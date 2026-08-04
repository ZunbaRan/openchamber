import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ACCEPTANCE_MCP_SERVER_NAME,
  assessAcceptanceOpenCodeCliMismatch,
  buildAcceptanceMcpConfigContent,
  captureSpawnedProcessEvidence,
  configureAcceptanceProject,
  readAcceptanceOpenCodeCliVersion,
  selectAcceptanceOpenCodeCliPath,
  validateAcceptanceMcpUrl,
} from './lib/tldraw-mcp-app-browser-orchestration.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.dirname(projectRoot);
const tldrawRepository = path.resolve(
  process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_REPO_DIR?.trim()
    || path.join(workspaceRoot, 'tldraw-mcp-app'),
);
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const evidenceDirectory = path.join(projectRoot, '.tmp', 'tldraw-mcp-app-browser-orchestrated', runId);
const browserEvidenceDirectory = path.join(evidenceDirectory, 'browser');
const logsDirectory = path.join(evidenceDirectory, 'logs');
const runtimeRoot = path.join(os.tmpdir(), `openchamber-tldraw-e2e-${randomUUID()}`);
const runtime = {
  root: runtimeRoot,
  home: path.join(runtimeRoot, 'home'),
  tmp: path.join(runtimeRoot, 'tmp'),
  xdgData: path.join(runtimeRoot, 'xdg-data'),
  xdgState: path.join(runtimeRoot, 'xdg-state'),
  xdgCache: path.join(runtimeRoot, 'xdg-cache'),
  tldraw: path.join(runtimeRoot, 'tldraw'),
  // interactive-ui-demo validates custom runtimes against its effective TMPDIR.
  // Keep the demo runtime under that same isolated root instead of as a sibling.
  demo: path.join(runtimeRoot, 'tmp', 'openchamber-interactive-ui-demo-runtime'),
};
const tldrawLogPath = path.join(logsDirectory, 'tldraw.log');
const openChamberLogPath = path.join(logsDirectory, 'openchamber.log');
const verifierLogPath = path.join(logsDirectory, 'browser-verifier.log');
const reportPath = path.join(evidenceDirectory, 'orchestration.json');
const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const inheritedEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => (
  !name.startsWith('OPENCHAMBER_')
  && !name.startsWith('OPENCODE_')
  && !name.startsWith('TLDRAW_MCP_')
)));

const reservePort = async () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    server.close((error) => {
      if (error) reject(error);
      else if (!port) reject(new Error('Could not reserve a loopback port'));
      else resolve(port);
    });
  });
});

const waitFor = async (operation, label, timeoutMs = 90_000, intervalMs = 200) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    if (interruptedSignal) throw new Error(`Acceptance interrupted by ${interruptedSignal}`);
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      if (error?.acceptanceFatal === true) throw error;
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`${label} did not become ready${lastError ? `: ${lastError.message}` : ''}`);
};

const assertChildRunning = (child, label) => {
  if (child && (child.exitCode !== null || child.signalCode !== null)) {
    const error = new Error(`${label} exited before becoming ready (${child.signalCode || child.exitCode})`);
    error.acceptanceFatal = true;
    throw error;
  }
};

const openLog = async (filePath) => {
  const handle = await fs.open(filePath, 'a', 0o600);
  await fs.chmod(filePath, 0o600);
  return handle;
};

const spawnLogged = async ({ command, args, cwd, env, logPath, name, tee = false }) => {
  if (tee) {
    const handle = await fs.open(logPath, 'a', 0o600);
    await fs.chmod(logPath, 0o600);
    const child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    });
    child.runtimeName = name;
    child.spawnedAt = new Date().toISOString();
    child.once('error', () => {});
    child.stdout.on('data', (chunk) => {
      process.stdout.write(chunk);
      void handle.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
      process.stderr.write(chunk);
      void handle.write(chunk);
    });
    child.once('close', () => void handle.close());
    return child;
  }
  const handle = await openLog(logPath);
  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', handle.fd, handle.fd],
      detached: process.platform !== 'win32',
    });
  } finally {
    await handle.close();
  }
  child.runtimeName = name;
  child.spawnedAt = new Date().toISOString();
  child.once('error', () => {});
  return child;
};

