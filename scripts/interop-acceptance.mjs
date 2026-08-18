import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workspaceRoot = path.dirname(projectRoot);
const outputRoot = path.join(projectRoot, '.tmp', 'interop-acceptance');
const SCAN_CHUNK_BYTES = 1024 * 1024;
const MAIN_CHAINS = [
  'hosted-ocix',
  'local-ocix',
  'legacy-mcp',
  'legacy-mcp-app',
  'mcp-2026-app',
];

const fail = (message) => {
  throw new Error(message);
};

const safeId = (value, label) => {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value)) {
    fail(`${label} must contain only letters, numbers, dots, underscores, and hyphens`);
  }
  return value;
};

const runDirectory = (runId) => path.join(outputRoot, safeId(runId, 'run-id'));

const writeJson = async (filePath, value) => {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
};

const readJson = async (filePath) => JSON.parse(await fs.readFile(filePath, 'utf8'));

const command = async (cwd, executable, args) => {
  const { stdout } = await execFileAsync(executable, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.trim();
};

const optionalCommand = async (cwd, executable, args) => {
  try {
    return await command(cwd, executable, args);
  } catch {
    return null;
  }
};

const repositoryState = async (directory) => {
  const [branch, commit, status, diff] = await Promise.all([
    command(directory, 'git', ['branch', '--show-current']),
    command(directory, 'git', ['rev-parse', 'HEAD']),
    command(directory, 'git', ['status', '--short']),
    execFileAsync('git', ['diff', '--binary'], {
      cwd: directory,
      encoding: null,
      maxBuffer: 32 * 1024 * 1024,
    }).then(({ stdout }) => stdout),
  ]);
  return {
    directory,
    branch,
    commit,
    dirty: status.length > 0,
    status: status ? status.split('\n') : [],
    trackedDiffSha256: crypto.createHash('sha256').update(diff).digest('hex'),
  };
};

const memorySnapshot = async () => ({
  capturedAt: new Date().toISOString(),
  pressure: await optionalCommand(projectRoot, 'memory_pressure', ['-Q']),
  swap: await optionalCommand(projectRoot, 'sysctl', ['vm.swapusage']),
});

const createRun = async (requestedRunId) => {
  const generated = new Date().toISOString().replaceAll(':', '').replaceAll('.', '-');
  const runId = safeId(requestedRunId || generated, 'run-id');
  const directory = runDirectory(runId);
  await fs.mkdir(outputRoot, { recursive: true, mode: 0o700 });
  try {
    await fs.mkdir(directory, { recursive: false, mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') fail(`Acceptance run already exists: ${runId}`);
    throw error;
  }
  for (const child of ['cases', 'screenshots', 'videos', 'logs', 'protocol']) {
    await fs.mkdir(path.join(directory, child), { mode: 0o700 });
  }

  const [openchamber, opencode, lock, memory] = await Promise.all([
    repositoryState(projectRoot),
    repositoryState(path.join(workspaceRoot, 'opencode')),
    readJson(path.join(projectRoot, 'packages', 'electron', 'opencode-cli.lock.json')),
    memorySnapshot(),
  ]);
  const run = {
    $schema: 'openchamber://interop-acceptance-run/v1',
    runId,
    status: 'running',
    startedAt: new Date().toISOString(),
    completedAt: null,
    repositories: { openchamber, opencode },
    opencodeCliLock: {
      repository: lock.repository,
      tag: lock.tag,
      version: lock.version,
      upstreamCommit: lock.upstream?.commit ?? lock.upstreamCommit,
      forkCommit: lock.fork?.commit ?? lock.forkCommit,
    },
    model: null,
    provider: null,
    deployment: {
      server: '43.138.244.5',
      projectDirectory: '/data/project/openchamber-interop-lab',
      gatewayPort: 9510,
      tunnelUrl: null,
      composeLock: null,
    },
    memory: { before: memory, after: null },
    mainChains: Object.fromEntries(MAIN_CHAINS.map((id) => [id, 'pending'])),
    caseSummary: { pass: 0, fail: 0, blocked: 0, pending: 0 },
    p0Failures: [],
    evidence: {
      protocolNegotiation: 'protocol/protocol-negotiation.json',
      secretScan: 'secret-scan.json',
      testResults: 'test-results.json',
      composeLock: 'compose-lock.json',
    },
  };
  await writeJson(path.join(directory, 'run.json'), run);
  process.stdout.write(`${JSON.stringify({ runId, directory }, null, 2)}\n`);
};

const recordCase = async (runId, caseId, status, evidenceFile) => {
  const normalizedStatus = safeId(status, 'status');
  if (!['pass', 'fail', 'blocked', 'pending'].includes(normalizedStatus)) {
    fail('status must be pass, fail, blocked, or pending');
  }
  const id = safeId(caseId, 'case-id');
  const directory = runDirectory(runId);
  const run = await readJson(path.join(directory, 'run.json'));
  let evidence = {};
  if (evidenceFile) {
    evidence = await readJson(path.resolve(evidenceFile));
  }
  const attemptDirectory = path.join(directory, 'cases', id);
  await fs.mkdir(attemptDirectory, { recursive: true, mode: 0o700 });
  const existing = (await fs.readdir(attemptDirectory))
    .filter((name) => /^attempt-\d+\.json$/.test(name));
  const attempt = existing.length + 1;
  const record = {
    $schema: 'openchamber://interop-acceptance-case/v1',
    caseId: id,
    attempt,
    status: normalizedStatus,
    recordedAt: new Date().toISOString(),
    evidence,
  };
  await writeJson(path.join(attemptDirectory, `attempt-${attempt}.json`), record);
  run.status = 'running';
  await writeJson(path.join(directory, 'run.json'), run);
  process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
};

const updateMetadata = async (runId, metadataFile) => {
  if (!metadataFile) fail('metadata requires a JSON file');
  const directory = runDirectory(runId);
  const runPath = path.join(directory, 'run.json');
  const run = await readJson(runPath);
  const metadata = await readJson(path.resolve(metadataFile));
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    fail('metadata JSON must be an object');
  }
  const allowed = new Set([
    'model',
    'provider',
    'deployment',
    'thirdPartyVersions',
    'hostedOcix',
    'mcp',
  ]);
  const unknown = Object.keys(metadata).filter((key) => !allowed.has(key));
  if (unknown.length) fail(`unsupported metadata fields: ${unknown.join(', ')}`);
  if (metadata.deployment !== undefined) {
    if (!metadata.deployment || typeof metadata.deployment !== 'object' || Array.isArray(metadata.deployment)) {
      fail('deployment metadata must be an object');
    }
    run.deployment = { ...run.deployment, ...metadata.deployment };
  }
  for (const key of ['model', 'provider', 'thirdPartyVersions', 'hostedOcix', 'mcp']) {
    if (metadata[key] !== undefined) run[key] = metadata[key];
  }
  await writeJson(runPath, run);
  process.stdout.write(`${JSON.stringify({ runId, updated: Object.keys(metadata) }, null, 2)}\n`);
};

const collectCaseRecords = async (directory) => {
  const casesDirectory = path.join(directory, 'cases');
  const caseIds = await fs.readdir(casesDirectory);
  const records = [];
  for (const caseId of caseIds.sort()) {
    const caseDirectory = path.join(casesDirectory, caseId);
    const entries = (await fs.readdir(caseDirectory))
      .filter((name) => /^attempt-\d+\.json$/.test(name))
      .sort((left, right) => Number(left.match(/\d+/)?.[0]) - Number(right.match(/\d+/)?.[0]));
    for (const entry of entries) {
      records.push(await readJson(path.join(caseDirectory, entry)));
    }
  }
  return records;
};

const walkFiles = async (directory) => {
  const files = [];
  const queue = [directory];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) queue.push(next);
      else if (entry.isFile()) files.push(next);
    }
  }
  return files;
};

