import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';

// Self-contained acceptance must launch an exact OpenCode CLI and fail closed.
// The orchestrator strips every OPENCODE_*/OPENCHAMBER_* variable from the
// inherited environment, so without this seam it would silently launch whatever
// `opencode` the demo server finds on PATH (~/.opencode/bin/opencode on this
// machine), which may be an old official CLI that can connect Tools but never
// negotiates MCP Apps capability. That produces false green/false red runs that
// do not exercise the staged/current fork at all.

export const ACCEPTANCE_OPENCODE_CLI_PATH_ENV = 'OPENCHAMBER_TLDRAW_ACCEPTANCE_OPENCODE_CLI_PATH';

export const STAGED_OPENCODE_CLI_RELATIVE_PATH = ['packages', 'electron', 'resources', 'opencode-cli'];

export const acceptanceOpenCodeCliBinaryName = () => (process.platform === 'win32' ? 'opencode.exe' : 'opencode');

export const acceptanceOpenCodeCliStagedPath = (projectRoot) => path.join(
  projectRoot,
  ...STAGED_OPENCODE_CLI_RELATIVE_PATH,
  acceptanceOpenCodeCliBinaryName(),
);

// Selects the exact OpenCode CLI the acceptance must launch. Resolution order:
//   1. OPENCHAMBER_TLDRAW_ACCEPTANCE_OPENCODE_CLI_PATH (explicit, trimmed);
//   2. the staged repository CLI at packages/electron/resources/opencode-cli.
// The path is canonicalized (realpath), must exist as an executable file, and
// never falls back to PATH, ~/.opencode, or another installed CLI. Any failure
// throws an actionable error so the gate stops before spawning the demo.
export const selectAcceptanceOpenCodeCliPath = async ({ projectRoot, env = process.env }) => {
  const explicit = typeof env[ACCEPTANCE_OPENCODE_CLI_PATH_ENV] === 'string'
    ? env[ACCEPTANCE_OPENCODE_CLI_PATH_ENV].trim()
    : '';
  const requested = explicit || acceptanceOpenCodeCliStagedPath(projectRoot);
  const source = explicit ? 'explicit' : 'staged-default';
  const actionable = [
    `The self-contained acceptance must launch an exact OpenCode CLI (source: ${source}).`,
    `Set ${ACCEPTANCE_OPENCODE_CLI_PATH_ENV} to an existing executable file,`,
    'or stage the repository CLI first (bun run --cwd packages/electron prepare:opencode-cli).',
    'The acceptance fails closed and never falls back to PATH, ~/.opencode, or another installed CLI.',
  ].join(' ');

  let resolved;
  try {
    resolved = fs.realpathSync(requested);
  } catch (error) {
    throw new Error(`Acceptance OpenCode CLI path is missing: ${requested}. ${actionable}`, { cause: error });
  }
  let stats;
  try {
    stats = fs.statSync(resolved);
  } catch (error) {
    throw new Error(`Acceptance OpenCode CLI path cannot be inspected: ${resolved}. ${actionable}`, { cause: error });
  }
  if (!stats.isFile()) {
    throw new Error(`Acceptance OpenCode CLI path is not a file: ${resolved}. ${actionable}`);
  }
  if (process.platform !== 'win32' && (stats.mode & 0o111) === 0) {
    throw new Error(`Acceptance OpenCode CLI path is not executable: ${resolved}. ${actionable}`);
  }
  return { source, requested, resolved };
};

// Pure mismatch assessment for the /health readiness gate. The demo server
// reports opencodeBinaryResolved; it must equal the exact canonical path this
// acceptance selected. A mismatch (or a missing report) is fatal immediately:
// polling until timeout would only mask that the run validated the wrong CLI.
export const assessAcceptanceOpenCodeCliMismatch = ({ selectedPath, reportedPath }) => {
  if (typeof reportedPath !== 'string' || reportedPath.trim() === '') {
    return {
      match: false,
      reason: `health did not report opencodeBinaryResolved (received ${JSON.stringify(reportedPath)})`,
    };
  }
  if (path.resolve(selectedPath) !== path.resolve(reportedPath.trim())) {
    return {
      match: false,
      reason: `health reports opencodeBinaryResolved=${reportedPath.trim()}, but the acceptance selected ${selectedPath}`,
    };
  }
  return { match: true, reason: null };
};

