import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptsDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const projectRoot = path.resolve(scriptsDirectory, '..');
const demoScriptPath = path.join(scriptsDirectory, 'interactive-ui-demo.mjs');
const runtimeDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-demo');
const stateFilePath = path.join(runtimeDirectory, 'state.json');
const logFilePath = path.join(runtimeDirectory, 'demo.log');
const readyPattern = /OpenChamber Agent demo: (http:\/\/127\.0\.0\.1:(\d+))/;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const isProcessRunning = (pid) => {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const readProcessCommand = (pid) => {
  if (!isProcessRunning(pid)) return '';
  try {
    if (process.platform === 'linux') {
      return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replaceAll('\0', ' ').trim();
    }
    if (process.platform !== 'win32') {
      const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], {
        encoding: 'utf8',
        timeout: 3_000,
        windowsHide: true,
      });
      return (result.stdout || '').trim();
    }
  } catch {
  }
  return '';
};

const readProcessCwd = (pid) => {
  try {
    if (process.platform === 'linux') {
      return fs.realpathSync(`/proc/${pid}/cwd`);
    }
    if (process.platform === 'darwin') {
      const result = spawnSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], {
        encoding: 'utf8',
        timeout: 3_000,
        windowsHide: true,
      });
      const cwdLine = (result.stdout || '').split('\n').find((line) => line.startsWith('n'));
      return cwdLine ? cwdLine.slice(1).trim() : '';
    }
  } catch {
  }
  return '';
};

const parseProcessTable = (output) => String(output || '')
  .split('\n')
  .map((line) => line.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/))
  .filter(Boolean)
  .map((match) => ({
    pid: Number.parseInt(match[1], 10),
    parentPid: Number.parseInt(match[2], 10),
    processGroupId: Number.parseInt(match[3], 10),
    command: match[4].trim(),
  }));

const readProcessTable = () => {
  if (process.platform === 'win32') return [];
  try {
    const result = spawnSync('ps', ['-axo', 'pid=,ppid=,pgid=,command='], {
      encoding: 'utf8',
      timeout: 5_000,
      windowsHide: true,
    });
    return parseProcessTable(result.stdout);
  } catch {
    return [];
  }
};