const childExit = (child) => new Promise((resolve, reject) => {
  child.once('error', reject);
  child.once('exit', (code, signal) => resolve({ code, signal }));
  if (child.exitCode !== null || child.signalCode !== null) {
    queueMicrotask(() => resolve({ code: child.exitCode, signal: child.signalCode }));
  }
});

const stopChild = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const send = (signal) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // The process already exited.
    }
  };
  send('SIGTERM');
  const exited = await Promise.race([
    childExit(child).then(() => true),
    delay(8_000).then(() => false),
  ]);
  if (!exited) {
    send('SIGKILL');
    await Promise.race([childExit(child), delay(2_000)]);
  }
};

const isPortClosed = (port) => new Promise((resolve) => {
  const socket = net.createConnection({ host: '127.0.0.1', port });
  socket.unref();
  socket.once('connect', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('error', () => resolve(true));
});

const readAuthContent = async () => {
  const fromEnvironment = process.env.OPENCODE_AUTH_CONTENT?.trim();
  if (fromEnvironment) {
    JSON.parse(fromEnvironment);
    return { content: fromEnvironment, source: 'environment' };
  }
  const userDataRoot = process.env.XDG_DATA_HOME?.trim()
    ? path.resolve(process.env.XDG_DATA_HOME)
    : path.join(os.homedir(), '.local', 'share');
  const authPath = path.resolve(
    process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_AUTH_FILE?.trim()
      || path.join(userDataRoot, 'opencode', 'auth.json'),
  );
  const content = await fs.readFile(authPath, 'utf8').catch((error) => {
    throw new Error(`OpenCode Provider auth is required for the real model-selection gate (${error.message})`);
  });
  JSON.parse(content);
  return { content, source: 'file' };
};

const runChecked = async ({ command, args, cwd, env = process.env, name }) => {
  const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
  activeCommandProcess = child;
  try {
    const { code, signal } = await childExit(child);
    if (code !== 0) throw new Error(`${name} failed (${signal || code})`);
  } finally {
    if (activeCommandProcess === child) activeCommandProcess = null;
  }
};

let activeCommandProcess;
let tldrawProcess;
let openChamberProcess;
let verifierProcess;
let tldrawPort;
let openChamberPort;
let interruptedSignal;
let cleanupPromise;
let runtimeRemoved = false;
let portsReleased = false;
let primaryFailure;
let browserReport = null;
let authSource = null;
let acceptanceOpenCodeCli = null;
let opencodeCliEvidence = null;
let mcpConfigEvidence = null;
let acceptanceProjectEvidence = null;

const cleanup = () => {
  if (cleanupPromise) return cleanupPromise;
  cleanupPromise = (async () => {
    await stopChild(activeCommandProcess);
    await stopChild(verifierProcess);
    await stopChild(openChamberProcess);
    await stopChild(tldrawProcess);
    if (openChamberPort && tldrawPort) {
      portsReleased = Boolean(await waitFor(
        async () => (await isPortClosed(openChamberPort)) && (await isPortClosed(tldrawPort)),
        'Acceptance ports to close',
        15_000,
        150,
      ).catch(() => false));
    }
    await fs.rm(runtimeRoot, { recursive: true, force: true });
    runtimeRemoved = true;
  })();
  return cleanupPromise;
};

const onSignal = (signal) => {
  interruptedSignal ||= signal;
  void cleanup();
};
const onSigint = () => onSignal('SIGINT');
const onSigterm = () => onSignal('SIGTERM');
process.once('SIGINT', onSigint);
process.once('SIGTERM', onSigterm);

try {
  await fs.mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await fs.mkdir(browserEvidenceDirectory, { recursive: true, mode: 0o700 });
  await fs.mkdir(logsDirectory, { recursive: true, mode: 0o700 });
  for (const directory of Object.values(runtime)) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  }
  acceptanceOpenCodeCli = await selectAcceptanceOpenCodeCliPath({ projectRoot });
  const acceptanceOpenCodeCliVersion = await readAcceptanceOpenCodeCliVersion({
    cliPath: acceptanceOpenCodeCli.resolved,
  });
  opencodeCliEvidence = {
    source: acceptanceOpenCodeCli.source,
    requested: acceptanceOpenCodeCli.requested,
    resolved: acceptanceOpenCodeCli.resolved,
    version: acceptanceOpenCodeCliVersion,
  };
  console.log(`[acceptance] OpenCode CLI (${acceptanceOpenCodeCli.source}): ${acceptanceOpenCodeCli.resolved}${acceptanceOpenCodeCliVersion ? ` (${acceptanceOpenCodeCliVersion})` : ''}`);
  const webIndex = path.join(projectRoot, 'packages', 'web', 'dist', 'index.html');
  await fs.access(webIndex).catch(() => {
    throw new Error('OpenChamber web assets are missing; run `bun run build:web` before the self-contained browser gate');
  });
  await fs.access(path.join(tldrawRepository, 'dist', 'server.mjs')).catch(() => {
    throw new Error(`Standalone tldraw MCP distribution is missing under ${tldrawRepository}`);
  });
  await runChecked({
    command: process.execPath,
    args: ['scripts/verify-dist.mjs'],
    cwd: tldrawRepository,
    name: 'Standalone tldraw distribution verification',
  });

  const auth = await readAuthContent();
  authSource = auth.source;
  [tldrawPort, openChamberPort] = await Promise.all([reservePort(), reservePort()]);
  if (tldrawPort === openChamberPort) throw new Error('Dynamic port allocation returned the same port twice');
  const tldrawUrl = `http://127.0.0.1:${tldrawPort}`;
  const openChamberUrl = `http://127.0.0.1:${openChamberPort}`;
  // The tracked demo at this base does not consume any tldraw-specific env
  // variable, so the single remote MCP server must arrive through the fork's
  // OPENCODE_CONFIG_CONTENT loader instead. This keeps the gate independent of
  // user/project config and of unrelated env handoffs.
  const tldrawMcpUrl = validateAcceptanceMcpUrl(`${tldrawUrl}/mcp`);
  const acceptanceMcpConfigContent = buildAcceptanceMcpConfigContent({ mcpUrl: tldrawMcpUrl });
  mcpConfigEvidence = {
    server: ACCEPTANCE_MCP_SERVER_NAME,
    url: tldrawMcpUrl,
  };

  tldrawProcess = await spawnLogged({
    command: process.execPath,
    args: ['dist/server.mjs'],
    cwd: tldrawRepository,
    env: {
      ...inheritedEnvironment,
      HOME: runtime.home,
      TMPDIR: runtime.tmp,
      XDG_DATA_HOME: runtime.xdgData,
      XDG_STATE_HOME: runtime.xdgState,
      XDG_CACHE_HOME: runtime.xdgCache,
      TLDRAW_MCP_HOST: '127.0.0.1',
      TLDRAW_MCP_PORT: String(tldrawPort),
      TLDRAW_MCP_RUNTIME_DIR: runtime.tldraw,
      TLDRAW_MCP_STORE_ROOT: path.join(runtime.tldraw, 'canvas-store'),
      TLDRAW_MCP_SCOPE_ID: `acceptance-${runId}`,
      TLDRAW_MCP_WORKSPACE_ID: 'openchamber-browser-e2e',
      TLDRAW_MCP_CANVAS_ID: `bootstrap-${runId}`,
    },
    logPath: tldrawLogPath,
    name: 'tldraw MCP',
  });
  await waitFor(async () => {
    assertChildRunning(tldrawProcess, 'Standalone tldraw MCP');
    const response = await fetch(`${tldrawUrl}/health`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
    if (!response?.ok) return null;
    const health = await response.json();
    return health?.status === 'ok' && health?.protocolVersion === '2026-07-28' ? health : null;
  }, 'Standalone tldraw MCP');

  openChamberProcess = await spawnLogged({
    command: process.execPath,
    args: ['scripts/interactive-ui-demo.mjs'],
    cwd: projectRoot,
    env: {
      ...inheritedEnvironment,
      HOME: runtime.home,
      TMPDIR: runtime.tmp,
      XDG_DATA_HOME: runtime.xdgData,
      XDG_STATE_HOME: runtime.xdgState,
      XDG_CACHE_HOME: runtime.xdgCache,
      OPENCODE_AUTH_CONTENT: auth.content,
      OPENCODE_BINARY: acceptanceOpenCodeCli.resolved,
      OPENCODE_CONFIG_CONTENT: acceptanceMcpConfigContent,
      OPENCODE_DISABLE_CHANNEL_DB: 'true',
      OPENCODE_DISABLE_AUTOUPDATE: 'true',
      OPENCHAMBER_INTERACTIVE_UI_DEMO_PORT: String(openChamberPort),
      OPENCHAMBER_INTERACTIVE_UI_DEMO_RUNTIME_DIR: runtime.demo,
    },
    logPath: openChamberLogPath,
    name: 'OpenChamber demo',
  });
  await waitFor(async () => {
    assertChildRunning(openChamberProcess, 'OpenChamber demo');
    const response = await fetch(`${openChamberUrl}/health`, { signal: AbortSignal.timeout(2_000) }).catch(() => null);
    if (!response?.ok) return null;
    const health = await response.json();
    if (health?.openCodeRunning !== true) return null;
    const binaryVerdict = assessAcceptanceOpenCodeCliMismatch({
      selectedPath: acceptanceOpenCodeCli.resolved,
      reportedPath: health?.opencodeBinaryResolved,
    });
    if (!binaryVerdict.match) {
      const error = new Error(`OpenChamber launched the wrong OpenCode CLI: ${binaryVerdict.reason}`);
      error.acceptanceFatal = true;
      throw error;
    }
    return health;
  }, 'OpenChamber and managed OpenCode', 120_000);
  // The isolated demo settings.json only carries recap/suggestion flags, so the
  // Pin button would resolve no project for the authoritative message directory
  // and return before any network request. Register the acceptance projectRoot
  // as the exact workbench project before the browser verifier launches (and
  // before MCP negotiation so a Pin failure can never be misattributed to MCP
  // state). The identity is recorded for the orchestration report.
  acceptanceProjectEvidence = await configureAcceptanceProject({
    baseUrl: openChamberUrl,
    projectRoot,
  });
  console.log(`[acceptance] Registered acceptance project ${acceptanceProjectEvidence.projectId} in isolated settings`);
  await waitFor(async () => {
    assertChildRunning(openChamberProcess, 'OpenChamber demo');
    const response = await fetch(`${openChamberUrl}/api/mcp?directory=${encodeURIComponent(projectRoot)}`, {
      signal: AbortSignal.timeout(5_000),
    }).catch(() => null);
    if (!response?.ok) return null;
    const payload = await response.json();
    const status = payload?.[ACCEPTANCE_MCP_SERVER_NAME];
    if (status && typeof status === 'object') {
      // Fail fast on explicit permanent error statuses instead of polling until
      // the 120 s timeout (e.g. the previous real failure where the server was
      // never configured and the run only surfaced a generic timeout).
      const fatalMessage = (() => {
        switch (status.status) {
          case 'failed':
            return typeof status.error === 'string' && status.error.trim()
              ? `tldraw MCP server ${ACCEPTANCE_MCP_SERVER_NAME} failed: ${status.error}`
              : `tldraw MCP server ${ACCEPTANCE_MCP_SERVER_NAME} failed without an error message`;
          case 'needs_client_registration':
            return `tldraw MCP server ${ACCEPTANCE_MCP_SERVER_NAME} requires client registration while the acceptance config disables oauth: ${typeof status.error === 'string' ? status.error : '(no detail)'}`;
          case 'needs_auth':
            return `tldraw MCP server ${ACCEPTANCE_MCP_SERVER_NAME} requires auth while the acceptance config disables oauth; no interactive flow is available`;
          default:
            return null;
        }
      })();
      if (fatalMessage) {
        const error = new Error(`OpenChamber MCP 2026 Apps negotiation cannot recover: ${fatalMessage.slice(0, 500)}`);
        error.acceptanceFatal = true;
        throw error;
      }
    }
    return status?.status === 'connected'
      && status?.protocolVersion === '2026-07-28'
      && status?.apps?.negotiated === true
      ? status
      : null;
  }, 'OpenChamber MCP 2026 Apps negotiation', 120_000);

  verifierProcess = await spawnLogged({
    command: process.execPath,
    args: ['scripts/verify-tldraw-mcp-app-browser.mjs'],
    cwd: projectRoot,
    env: {
      ...inheritedEnvironment,
      OPENCHAMBER_TLDRAW_ACCEPTANCE_BASE_URL: openChamberUrl,
      OPENCHAMBER_TLDRAW_ACCEPTANCE_OUTPUT_DIRECTORY: browserEvidenceDirectory,
      OPENCHAMBER_TLDRAW_ACCEPTANCE_DIAGNOSTIC_LOGS: [tldrawLogPath, openChamberLogPath].join(path.delimiter),
      ...(process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_MODEL
        ? { OPENCHAMBER_TLDRAW_ACCEPTANCE_MODEL: process.env.OPENCHAMBER_TLDRAW_ACCEPTANCE_MODEL }
        : {}),
    },
    logPath: verifierLogPath,
    name: 'tldraw browser verifier',
    tee: true,
  });
  const verifierExit = await childExit(verifierProcess);
  if (interruptedSignal) throw new Error(`Acceptance interrupted by ${interruptedSignal}`);
  if (verifierExit.code !== 0) {
    throw new Error(`tldraw browser verifier failed (${verifierExit.signal || verifierExit.code})`);
  }
  browserReport = JSON.parse(await fs.readFile(path.join(browserEvidenceDirectory, 'report.json'), 'utf8'));
  if (browserReport?.ok !== true) throw new Error('tldraw browser verifier did not produce a passing report');
} catch (error) {
  primaryFailure = error;
} finally {
  process.off('SIGINT', onSigint);
  process.off('SIGTERM', onSigterm);
  await cleanup().catch((error) => {
    primaryFailure ||= error;
  });
  const report = {
    $schema: 'openchamber://tldraw-mcp-app-browser-orchestration/v1',
    generatedAt: new Date().toISOString(),
    runId,
    ok: !primaryFailure && browserReport?.ok === true && runtimeRemoved && portsReleased,
    interruptedSignal: interruptedSignal ?? null,
    repositories: {
      openchamber: projectRoot,
      tldrawMcpApp: tldrawRepository,
    },
    opencodeCli: opencodeCliEvidence,
    mcpConfig: mcpConfigEvidence,
    acceptanceProject: acceptanceProjectEvidence,
    processes: {
      tldrawMcp: captureSpawnedProcessEvidence(tldrawProcess, 'tldraw-mcp'),
      openChamberDemo: captureSpawnedProcessEvidence(openChamberProcess, 'openchamber-demo'),
      browserVerifier: captureSpawnedProcessEvidence(verifierProcess, 'browser-verifier'),
    },
    runtime: {
      isolated: true,
      authSource,
      removed: runtimeRemoved,
      portsReleased,
      openChamberPort: openChamberPort ?? null,
      tldrawPort: tldrawPort ?? null,
    },
    evidence: {
      browserReport: path.join(browserEvidenceDirectory, 'report.json'),
      logsDirectory,
    },
    failure: primaryFailure ? {
      name: primaryFailure.name,
      message: primaryFailure.message,
      stack: primaryFailure.stack,
    } : null,
  };
  await fs.mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  if (!report.ok && !primaryFailure) {
    primaryFailure = new Error('Self-contained acceptance cleanup did not complete');
  }
}

if (primaryFailure) {
  throw new Error(`${primaryFailure.message}; orchestration report: ${reportPath}`, { cause: primaryFailure });
}
console.log(JSON.stringify({ ok: true, reportPath, browserReport: path.join(browserEvidenceDirectory, 'report.json') }, null, 2));
