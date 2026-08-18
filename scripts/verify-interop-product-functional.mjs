#!/usr/bin/env node

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.dirname(projectRoot);
const openCodeRoot = path.join(workspaceRoot, 'opencode');
const labRoot = path.join(projectRoot, 'extension', 'interop-acceptance-lab');

const HOSTED = Object.freeze({
  packagePath: path.join(labRoot, '.runtime', 'generated', 'hosted-ops', 'remote-ops.ocix'),
  secretPath: path.join(labRoot, '.runtime', 'secrets', 'hosted_ops_api_key'),
  extensionId: 'com.openchamber.interop.hosted-ops',
  connectorId: 'ops-api',
  version: '1.0.0',
  overview: {
    id: 'com.openchamber.interop.hosted-ops.overview',
    kind: 'view',
    tool: 'interop_ops_open_overview',
  },
  incident: {
    id: 'com.openchamber.interop.hosted-ops.incident-detail',
    kind: 'view',
    tool: 'interop_ops_open_incident',
  },
  topology: {
    id: 'com.openchamber.interop.hosted-ops.topology',
    kind: 'artifact',
    tool: 'interop_ops_open_topology',
  },
  queryOverviewAction: 'com.openchamber.interop.hosted-ops.overview.query',
  queryIncidentAction: 'com.openchamber.interop.hosted-ops.incident.query',
  acknowledgeAction: 'com.openchamber.interop.hosted-ops.incident.acknowledge',
});

const LOCAL = Object.freeze({
  packagePath: path.join(labRoot, '.runtime', 'generated', 'interop-local-crm.ocix'),
  secretPath: path.join(labRoot, '.runtime', 'secrets', 'local_crm_api_key'),
  extensionId: 'com.openchamber.interop.crm',
  connectorId: 'crm-api',
  version: '1.0.0',
  overview: {
    id: 'com.openchamber.interop.crm.overview',
    kind: 'view',
    tool: 'interop_crm_open_overview',
  },
  customer: {
    id: 'com.openchamber.interop.crm.customer',
    kind: 'view',
    tool: 'interop_crm_open_customer',
  },
  funnel: {
    id: 'com.openchamber.interop.crm.funnel',
    kind: 'artifact',
    tool: 'interop_crm_open_funnel',
  },
  queryOverviewAction: 'com.openchamber.interop.crm.overview.query',
  queryCustomerAction: 'com.openchamber.interop.crm.customer.query',
  advanceAction: 'com.openchamber.interop.crm.opportunity.advance',
});

const MCP_TARGETS = Object.freeze({
  legacyHttp: 'interop-legacy-http',
  legacySse: 'interop-legacy-sse',
  excalidrawSelfHosted: 'interop-excalidraw-self-hosted',
  excalidrawOfficial: 'interop-excalidraw-official',
  tldraw2026: 'interop-tldraw-2026',
});

const OFFICIAL_EXCALIDRAW_URL = 'https://mcp.excalidraw.com/mcp';
const DEFAULT_PUBLIC_BASE_URL_FILE = '/tmp/interop-public-base-url.txt';
const DEFAULT_LEGACY_SSE_ORIGIN = 'http://127.0.0.1:19510';
const DEFAULT_OPENCODE_PORT = 4097;
const DEFAULT_OPENCHAMBER_PORT = 3902;
const MCP_CONNECT_TIMEOUT_MS = 30_000;

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const printHelp = () => {
  process.stdout.write(`OpenChamber interop product functional verifier

Usage:
  node scripts/verify-interop-product-functional.mjs [options]

Options:
  --run-id <id>                     Stable evidence run identifier
  --run-root <path>                 New isolated runtime/evidence directory
  --public-base-url-file <path>     File containing the gated HTTPS lab base URL
  --legacy-sse-url-file <path>      Optional file containing the complete SSE URL
  --legacy-sse-origin <loopback>    SSH-forward origin (default: http://127.0.0.1:19510)
  --opencode-port <port>            Spawned OpenCode fork port (default: 4097)
  --openchamber-port <port>         Spawned OpenChamber port (default: 3902)
  --opencode-url <loopback-url>     Connect to an already-running OpenCode server
  --openchamber-url <loopback-url>  Connect to an already-running OpenChamber server
  --unsafe-connected-runtime        Acknowledge that connected mode mutates external state
  --report <path>                   Safe JSON report path
  --no-copy-provider-auth           Do not copy the alibaba-cn auth entry
  --keep-running                    Keep owned API servers alive for later browser acceptance
  --help                            Show this help

Sensitive URL alternatives:
  INTEROP_PUBLIC_BASE_URL
  INTEROP_LEGACY_SSE_URL
  INTEROP_OPENCODE_PASSWORD
  INTEROP_OPENCODE_USERNAME

The verifier never prints or records the gated public URL, access keys, or the
OpenCode Basic Auth password in its acceptance report. The isolated runtime
contains protected connection state. It does not claim browser/AppBridge
acceptance; --keep-running retains only API servers, not a current-source HMR UI.
`);
};

const parseArgs = (argv) => {
  const result = {
    runId: null,
    runRoot: null,
    publicBaseUrlFile: DEFAULT_PUBLIC_BASE_URL_FILE,
    legacySseUrlFile: null,
    legacySseOrigin: DEFAULT_LEGACY_SSE_ORIGIN,
    openCodePort: DEFAULT_OPENCODE_PORT,
    openChamberPort: DEFAULT_OPENCHAMBER_PORT,
    openCodeUrl: null,
    openChamberUrl: null,
    unsafeConnectedRuntime: false,
    reportPath: null,
    copyProviderAuth: true,
    keepRunning: false,
    help: false,
  };
  const valueOptions = new Map([
    ['--run-id', 'runId'],
    ['--run-root', 'runRoot'],
    ['--public-base-url-file', 'publicBaseUrlFile'],
    ['--legacy-sse-url-file', 'legacySseUrlFile'],
    ['--legacy-sse-origin', 'legacySseOrigin'],
    ['--opencode-port', 'openCodePort'],
    ['--openchamber-port', 'openChamberPort'],
    ['--opencode-url', 'openCodeUrl'],
    ['--openchamber-url', 'openChamberUrl'],
    ['--report', 'reportPath'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--keep-running') {
      result.keepRunning = true;
      continue;
    }
    if (token === '--unsafe-connected-runtime') {
      result.unsafeConnectedRuntime = true;
      continue;
    }
    if (token === '--no-copy-provider-auth') {
      result.copyProviderAuth = false;
      continue;
    }
    if (token === '--help' || token === '-h') {
      result.help = true;
      continue;
    }
    const key = valueOptions.get(token);
    if (!key) throw new Error(`Unknown option: ${token}`);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${token} requires a value`);
    result[key] = value;
    index += 1;
  }
  result.openCodePort = parsePort(result.openCodePort, '--opencode-port');
  result.openChamberPort = parsePort(result.openChamberPort, '--openchamber-port');
  if (result.openCodePort === result.openChamberPort) {
    throw new Error('OpenCode and OpenChamber must use different ports');
  }
  if (Boolean(result.openCodeUrl) !== Boolean(result.openChamberUrl)) {
    throw new Error('--opencode-url and --openchamber-url must be supplied together');
  }
  if (result.openCodeUrl && !result.unsafeConnectedRuntime) {
    throw new Error(
      'Connected mode mutates external OpenCode/OpenChamber state; pass --unsafe-connected-runtime to acknowledge it',
    );
  }
  if (result.openCodeUrl && result.keepRunning) {
    throw new Error('--keep-running is only valid for the isolated spawned runtime');
  }
  return result;
};

const parsePort = (value, label) => {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${label} must be an integer from 1 to 65535`);
  }
  return port;
};