const commandRunsDemo = (command) => {
  if (typeof command !== 'string' || command.length === 0) return false;
  const tokens = command.trim().split(/\s+/);
  const executable = path.basename(tokens[0] || '');
  if (executable !== 'node' && executable !== 'bun') return false;
  return tokens.slice(1).some((token) => {
    const normalized = token.replace(/^["']|["']$/g, '');
    return normalized === demoScriptPath || normalized === 'scripts/interactive-ui-demo.mjs';
  });
};

const isProjectDemoProcess = (entry) => {
  if (!entry || entry.pid === process.pid || !commandRunsDemo(entry.command)) return false;
  if (entry.command.includes(demoScriptPath)) return true;
  const cwd = readProcessCwd(entry.pid);
  return cwd.length > 0 && path.resolve(cwd) === projectRoot;
};

const listProjectDemoProcesses = () => readProcessTable().filter(isProjectDemoProcess);

const readState = () => {
  try {
    const value = JSON.parse(fs.readFileSync(stateFilePath, 'utf8'));
    if (!value || !Number.isInteger(value.pid) || value.pid <= 0 || typeof value.token !== 'string') return null;
    return value;
  } catch {
    return null;
  }
};

const writeState = (state) => {
  fs.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  const temporaryPath = `${stateFilePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, stateFilePath);
};

const removeState = () => {
  try {
    fs.unlinkSync(stateFilePath);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
};

const stateMatchesProcess = (state) => {
  if (!state || !isProcessRunning(state.pid)) return false;
  const command = readProcessCommand(state.pid);
  return commandRunsDemo(command) && command.includes(`--managed-demo-token=${state.token}`);
};

const descendantsOf = (rootPid, table) => {
  const descendants = [];
  const pending = [rootPid];
  while (pending.length > 0) {
    const parentPid = pending.shift();
    for (const entry of table) {
      if (entry.parentPid !== parentPid || descendants.some((candidate) => candidate.pid === entry.pid)) continue;
      descendants.push(entry);
      pending.push(entry.pid);
    }
  }
  return descendants;
};

const waitForExit = async (pid, timeoutMs) => {
  const deadline = Date.now() + timeoutMs;
  while (isProcessRunning(pid) && Date.now() < deadline) {
    await delay(150);
  }
  return !isProcessRunning(pid);
};

const signalProcess = (pid, signal) => {
  try {
    process.kill(pid, signal);
    return true;
  } catch (error) {
    return error?.code === 'ESRCH';
  }
};

const stopProcessTree = async (rootPid) => {
  if (!isProcessRunning(rootPid)) return true;

  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(rootPid), '/t'], {
      stdio: 'ignore',
      timeout: 5_000,
      windowsHide: true,
    });
    if (await waitForExit(rootPid, 8_000)) return true;
    spawnSync('taskkill', ['/pid', String(rootPid), '/f', '/t'], {
      stdio: 'ignore',
      timeout: 5_000,
      windowsHide: true,
    });
    return waitForExit(rootPid, 3_000);
  }

  // Snapshot descendants before signaling the root. Managed OpenCode may still
  // be shutting down when the parent exits and is then immediately reparented,
  // so it can no longer be discovered through the original PPID afterwards.
  const descendants = descendantsOf(rootPid, readProcessTable()).reverse();
  signalProcess(rootPid, 'SIGTERM');
  const rootStopped = await waitForExit(rootPid, 8_000);
  for (const entry of descendants) signalProcess(entry.pid, 'SIGTERM');
  await Promise.all(descendants.map((entry) => waitForExit(entry.pid, 3_000)));

  const remainingDescendants = descendants.filter((entry) => isProcessRunning(entry.pid));
  for (const entry of remainingDescendants) signalProcess(entry.pid, 'SIGKILL');
  if (!rootStopped) signalProcess(rootPid, 'SIGKILL');
  const [rootExited, ...descendantsExited] = await Promise.all([
    waitForExit(rootPid, 3_000),
    ...remainingDescendants.map((entry) => waitForExit(entry.pid, 3_000)),
  ]);
  return rootExited && descendantsExited.every(Boolean);
};

const readLogTail = (maximumCharacters = 4_000) => {
  try {
    const content = fs.readFileSync(logFilePath, 'utf8');
    return content.slice(-maximumCharacters).trim();
  } catch {
    return '';
  }
};

const waitForReady = async (pid, timeoutMs = 60_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const log = readLogTail(20_000);
    const match = log.match(readyPattern);
    if (match) return { url: match[1], port: Number.parseInt(match[2], 10) };
    if (!isProcessRunning(pid)) {
      throw new Error(`Interactive UI demo exited before it became ready.${log ? `\n\n${log}` : ''}`);
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for the Interactive UI demo. See ${logFilePath}`);
};

const runBuild = () => {
  const result = spawnSync('bun', ['run', 'build:web'], {
    cwd: projectRoot,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Web build failed${result.signal ? ` with signal ${result.signal}` : ` with exit code ${result.status}`}`);
  }
};

const startInteractiveUiDemo = async () => {
  const existingState = readState();
  if (stateMatchesProcess(existingState)) {
    const location = existingState.url || `PID ${existingState.pid}`;
    console.log(`[interactive-ui-demo] Already running: ${location}`);
    console.log(`[interactive-ui-demo] Stop: bun run demo:interactive-ui:stop`);
    return existingState;
  }
  if (existingState) removeState();

  const unmanaged = listProjectDemoProcesses();
  if (unmanaged.length > 0) {
    const pids = unmanaged.map((entry) => entry.pid).join(', ');
    throw new Error(`An Interactive UI demo is already running without managed state (PID: ${pids}). Run "bun run demo:interactive-ui:stop" first.`);
  }

  console.log('[interactive-ui-demo] Building the web app...');
  runBuild();

  fs.mkdirSync(runtimeDirectory, { recursive: true, mode: 0o700 });
  const logFd = fs.openSync(logFilePath, 'w', 0o600);
  const token = randomUUID();
  let child;
  try {
    child = spawn(process.execPath, [demoScriptPath, `--managed-demo-token=${token}`], {
      cwd: projectRoot,
      detached: true,
      env: process.env,
      stdio: ['ignore', logFd, logFd],
      windowsHide: true,
    });
  } finally {
    fs.closeSync(logFd);
  }

  if (!child.pid) throw new Error('Interactive UI demo did not return a process ID');
  child.unref();

  const startingState = {
    version: 1,
    pid: child.pid,
    token,
    status: 'starting',
    startedAt: new Date().toISOString(),
    logFile: logFilePath,
  };
  writeState(startingState);

  try {
    const ready = await waitForReady(child.pid);
    const readyState = { ...startingState, ...ready, status: 'ready' };
    writeState(readyState);
    console.log(`[interactive-ui-demo] Ready: ${ready.url}`);
    console.log(`[interactive-ui-demo] Log: ${logFilePath}`);
    console.log('[interactive-ui-demo] Stop: bun run demo:interactive-ui:stop');
    return readyState;
  } catch (error) {
    await stopProcessTree(child.pid);
    removeState();
    throw error;
  }
};

const stopInteractiveUiDemo = async () => {
  const state = readState();
  const trackedPid = stateMatchesProcess(state) ? state.pid : null;
  const discovered = listProjectDemoProcesses();
  const targetPids = [...new Set([
    ...(trackedPid ? [trackedPid] : []),
    ...discovered.map((entry) => entry.pid),
  ])];

  if (targetPids.length === 0) {
    if (state) removeState();
    console.log('[interactive-ui-demo] No running demo found.');
    return { stopped: [], failed: [] };
  }

  console.log(`[interactive-ui-demo] Stopping PID ${targetPids.join(', ')}...`);
  const outcomes = await Promise.all(targetPids.map(async (pid) => ({
    pid,
    stopped: await stopProcessTree(pid),
  })));
  const stopped = outcomes.filter((outcome) => outcome.stopped).map((outcome) => outcome.pid);
  const failed = outcomes.filter((outcome) => !outcome.stopped).map((outcome) => outcome.pid);

  if (failed.length === 0) {
    removeState();
    console.log(`[interactive-ui-demo] Stopped PID ${stopped.join(', ')}.`);
    return { stopped, failed };
  }

  throw new Error(`Could not stop Interactive UI demo PID ${failed.join(', ')}. State was kept for retry.`);
};

export {
  commandRunsDemo,
  descendantsOf,
  logFilePath,
  parseProcessTable,
  projectRoot,
  startInteractiveUiDemo,
  stateMatchesProcess,
  stopInteractiveUiDemo,
};
