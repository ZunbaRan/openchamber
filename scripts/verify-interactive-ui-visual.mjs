import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzip } from 'node:zlib';
import { promisify } from 'node:util';
import sharp from 'sharp';
import { startMockBusinessServer } from '../examples/interactive-ui/mock-business-server.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(projectRoot, 'examples', 'interactive-ui');
const outputDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-visual-smoke');
const goldenDirectory = path.join(projectRoot, 'tests', 'visual', 'interactive-ui', 'golden');
const goldenManifestPath = path.join(goldenDirectory, 'manifest.json');
const gzipAsync = promisify(gzip);
const artifactRuntimes = new Set(['artifact-static', 'artifact-interactive']);
const runtimes = ['generated', 'declarative', 'native', 'crm', 'artifact-static', 'artifact-interactive'];
const updateGoldens = process.argv.includes('--update-goldens');
const pixelChannelThreshold = 12;
const changedPixelRatioThreshold = 0.0005;
const meanChannelDeltaThreshold = 0.05;
const artifactPaintSettleMs = 250;

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

const compareScreenshot = async (actualPath, expectedPath, diffPath) => {
  const [actual, expected] = await Promise.all([
    sharp(actualPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
    sharp(expectedPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true }),
  ]);
  assert.deepEqual(
    { width: actual.info.width, height: actual.info.height, channels: actual.info.channels },
    { width: expected.info.width, height: expected.info.height, channels: expected.info.channels },
    `${path.basename(actualPath)} dimensions changed`,
  );

  const pixels = actual.info.width * actual.info.height;
  const channels = actual.info.channels;
  let changedPixels = 0;
  let totalChannelDelta = 0;
  const diff = Buffer.alloc(actual.data.length);
  for (let offset = 0; offset < actual.data.length; offset += channels) {
    let pixelDelta = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const delta = Math.abs(actual.data[offset + channel] - expected.data[offset + channel]);
      pixelDelta = Math.max(pixelDelta, delta);
      totalChannelDelta += delta;
    }
    if (pixelDelta > pixelChannelThreshold) changedPixels += 1;
    const marker = pixelDelta > pixelChannelThreshold ? 255 : Math.round(actual.data[offset] * 0.2);
    diff[offset] = marker;
    diff[offset + 1] = pixelDelta > pixelChannelThreshold ? 0 : marker;
    diff[offset + 2] = pixelDelta > pixelChannelThreshold ? 180 : marker;
    diff[offset + 3] = 255;
  }
  const changedPixelRatio = changedPixels / pixels;
  const meanChannelDelta = totalChannelDelta / actual.data.length;
  const passed = changedPixelRatio <= changedPixelRatioThreshold
    && meanChannelDelta <= meanChannelDeltaThreshold;
  if (!passed) {
    await sharp(diff, { raw: actual.info }).png().toFile(diffPath);
  }
  return {
    passed,
    changedPixels,
    changedPixelRatio: Math.round(changedPixelRatio * 1_000_000) / 1_000_000,
    meanChannelDelta: Math.round(meanChannelDelta * 1_000_000) / 1_000_000,
  };
};

const close = (server) => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));

const reservePort = async () => {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', resolve);
    server.once('error', reject);
  });
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  await close(server);
  return port;
};

const findChrome = async () => {
  const candidates = [
    process.env.OPENCHAMBER_TEST_CHROME,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // Try the next reviewed browser path.
    }
  }
  throw new Error('Chrome/Chromium not found; set OPENCHAMBER_TEST_CHROME to an executable path');
};

const waitForDebugger = async (port, processOutput) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {
      // Browser startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Chrome DevTools did not start: ${processOutput().slice(-2_000)}`);
};