const safeRunId = (value) => {
  const generated = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
  const candidate = value || `product-${generated}`;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(candidate)) {
    throw new Error('--run-id contains unsupported characters');
  }
  return candidate;
};

const validateLoopbackUrl = (value, label) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} is not a valid URL`);
  }
  if (parsed.protocol !== 'http:' || !['127.0.0.1', 'localhost', '::1'].includes(parsed.hostname)) {
    throw new Error(`${label} must be a loopback HTTP URL`);
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, '');
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString().replace(/\/+$/, '');
};

const validatePublicBaseUrl = (value) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('The public lab base URL is invalid');
  }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('The public lab base URL must be a credential-free HTTPS URL');
  }
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/') {
    throw new Error('The public lab base URL must include its gated path');
  }
  parsed.pathname = pathname;
  return parsed.toString().replace(/\/+$/, '');
};

const readProtectedText = async (filePath, label) => {
  let value;
  try {
    value = (await fs.readFile(filePath, 'utf8')).trim();
  } catch {
    throw new Error(`${label} could not be read`);
  }
  if (!value) throw new Error(`${label} is empty`);
  return value;
};

const readDotEnvValue = async (filePath, name) => {
  const document = await fs.readFile(filePath, 'utf8');
  const line = document.split(/\r?\n/).find((candidate) => candidate.startsWith(`${name}=`));
  if (!line) throw new Error(`The lab environment is missing ${name}`);
  const value = line.slice(name.length + 1).trim().replace(/^(['"])(.*)\1$/, '$2');
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) throw new Error(`The lab environment has an invalid ${name}`);
  return value;
};

const atomicWriteJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporary = `${filePath}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await fs.rename(temporary, filePath);
  await fs.chmod(filePath, 0o600);
};

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

class CredentialLeakError extends Error {
  constructor(kind, message) {
    super(message);
    this.name = 'CredentialLeakError';
    this.leakKind = kind;
  }
}

const createRedactor = () => {
  const needles = new Set();
  return {
    add(value) {
      if (typeof value === 'string' && value.length >= 4) needles.add(value);
    },
    message(error) {
      let text = error instanceof Error ? error.message : String(error);
      for (const needle of [...needles].sort((left, right) => right.length - left.length)) {
        text = text.replaceAll(needle, '<redacted>');
      }
      return text
        .replaceAll(/https?:\/\/[^\s"'<>]+/gi, '<url>')
        .replaceAll(/Bearer\s+[A-Za-z0-9._~+/-]+/gi, 'Bearer <redacted>')
        .slice(0, 1_000);
    },
    values() {
      return [...needles];
    },
  };
};

const assertSecretAbsent = (value, label, secretValues) => {
  const serialized = typeof value === 'string' ? value : JSON.stringify(value);
  for (const secret of secretValues) {
    if (serialized.includes(secret)) {
      throw new CredentialLeakError('response', `${label} exposed credential material`);
    }
  }
};

const readResponsePayload = async (response, label) => {
  const text = await response.text();
  if (!text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} returned invalid JSON`);
  }
};

const createJsonClient = (baseUrl, {
  defaultHeaders = {},
  secretValues = [],
} = {}) => async (pathname, {
  method = 'GET',
  body,
  timeoutMs = 20_000,
  label = `${method} request`,
} = {}) => {
  let response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      method,
      headers: {
        Accept: 'application/json',
        ...defaultHeaders,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw new Error(`${label} could not reach its local runtime`);
  }
  const payload = await readResponsePayload(response, label);
  assertSecretAbsent(payload, label, secretValues);
  return { status: response.status, payload };
};

const expectStatus = (result, expected, label) => {
  const values = Array.isArray(expected) ? expected : [expected];
  assert.equal(
    values.includes(result.status),
    true,
    `${label} returned ${result.status} (${typeof result.payload?.code === 'string' ? result.payload.code : 'no-code'})`,
  );
  return result.payload;
};

const waitFor = async (operation, label, timeoutMs = 90_000, intervalMs = 500) => {
  const deadline = Date.now() + timeoutMs;
  let lastSafeReason = '';
  while (Date.now() < deadline) {
    try {
      const result = await operation();
      if (result?.ready) return result.value;
      if (typeof result?.reason === 'string') lastSafeReason = result.reason;
    } catch {
      // The caller's final assertion provides a bounded, non-sensitive reason.
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastSafeReason ? ` (${lastSafeReason})` : ''}`);
};

const waitForHttpJson = async (client, pathname, label, predicate = () => true, timeoutMs = 90_000) => (
  waitFor(async () => {
    const result = await client(pathname, { label, timeoutMs: 10_000 });
    if (result.status !== 200 || !predicate(result.payload)) {
      return { ready: false, reason: `last status ${result.status}` };
    }
    return { ready: true, value: result.payload };
  }, label, timeoutMs)
);

const assertPortAvailable = async (port, label) => {
  const listening = await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const done = (value) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
    socket.setTimeout(500, () => done(false));
  });
  if (listening) throw new Error(`${label} port ${port} is already in use`);
};

const fetchSafeJson = async (url, label, secretValues) => {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(`${label} is unreachable`);
  }
  const payload = await readResponsePayload(response, label);
  assertSecretAbsent(payload, label, secretValues);
  return { status: response.status, payload };
};

const preflightSse = async (url) => {
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'text/event-stream' },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error('The Legacy SSE lab endpoint is unreachable');
  }
  try {
    assert.equal(response.status, 200, `Legacy SSE preflight returned ${response.status}`);
    const contentType = response.headers.get('content-type') ?? '';
    assert.match(contentType, /^text\/event-stream(?:;|$)/i);
  } finally {
    await response.body?.cancel().catch(() => {});
  }
};

const openChildLog = async (filePath) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const handle = await fs.open(filePath, 'a', 0o600);
  await fs.chmod(filePath, 0o600);
  return handle;
};

const spawnLogged = async ({
  command,
  args,
  cwd,
  env,
  logPath,
  name,
}) => {
  const logHandle = await openChildLog(logPath);
  let child;
  try {
    child = spawn(command, args, {
      cwd,
      env,
      stdio: ['ignore', logHandle.fd, logHandle.fd],
      detached: process.platform !== 'win32',
    });
  } finally {
    await logHandle.close();
  }
  child.runtimeName = name;
  child.once('error', () => {});
  return child;
};