const scanFileForNeedles = async (filePath, needles) => {
  const handle = await fs.open(filePath, 'r');
  const matches = new Set();
  const longestNeedle = Math.max(...needles.map((needle) => Buffer.byteLength(needle.value)));
  let carry = Buffer.alloc(0);
  let position = 0;
  try {
    while (true) {
      const chunk = Buffer.allocUnsafe(SCAN_CHUNK_BYTES);
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      const window = Buffer.concat([carry, chunk.subarray(0, bytesRead)]);
      for (const needle of needles) {
        if (window.includes(Buffer.from(needle.value))) matches.add(needle.id);
      }
      carry = window.subarray(Math.max(0, window.length - longestNeedle + 1));
    }
  } finally {
    await handle.close();
  }
  return [...matches];
};

const scanTargetFiles = async (targetPath) => {
  const metadata = await fs.stat(targetPath);
  return metadata.isDirectory() ? walkFiles(targetPath) : [targetPath];
};

const secretScan = async (runId, additionalPaths = []) => {
  const directory = runDirectory(runId);
  const canary = process.env.OPENCHAMBER_INTEROP_CANARY;
  if (!canary || canary.length < 16) {
    fail('OPENCHAMBER_INTEROP_CANARY must be set to the random test token for secret scanning');
  }
  const needles = [
    { id: 'canary-token', value: canary },
    { id: 'private-key', value: '-----BEGIN PRIVATE KEY-----' },
    { id: 'openssh-private-key', value: '-----BEGIN OPENSSH PRIVATE KEY-----' },
  ];
  const matches = [];
  const targets = [
    { label: 'acceptance-evidence', root: directory },
    ...additionalPaths.map((value, index) => ({
      label: `external-${index + 1}`,
      root: path.resolve(value),
    })),
  ];
  for (const target of targets) {
    const targetMetadata = await fs.stat(target.root);
    for (const filePath of await scanTargetFiles(target.root)) {
      if (target.root === directory && path.basename(filePath) === 'secret-scan.json') continue;
      for (const kind of await scanFileForNeedles(filePath, needles)) {
        matches.push({
          target: target.label,
          file: targetMetadata.isDirectory()
            ? path.relative(target.root, filePath)
            : path.basename(filePath),
          kind,
        });
      }
    }
  }
  const report = {
    $schema: 'openchamber://interop-secret-scan/v1',
    scannedAt: new Date().toISOString(),
    ok: matches.length === 0,
    matches,
    skipped: [],
    targets: targets.map(({ label }) => label),
  };
  await writeJson(path.join(directory, 'secret-scan.json'), report);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
};