const execFileAsync = promisify(execFile);

// The self-contained gate must configure exactly one remote MCP server in the
// isolated OpenCode runtime. The tracked demo at this base does not consume any
// tldraw-specific env variable, so the server has to arrive through the fork's
// OPENCODE_CONFIG_CONTENT loader (packages/opencode/src/config/config.ts), which
// deep-merges the content as a local-scope config without reading user/project
// config files. Schema matches ConfigMCPV1.Info > Remote (type remote, url,
// enabled, oauth, timeout).
export const ACCEPTANCE_MCP_SERVER_NAME = 'interop-tldraw-2026';

// Validates the tldraw MCP URL must be http: or https: and returns the trimmed
// canonical URL. Throws an actionable error for anything else (never reads user
// or project config).
export const validateAcceptanceMcpUrl = (mcpUrl) => {
  if (typeof mcpUrl !== 'string' || mcpUrl.trim() === '') {
    throw new Error(`Acceptance tldraw MCP URL must be a non-empty http(s) string; received ${JSON.stringify(mcpUrl)}`);
  }
  const trimmed = mcpUrl.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch (error) {
    throw new Error(`Acceptance tldraw MCP URL is not parseable: ${trimmed}`, { cause: error });
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(`Acceptance tldraw MCP URL must use http: or https:; received ${trimmed}`);
  }
  return trimmed;
};

// Builds the deterministic OPENCODE_CONFIG_CONTENT string for exactly one remote
// MCP server named interop-tldraw-2026 at the supplied URL. Field order, spacing,
// and values are fixed so tests can assert the exact content.
export const buildAcceptanceMcpConfigContent = ({ mcpUrl }) => {
  const url = validateAcceptanceMcpUrl(mcpUrl);
  return JSON.stringify({
    mcp: {
      [ACCEPTANCE_MCP_SERVER_NAME]: {
        type: 'remote',
        url,
        oauth: false,
        timeout: 30000,
        enabled: true,
      },
    },
  }, null, 2);
};

// Records the smallest useful process evidence for an orchestration report:
// role, PID, and the ISO timestamp the child was spawned. Returns null when
// the child was never spawned (so the report can show absent/not-spawned).
export const captureSpawnedProcessEvidence = (child, role) => {
  if (!child || typeof child.pid !== 'number') return null;
  return {
    role,
    pid: child.pid,
    spawnedAt: typeof child.spawnedAt === 'string' ? child.spawnedAt : null,
  };
};

// Records identity evidence for the orchestration output: the first whitespace
// token of `opencode --version` (e.g. 1.18.10-oc.1 for the fork, 1.18.4 for the
// old official CLI). Where practical this is recorded alongside the resolved
// path so a run's provenance is auditable without re-deriving it.
export const readAcceptanceOpenCodeCliVersion = async ({ cliPath, timeoutMs = 15_000 }) => {
  const { stdout } = await execFileAsync(cliPath, ['--version'], { encoding: 'utf8', timeout: timeoutMs });
  return String(stdout || '').trim().split(/\s+/)[0] || null;
};

// Derives the deterministic workbench project id for an absolute path using the
// same path_<base64url(abs path)> convention as the server's
// createProjectIdFromPath (packages/web/server/lib/projects/project-id.js) and
// the UI's createProjectIdFromPath (packages/ui/src/lib/projectId.ts). The two
// implementations differ only on the filesystem root: the server preserves '/'
// (via its `|| value` fallback) while the UI returns '' for '/'. For the real
// acceptance input — an absolute non-root projectRoot (path.resolve of the
// worktree root) — both implementations agree with this helper. Workbench boards
// are keyed by this id: the host Pin action persists into projectId and the
// verifier polls GET /api/interactive-ui/workbench/boards/projectId, so both
// sides must derive it from the same normalization instead of duplicating the
// encoding inline.
export const deriveWorkbenchProjectId = (projectPath) => {
  if (typeof projectPath !== 'string') return '';
  const normalized = projectPath.replace(/\\/g, '/').replace(/\/+$/g, '') || projectPath;
  const trimmed = normalized.trim();
  if (!trimmed) return '';
  return `path_${Buffer.from(trimmed, 'utf8').toString('base64url')}`;
};