const connect = async (target) => {
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  let requestId = 0;
  const pending = new Map();
  const runtimeErrors = [];
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') runtimeErrors.push(message.params.exceptionDetails.text);
    if (message.id && pending.has(message.id)) {
      pending.get(message.id).resolve(message);
      pending.delete(message.id);
    }
  });
  const rejectPending = (error) => {
    for (const pendingRequest of pending.values()) pendingRequest.reject(error);
    pending.clear();
  };
  socket.addEventListener('error', () => rejectPending(new Error('Chrome DevTools socket failed')));
  socket.addEventListener('close', () => rejectPending(new Error('Chrome DevTools socket closed')));
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++requestId;
    const timeout = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Chrome DevTools ${method} timed out`));
    }, 10_000);
    pending.set(id, {
      reject,
      resolve(message) {
        clearTimeout(timeout);
        resolve(message);
      },
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression) => {
    const reply = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (reply.error) throw new Error(`Chrome Runtime.evaluate failed: ${reply.error.message}`);
    if (reply.result?.exceptionDetails) throw new Error(reply.result.exceptionDetails.text);
    return reply.result?.result?.value;
  };
  return { socket, send, evaluate, runtimeErrors };
};

const waitFor = async (browser, expression, label) => {
  for (let attempt = 0; attempt < 160; attempt += 1) {
    if (await browser.evaluate(expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const diagnostics = await browser.evaluate(`(() => ({
    url: location.href,
    readyState: document.readyState,
    bodyText: document.body?.innerText?.slice(0, 500) || '',
    alerts: Array.from(document.querySelectorAll('[role="alert"]')).map((element) => element.textContent?.trim().slice(0, 200) || ''),
  }))()`);
  throw new Error(`Timed out waiting for ${label}; state=${JSON.stringify(diagnostics)}`);
};

const percentile50 = (values) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10;
};

const collectBundleBaseline = async () => {
  const assetsDirectory = path.join(projectRoot, 'packages', 'web', 'dist', 'assets');
  const names = await fs.readdir(assetsDirectory);
  const prefixes = ['main-', 'interactiveUiDemo-', 'InteractiveUIView-', 'HTMLArtifactView-'];
  const entries = [];
  for (const prefix of prefixes) {
    const matches = names.filter((name) => name.startsWith(prefix) && name.endsWith('.js'));
    if (matches.length === 0) continue;
    const candidates = await Promise.all(matches.map(async (file) => ({
      file,
      size: (await fs.stat(path.join(assetsDirectory, file))).size,
    })));
    const file = candidates.sort((left, right) => right.size - left.size)[0].file;
    const bytes = await fs.readFile(path.join(assetsDirectory, file));
    entries.push({ file, bytes: bytes.byteLength, gzipBytes: (await gzipAsync(bytes)).byteLength });
  }
  return entries;
};

const dataDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-visual-data-'));
const chromeDirectory = await fs.mkdtemp(path.join(os.tmpdir(), 'openchamber-visual-chrome-'));
const opencodeConfigDirectory = path.join(dataDirectory, 'opencode-config');
let mock;
let openchamber;
let chromeProcess;
let browser;
let failure;
const screenshotFiles = [];

const writeScreenshot = async (file, encodedPng) => {
  await fs.writeFile(path.join(outputDirectory, file), Buffer.from(encodedPng, 'base64'));
  screenshotFiles.push(file);
};

try {
  await fs.rm(outputDirectory, { recursive: true, force: true });
  await fs.mkdir(outputDirectory, { recursive: true });
  await fs.mkdir(opencodeConfigDirectory, { recursive: true });
  const fixtureExtensionRoot = path.join(dataDirectory, 'visual-extensions');
  await fs.mkdir(fixtureExtensionRoot, { recursive: true });
  for (const extensionName of ['acme-sales', 'acme-crm']) {
    await fs.cp(path.join(extensionRoot, extensionName), path.join(fixtureExtensionRoot, extensionName), { recursive: true });
  }
  mock = await startMockBusinessServer({ token: 'visual-test-secret' });
  process.env.OPENCHAMBER_DATA_DIR = dataDirectory;
  process.env.OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR = opencodeConfigDirectory;
  process.env.OPENCODE_CONFIG_DIR = opencodeConfigDirectory;
  process.env.OCIX_DEMO_API_URL = mock.url;
  process.env.OCIX_DEMO_TOKEN = 'visual-test-secret';
  process.env.OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR = fixtureExtensionRoot;
  process.env.OPENCODE_SKIP_START = 'true';
  process.env.OPENCHAMBER_SKIP_OPENCODE_START = 'true';
  process.env.OPENCODE_HOST = 'http://127.0.0.1:9';
  process.env.OPENCODE_PORT = '9';
  process.env.OPENCHAMBER_HTML_ARTIFACTS_STATIC = 'true';
  process.env.OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS = 'true';

  const { startWebUiServer } = await import('../packages/web/server/index.js');
  openchamber = await startWebUiServer({ host: '127.0.0.1', port: 0, attachSignals: false, exitOnShutdown: false });
  let appUrl = `http://127.0.0.1:${openchamber.getPort()}`;

  const debugPort = await reservePort();
  const chromeBinary = await findChrome();
  let browserOutput = '';
  chromeProcess = spawn(chromeBinary, [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${chromeDirectory}`,
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  chromeProcess.stderr.on('data', (chunk) => {
    browserOutput = `${browserOutput}${String(chunk)}`.slice(-8_000);
  });
  await waitForDebugger(debugPort, () => browserOutput);
  const browserVersionResponse = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
  assert.equal(browserVersionResponse.ok, true);
  const browserVersionInfo = await browserVersionResponse.json();

  const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?about:blank`, { method: 'PUT' });
  assert.equal(targetResponse.ok, true);
  const target = await targetResponse.json();
  browser = await connect(target);
  await browser.send('Runtime.enable');
  await browser.send('Page.enable');

  const cases = [];
  const widths = [1440, 1024, 768, 390];
  for (const runtime of runtimes) {
    for (const theme of ['light', 'dark']) {
      for (const width of widths) cases.push({ runtime, theme, width, locale: 'zh-CN' });
    }
    cases.push({ runtime, theme: 'light', width: 390, locale: 'en' });
  }

  const results = [];
  const stateCases = [];
  for (const entry of cases) {
    const startedAt = Date.now();
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: entry.width,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: entry.width <= 390,
    });
    const query = new URLSearchParams({
      runtime: entry.runtime,
      theme: entry.theme,
      ocPanel: 'session-chat',
      themeMode: entry.theme,
      themeVariant: entry.theme,
      locale: entry.locale,
      mobile: String(entry.width <= 390),
    });
    await browser.send('Page.navigate', { url: `${appUrl}/interactive-ui-demo.html?${query}` });
    await waitFor(browser, `document.readyState === 'complete'`, 'document load');
    if (artifactRuntimes.has(entry.runtime)) {
      await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="ready"]') !== null`, `${entry.runtime} artifact ready`);
      // The ready bridge message can reach the host before Chromium composites the
      // opaque nested Artifact frame. Keep this delay in readyMs so the runtime
      // budget covers what users can actually see rather than bridge readiness.
      await browser.evaluate(`new Promise((resolve) => setTimeout(resolve, ${artifactPaintSettleMs}))`);
    } else {
      await waitFor(browser, `Boolean(document.querySelector('[data-ocix-view-metadata]'))`, `${entry.runtime} view metadata`);
      await waitFor(browser, `document.querySelectorAll('tbody tr').length > 0`, `${entry.runtime} rendered rows`);
    }
    const readyMs = Date.now() - startedAt;

    const metrics = await browser.evaluate(`(() => {
      const root = document.documentElement;
      const scope = document.querySelector('.ocix-scope');
      const table = document.querySelector('table');
      const tableScroller = table?.parentElement;
      const styles = scope ? getComputedStyle(scope) : null;
      const colorToRgb = (value) => {
        if (!value) return null;
        const canvas = document.createElement('canvas');
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) return null;
        context.clearRect(0, 0, 1, 1);
        context.fillStyle = value;
        context.fillRect(0, 0, 1, 1);
        return Array.from(context.getImageData(0, 0, 1, 1).data.slice(0, 3));
      };
      const luminance = (rgb) => {
        if (!rgb) return null;
        const values = rgb.map((channel) => {
          const normalized = channel / 255;
          return normalized <= 0.04045 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4);
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const contrast = (foreground, background) => {
        const foregroundLuminance = luminance(colorToRgb(foreground));
        const backgroundLuminance = luminance(colorToRgb(background));
        if (foregroundLuminance === null || backgroundLuminance === null) return 0;
        const lighter = Math.max(foregroundLuminance, backgroundLuminance);
        const darker = Math.min(foregroundLuminance, backgroundLuminance);
        return Math.round(((lighter + 0.05) / (darker + 0.05)) * 100) / 100;
      };
      const surfaceToken = styles?.getPropertyValue('--ocix-surface').trim() || '';
      const foregroundToken = styles?.getPropertyValue('--ocix-foreground').trim() || '';
      const mutedForegroundToken = styles?.getPropertyValue('--ocix-muted-foreground').trim() || '';
      const artifactHost = document.querySelector('[data-ocix-artifact-host]');
      const artifactFrame = artifactHost?.querySelector('iframe');
      const artifactResources = performance.getEntriesByType('resource')
        .filter((entry) => entry.name.includes('/api/interactive-ui/artifacts/'))
        .map((entry) => ({ name: entry.name.split('/api/interactive-ui/')[1] || '', duration: Math.round(entry.duration * 10) / 10 }));
      const accessibleName = (element) => {
        const labelledBy = element.getAttribute('aria-labelledby');
        if (labelledBy) {
          const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim();
          if (text) return text;
        }
        if (element.getAttribute('aria-label')?.trim()) return element.getAttribute('aria-label').trim();
        if (element.getAttribute('title')?.trim()) return element.getAttribute('title').trim();
        if (element instanceof HTMLInputElement && element.labels?.length) {
          const text = Array.from(element.labels).map((label) => label.textContent || '').join(' ').trim();
          if (text) return text;
        }
        return element.textContent?.trim() || '';
      };
      const controls = Array.from(document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [tabindex]:not([tabindex="-1"])'));
      const ids = Array.from(document.querySelectorAll('[id]')).map((element) => element.id).filter(Boolean);
      const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
      const brokenAriaReferences = Array.from(document.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby]')).flatMap((element) =>
        ['aria-controls', 'aria-labelledby', 'aria-describedby'].flatMap((attribute) =>
          (element.getAttribute(attribute) || '').split(/\s+/).filter(Boolean).filter((id) => !document.getElementById(id)).map((id) => ({ attribute, id }))
        )
      );
      return {
        innerWidth,
        pageWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
        surface: surfaceToken,
        foreground: foregroundToken,
        contrast: {
          foreground: contrast(foregroundToken, surfaceToken),
          muted: contrast(mutedForegroundToken, surfaceToken),
        },
        rows: document.querySelectorAll('tbody tr').length,
        hasSummary: Boolean(document.querySelector('[data-ocix-view-summary], [data-ocix-artifact-summary]')),
        metadataText: document.querySelector('[data-ocix-view-metadata]')?.textContent || '',
        hasError: Boolean(document.querySelector('[role="alert"]')),
        tableLocalOverflow: Boolean(table && tableScroller && table.scrollWidth > tableScroller.clientWidth),
        artifactState: artifactHost?.getAttribute('data-ocix-artifact-state') || '',
        artifactMode: artifactHost?.getAttribute('data-ocix-artifact-mode') || '',
        artifactScripts: artifactHost?.getAttribute('data-ocix-artifact-scripts') || '',
        artifactSandbox: artifactFrame?.getAttribute('sandbox') ?? null,
        artifactResources,
        accessibility: {
          controls: controls.length,
          controlsMissingName: controls.filter((element) => !accessibleName(element)).length,
          duplicateIds: Array.from(new Set(duplicateIds)),
          brokenAriaReferences,
          iframeMissingTitle: Array.from(document.querySelectorAll('iframe')).filter((frame) => !frame.getAttribute('title')?.trim()).length,
          imagesMissingAlt: Array.from(document.querySelectorAll('img')).filter((image) => !image.hasAttribute('alt')).length,
        },
        bodyText: document.body.innerText.slice(0, 800)
      };
    })()`);
    assert.equal(metrics.pageWidth <= metrics.innerWidth + 1, true, `${entry.runtime}/${entry.theme}/${entry.width} has page overflow`);
    assert.equal(metrics.hasSummary, true);
    assert.equal(metrics.hasError, false);
    assert.notEqual(metrics.surface, '');
    assert.notEqual(metrics.foreground, '');
    assert.equal(metrics.contrast.foreground >= 7, true, `${entry.runtime}/${entry.theme} primary text contrast is ${metrics.contrast.foreground}`);
    assert.equal(metrics.contrast.muted >= 4.5, true, `${entry.runtime}/${entry.theme} muted text contrast is ${metrics.contrast.muted}`);
    assert.equal(metrics.accessibility.controlsMissingName, 0, `${entry.runtime} contains an unnamed control`);
    assert.deepEqual(metrics.accessibility.duplicateIds, [], `${entry.runtime} contains duplicate IDs`);
    assert.deepEqual(metrics.accessibility.brokenAriaReferences, [], `${entry.runtime} contains broken ARIA references`);
    assert.equal(metrics.accessibility.iframeMissingTitle, 0, `${entry.runtime} contains an untitled iframe`);
    assert.equal(metrics.accessibility.imagesMissingAlt, 0, `${entry.runtime} contains an image without alt text`);
    if (artifactRuntimes.has(entry.runtime)) {
      assert.equal(metrics.artifactState, 'ready');
      assert.equal(metrics.artifactMode, 'inline');
      assert.equal(metrics.artifactScripts, String(entry.runtime === 'artifact-interactive'));
      assert.equal(metrics.artifactSandbox, entry.runtime === 'artifact-interactive' ? 'allow-scripts' : '');
    } else {
      assert.equal(metrics.rows > 0, true);
      if (entry.width === 390) assert.equal(metrics.tableLocalOverflow, true, `${entry.runtime} table should scroll locally at 390px`);
    }
    if (entry.locale === 'en' && !artifactRuntimes.has(entry.runtime)) {
      assert.match(metrics.metadataText, entry.runtime === 'generated' ? /Snapshot/ : /Live data/);
    }

    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    assert.equal(typeof screenshot.result?.data, 'string');
    const file = `${entry.runtime}-${entry.theme}-${entry.width}-${entry.locale}.png`;
    await writeScreenshot(file, screenshot.result.data);
    results.push({
      ...entry,
      file,
      surface: metrics.surface,
      foreground: metrics.foreground,
      contrast: metrics.contrast,
      rows: metrics.rows,
      readyMs,
      artifactResources: metrics.artifactResources,
    });

    if (entry.runtime === 'generated' && entry.theme === 'light' && entry.width === 1024 && entry.locale === 'zh-CN') {
      const keyboardBefore = await browser.evaluate(`(() => {
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
        const accordion = document.querySelector('button[aria-expanded]');
        tabs[0]?.focus();
        return {
          tabs: tabs.length,
          selected: tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'),
          activeIsFirstTab: document.activeElement === tabs[0],
          accordionExpanded: accordion?.getAttribute('aria-expanded') || '',
        };
      })()`);
      assert.equal(keyboardBefore.tabs >= 2, true);
      assert.equal(keyboardBefore.selected, 0);
      assert.equal(keyboardBefore.activeIsFirstTab, true);
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight' });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight' });
      await waitFor(browser, `document.querySelectorAll('[role="tab"]')[1]?.getAttribute('aria-selected') === 'true'`, 'generated tab keyboard selection');
      const keyboardAfterTab = await browser.evaluate(`(() => {
        const tabs = Array.from(document.querySelectorAll('[role="tab"]'));
        return {
          selected: tabs.findIndex((tab) => tab.getAttribute('aria-selected') === 'true'),
          activeIsSecondTab: document.activeElement === tabs[1],
          selectedPanelVisible: !document.getElementById(tabs[1]?.getAttribute('aria-controls') || '')?.hidden,
        };
      })()`);
      assert.deepEqual(keyboardAfterTab, { selected: 1, activeIsSecondTab: true, selectedPanelVisible: true });

      const accordionBefore = await browser.evaluate(`(() => {
        const trigger = document.querySelector('button[aria-expanded]');
        trigger?.focus();
        return trigger?.getAttribute('aria-expanded') || '';
      })()`);
      await browser.send('Input.dispatchKeyEvent', { type: 'keyDown', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
      await browser.send('Input.dispatchKeyEvent', { type: 'keyUp', key: ' ', code: 'Space', windowsVirtualKeyCode: 32, nativeVirtualKeyCode: 32 });
      await waitFor(browser, `document.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded') !== ${JSON.stringify(accordionBefore)}`, 'generated accordion keyboard toggle');
      const keyboardAfterAccordion = await browser.evaluate(`(() => {
        const trigger = document.querySelector('button[aria-expanded]');
        const panel = document.getElementById(trigger?.getAttribute('aria-controls') || '');
        return {
          activeIsTrigger: document.activeElement === trigger,
          expanded: trigger?.getAttribute('aria-expanded') || '',
          panelHidden: panel?.hidden ?? null,
        };
      })()`);
      assert.equal(keyboardAfterAccordion.activeIsTrigger, true);
      assert.notEqual(keyboardAfterAccordion.expanded, accordionBefore);
      assert.equal(keyboardAfterAccordion.panelHidden, keyboardAfterAccordion.expanded !== 'true');
    }

    if (artifactRuntimes.has(entry.runtime) && entry.theme === 'light' && entry.width === 1024 && entry.locale === 'zh-CN') {
      await browser.evaluate(`(() => {
        window.__openchamberArtifactFixtureFrame = document.querySelector('[data-ocix-artifact-host] iframe');
        return Boolean(window.__openchamberArtifactFixtureFrame);
      })()`);
      for (const mode of ['workspace', 'fullscreen']) {
        await browser.evaluate(`document.querySelector('[data-ocix-artifact-action="${mode}"]')?.click()`);
        await waitFor(browser, `document.querySelector('[data-ocix-artifact-mode="${mode}"]') !== null`, `${entry.runtime} ${mode} mode`);
        const retained = await browser.evaluate(`window.__openchamberArtifactFixtureFrame === document.querySelector('[data-ocix-artifact-host] iframe')`);
        assert.equal(retained, true, `${entry.runtime} should retain the iframe instance in ${mode}`);
        const expandedScreenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        const expandedFile = `${entry.runtime}-light-1024-zh-CN-${mode}.png`;
        await writeScreenshot(expandedFile, expandedScreenshot.result.data);
        await browser.evaluate(`document.querySelector('[data-ocix-artifact-action="inline"]')?.click()`);
        await waitFor(browser, `document.querySelector('[data-ocix-artifact-mode="inline"]') !== null`, `${entry.runtime} return inline`);
      }
    }
  }

  for (const runtime of runtimes) {
    const light = results.find((entry) => entry.runtime === runtime && entry.theme === 'light' && entry.width === 1024);
    const dark = results.find((entry) => entry.runtime === runtime && entry.theme === 'dark' && entry.width === 1024);
    assert(light && dark);
    assert.notEqual(light.surface, dark.surface, `${runtime} light/dark surface tokens should differ`);
    assert.notEqual(light.foreground, dark.foreground, `${runtime} light/dark foreground tokens should differ`);
  }

  const verifyFailureState = async ({ runtime, expectedState, expectedRole, surface = 'desktop' }) => {
    await browser.send('Emulation.setDeviceMetricsOverride', {
      width: 1024,
      height: 1000,
      deviceScaleFactor: 1,
      mobile: false,
    });
    const query = new URLSearchParams({
      runtime,
      theme: 'light',
      ocPanel: 'session-chat',
      themeMode: 'light',
      themeVariant: 'light',
      locale: 'zh-CN',
      mobile: String(surface === 'mobile'),
      surface,
    });
    const runtimeErrorOffset = browser.runtimeErrors.length;
    await browser.send('Page.navigate', { url: `${appUrl}/interactive-ui-demo.html?${query}` });
    await waitFor(browser, `document.readyState === 'complete'`, `${runtime} document load`);
    await waitFor(browser, `document.querySelector('[data-ocix-artifact-state="${expectedState}"]') !== null`, `${runtime} ${expectedState} state`);
    const observed = await browser.evaluate(`(() => {
      const host = document.querySelector('[data-ocix-artifact-host]');
      const notice = document.querySelector('[data-ocix-artifact-failure="${expectedState}"]');
      return {
        state: host?.getAttribute('data-ocix-artifact-state') || '',
        failure: notice?.getAttribute('data-ocix-artifact-failure') || '',
        role: notice?.getAttribute('role') || '',
        iframeCount: host?.querySelectorAll('iframe').length ?? -1,
        fallbackPresent: Boolean(host?.querySelector('details[data-ocix-artifact-fallback]')),
        fallbackOpen: host?.querySelector('details[data-ocix-artifact-fallback]')?.hasAttribute('open') ?? false,
        fallbackSummary: host?.querySelector('details[data-ocix-artifact-fallback] summary')?.textContent?.trim() || '',
        pageWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
        innerWidth,
        brokenAriaReferences: Array.from(document.querySelectorAll('[aria-controls], [aria-labelledby], [aria-describedby]')).flatMap((element) =>
          ['aria-controls', 'aria-labelledby', 'aria-describedby'].flatMap((attribute) =>
            (element.getAttribute(attribute) || '').split(/\s+/).filter(Boolean).filter((id) => !document.getElementById(id)).map((id) => ({ attribute, id }))
          )
        ),
      };
    })()`);
    assert.equal(observed.state, expectedState);
    assert.equal(observed.failure, expectedState);
    assert.equal(observed.role, expectedRole);
    assert.equal(observed.iframeCount, 0);
    assert.equal(observed.fallbackPresent, true);
    assert.equal(observed.fallbackOpen, false);
    assert.notEqual(observed.fallbackSummary, '');
    assert.equal(observed.pageWidth <= observed.innerWidth + 1, true);
    assert.deepEqual(observed.brokenAriaReferences, []);
    const newRuntimeErrors = browser.runtimeErrors.slice(runtimeErrorOffset);
    assert.equal(newRuntimeErrors.length, 0, newRuntimeErrors.join('\n'));
    const screenshot = await browser.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
    const file = `${runtime}-${surface}-light-1024-zh-CN-${expectedState}.png`;
    await writeScreenshot(file, screenshot.result.data);
    stateCases.push({ runtime, surface, expectedState, expectedRole, file });
  };

  await verifyFailureState({ runtime: 'artifact-blocked', expectedState: 'blocked', expectedRole: 'alert' });
  await verifyFailureState({ runtime: 'artifact-crashed', expectedState: 'crashed', expectedRole: 'alert' });
  await verifyFailureState({ runtime: 'artifact-interactive', surface: 'mobile', expectedState: 'scripts-disabled', expectedRole: 'status' });

  await openchamber.stop();
  process.env.OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS = 'false';
  openchamber = await startWebUiServer({ host: '127.0.0.1', port: 0, attachSignals: false, exitOnShutdown: false });
  appUrl = `http://127.0.0.1:${openchamber.getPort()}`;
  await verifyFailureState({ runtime: 'artifact-interactive', expectedState: 'scripts-disabled', expectedRole: 'status' });

  assert.equal(browser.runtimeErrors.length, 0, browser.runtimeErrors.join('\n'));

  const bundleBaseline = await collectBundleBaseline();
  const readyBaseline = Object.fromEntries(runtimes.map((runtime) => [
    runtime,
    {
      medianMs: percentile50(results.filter((entry) => entry.runtime === runtime).map((entry) => entry.readyMs)),
      samples: results.filter((entry) => entry.runtime === runtime).length,
    },
  ]));
  const uniqueScreenshotFiles = [...new Set(screenshotFiles)].sort();
  assert.equal(uniqueScreenshotFiles.length, screenshotFiles.length, 'Visual suite produced duplicate screenshot names');
  const screenshotEntries = await Promise.all(uniqueScreenshotFiles.map(async (file) => {
    const bytes = await fs.readFile(path.join(outputDirectory, file));
    const metadata = await sharp(bytes).metadata();
    return {
      file,
      width: metadata.width,
      height: metadata.height,
      sha256: sha256(bytes),
    };
  }));
  let goldenResult;
  if (updateGoldens) {
    await fs.rm(goldenDirectory, { recursive: true, force: true });
    await fs.mkdir(goldenDirectory, { recursive: true });
    for (const file of uniqueScreenshotFiles) {
      await fs.copyFile(path.join(outputDirectory, file), path.join(goldenDirectory, file));
    }
    const manifest = {
      $schema: 'openchamber://interactive-ui-visual-golden/v1',
      baselineDate: '2026-07-21',
      platform: `${process.platform}-${process.arch}`,
      browser: browserVersionInfo.Browser || 'unknown',
      thresholds: {
        pixelChannel: pixelChannelThreshold,
        changedPixelRatio: changedPixelRatioThreshold,
        meanChannelDelta: meanChannelDeltaThreshold,
      },
      screenshots: screenshotEntries,
    };
    await fs.writeFile(goldenManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    goldenResult = { mode: 'updated', cases: uniqueScreenshotFiles.length, failures: 0 };
  } else {
    let manifest;
    try {
      manifest = JSON.parse(await fs.readFile(goldenManifestPath, 'utf8'));
    } catch (error) {
      throw new Error(`Visual Golden is missing or invalid. Review the screenshots, then run bun run test:interactive-ui-visual:update. ${error instanceof Error ? error.message : String(error)}`);
    }
    assert.equal(manifest.$schema, 'openchamber://interactive-ui-visual-golden/v1');
    const expectedFiles = manifest.screenshots.map((entry) => entry.file).sort();
    assert.deepEqual(uniqueScreenshotFiles, expectedFiles, 'Visual Golden file set changed');
    const goldenPngFiles = (await fs.readdir(goldenDirectory)).filter((file) => file.endsWith('.png')).sort();
    assert.deepEqual(goldenPngFiles, expectedFiles, 'Visual Golden directory contains missing or stale PNG files');
    const comparisons = [];
    for (const file of uniqueScreenshotFiles) {
      const result = await compareScreenshot(
        path.join(outputDirectory, file),
        path.join(goldenDirectory, file),
        path.join(outputDirectory, file.replace(/\.png$/, '.diff.png')),
      );
      comparisons.push({ file, ...result });
    }
    const failures = comparisons.filter((entry) => !entry.passed);
    assert.equal(
      failures.length,
      0,
      `Visual Golden mismatch:\n${failures.map((entry) => `${entry.file}: changed=${entry.changedPixelRatio}, mean=${entry.meanChannelDelta}`).join('\n')}`,
    );
    goldenResult = {
      mode: 'checked',
      cases: comparisons.length,
      failures: 0,
      maxChangedPixelRatio: Math.max(...comparisons.map((entry) => entry.changedPixelRatio)),
      maxMeanChannelDelta: Math.max(...comparisons.map((entry) => entry.meanChannelDelta)),
    };
  }
  const report = {
    ok: true,
    cases: results.length,
    runtimes,
    themes: ['light', 'dark'],
    widths,
    locales: ['zh-CN', 'en'],
    displayModes: ['inline', 'workspace', 'fullscreen'],
    screenshots: outputDirectory,
    runtimeErrors: browser.runtimeErrors.length,
    accessibility: {
      unnamedControls: 0,
      duplicateIds: 0,
      brokenAriaReferences: 0,
      untitledIframes: 0,
      imagesWithoutAlt: 0,
      generatedTabsKeyboard: 'passed',
      generatedAccordionKeyboard: 'passed',
    },
    goldens: goldenResult,
    stateCases,
    readyBaseline,
    bundleBaseline,
    results,
  };
  await fs.writeFile(path.join(outputDirectory, 'baseline.json'), `${JSON.stringify(report, null, 2)}\n`);

  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
} catch (error) {
  failure = error;
} finally {
  browser?.socket.close();
  if (chromeProcess && chromeProcess.exitCode === null) {
    chromeProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => chromeProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]);
  }
  await openchamber?.stop().catch(() => {});
  await mock?.close().catch(() => {});
  await fs.rm(dataDirectory, { recursive: true, force: true });
  await fs.rm(chromeDirectory, { recursive: true, force: true });
}

if (failure) {
  if (browser?.runtimeErrors.length) {
    console.error(`Browser runtime errors:\n${browser.runtimeErrors.join('\n')}`);
  }
  console.error(failure instanceof Error ? failure.stack : String(failure));
  process.exit(1);
}
process.exit(0);