const finalizeRun = async (runId) => {
  const directory = runDirectory(runId);
  const runPath = path.join(directory, 'run.json');
  const run = await readJson(runPath);
  const records = await collectCaseRecords(directory);
  const latestByCase = {};
  for (const record of records) latestByCase[record.caseId] = record;
  const latest = Object.values(latestByCase);
  const summary = {
    pass: latest.filter((item) => item.status === 'pass').length,
    fail: latest.filter((item) => item.status === 'fail').length,
    blocked: latest.filter((item) => item.status === 'blocked').length,
    pending: latest.filter((item) => item.status === 'pending').length,
  };
  for (const chain of MAIN_CHAINS) {
    const chainCases = latest.filter((item) => item.caseId === chain || item.caseId.startsWith(`${chain}.`));
    run.mainChains[chain] = chainCases.some((item) => item.status === 'fail')
      ? 'fail'
      : chainCases.some((item) => item.status === 'blocked')
        ? 'blocked'
        : chainCases.length > 0 && chainCases.every((item) => item.status === 'pass')
          ? 'pass'
          : 'pending';
  }
  const secretReport = await readJson(path.join(directory, 'secret-scan.json')).catch(() => null);
  const p0Failures = [
    ...(secretReport?.matches ?? []).map((match) => ({
      kind: 'secret-exposure',
      evidence: match,
    })),
    ...latest
      .filter((item) => item.evidence?.severity === 'P0' && item.status === 'fail')
      .map((item) => ({ kind: item.caseId, evidence: item.evidence })),
  ];
  const requiredEvidence = [
    path.join(directory, 'compose-lock.json'),
    path.join(directory, 'protocol', 'protocol-negotiation.json'),
  ];
  const missingEvidence = [];
  for (const evidencePath of requiredEvidence) {
    try {
      await fs.access(evidencePath);
    } catch {
      missingEvidence.push(path.relative(directory, evidencePath));
    }
  }
  const complete = Object.values(run.mainChains).every((status) => status === 'pass')
    && summary.fail === 0
    && summary.blocked === 0
    && summary.pending === 0
    && p0Failures.length === 0
    && secretReport?.ok === true
    && missingEvidence.length === 0;
  const testResults = {
    $schema: 'openchamber://interop-acceptance-results/v1',
    generatedAt: new Date().toISOString(),
    complete,
    mainChains: run.mainChains,
    summary,
    missingEvidence,
    latest,
    attempts: records,
  };
  await writeJson(path.join(directory, 'test-results.json'), testResults);
  run.status = complete ? 'passed' : 'incomplete';
  run.completedAt = new Date().toISOString();
  run.caseSummary = summary;
  run.p0Failures = p0Failures;
  run.memory.after = await memorySnapshot();
  await writeJson(runPath, run);
  process.stdout.write(`${JSON.stringify({
    runId,
    status: run.status,
    mainChains: run.mainChains,
    summary,
    p0Failures: p0Failures.length,
    missingEvidence,
    directory,
  }, null, 2)}\n`);
  if (!complete) process.exitCode = 1;
};

const [action, ...args] = process.argv.slice(2);
switch (action) {
  case 'init':
    await createRun(args[0]);
    break;
  case 'record':
    await recordCase(args[0], args[1], args[2], args[3]);
    break;
  case 'metadata':
    await updateMetadata(args[0], args[1]);
    break;
  case 'secret-scan':
    await secretScan(args[0], args.slice(1));
    break;
  case 'finalize':
    await finalizeRun(args[0]);
    break;
  default:
    fail(
      'Usage: interop-acceptance.mjs <init|metadata|record|secret-scan|finalize> ...; secret-scan accepts optional evidence paths',
    );
}