const WORKBENCH_SETTINGS_ENDPOINT = '/api/config/settings';

// Registers the acceptance projectRoot as the exact workbench project in the
// isolated demo settings before the browser verifier starts. The isolated demo
// settings.json only carries recap/suggestion flags, so the Pin button's
// resolveWorkbenchPinProject returns null for the authoritative message
// directory (projectRoot) and handlePin returns before any network request —
// the observed production failure. This PUTs /api/config/settings with a single
// canonical project entry plus activeProjectId and lastDirectory, then fails
// closed unless a 2xx response echoes that exact identity (malformed or
// mismatched responses are never treated as success). Returns auditable
// evidence for the orchestration report. resolveWorkbenchPinProject is not
// weakened: the acceptance registers the real project instead.
export const configureAcceptanceProject = async ({
  baseUrl,
  projectRoot,
  fetchImpl = fetch,
  timeoutMs = 15_000,
}) => {
  const canonicalRoot = path.resolve(projectRoot);
  const projectId = deriveWorkbenchProjectId(canonicalRoot);
  if (!projectId) {
    throw new Error(`configureAcceptanceProject cannot derive a project id from ${JSON.stringify(projectRoot)}`);
  }
  const endpoint = `${String(baseUrl).replace(/\/+$/, '')}${WORKBENCH_SETTINGS_ENDPOINT}`;
  const request = {
    projects: [{ id: projectId, path: canonicalRoot }],
    activeProjectId: projectId,
    lastDirectory: canonicalRoot,
  };
  const response = await fetchImpl(endpoint, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `configureAcceptanceProject PUT ${endpoint} failed (${response.status}): ${String(detail).slice(0, 240)}`,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`configureAcceptanceProject received a non-JSON response from ${endpoint}`, { cause: error });
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error(`configureAcceptanceProject received an invalid settings payload from ${endpoint}`);
  }
  const projects = Array.isArray(payload.projects) ? payload.projects : [];
  // The request promises exactly one canonical project; a response with any
  // other count means the server did not echo the isolated settings we wrote.
  if (projects.length !== 1) {
    throw new Error(
      `configureAcceptanceProject response from ${endpoint} must contain exactly one project entry (received ${projects.length})`,
    );
  }
  const entry = projects[0];
  if (!entry || typeof entry !== 'object' || entry.id !== projectId) {
    throw new Error(`configureAcceptanceProject response from ${endpoint} did not include project ${projectId}`);
  }
  if (typeof entry.path !== 'string' || path.resolve(entry.path) !== canonicalRoot) {
    throw new Error(
      `configureAcceptanceProject response project ${projectId} does not match ${canonicalRoot} (received ${JSON.stringify(entry.path)})`,
    );
  }
  if (typeof payload.activeProjectId !== 'string' || payload.activeProjectId !== projectId) {
    throw new Error(
      `configureAcceptanceProject response activeProjectId=${JSON.stringify(payload.activeProjectId)} does not match ${projectId}`,
    );
  }
  const receivedLastDirectory = typeof payload.lastDirectory === 'string' ? payload.lastDirectory.trim() : '';
  if (receivedLastDirectory === '' || path.resolve(receivedLastDirectory) !== canonicalRoot) {
    throw new Error(
      `configureAcceptanceProject response lastDirectory=${JSON.stringify(payload.lastDirectory)} does not match ${canonicalRoot}`,
    );
  }
  return {
    endpoint,
    method: 'PUT',
    projectRoot: canonicalRoot,
    projectId,
    request,
    response: {
      status: response.status,
      project: { id: entry.id, path: entry.path },
      activeProjectId: payload.activeProjectId,
      lastDirectory: payload.lastDirectory,
    },
  };
};