const stopChild = async (child) => {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const send = (signal) => {
    try {
      if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      // Process already exited.
    }
  };
  send('SIGTERM');
  const exited = await Promise.race([
    new Promise((resolve) => child.once('exit', () => resolve(true))),
    delay(5_000).then(() => false),
  ]);
  if (!exited) {
    send('SIGKILL');
    await Promise.race([
      new Promise((resolve) => child.once('exit', resolve)),
      delay(2_000),
    ]);
  }
};

const readFileContainsAny = async (filePath, needles) => {
  const active = needles.filter((needle) => typeof needle === 'string' && needle.length >= 4);
  if (!active.length) return false;
  const maximum = Math.max(...active.map((needle) => Buffer.byteLength(needle)));
  let tail = Buffer.alloc(0);
  for await (const chunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    const combined = Buffer.concat([tail, Buffer.from(chunk)]);
    const text = combined.toString('utf8');
    if (active.some((needle) => text.includes(needle))) return true;
    tail = combined.subarray(Math.max(0, combined.length - maximum - 4));
  }
  return false;
};

const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const copyProviderAuth = async (runtime) => {
  const source = path.join(os.homedir(), '.local', 'share', 'opencode', 'auth.json');
  let document;
  try {
    document = JSON.parse(await fs.readFile(source, 'utf8'));
  } catch {
    return false;
  }
  if (!isRecord(document) || !isRecord(document['alibaba-cn'])) return false;
  const target = path.join(runtime.xdgData, 'opencode', 'auth.json');
  await atomicWriteJson(target, { 'alibaba-cn': document['alibaba-cn'] });
  return true;
};

const summarizeCapabilities = (capabilities) => ({
  distribution: capabilities.distribution,
  version: capabilities.version,
  upstreamVersion: capabilities.upstreamVersion,
  apiVersion: capabilities.apiVersion,
  managedUpdate: capabilities.managedUpdate,
  features: {
    mcpLegacy: capabilities.features?.mcpLegacy === true,
    mcp20260728: capabilities.features?.mcp20260728 === true,
    mcpApps: capabilities.features?.mcpApps === true,
    mcpAppToolCall: capabilities.features?.mcpAppToolCall === true,
  },
});

const assertForkCapabilities = (capabilities) => {
  assert.equal(typeof capabilities?.distribution, 'string');
  assert.equal(capabilities.distribution.length > 0, true);
  assert.equal(capabilities?.apiVersion, '2');
  for (const feature of ['mcpLegacy', 'mcp20260728', 'mcpApps', 'mcpAppToolCall']) {
    assert.equal(capabilities?.features?.[feature], true, `OpenCode fork capability ${feature} is unavailable`);
  }
};

const installOcix = async (client, fixture, expectedDelivery) => {
  const packageBuffer = await fs.readFile(fixture.packagePath);
  const packageBase64 = packageBuffer.toString('base64');
  const inspection = expectStatus(await client('/api/interactive-ui/manager/packages/inspect', {
    method: 'POST',
    body: { packageBase64 },
    timeoutMs: 90_000,
    label: `${expectedDelivery} OCIX inspection`,
  }), 200, `${expectedDelivery} OCIX inspection`);
  assert.equal(inspection.extension?.id, fixture.extensionId);
  assert.equal(inspection.extension?.version, fixture.version);
  assert.equal(inspection.delivery, expectedDelivery);
  assert.equal(typeof inspection.publisher?.fingerprint, 'string');
  if (expectedDelivery === 'hosted') {
    assert.equal(typeof inspection.hosted?.manifestHash, 'string');
    assert.equal(inspection.hosted?.version, fixture.version);
  }
  const installed = expectStatus(await client('/api/interactive-ui/manager/packages', {
    method: 'POST',
    body: {
      packageBase64,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      ...(expectedDelivery === 'hosted'
        ? { confirmedHostedManifestHash: inspection.hosted.manifestHash }
        : {}),
    },
    timeoutMs: 120_000,
    label: `${expectedDelivery} OCIX installation`,
  }), 201, `${expectedDelivery} OCIX installation`);
  assert.equal(installed.installed, true);
  assert.equal(installed.extension?.id, fixture.extensionId);
  return {
    id: fixture.extensionId,
    version: fixture.version,
    delivery: expectedDelivery,
    publisherTrusted: true,
  };
};

const assertInstalledVersion = (manager, fixture, delivery) => {
  const extension = manager.extensions?.find((candidate) => candidate.id === fixture.extensionId);
  assert(extension, `${fixture.extensionId} is missing from manager state`);
  assert.equal(extension.enabled, true);
  assert.equal(extension.activeVersion, fixture.version);
  assert.equal(extension.versions?.[fixture.version]?.delivery, delivery);
  assert.equal(extension.integrity?.status, 'ready');
  return {
    activeVersion: extension.activeVersion,
    delivery,
    integrity: extension.integrity.status,
  };
};

const assertSurfaceContract = (catalog, fixture, expectations) => {
  const extension = catalog.extensions?.find((candidate) => candidate.id === fixture.extensionId);
  assert(extension, `${fixture.extensionId} is missing from the Workbench catalog`);
  const result = {};
  for (const expectation of expectations) {
    const surface = extension.surfaces?.find((candidate) => candidate.surfaceId === expectation.fixture.id);
    assert(surface, `${expectation.fixture.id} is missing from the Workbench catalog`);
    assert.equal(surface.form, expectation.fixture.kind === 'artifact' ? 'html-artifact' : 'interactive-ui');
    assert.equal(surface.manualLaunch?.enabled, expectation.manualLaunch);
    assert.deepEqual(
      surface.manualLaunch?.missingRequiredPaths ?? [],
      expectation.missingRequiredPaths ?? [],
    );
    result[expectation.fixture.id] = {
      form: surface.form,
      runtime: surface.runtime,
      manualLaunch: surface.manualLaunch.enabled,
      missingRequiredPaths: surface.manualLaunch.missingRequiredPaths ?? [],
    };
  }
  return result;
};

const verifyDescriptor = async (client, fixture, expectedRuntime) => {
  const endpoint = fixture.kind === 'artifact'
    ? `/api/interactive-ui/installed-artifacts/${encodeURIComponent(fixture.id)}?launch=workbench`
    : `/api/interactive-ui/views/${encodeURIComponent(fixture.id)}?launch=workbench`;
  const descriptor = expectStatus(await client(endpoint, {
    label: `${fixture.id} descriptor`,
  }), 200, `${fixture.id} descriptor`);
  if (fixture.kind === 'artifact') {
    assert.equal(descriptor.artifact?.id, fixture.id);
    assert.equal(descriptor.artifact?.business, true);
  } else {
    assert.equal(descriptor.view?.id, fixture.id);
    assert.equal(descriptor.view?.runtime, expectedRuntime);
    if (expectedRuntime === 'declarative') assert.equal(descriptor.declarative?.id, fixture.id);
    if (expectedRuntime === 'native') assert.equal(typeof descriptor.native?.assetPath, 'string');
  }
  return descriptor;
};

