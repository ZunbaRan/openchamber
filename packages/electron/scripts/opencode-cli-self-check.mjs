import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SHA256_RE = /^[a-f0-9]{64}$/;
const GENERATIVE_WIDGET_SCHEMA = 'com.openchamber.generative-widget-assets.v1';
const GENERATIVE_WIDGET_SKILL = 'generative-widget-guidelines';

export const readBinaryVersion = (binaryPath) => {
  if (!fs.existsSync(binaryPath)) return null;
  const result = spawnSync(binaryPath, ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 15_000,
    windowsHide: true,
  });
  if (result.status !== 0) return null;
  return (result.stdout || '').trim().split(/\s+/)[0] || null;
};

export const validateGenerativeWidgetManifest = (manifest, source = 'OpenCode CLI') => {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`${source} returned an invalid Generative Widget asset manifest`);
  }
  if (manifest.schema !== GENERATIVE_WIDGET_SCHEMA) {
    throw new Error(`${source} returned an unsupported Generative Widget asset schema`);
  }
  if (manifest.skill !== GENERATIVE_WIDGET_SKILL) {
    throw new Error(`${source} did not verify the ${GENERATIVE_WIDGET_SKILL} skill`);
  }
  if (!SHA256_RE.test(manifest.promptSha256) || !SHA256_RE.test(manifest.skillSha256)) {
    throw new Error(`${source} returned invalid Generative Widget asset digests`);
  }
  return manifest;
};

const verifyGenerativeWidgetAssets = (binaryPath) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-opencode-assets-'));
  const config = path.join(root, 'opencode-config');
  const xdgConfig = path.join(root, 'xdg-config');
  const xdgData = path.join(root, 'xdg-data');
  const xdgState = path.join(root, 'xdg-state');
  const xdgCache = path.join(root, 'xdg-cache');

  try {
    for (const directory of [config, xdgConfig, xdgData, xdgState, xdgCache]) {
      fs.mkdirSync(directory, { recursive: true });
    }

    const result = spawnSync(binaryPath, ['--pure', 'debug', 'generative-widget'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      windowsHide: true,
      env: {
        ...process.env,
        HOME: root,
        USERPROFILE: root,
        OPENCODE_TEST_HOME: root,
        OPENCODE_CONFIG_DIR: config,
        OPENCODE_CONFIG_CONTENT: '{}',
        OPENCODE_DISABLE_AUTOUPDATE: '1',
        OPENCODE_DISABLE_AUTOCOMPACT: '1',
        OPENCODE_DISABLE_CLAUDE_CODE: '1',
        OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: '1',
        OPENCODE_DISABLE_EXTERNAL_SKILLS: '1',
        OPENCODE_DISABLE_MODELS_FETCH: '1',
        OPENCODE_DISABLE_PROJECT_CONFIG: '1',
        XDG_CONFIG_HOME: xdgConfig,
        XDG_DATA_HOME: xdgData,
        XDG_STATE_HOME: xdgState,
        XDG_CACHE_HOME: xdgCache,
      },
    });

    if (result.status !== 0) {
      const stderr = result.stderr ? `\n${result.stderr.trim()}` : '';
      const stdout = result.stdout ? `\n${result.stdout.trim()}` : '';
      const error = result.error?.message ? `\n${result.error.message}` : '';
      throw new Error(`OpenCode Generative Widget asset self-check failed: ${binaryPath}${stderr}${stdout}${error}`);
    }

    let manifest;
    try {
      manifest = JSON.parse((result.stdout || '').trim());
    } catch {
      throw new Error(`OpenCode Generative Widget asset self-check returned invalid JSON: ${binaryPath}`);
    }
    return validateGenerativeWidgetManifest(manifest, binaryPath);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
};

export const assertOpenCodeCliBinary = (binaryPath, expectedVersion) => {
  if (!fs.existsSync(binaryPath)) {
    throw new Error(`Bundled OpenCode CLI not found: ${binaryPath}`);
  }
  const stat = fs.statSync(binaryPath);
  if (!stat.isFile()) {
    throw new Error(`Bundled OpenCode CLI is not a file: ${binaryPath}`);
  }
  if (process.platform !== 'win32' && (stat.mode & 0o111) === 0) {
    throw new Error(`Bundled OpenCode CLI is not executable: ${binaryPath}`);
  }

  const actualVersion = readBinaryVersion(binaryPath);
  if (actualVersion !== expectedVersion) {
    throw new Error(
      `Bundled OpenCode CLI version mismatch at ${binaryPath}: expected ${expectedVersion}, got ${actualVersion || '(empty)'}`,
    );
  }

  const manifest = verifyGenerativeWidgetAssets(binaryPath);
  console.log(`[electron] verified bundled OpenCode CLI ${actualVersion} with Generative Widget assets: ${binaryPath}`);
  return manifest;
};