const verifyTextAsset = async (baseUrl, pathname, label, secretValues, expectedPattern) => {
  let response;
  try {
    response = await fetch(`${baseUrl}${pathname}`, {
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    throw new Error(`${label} could not be loaded`);
  }
  assert.equal(response.status, 200, `${label} returned ${response.status}`);
  const text = await response.text();
  assertSecretAbsent(text, label, secretValues);
  assert.match(text, expectedPattern);
  return { bytes: Buffer.byteLength(text) };
};

const actionContext = (fixture, surface, suffix) => ({
  extensionId: fixture.extensionId,
  ...(surface.kind === 'artifact' ? { artifactId: surface.id } : { viewId: surface.id }),
  instanceId: `interop-functional-${suffix}`,
  tool: {
    id: `interop-functional-${suffix}-tool`,
    name: surface.tool,
  },
});

const callAction = (client, actionId, context, input, confirmationToken) => client(
  `/api/interactive-ui/actions/${encodeURIComponent(actionId)}`,
  {
    method: 'POST',
    body: {
      ...context,
      input,
      ...(confirmationToken ? { confirmationToken } : {}),
    },
    timeoutMs: 45_000,
    label: `${actionId} action`,
  },
);

const configureConnection = async (client, fixture, accessKey) => {
  const base = `/api/interactive-ui/connections/${encodeURIComponent(fixture.extensionId)}/${encodeURIComponent(fixture.connectorId)}`;
  const configured = expectStatus(await client(base, {
    method: 'PUT',
    body: { accessKey },
    label: `${fixture.extensionId} connection configuration`,
  }), 200, `${fixture.extensionId} connection configuration`);
  assert.equal(configured.credential?.configured, true);
  const tested = expectStatus(await client(`${base}/test`, {
    method: 'POST',
    label: `${fixture.extensionId} connection test`,
  }), 200, `${fixture.extensionId} connection test`);
  assert.equal(tested.ok, true);
  return { configured: true, reachable: true };
};

const verifyHostedActions = async (client) => {
  const overviewContext = actionContext(HOSTED, HOSTED.overview, 'hosted-overview');
  const incidentContext = actionContext(HOSTED, HOSTED.incident, 'hosted-incident');
  const overview = expectStatus(await callAction(
    client,
    HOSTED.queryOverviewAction,
    overviewContext,
    { environment: 'production' },
  ), 200, 'Hosted operations live query').data;
  assert(Array.isArray(overview.services) && overview.services.length > 0);
  const incident = overview.incidents?.find((candidate) => candidate.status === 'open');
  assert(incident, 'Hosted operations fixture has no open incident; restart the lab backend');
  const input = {
    environment: 'production',
    incidentId: incident.id,
  };
  const before = expectStatus(await callAction(
    client,
    HOSTED.queryIncidentAction,
    incidentContext,
    input,
  ), 200, 'Hosted incident query before write').data.incident;
  assert.equal(before.status, 'open');

  const writeInput = {
    ...input,
    revision: before.revision,
  };
  const challenge = await callAction(
    client,
    HOSTED.acknowledgeAction,
    incidentContext,
    writeInput,
  );
  assert.equal(challenge.status, 409);
  assert.equal(challenge.payload?.code, 'confirmation_required');
  assert.match(challenge.payload?.confirmationToken ?? '', /^oc_confirmation_/);

  const afterCancel = expectStatus(await callAction(
    client,
    HOSTED.queryIncidentAction,
    incidentContext,
    input,
  ), 200, 'Hosted incident query after cancelled write').data.incident;
  assert.equal(afterCancel.status, 'open');
  assert.equal(afterCancel.revision, before.revision);

  const confirmed = expectStatus(await callAction(
    client,
    HOSTED.acknowledgeAction,
    incidentContext,
    writeInput,
    challenge.payload.confirmationToken,
  ), 200, 'Hosted incident confirmed acknowledgement').data.incident;
  assert.equal(confirmed.status, 'acknowledged');
  assert.equal(confirmed.revision, before.revision + 1);
  return {
    serviceCount: overview.services.length,
    incidentSelected: true,
    cancellationPreservedState: true,
    confirmationRequired: true,
    confirmedWriteChangedRevision: true,
  };
};

const verifyLocalActions = async (client) => {
  const overviewContext = actionContext(LOCAL, LOCAL.overview, 'local-overview');
  const customerContext = actionContext(LOCAL, LOCAL.customer, 'local-customer');
  const overview = expectStatus(await callAction(
    client,
    LOCAL.queryOverviewAction,
    overviewContext,
    { scope: 'default' },
  ), 200, 'Local CRM live overview').data;
  assert(Array.isArray(overview.customers) && overview.customers.length > 0);

  let customerData;
  for (const customer of overview.customers) {
    const candidate = expectStatus(await callAction(
      client,
      LOCAL.queryCustomerAction,
      customerContext,
      { scope: 'default', customerId: customer.id },
    ), 200, 'Local CRM customer query').data;
    if (candidate.opportunities?.some((opportunity) => opportunity.nextStage)) {
      customerData = candidate;
      break;
    }
  }
  const opportunity = customerData?.opportunities?.find((candidate) => candidate.nextStage);
  assert(opportunity, 'Local CRM fixture has no advanceable opportunity; restart the lab backend');

  const writeInput = {
    scope: 'default',
    customerId: customerData.customer.id,
    opportunityId: opportunity.id,
    revision: opportunity.revision,
  };
  const challenge = await callAction(
    client,
    LOCAL.advanceAction,
    customerContext,
    writeInput,
  );
  assert.equal(challenge.status, 409);
  assert.equal(challenge.payload?.code, 'confirmation_required');
  assert.match(challenge.payload?.confirmationToken ?? '', /^oc_confirmation_/);

  const afterCancel = expectStatus(await callAction(
    client,
    LOCAL.queryCustomerAction,
    customerContext,
    { scope: 'default', customerId: customerData.customer.id },
  ), 200, 'Local CRM query after cancelled write').data;
  const cancelledOpportunity = afterCancel.opportunities?.find((candidate) => candidate.id === opportunity.id);
  assert.equal(cancelledOpportunity?.revision, opportunity.revision);
  assert.equal(cancelledOpportunity?.stage, opportunity.stage);

  const confirmed = expectStatus(await callAction(
    client,
    LOCAL.advanceAction,
    customerContext,
    writeInput,
    challenge.payload.confirmationToken,
  ), 200, 'Local CRM confirmed opportunity advance').data.opportunity;
  assert.equal(confirmed.revision, opportunity.revision + 1);
  assert.notEqual(confirmed.stage, opportunity.stage);
  return {
    customerCount: overview.customers.length,
    advanceableOpportunitySelected: true,
    cancellationPreservedState: true,
    confirmationRequired: true,
    confirmedWriteChangedRevision: true,
  };
};

const configureMcp = async (client, directory, targets) => {
  for (const target of targets) {
    expectStatus(await client(
      `/api/config/mcp/${encodeURIComponent(target.name)}?directory=${encodeURIComponent(directory)}`,
      {
        method: 'POST',
        body: {
          scope: 'user',
          type: 'remote',
          url: target.url,
          oauth: false,
          timeout: MCP_CONNECT_TIMEOUT_MS,
          enabled: true,
        },
        timeoutMs: 60_000,
        label: `${target.name} MCP configuration`,
      },
    ), 200, `${target.name} MCP configuration`);
  }
  const listed = expectStatus(await client(
    `/api/config/mcp?directory=${encodeURIComponent(directory)}`,
    { label: 'MCP configuration inventory' },
  ), 200, 'MCP configuration inventory');
  const names = new Set(Array.isArray(listed)
    ? listed.map((entry) => entry.name)
    : Object.keys(listed ?? {}));
  for (const target of targets) assert.equal(names.has(target.name), true, `${target.name} config is missing`);
  return targets.map((target) => target.name);
};

const summarizeMcpStatus = (status) => ({
  status: status?.status ?? 'missing',
  ...(status?.status === 'connected'
    ? {
        protocolVersion: status.protocolVersion ?? null,
        era: status.era,
        adapter: status.adapter,
        apps: status.apps,
      }
    : {}),
});

const assertConnectedStatus = (statuses, name, expectation) => {
  const status = statuses?.[name];
  assert.equal(status?.status, 'connected', `${name} did not connect`);
  assert.equal(status.apps?.client, true, `${name} did not enable the MCP Apps client capability`);
  if (expectation.era) assert.equal(status.era, expectation.era);
  if (expectation.adapter) assert.equal(status.adapter, expectation.adapter);
  if (expectation.protocolVersion) assert.equal(status.protocolVersion, expectation.protocolVersion);
  if (typeof expectation.appsServer === 'boolean') {
    assert.equal(status.apps?.server, expectation.appsServer, `${name} MCP Apps server capability mismatch`);
  }
  if (typeof expectation.appsNegotiated === 'boolean') {
    assert.equal(
      status.apps?.negotiated,
      expectation.appsNegotiated,
      `${name} MCP Apps negotiation state mismatch`,
    );
  }
  return summarizeMcpStatus(status);
};

const waitForMcpStatuses = async (client, directory) => {
  const expectedNames = Object.values(MCP_TARGETS);
  return waitFor(async () => {
    const response = await client(`/api/mcp?directory=${encodeURIComponent(directory)}`, {
      timeoutMs: 20_000,
      label: 'MCP runtime status',
    });
    if (response.status !== 200 || !isRecord(response.payload)) {
      return { ready: false, reason: `last status ${response.status}` };
    }
    const disconnected = expectedNames.filter((name) => response.payload[name]?.status !== 'connected');
    if (disconnected.length) {
      const summary = disconnected.map((name) => {
        const status = response.payload[name];
        const state = typeof status?.status === 'string' ? status.status : 'missing';
        const code = typeof status?.error?.code === 'string' ? `:${status.error.code}` : '';
        return `${name}=${state}${code}`;
      }).join(',');
      return { ready: false, reason: summary };
    }
    return { ready: true, value: response.payload };
  }, 'all MCP runtimes to connect', 180_000, 1_000);
};

const verifyMcpApps = async (client, directory) => {
  const payload = expectStatus(await client(
    `/api/mcp/app?directory=${encodeURIComponent(directory)}`,
    { label: 'MCP App registry', timeoutMs: 30_000 },
  ), 200, 'MCP App registry');
  const definitions = Object.values(payload?.apps ?? payload ?? {}).filter(isRecord);
  const requireDefinition = (server, tool, expectedVisibility) => {
    const definition = definitions.find((candidate) => candidate.server === server && candidate.tool === tool);
    assert(definition, `${server} did not register ${tool} as an MCP App`);
    assert.match(definition.meta?.resourceUri ?? '', /^ui:\/\//);
    const visibility = [...(definition.meta?.visibility ?? [])].sort();
    assert.deepEqual(visibility, [...expectedVisibility].sort(), `${server}/${tool} visibility mismatch`);
    return {
      server,
      tool,
      visibility,
      resourceScheme: 'ui',
    };
  };
  return [
    requireDefinition(MCP_TARGETS.excalidrawSelfHosted, 'create_view', ['model', 'app']),
    requireDefinition(MCP_TARGETS.excalidrawOfficial, 'create_view', ['model', 'app']),
    requireDefinition(MCP_TARGETS.tldraw2026, 'tldraw_open_canvas', ['model', 'app']),
    requireDefinition(MCP_TARGETS.tldraw2026, 'tldraw_apply_operations', ['app']),
    requireDefinition(MCP_TARGETS.tldraw2026, 'tldraw_save_canvas', ['app']),
    requireDefinition(MCP_TARGETS.tldraw2026, 'tldraw_export_snapshot', ['app']),
  ];
};

const createRuntimeDirectories = async (runRoot) => {
  await fs.mkdir(path.dirname(runRoot), { recursive: true, mode: 0o700 });
  await fs.mkdir(runRoot, { recursive: false, mode: 0o700 });
  const runtimeRoot = path.join(runRoot, 'runtime');
  const directories = {
    root: runtimeRoot,
    home: path.join(runtimeRoot, 'home'),
    xdgConfig: path.join(runtimeRoot, 'xdg-config'),
    xdgData: path.join(runtimeRoot, 'xdg-data'),
    xdgState: path.join(runtimeRoot, 'xdg-state'),
    xdgCache: path.join(runtimeRoot, 'xdg-cache'),
    tmp: path.join(runtimeRoot, 'tmp'),
    openChamberData: path.join(runtimeRoot, 'openchamber-data'),
    openCodeConfig: path.join(runtimeRoot, 'opencode-config'),
    logs: path.join(runRoot, 'logs'),
  };
  for (const directory of Object.values(directories)) {
    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  }
  return directories;
};

const buildIsolatedEnv = (runtime, openCodePassword, openCodeUrl) => {
  const blockedNames = new Set([
    'HOME',
    'TMPDIR',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_STATE_HOME',
    'XDG_CACHE_HOME',
    'OPENCHAMBER_DATA_DIR',
    'OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR',
    'OPENCHAMBER_SKIP_OPENCODE_START',
    'OPENCODE_CONFIG',
    'OPENCODE_CONFIG_CONTENT',
    'OPENCODE_CONFIG_DIR',
    'OPENCODE_AUTH_CONTENT',
    'OPENCODE_SERVER_USERNAME',
    'OPENCODE_SERVER_PASSWORD',
    'OPENCODE_HOST',
  ]);
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => (
      !blockedNames.has(name)
      && !name.startsWith('INTEROP_')
      && !name.startsWith('OPENCODE_')
      && !name.startsWith('OPENCHAMBER_')
    )),
  );
  return {
    ...inherited,
    HOME: runtime.home,
    TMPDIR: runtime.tmp,
    XDG_CONFIG_HOME: runtime.xdgConfig,
    XDG_DATA_HOME: runtime.xdgData,
    XDG_STATE_HOME: runtime.xdgState,
    XDG_CACHE_HOME: runtime.xdgCache,
    OPENCHAMBER_DATA_DIR: runtime.openChamberData,
    OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR: runtime.openCodeConfig,
    OPENCODE_CONFIG_DIR: runtime.openCodeConfig,
    OPENCODE_DISABLE_CHANNEL_DB: 'true',
    OPENCODE_DISABLE_AUTOUPDATE: 'true',
    OPENCODE_DISABLE_PROJECT_CONFIG: 'true',
    OPENCODE_DISABLE_EXTERNAL_SKILLS: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE: 'true',
    OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: 'true',
    OPENCODE_SERVER_USERNAME: 'opencode',
    OPENCODE_SERVER_PASSWORD: openCodePassword,
    OPENCODE_HOST: openCodeUrl,
    OPENCODE_SKIP_START: 'true',
    OPENCHAMBER_SKIP_OPENCODE_START: 'true',
  };
};

const createOwnedRuntime = async ({
  args,
  runtime,
  env,
  openCodeUrl,
  openChamberUrl,
}) => {
  await assertPortAvailable(args.openCodePort, 'OpenCode');
  await assertPortAvailable(args.openChamberPort, 'OpenChamber');
  let openCode = await spawnLogged({
    command: process.env.BUN_BIN || 'bun',
    args: [
      'run',
      '--cwd',
      'packages/opencode',
      '--conditions=browser',
      'src/index.ts',
      'serve',
      '--hostname',
      '127.0.0.1',
      '--port',
      String(args.openCodePort),
      '--cors',
      openChamberUrl,
    ],
    cwd: openCodeRoot,
    env,
    logPath: path.join(runtime.logs, 'opencode.log'),
    name: 'opencode',
  });
  const openChamber = await spawnLogged({
    command: process.env.BUN_BIN || 'bun',
    args: ['packages/web/server/index.js', '--port', String(args.openChamberPort)],
    cwd: projectRoot,
    env,
    logPath: path.join(runtime.logs, 'openchamber.log'),
    name: 'openchamber',
  });
  return {
    owned: true,
    get openCode() {
      return openCode;
    },
    openChamber,
    async restartOpenCode() {
      await stopChild(openCode);
      openCode = await spawnLogged({
        command: process.env.BUN_BIN || 'bun',
        args: [
          'run',
          '--cwd',
          'packages/opencode',
          '--conditions=browser',
          'src/index.ts',
          'serve',
          '--hostname',
          '127.0.0.1',
          '--port',
          String(args.openCodePort),
          '--cors',
          openChamberUrl,
        ],
        cwd: openCodeRoot,
        env,
        logPath: path.join(runtime.logs, 'opencode.log'),
        name: 'opencode',
      });
    },
    async stop() {
      await stopChild(openChamber);
      await stopChild(openCode);
    },
  };
};

const waitForShutdownOrRuntimeExit = (runtimeProcess) => new Promise((resolve, reject) => {
  const children = [runtimeProcess.openCode, runtimeProcess.openChamber].filter(Boolean);
  const exitHandlers = new Map();
  const cleanup = () => {
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    for (const [child, handler] of exitHandlers) child.off('exit', handler);
  };
  const finish = (signal) => {
    cleanup();
    resolve(signal);
  };
  const onSigint = () => finish('SIGINT');
  const onSigterm = () => finish('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);
  for (const child of children) {
    const onExit = () => {
      cleanup();
      reject(new Error(`${child.runtimeName ?? 'runtime'} exited during the retained API phase`));
    };
    exitHandlers.set(child, onExit);
    child.once('exit', onExit);
    if (child.exitCode !== null || child.signalCode !== null) {
      queueMicrotask(onExit);
      break;
    }
  }
});

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  const runId = safeRunId(args.runId);
  const runRoot = args.runRoot
    ? path.resolve(args.runRoot)
    : path.join(projectRoot, '.tmp', 'interop-acceptance', runId);
  const runtime = await createRuntimeDirectories(runRoot);
  const reportPath = args.reportPath ? path.resolve(args.reportPath) : path.join(runRoot, 'report.json');
  const redactor = createRedactor();
  const report = {
    $schema: 'openchamber://interop-product-functional-report/v2',
    runId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    phase: 'product-api-functional',
    phaseOk: false,
    productApiFunctionalOk: false,
    overall: {
      ok: false,
      status: 'pending-product-api',
      reason: 'Browser rendering and AppBridge interaction require separate evidence.',
    },
    scope: 'source-product-api-functional',
    runtime: {
      mode: args.openCodeUrl ? 'connected' : 'isolated-spawned',
      providerAuthCopied: false,
      connectedMutationAcknowledged: args.openCodeUrl ? args.unsafeConnectedRuntime : false,
    },
    evidenceStorage: {
      acceptanceReportContainsSecrets: false,
      isolatedRuntimeContainsProtectedConnectionState: !args.openCodeUrl,
      isolationExpectation: 'Runtime directory 0700; protected files 0600; never publish runtime state.',
    },
    preflight: {
      publicGateway: false,
      legacySse: false,
    },
    capabilities: null,
    ocix: {
      hosted: null,
      local: null,
    },
    mcp: {
      configured: [],
      statuses: {},
      apps: [],
    },
    secretHygiene: {
      checksCompleted: false,
      passed: null,
      responseLeakDetected: false,
      childLogLeakDetected: false,
    },
    browserAcceptance: {
      status: 'pending',
      reason: 'Use --keep-running and complete real rendering/AppBridge interaction in the browser.',
    },
    error: null,
  };
  let runtimeProcess = null;
  let keepRunning = false;

  try {
    const [publicBaseRaw, hostedKey, localKey, publicGatePath] = await Promise.all([
      process.env.INTEROP_PUBLIC_BASE_URL
        ? Promise.resolve(process.env.INTEROP_PUBLIC_BASE_URL.trim())
        : readProtectedText(path.resolve(args.publicBaseUrlFile), 'The public lab base URL file'),
      readProtectedText(HOSTED.secretPath, 'The Hosted OCIX test key'),
      readProtectedText(LOCAL.secretPath, 'The Local OCIX test key'),
      readDotEnvValue(path.join(labRoot, '.env'), 'PUBLIC_GATE_PATH'),
    ]);
    const publicBaseUrl = validatePublicBaseUrl(publicBaseRaw);
    const legacySseUrl = process.env.INTEROP_LEGACY_SSE_URL
      ? process.env.INTEROP_LEGACY_SSE_URL.trim()
      : args.legacySseUrlFile
        ? await readProtectedText(path.resolve(args.legacySseUrlFile), 'The Legacy SSE URL file')
        : `${validateLoopbackUrl(args.legacySseOrigin, '--legacy-sse-origin')}/${publicGatePath}/mcp/legacy/sse`;
    let parsedLegacySseUrl;
    try {
      parsedLegacySseUrl = new URL(legacySseUrl);
    } catch {
      throw new Error('The Legacy SSE URL is invalid');
    }
    if (!['http:', 'https:'].includes(parsedLegacySseUrl.protocol)) {
      throw new Error('The Legacy SSE URL must use HTTP or HTTPS');
    }

    const openCodePassword = args.openCodeUrl
      ? (process.env.INTEROP_OPENCODE_PASSWORD ?? '')
      : crypto.randomBytes(32).toString('base64url');
    const openCodeUsername = process.env.INTEROP_OPENCODE_USERNAME || 'opencode';
    const openCodeBasicCredential = openCodePassword
      ? Buffer.from(`${openCodeUsername}:${openCodePassword}`).toString('base64')
      : '';
    const openCodeUrl = args.openCodeUrl
      ? validateLoopbackUrl(args.openCodeUrl, '--opencode-url')
      : `http://127.0.0.1:${args.openCodePort}`;
    const openChamberUrl = args.openChamberUrl
      ? validateLoopbackUrl(args.openChamberUrl, '--openchamber-url')
      : `http://127.0.0.1:${args.openChamberPort}`;

    for (const value of [
      publicBaseUrl,
      publicGatePath,
      legacySseUrl,
      hostedKey,
      localKey,
      openCodePassword,
      openCodeBasicCredential,
    ]) redactor.add(value);

    const responseSecretValues = [
      hostedKey,
      localKey,
      openCodePassword,
      openCodeBasicCredential,
    ].filter(Boolean);
    const publicHealth = await fetchSafeJson(`${publicBaseUrl}/health`, 'The public interop gateway', responseSecretValues);
    assert.equal(publicHealth.status, 200);
    report.preflight.publicGateway = true;
    await preflightSse(legacySseUrl);
    report.preflight.legacySse = true;

    const isolatedEnv = buildIsolatedEnv(runtime, openCodePassword, openCodeUrl);
    if (args.copyProviderAuth) {
      report.runtime.providerAuthCopied = await copyProviderAuth(runtime);
    }

    const openCodeHeaders = openCodePassword
      ? { Authorization: `Basic ${openCodeBasicCredential}` }
      : {};
    const openCodeClient = createJsonClient(openCodeUrl, {
      defaultHeaders: openCodeHeaders,
      secretValues: responseSecretValues,
    });
    const openChamberClient = createJsonClient(openChamberUrl, {
      secretValues: responseSecretValues,
    });
    if (args.openCodeUrl) {
      runtimeProcess = {
        owned: false,
        restartOpenCode: async () => {},
        stop: async () => {},
      };
    } else {
      runtimeProcess = await createOwnedRuntime({
        args,
        runtime,
        env: isolatedEnv,
        openCodeUrl,
        openChamberUrl,
      });
    }

    await waitForHttpJson(
      openCodeClient,
      '/global/health',
      'OpenCode fork health',
      (payload) => payload?.healthy === true,
      120_000,
    );
    await waitForHttpJson(
      openChamberClient,
      '/health',
      'OpenChamber health',
      (payload) => payload?.status === 'ok',
      120_000,
    );
    const capabilities = await waitForHttpJson(
      openChamberClient,
      '/api/global/capabilities',
      'OpenCode fork capability proxy',
      (payload) => payload?.features?.mcpApps === true,
      60_000,
    );
    assertForkCapabilities(capabilities);
    report.capabilities = summarizeCapabilities(capabilities);

    process.stdout.write('[interop] Installing signed OCIX fixtures through manager APIs\n');
    const hostedInstall = await installOcix(openChamberClient, HOSTED, 'hosted');
    const localInstall = await installOcix(openChamberClient, LOCAL, 'local');
    const manager = expectStatus(await openChamberClient('/api/interactive-ui/manager', {
      label: 'OCIX manager inventory',
      timeoutMs: 60_000,
    }), 200, 'OCIX manager inventory');
    const hostedManager = assertInstalledVersion(manager, HOSTED, 'hosted');
    const localManager = assertInstalledVersion(manager, LOCAL, 'local');

    const catalog = expectStatus(await openChamberClient('/api/interactive-ui/workbench/catalog', {
      label: 'Applications Workbench catalog',
    }), 200, 'Applications Workbench catalog');
    assert.deepEqual(catalog.errors ?? [], []);
    const hostedSurfaces = assertSurfaceContract(catalog, HOSTED, [
      { fixture: HOSTED.overview, manualLaunch: true },
      { fixture: HOSTED.incident, manualLaunch: false, missingRequiredPaths: ['incidentId'] },
      { fixture: HOSTED.topology, manualLaunch: true },
    ]);
    const localSurfaces = assertSurfaceContract(catalog, LOCAL, [
      { fixture: LOCAL.overview, manualLaunch: true },
      { fixture: LOCAL.customer, manualLaunch: false, missingRequiredPaths: ['customerId'] },
      { fixture: LOCAL.funnel, manualLaunch: true },
    ]);

    const hostedOverviewDescriptor = await verifyDescriptor(openChamberClient, HOSTED.overview, 'declarative');
    const hostedIncidentDescriptor = await verifyDescriptor(openChamberClient, HOSTED.incident, 'declarative');
    const hostedTopologyDescriptor = await verifyDescriptor(openChamberClient, HOSTED.topology, 'artifact');
    const localOverviewDescriptor = await verifyDescriptor(openChamberClient, LOCAL.overview, 'declarative');
    const localCustomerDescriptor = await verifyDescriptor(openChamberClient, LOCAL.customer, 'native');
    const localFunnelDescriptor = await verifyDescriptor(openChamberClient, LOCAL.funnel, 'artifact');
    await verifyTextAsset(
      openChamberUrl,
      hostedTopologyDescriptor.documentPath,
      'Hosted topology Artifact broker',
      responseSecretValues,
      /data-ocix-artifact-broker/,
    );
    await verifyTextAsset(
      openChamberUrl,
      localFunnelDescriptor.documentPath,
      'Local CRM funnel Artifact broker',
      responseSecretValues,
      /data-ocix-artifact-broker/,
    );
    await verifyTextAsset(
      openChamberUrl,
      localCustomerDescriptor.native.assetPath,
      'Local CRM Native bundle',
      responseSecretValues,
      /com\.openchamber\.interop\.crm/,
    );
    assert.equal(hostedOverviewDescriptor.view.dashboard.manualLaunch.enabled, true);
    assert.equal(hostedIncidentDescriptor.view.dashboard.manualLaunch.enabled, false);
    assert.equal(localOverviewDescriptor.view.dashboard.manualLaunch.enabled, true);

    for (const toolName of [
      'interop_ops_open_overview.ts',
      'interop_ops_open_incident.ts',
      'interop_ops_open_topology.ts',
      'interop_crm_open_overview.ts',
      'interop_crm_open_customer.ts',
      'interop_crm_open_funnel.ts',
    ]) {
      await fs.access(path.join(runtime.openCodeConfig, 'tools', toolName));
    }
    await fs.access(path.join(runtime.openCodeConfig, 'skills', 'interop-crm-interactive-ui', 'SKILL.md'));

    process.stdout.write('[interop] Configuring isolated Business Gateway connections\n');
    const hostedConnection = await configureConnection(openChamberClient, HOSTED, hostedKey);
    const localConnection = await configureConnection(openChamberClient, LOCAL, localKey);
    const connectionInventory = expectStatus(await openChamberClient('/api/interactive-ui/connections', {
      label: 'Business connection inventory',
    }), 200, 'Business connection inventory');
    for (const fixture of [HOSTED, LOCAL]) {
      const connection = connectionInventory.connections?.find(
        (candidate) => candidate.extension?.id === fixture.extensionId
          && candidate.connector?.id === fixture.connectorId,
      );
      assert.equal(connection?.credential?.configured, true);
      assert.equal(connection?.health?.status, 'reachable');
    }

    process.stdout.write('[interop] Exercising real reads and confirmation-bound writes\n');
    const hostedActions = await verifyHostedActions(openChamberClient);
    const localActions = await verifyLocalActions(openChamberClient);
    report.ocix.hosted = {
      ...hostedInstall,
      manager: hostedManager,
      surfaces: hostedSurfaces,
      connection: hostedConnection,
      actions: hostedActions,
    };
    report.ocix.local = {
      ...localInstall,
      manager: localManager,
      surfaces: localSurfaces,
      connection: localConnection,
      actions: localActions,
      agentRuntime: {
        tools: 3,
        skills: 1,
        installedInIsolatedGlobalConfig: true,
      },
    };

    process.stdout.write('[interop] Configuring Legacy MCP, MCP Apps, and strict MCP 2026 targets\n');
    const mcpTargets = [
      { name: MCP_TARGETS.legacyHttp, url: `${publicBaseUrl}/mcp/legacy` },
      { name: MCP_TARGETS.legacySse, url: legacySseUrl },
      { name: MCP_TARGETS.excalidrawSelfHosted, url: `${publicBaseUrl}/mcp/excalidraw` },
      { name: MCP_TARGETS.excalidrawOfficial, url: OFFICIAL_EXCALIDRAW_URL },
      { name: MCP_TARGETS.tldraw2026, url: `${publicBaseUrl}/mcp/tldraw` },
    ];
    report.mcp.configured = await configureMcp(openChamberClient, projectRoot, mcpTargets);

    if (runtimeProcess.owned) {
      await runtimeProcess.restartOpenCode();
      await waitForHttpJson(
        openCodeClient,
        '/global/health',
        'restarted OpenCode fork health',
        (payload) => payload?.healthy === true,
        120_000,
      );
      await waitForHttpJson(
        openChamberClient,
        '/api/global/capabilities',
        'restarted OpenCode fork capability proxy',
        (payload) => payload?.features?.mcpApps === true,
        60_000,
      );
    }

    const statuses = await waitForMcpStatuses(openChamberClient, projectRoot);
    report.mcp.statuses[MCP_TARGETS.legacyHttp] = assertConnectedStatus(
      statuses,
      MCP_TARGETS.legacyHttp,
      { era: 'legacy' },
    );
    report.mcp.statuses[MCP_TARGETS.legacySse] = assertConnectedStatus(
      statuses,
      MCP_TARGETS.legacySse,
      { era: 'legacy' },
    );
    report.mcp.statuses[MCP_TARGETS.excalidrawSelfHosted] = assertConnectedStatus(
      statuses,
      MCP_TARGETS.excalidrawSelfHosted,
      { era: 'legacy', appsServer: false, appsNegotiated: false },
    );
    report.mcp.statuses[MCP_TARGETS.excalidrawOfficial] = assertConnectedStatus(
      statuses,
      MCP_TARGETS.excalidrawOfficial,
      { era: 'legacy', appsServer: false, appsNegotiated: false },
    );
    report.mcp.statuses[MCP_TARGETS.tldraw2026] = assertConnectedStatus(
      statuses,
      MCP_TARGETS.tldraw2026,
      {
        era: '2026-07-28',
        adapter: '2026-sdk',
        protocolVersion: '2026-07-28',
        appsServer: true,
        appsNegotiated: true,
      },
    );
    report.mcp.apps = await verifyMcpApps(openChamberClient, projectRoot);

    const logNeedles = [
      publicBaseUrl,
      publicGatePath,
      legacySseUrl,
      hostedKey,
      localKey,
      openCodePassword,
      openCodeBasicCredential,
    ].filter(Boolean);
    for (const logName of ['opencode.log', 'openchamber.log']) {
      const logPath = path.join(runtime.logs, logName);
      if (!await fileExists(logPath)) continue;
      const leaked = await readFileContainsAny(logPath, logNeedles);
      if (leaked) {
        throw new CredentialLeakError(
          'child-log',
          `${logName} contains gated URL or credential material`,
        );
      }
    }

    report.secretHygiene.checksCompleted = true;
    report.secretHygiene.passed = true;
    report.secretHygiene.childLogLeakDetected = false;
    report.completedAt = new Date().toISOString();
    report.phaseOk = true;
    report.productApiFunctionalOk = true;
    report.overall = {
      ok: false,
      status: 'pending-browser-appbridge',
      reason: 'Product API checks passed; real rendering and AppBridge interaction are not yet evidenced.',
    };
    keepRunning = args.keepRunning;
    await atomicWriteJson(reportPath, report);
    process.stdout.write('[interop] Product API functional phase passed; overall acceptance remains pending\n');
    process.stdout.write(`[interop] Safe report: ${reportPath}\n`);

    if (keepRunning) {
      await atomicWriteJson(path.join(runRoot, 'runtime.json'), {
        $schema: 'openchamber://interop-protected-runtime-reference/v1',
        runId,
        openChamberApiUrl: openChamberUrl,
        openCodeUrl,
        openChamberPid: runtimeProcess.openChamber?.pid ?? null,
        openCodePid: runtimeProcess.openCode?.pid ?? null,
        containsProtectedConnectionState: true,
        publishable: false,
        currentSourceHmrUiStarted: false,
        browserAcceptance: 'pending',
      });
      process.stdout.write('[interop] Isolated API runtime retained for the browser/AppBridge phase\n');
      process.stdout.write(
        '[interop] No current-source HMR UI was started; launch it separately against this isolated API runtime\n',
      );
      process.stdout.write('[interop] Press Ctrl+C after separate browser/AppBridge evidence is captured\n');
      await waitForShutdownOrRuntimeExit(runtimeProcess);
    }
  } catch (error) {
    report.completedAt = new Date().toISOString();
    report.phaseOk = false;
    report.productApiFunctionalOk = false;
    report.overall = {
      ok: false,
      status: 'failed',
      reason: 'The product API functional phase failed.',
    };
    if (error instanceof CredentialLeakError) {
      report.secretHygiene.checksCompleted = true;
      report.secretHygiene.passed = false;
      if (error.leakKind === 'response') report.secretHygiene.responseLeakDetected = true;
      if (error.leakKind === 'child-log') report.secretHygiene.childLogLeakDetected = true;
    }
    report.error = {
      message: redactor.message(error),
    };
    await atomicWriteJson(reportPath, report).catch(() => {});
    process.stderr.write(`[interop] FAILED: ${redactor.message(error)}\n`);
    process.stderr.write(`[interop] Safe report: ${reportPath}\n`);
    process.exitCode = 1;
  } finally {
    if (runtimeProcess) await runtimeProcess.stop();
  }
};

await main();
