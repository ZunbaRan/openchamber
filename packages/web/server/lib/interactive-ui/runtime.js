import {
  buildInteractiveUICapabilityCatalog,
  normalizeInteractiveUIRouting,
  renderInteractiveUIRoutingSystemPrompt,
} from './routing.js';
import { createInstalledHTMLArtifactDocument } from './artifact-store.js';

const MANIFEST_FILE = 'openchamber.extension.json';
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_VIEW_BYTES = 512 * 1024;
const MAX_NATIVE_BUNDLE_BYTES = 2 * 1024 * 1024;
const MAX_INSTALLED_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const ACTION_TIMEOUT_MS = 15_000;
const CONNECTION_TEST_TIMEOUT_MS = 10_000;
const CONFIRMATION_TTL_MS = 60_000;
const MAX_PENDING_CONFIRMATIONS = 1024;
const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const ACTION_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const ENV_REFERENCE_PATTERN = /^\$\{([A-Z][A-Z0-9_]*)\}$/;
const HEADER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const BLOCKED_CREDENTIAL_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'proxy-authorization',
  'set-cookie',
  'transfer-encoding',
]);

export class InteractiveUIRuntimeError extends Error {
  constructor(message, status = 400, code = 'invalid_request', details = undefined) {
    super(message);
    this.name = 'InteractiveUIRuntimeError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

const readLimitedText = async (fsPromises, filePath, maxBytes) => {
  const stat = await fsPromises.stat(filePath);
  if (!stat.isFile()) throw new InteractiveUIRuntimeError('Extension entry is not a file', 400, 'invalid_entry');
  if (stat.size > maxBytes) throw new InteractiveUIRuntimeError('Extension entry exceeds the size limit', 413, 'entry_too_large');
  return fsPromises.readFile(filePath, 'utf8');
};

const parseJson = (text, label) => {
  try {
    return JSON.parse(text);
  } catch {
    throw new InteractiveUIRuntimeError(`${label} is not valid JSON`, 400, 'invalid_json');
  }
};

const resolveEnvReference = (value, environment, label) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InteractiveUIRuntimeError(`${label} is required`, 400, 'invalid_manifest');
  }
  const trimmed = value.trim();
  const match = trimmed.match(ENV_REFERENCE_PATTERN);
  if (!match) return trimmed;
  const resolved = environment[match[1]];
  if (typeof resolved !== 'string' || !resolved.trim()) {
    throw new InteractiveUIRuntimeError(`${label} references an unset environment variable`, 503, 'connector_unconfigured');
  }
  return resolved.trim();
};

const resolveEntryPath = (path, extensionDirectory, entry, allowedExtensions) => {
  if (typeof entry !== 'string' || !entry.trim()) {
    throw new InteractiveUIRuntimeError('Extension entry path is required', 400, 'invalid_manifest');
  }
  const resolved = path.resolve(extensionDirectory, entry);
  const relative = path.relative(extensionDirectory, resolved);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new InteractiveUIRuntimeError('Extension entry escapes its installation directory', 400, 'invalid_entry');
  }
  if (allowedExtensions && !allowedExtensions.some((extension) => resolved.endsWith(extension))) {
    throw new InteractiveUIRuntimeError('Extension entry has an unsupported file type', 400, 'invalid_entry');
  }
  return resolved;
};

const normalizeCredentialPlacement = (auth, connectorId) => {
  const placement = isRecord(auth.placement) ? auth.placement : {};
  if (placement.type !== undefined && placement.type !== 'header') {
    throw new InteractiveUIRuntimeError(`Connector ${connectorId} credentials must use header placement`, 400, 'invalid_manifest');
  }
  const name = typeof placement.name === 'string' && placement.name.trim()
    ? placement.name.trim()
    : 'Authorization';
  if (!HEADER_NAME_PATTERN.test(name) || BLOCKED_CREDENTIAL_HEADERS.has(name.toLowerCase()) || name.toLowerCase().startsWith('x-openchamber-')) {
    throw new InteractiveUIRuntimeError(`Connector ${connectorId} uses an unsafe credential header`, 400, 'invalid_manifest');
  }
  const prefix = typeof placement.prefix === 'string'
    ? placement.prefix
    : name.toLowerCase() === 'authorization' ? 'Bearer ' : '';
  if (prefix.length > 64 || /[\r\n\0]/.test(prefix)) {
    throw new InteractiveUIRuntimeError(`Connector ${connectorId} uses an invalid credential prefix`, 400, 'invalid_manifest');
  }
  return { type: 'header', name, prefix };
};

const normalizeSafeRequest = (value, connectorId, label, allowedMethods) => {
  if (!isRecord(value)) return null;
  const method = typeof value.method === 'string' ? value.method.toUpperCase() : allowedMethods[0];
  if (!allowedMethods.includes(method)) {
    throw new InteractiveUIRuntimeError(`Connector ${connectorId} ${label} uses an unsupported HTTP method`, 400, 'invalid_manifest');
  }
  if (typeof value.path !== 'string' || !value.path.startsWith('/') || value.path.includes('://') || value.path.includes('..')) {
    throw new InteractiveUIRuntimeError(`Connector ${connectorId} ${label} must use a fixed connector-relative path`, 400, 'invalid_manifest');
  }
  return { method, path: value.path };
};

const normalizeConnector = (connector, manifest, environment) => {
  if (!isRecord(connector) || typeof connector.id !== 'string' || connector.type !== 'http') {
    throw new InteractiveUIRuntimeError('Only named HTTP connectors are supported in OCIX v1', 400, 'invalid_manifest');
  }
  const baseUrlValue = resolveEnvReference(connector.baseUrl, environment, `Connector ${connector.id} baseUrl`);
  let baseUrl;
  try {
    baseUrl = new URL(baseUrlValue);
  } catch {
    throw new InteractiveUIRuntimeError(`Connector ${connector.id} has an invalid baseUrl`, 400, 'invalid_manifest');
  }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) {
    throw new InteractiveUIRuntimeError(`Connector ${connector.id} must use an HTTP(S) URL without embedded credentials`, 400, 'invalid_manifest');
  }
  const networkPermissions = Array.isArray(manifest.permissions?.network) ? manifest.permissions.network : [];
  const allowedOrigins = networkPermissions.map((value) => {
    const resolved = resolveEnvReference(value, environment, 'Network permission');
    try {
      return new URL(resolved).origin;
    } catch {
      throw new InteractiveUIRuntimeError('Network permission must be an absolute HTTP(S) URL', 400, 'invalid_manifest');
    }
  });
  if (!allowedOrigins.includes(baseUrl.origin)) {
    throw new InteractiveUIRuntimeError(`Connector ${connector.id} origin is not declared in permissions.network`, 400, 'network_not_allowed');
  }
  const auth = isRecord(connector.auth) ? connector.auth : { type: 'none' };
  if (!['none', 'env-bearer', 'api-key', 'issued-key'].includes(auth.type)) {
    throw new InteractiveUIRuntimeError(`Connector ${connector.id} uses an unsupported auth type`, 400, 'invalid_manifest');
  }
  if (auth.type === 'env-bearer' && (typeof auth.env !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(auth.env))) {
    throw new InteractiveUIRuntimeError(`Connector ${connector.id} must declare a valid bearer-token environment variable`, 400, 'invalid_manifest');
  }
  let normalizedAuth;
  if (auth.type === 'env-bearer') {
    normalizedAuth = { type: 'env-bearer', env: auth.env };
  } else if (auth.type === 'api-key') {
    normalizedAuth = { type: 'api-key', placement: normalizeCredentialPlacement(auth, connector.id) };
  } else if (auth.type === 'issued-key') {
    const provisioningUrlValue = resolveEnvReference(auth.provisioningUrl, environment, `Connector ${connector.id} provisioningUrl`);
    let provisioningUrl;
    try {
      provisioningUrl = new URL(provisioningUrlValue);
    } catch {
      throw new InteractiveUIRuntimeError(`Connector ${connector.id} has an invalid provisioningUrl`, 400, 'invalid_manifest');
    }
    const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(provisioningUrl.hostname);
    if ((provisioningUrl.protocol !== 'https:' && !(provisioningUrl.protocol === 'http:' && loopback)) || provisioningUrl.username || provisioningUrl.password) {
      throw new InteractiveUIRuntimeError(`Connector ${connector.id} provisioningUrl must use HTTPS without embedded credentials`, 400, 'invalid_manifest');
    }
    if (!allowedOrigins.includes(provisioningUrl.origin)) {
      throw new InteractiveUIRuntimeError(`Connector ${connector.id} provisioning origin is not declared in permissions.network`, 400, 'network_not_allowed');
    }
    normalizedAuth = {
      type: 'issued-key',
      placement: normalizeCredentialPlacement(auth, connector.id),
      provisioningUrl: provisioningUrl.toString(),
    };
  } else {
    normalizedAuth = { type: 'none' };
  }
  return {
    id: connector.id,
    type: 'http',
    baseUrl: baseUrl.toString(),
    origin: baseUrl.origin,
    auth: normalizedAuth,
    test: normalizeSafeRequest(connector.test, connector.id, 'test request', ['GET', 'HEAD']),
  };
};

const normalizeAction = (action, connectorIds) => {
  if (!isRecord(action) || typeof action.id !== 'string' || !ACTION_ID_PATTERN.test(action.id)) {
    throw new InteractiveUIRuntimeError('Action IDs must be namespaced identifiers', 400, 'invalid_manifest');
  }
  if (typeof action.connector !== 'string' || !connectorIds.has(action.connector)) {
    throw new InteractiveUIRuntimeError(`Action ${action.id} references an unknown connector`, 400, 'invalid_manifest');
  }
  const risk = ['read', 'write', 'destructive'].includes(action.risk) ? action.risk : 'read';
  const permission = ['allow', 'ask', 'deny'].includes(action.permission)
    ? action.permission
    : risk === 'read' ? 'allow' : 'ask';
  const request = isRecord(action.request) ? action.request : {};
  const method = typeof request.method === 'string' ? request.method.toUpperCase() : 'POST';
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    throw new InteractiveUIRuntimeError(`Action ${action.id} uses an unsupported HTTP method`, 400, 'invalid_manifest');
  }
  if (typeof request.path !== 'string' || !request.path.startsWith('/') || request.path.includes('://') || request.path.includes('..')) {
    throw new InteractiveUIRuntimeError(`Action ${action.id} must use a fixed connector-relative path`, 400, 'invalid_manifest');
  }
  return {
    id: action.id,
    connector: action.connector,
    risk,
    permission,
    request: { method, path: request.path },
    confirmation: isRecord(action.confirmation)
      ? {
          ...(typeof action.confirmation.title === 'string' ? { title: action.confirmation.title } : {}),
          ...(typeof action.confirmation.description === 'string' ? { description: action.confirmation.description } : {}),
        }
      : undefined,
  };
};

const normalizeView = (view, extensionId, routing) => {
  if (!isRecord(view) || typeof view.id !== 'string' || !view.id.startsWith(`${extensionId}.`)) {
    throw new InteractiveUIRuntimeError('View IDs must be inside the extension namespace', 400, 'invalid_manifest');
  }
  if (view.runtime !== 'declarative' && view.runtime !== 'native') {
    throw new InteractiveUIRuntimeError(`View ${view.id} has an unsupported runtime`, 400, 'invalid_manifest');
  }
  if (typeof view.entry !== 'string' || !view.entry.trim()) {
    throw new InteractiveUIRuntimeError(`View ${view.id} is missing its entry`, 400, 'invalid_manifest');
  }
  return {
    id: view.id,
    runtime: view.runtime,
    entry: view.entry,
    exportName: typeof view.export === 'string' && view.export.trim() ? view.export.trim() : 'extension',
    tools: Array.isArray(view.tools) ? view.tools.filter((tool) => typeof tool === 'string' && tool.trim()).map((tool) => tool.trim()) : [],
    routing: routing ?? null,
    displayModes: Array.isArray(view.displayModes)
      ? view.displayModes.filter((mode) => ['inline', 'workspace', 'fullscreen'].includes(mode))
      : ['inline'],
  };
};

const normalizeInstalledArtifact = (artifact, extensionId, routing, actionIds) => {
  if (!isRecord(artifact) || typeof artifact.id !== 'string' || !artifact.id.startsWith(`${extensionId}.`)) {
    throw new InteractiveUIRuntimeError('HTML Artifact IDs must be inside the extension namespace', 400, 'invalid_manifest');
  }
  if (typeof artifact.title !== 'string' || !artifact.title.trim() || artifact.title.length > 120) {
    throw new InteractiveUIRuntimeError(`HTML Artifact ${artifact.id} must declare a short title`, 400, 'invalid_manifest');
  }
  if (typeof artifact.entry !== 'string' || !artifact.entry.trim()) {
    throw new InteractiveUIRuntimeError(`HTML Artifact ${artifact.id} is missing its entry`, 400, 'invalid_manifest');
  }
  const capabilities = isRecord(artifact.capabilities) ? artifact.capabilities : {};
  if (!Object.keys(capabilities).every((key) => key === 'scripts' || key === 'businessActions') || capabilities.scripts !== true) {
    throw new InteractiveUIRuntimeError(`Installed HTML Artifact ${artifact.id} must enable scripts`, 400, 'invalid_manifest');
  }
  if (capabilities.businessActions !== undefined && (!Array.isArray(capabilities.businessActions)
    || capabilities.businessActions.some((action) => typeof action !== 'string' || !ACTION_ID_PATTERN.test(action)))) {
    throw new InteractiveUIRuntimeError(`HTML Artifact ${artifact.id} has invalid business actions`, 400, 'invalid_manifest');
  }
  const businessActions = Array.isArray(capabilities.businessActions) ? capabilities.businessActions : [];
  if (new Set(businessActions).size !== businessActions.length) {
    throw new InteractiveUIRuntimeError(`HTML Artifact ${artifact.id} contains duplicate business actions`, 400, 'invalid_manifest');
  }
  for (const action of businessActions) {
    if (!actionIds.has(action)) {
      throw new InteractiveUIRuntimeError(`HTML Artifact ${artifact.id} references undeclared action ${action}`, 400, 'invalid_manifest');
    }
  }
  if (artifact.displayModes !== undefined && (!Array.isArray(artifact.displayModes)
    || artifact.displayModes.some((mode) => !['inline', 'workspace', 'fullscreen'].includes(mode)))) {
    throw new InteractiveUIRuntimeError(`HTML Artifact ${artifact.id} has invalid display modes`, 400, 'invalid_manifest');
  }
  const displayModes = artifact.displayModes ?? ['inline', 'workspace', 'fullscreen'];
  if (!displayModes.includes('inline') || new Set(displayModes).size !== displayModes.length) {
    throw new InteractiveUIRuntimeError(`HTML Artifact ${artifact.id} has invalid display modes`, 400, 'invalid_manifest');
  }
  const inlineHeight = artifact.inlineHeight === undefined ? 420 : artifact.inlineHeight;
  if (!Number.isInteger(inlineHeight) || inlineHeight < 120 || inlineHeight > 900) {
    throw new InteractiveUIRuntimeError(`HTML Artifact ${artifact.id} inlineHeight must be an integer from 120 to 900`, 400, 'invalid_manifest');
  }
  return {
    id: artifact.id,
    title: artifact.title.trim(),
    entry: artifact.entry.trim(),
    tools: Array.isArray(artifact.tools)
      ? artifact.tools.filter((tool) => typeof tool === 'string' && tool.trim()).map((tool) => tool.trim())
      : [],
    routing: routing ?? null,
    displayModes,
    inlineHeight,
    businessActions,
  };
};

const normalizeManifest = (raw, directory, environment) => {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !EXTENSION_ID_PATTERN.test(raw.id)) {
    throw new InteractiveUIRuntimeError('Extension manifest has an invalid namespaced id', 400, 'invalid_manifest');
  }
  if (typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.version !== 'string' || !raw.version.trim()) {
    throw new InteractiveUIRuntimeError(`Extension ${raw.id} must declare name and version`, 400, 'invalid_manifest');
  }
  const normalizedRouting = normalizeInteractiveUIRouting(raw);
  const views = Array.isArray(raw.views)
    ? raw.views.map((view) => normalizeView(view, raw.id, normalizedRouting.viewRouting.get(view?.id)))
    : [];
  const viewIds = new Set(views.map((view) => view.id));
  if (viewIds.size !== views.length) throw new InteractiveUIRuntimeError(`Extension ${raw.id} has duplicate view IDs`, 409, 'duplicate_view');

  const connectors = Array.isArray(raw.connectors)
    ? raw.connectors.map((connector) => normalizeConnector(connector, raw, environment))
    : [];
  const connectorIds = new Set(connectors.map((connector) => connector.id));
  if (connectorIds.size !== connectors.length) throw new InteractiveUIRuntimeError(`Extension ${raw.id} has duplicate connector IDs`, 409, 'duplicate_connector');
  const actions = Array.isArray(raw.actions) ? raw.actions.map((action) => normalizeAction(action, connectorIds)) : [];
  const actionIds = new Set(actions.map((action) => action.id));
  if (actionIds.size !== actions.length) throw new InteractiveUIRuntimeError(`Extension ${raw.id} has duplicate action IDs`, 409, 'duplicate_action');
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.map((artifact) => normalizeInstalledArtifact(
        artifact,
        raw.id,
        normalizedRouting.artifactRouting.get(artifact?.id),
        actionIds,
      ))
    : [];
  const artifactIds = new Set(artifacts.map((artifact) => artifact.id));
  if (artifactIds.size !== artifacts.length) {
    throw new InteractiveUIRuntimeError(`Extension ${raw.id} has duplicate HTML Artifact IDs`, 409, 'duplicate_artifact');
  }
  if (views.length === 0 && artifacts.length === 0) {
    throw new InteractiveUIRuntimeError(`Extension ${raw.id} does not declare any Interactive UI views or HTML Artifacts`, 400, 'invalid_manifest');
  }
  if (artifacts.some((artifact) => viewIds.has(artifact.id))) {
    throw new InteractiveUIRuntimeError(`Extension ${raw.id} reuses a surface ID across Interactive UI and HTML Artifact`, 409, 'duplicate_surface');
  }

  return {
    id: raw.id,
    name: raw.name.trim(),
    version: raw.version.trim(),
    directory,
    agentRouting: normalizedRouting.agentRouting,
    views,
    artifacts,
    connectors,
    actions,
  };
};

export const createInteractiveUIRuntime = ({
  fsPromises,
  path,
  crypto,
  fetchImpl = globalThis.fetch,
  extensionRoots = [],
  environment = process.env,
  connectionStore = null,
  logger = console,
} = {}) => {
  if (!fsPromises || !path || !crypto || typeof fetchImpl !== 'function') {
    throw new Error('Interactive UI runtime dependencies are incomplete');
  }

  const pendingConfirmations = new Map();
  // Credential state is durable; reachability is only recent runtime evidence.
  // Keep health ephemeral so it can never become an authorization source.
  const connectionHealth = new Map();
  const connectionHealthKey = (extensionId, connectorId) => `${extensionId}\u0000${connectorId}`;
  const getConnectionHealth = (extensionId, connectorId) => connectionHealth.get(connectionHealthKey(extensionId, connectorId)) ?? {
    status: 'unknown',
    checkedAt: null,
  };
  const setConnectionHealth = (extensionId, connectorId, status, code = null) => {
    const health = {
      status,
      checkedAt: new Date().toISOString(),
      ...(code ? { code } : {}),
    };
    connectionHealth.set(connectionHealthKey(extensionId, connectorId), health);
    return health;
  };
  const resetConnectionHealth = (extensionId, connectorId) => {
    connectionHealth.delete(connectionHealthKey(extensionId, connectorId));
  };
  const sweepConfirmations = (now = Date.now()) => {
    for (const [token, entry] of pendingConfirmations) {
      if (entry.expiresAt <= now) pendingConfirmations.delete(token);
    }
  };
  const confirmationFingerprint = ({ extensionId, surfaceId, surfaceType, actionId, instanceId, tool, input }) => {
    const context = canonicalize({
      extensionId,
      surfaceId,
      surfaceType,
      actionId,
      instanceId: typeof instanceId === 'string' ? instanceId : '',
      tool: isRecord(tool)
        ? {
            id: typeof tool.id === 'string' ? tool.id : '',
            name: typeof tool.name === 'string' ? tool.name : '',
          }
        : { id: '', name: '' },
      input: input ?? null,
    });
    return crypto.createHash('sha256').update(JSON.stringify(context)).digest('hex');
  };
  const issueConfirmation = (fingerprint, confirmation) => {
    const now = Date.now();
    sweepConfirmations(now);
    while (pendingConfirmations.size >= MAX_PENDING_CONFIRMATIONS) {
      const oldest = pendingConfirmations.keys().next().value;
      if (oldest === undefined) break;
      pendingConfirmations.delete(oldest);
    }
    const token = `oc_confirmation_${crypto.randomUUID()}`;
    const expiresAt = now + CONFIRMATION_TTL_MS;
    pendingConfirmations.set(token, { fingerprint, expiresAt });
    return { token, expiresAt, confirmation };
  };
  const consumeConfirmation = (token, fingerprint) => {
    if (typeof token !== 'string' || !token) return false;
    sweepConfirmations();
    const entry = pendingConfirmations.get(token);
    if (!entry || entry.fingerprint !== fingerprint) return false;
    pendingConfirmations.delete(token);
    return true;
  };

  const discoverManifestPaths = async () => {
    const manifests = [];
    const rootValues = typeof extensionRoots === 'function' ? await extensionRoots() : extensionRoots;
    if (!Array.isArray(rootValues)) {
      throw new InteractiveUIRuntimeError('Extension roots are unavailable', 500, 'extension_roots_unavailable');
    }
    for (const rootValue of rootValues) {
      if (typeof rootValue !== 'string' || !rootValue.trim()) continue;
      const root = path.resolve(rootValue.trim());
      let stat;
      try {
        stat = await fsPromises.stat(root);
      } catch (error) {
        if (error?.code !== 'ENOENT') logger.warn?.('[InteractiveUI] Failed to inspect extension root', error?.message || error);
        continue;
      }
      if (stat.isFile() && path.basename(root) === MANIFEST_FILE) {
        manifests.push(root);
        continue;
      }
      if (!stat.isDirectory()) continue;
      const directManifest = path.join(root, MANIFEST_FILE);
      try {
        if ((await fsPromises.stat(directManifest)).isFile()) manifests.push(directManifest);
      } catch {
      }
      const children = await fsPromises.readdir(root, { withFileTypes: true }).catch(() => []);
      for (const child of children) {
        if (!child.isDirectory()) continue;
        const manifestPath = path.join(root, child.name, MANIFEST_FILE);
        try {
          if ((await fsPromises.stat(manifestPath)).isFile()) manifests.push(manifestPath);
        } catch {
        }
      }
    }
    return Array.from(new Set(manifests));
  };

  const loadExtensions = async () => {
    const extensions = [];
    const errors = [];
    for (const manifestPath of await discoverManifestPaths()) {
      try {
        const text = await readLimitedText(fsPromises, manifestPath, MAX_MANIFEST_BYTES);
        extensions.push(normalizeManifest(parseJson(text, MANIFEST_FILE), path.dirname(manifestPath), environment));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({ manifest: manifestPath, error: message });
        logger.warn?.('[InteractiveUI] Extension was skipped:', message);
      }
    }
    const ids = new Set();
    const surfaces = new Set();
    for (const extension of extensions) {
      if (ids.has(extension.id)) throw new InteractiveUIRuntimeError(`Duplicate extension ID ${extension.id}`, 409, 'duplicate_extension');
      ids.add(extension.id);
      for (const view of extension.views) {
        if (surfaces.has(view.id)) throw new InteractiveUIRuntimeError(`Duplicate surface ID ${view.id}`, 409, 'duplicate_surface');
        surfaces.add(view.id);
      }
      for (const artifact of extension.artifacts) {
        if (surfaces.has(artifact.id)) throw new InteractiveUIRuntimeError(`Duplicate surface ID ${artifact.id}`, 409, 'duplicate_surface');
        surfaces.add(artifact.id);
      }
    }
    return { extensions, errors };
  };

  const findView = async (viewId) => {
    const { extensions } = await loadExtensions();
    for (const extension of extensions) {
      const view = extension.views.find((candidate) => candidate.id === viewId);
      if (view) return { extension, view };
    }
    throw new InteractiveUIRuntimeError(`Interactive view ${viewId} is not installed`, 404, 'view_not_found');
  };

  const findInstalledArtifact = async (artifactId) => {
    const { extensions } = await loadExtensions();
    for (const extension of extensions) {
      const artifact = extension.artifacts.find((candidate) => candidate.id === artifactId);
      if (artifact) return { extension, artifact };
    }
    throw new InteractiveUIRuntimeError(`HTML Artifact ${artifactId} is not installed`, 404, 'artifact_not_found');
  };

  const findConnector = async (extensionId, connectorId) => {
    const { extensions } = await loadExtensions();
    const extension = extensions.find((candidate) => candidate.id === extensionId);
    if (!extension) throw new InteractiveUIRuntimeError(`Extension ${extensionId} is not installed`, 404, 'extension_not_found');
    const connector = extension.connectors.find((candidate) => candidate.id === connectorId);
    if (!connector) throw new InteractiveUIRuntimeError(`Connector ${connectorId} is not declared by ${extensionId}`, 404, 'connector_not_found');
    return { extension, connector };
  };

  const getConnectionStatus = async (extensionId, connector) => {
    if (connector.auth.type === 'none') return { configured: true, expired: false, source: 'none' };
    if (connector.auth.type === 'env-bearer') {
      const configured = typeof environment[connector.auth.env] === 'string' && Boolean(environment[connector.auth.env].trim());
      return { configured, expired: false, source: 'environment' };
    }
    if (!connectionStore?.getStatus) return { configured: false, expired: false };
    return connectionStore.getStatus(extensionId, connector.id);
  };

  const applyConnectorAuthentication = async (extensionId, connector, headers) => {
    if (connector.auth.type === 'none') return;
    if (connector.auth.type === 'env-bearer') {
      const token = environment[connector.auth.env];
      if (typeof token !== 'string' || !token.trim()) {
        throw new InteractiveUIRuntimeError('Connector credentials are not configured', 503, 'connector_unconfigured');
      }
      headers.set('Authorization', `Bearer ${token.trim()}`);
      return;
    }
    if (!connectionStore?.resolveCredential) {
      throw new InteractiveUIRuntimeError('Connector credentials are not configured', 503, 'connector_unconfigured');
    }
    const credential = await connectionStore.resolveCredential(extensionId, connector.id);
    if (!credential?.accessKey) {
      throw new InteractiveUIRuntimeError('Connector credentials are not configured', 503, 'connector_unconfigured');
    }
    headers.set(
      connector.auth.placement.name,
      `${connector.auth.placement.prefix}${credential.accessKey}`,
    );
  };

  const listConnections = async () => {
    const { extensions, errors } = await loadExtensions();
    return {
      apiVersion: 1,
      connections: await Promise.all(extensions.flatMap((extension) => extension.connectors.map(async (connector) => ({
        extension: { id: extension.id, name: extension.name, version: extension.version },
        connector: {
          id: connector.id,
          origin: connector.origin,
          authType: connector.auth.type,
          testable: Boolean(connector.test),
          configurable: connector.auth.type === 'api-key',
          provisionable: connector.auth.type === 'issued-key',
        },
        credential: await getConnectionStatus(extension.id, connector),
        health: getConnectionHealth(extension.id, connector.id),
      })))),
      errors,
    };
  };

  const configureConnection = async (extensionId, connectorId, input) => {
    const { connector } = await findConnector(extensionId, connectorId);
    if (connector.auth.type !== 'api-key' || !connectionStore?.setManualCredential) {
      throw new InteractiveUIRuntimeError('Connector does not accept a manually configured access key', 409, 'manual_configuration_unsupported');
    }
    const credential = await connectionStore.setManualCredential(extensionId, connectorId, input?.accessKey);
    resetConnectionHealth(extensionId, connectorId);
    return { extensionId, connectorId, credential };
  };

  const provisionConnection = async (extensionId, connectorId, input) => {
    const { connector } = await findConnector(extensionId, connectorId);
    if (connector.auth.type !== 'issued-key' || !connectionStore?.provisionCredential) {
      throw new InteractiveUIRuntimeError('Connector does not support credential provisioning', 409, 'provisioning_unsupported');
    }
    const credential = await connectionStore.provisionCredential(extensionId, connector, input?.setupCode);
    resetConnectionHealth(extensionId, connectorId);
    return { extensionId, connectorId, credential };
  };

  const removeConnection = async (extensionId, connectorId) => {
    await findConnector(extensionId, connectorId);
    resetConnectionHealth(extensionId, connectorId);
    if (!connectionStore?.removeCredential) return { removed: false };
    return connectionStore.removeCredential(extensionId, connectorId);
  };

  const removeExtensionConnections = async (extensionId) => {
    for (const key of connectionHealth.keys()) {
      if (key.startsWith(`${extensionId}\u0000`)) connectionHealth.delete(key);
    }
    if (!connectionStore?.removeExtensionCredentials) return { removed: 0 };
    return connectionStore.removeExtensionCredentials(extensionId);
  };

  const testConnection = async (extensionId, connectorId) => {
    const { connector } = await findConnector(extensionId, connectorId);
    if (!connector.test) throw new InteractiveUIRuntimeError('Connector does not declare a safe test request', 409, 'connection_test_unsupported');
    const target = new URL(connector.test.path.slice(1), connector.baseUrl.endsWith('/') ? connector.baseUrl : `${connector.baseUrl}/`);
    if (target.origin !== connector.origin) throw new InteractiveUIRuntimeError('Connection test escaped the connector origin', 403, 'network_not_allowed');
    const requestId = crypto.randomUUID();
    const headers = new Headers({ Accept: 'application/json', 'X-OpenChamber-Request-Id': requestId });
    await applyConnectorAuthentication(extensionId, connector, headers);
    let response;
    try {
      response = await fetchImpl(target, {
        method: connector.test.method,
        headers,
        signal: AbortSignal.timeout(CONNECTION_TEST_TIMEOUT_MS),
      });
    } catch (error) {
      const timeout = error?.name === 'TimeoutError';
      setConnectionHealth(extensionId, connectorId, 'unreachable', timeout ? 'connection_test_timeout' : 'upstream_unavailable');
      throw new InteractiveUIRuntimeError(
        timeout ? 'Connection test timed out' : 'Connection test failed',
        502,
        timeout ? 'connection_test_timeout' : 'upstream_unavailable',
      );
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_UPSTREAM_BYTES) throw new InteractiveUIRuntimeError('Connection test response is too large', 502, 'upstream_response_too_large');
    if (!response.ok) {
      if (response.status === 401) {
        setConnectionHealth(extensionId, connectorId, 'unauthorized', 'connector_unauthorized');
        throw new InteractiveUIRuntimeError('Access key is invalid or expired', 401, 'connector_unauthorized');
      }
      if (response.status === 403) {
        setConnectionHealth(extensionId, connectorId, 'forbidden', 'connector_forbidden');
        throw new InteractiveUIRuntimeError('Access key does not have permission', 403, 'connector_forbidden');
      }
      setConnectionHealth(extensionId, connectorId, 'reachable', 'upstream_error');
      throw new InteractiveUIRuntimeError(`Business system rejected the connection test (${response.status})`, response.status >= 400 && response.status < 500 ? response.status : 502, 'upstream_error');
    }
    const health = setConnectionHealth(extensionId, connectorId, 'reachable');
    return { ok: true, status: response.status, requestId, checkedAt: health.checkedAt };
  };

  const getViewDescriptor = async (viewId, toolName = '') => {
    const { extension, view } = await findView(viewId);
    if (view.tools.length > 0 && (!toolName || !view.tools.includes(toolName))) {
      throw new InteractiveUIRuntimeError(`Tool ${toolName || '(missing)'} is not bound to view ${viewId}`, 403, 'tool_view_mismatch');
    }
    logger.info?.('[InteractiveUI] Agent routing outcome', {
      extensionId: extension.id,
      viewId: view.id,
      tool: toolName || null,
      domain: extension.agentRouting?.domain ?? null,
      dataAuthority: extension.agentRouting?.dataAuthority ?? null,
      operation: view.routing?.operation ?? null,
    });
    const base = {
      extension: { id: extension.id, name: extension.name, version: extension.version },
      view: { id: view.id, runtime: view.runtime, displayModes: view.displayModes },
    };
    if (view.runtime === 'declarative') {
      const entryPath = resolveEntryPath(path, extension.directory, view.entry, ['.json']);
      const definition = parseJson(await readLimitedText(fsPromises, entryPath, MAX_VIEW_BYTES), `Declarative view ${view.id}`);
      if (!isRecord(definition) || definition.$schema !== 'openchamber://declarative-view/v1' || definition.id !== view.id || !isRecord(definition.layout)) {
        throw new InteractiveUIRuntimeError(`Declarative view ${view.id} does not match its manifest`, 400, 'invalid_view');
      }
      return { ...base, declarative: definition };
    }
    const bundlePath = resolveEntryPath(path, extension.directory, view.entry, ['.mjs', '.js']);
    const source = await readLimitedText(fsPromises, bundlePath, MAX_NATIVE_BUNDLE_BYTES);
    const integrity = `sha256-${crypto.createHash('sha256').update(source).digest('base64')}`;
    return {
      ...base,
      native: {
        assetPath: `/api/interactive-ui/extensions/${encodeURIComponent(extension.id)}/native/${encodeURIComponent(view.id)}`,
        exportName: view.exportName,
        integrity,
      },
    };
  };

  const getNativeBundle = async (extensionId, viewId) => {
    const { extension, view } = await findView(viewId);
    if (extension.id !== extensionId || view.runtime !== 'native') {
      throw new InteractiveUIRuntimeError('Native extension asset was not found', 404, 'asset_not_found');
    }
    const entryPath = resolveEntryPath(path, extension.directory, view.entry, ['.mjs', '.js']);
    const source = await readLimitedText(fsPromises, entryPath, MAX_NATIVE_BUNDLE_BYTES);
    return {
      source,
      integrity: `sha256-${crypto.createHash('sha256').update(source).digest('base64')}`,
    };
  };

  const getInstalledArtifactDescriptor = async (artifactId, toolName = '') => {
    const { extension, artifact } = await findInstalledArtifact(artifactId);
    if (artifact.tools.length > 0 && (!toolName || !artifact.tools.includes(toolName))) {
      throw new InteractiveUIRuntimeError(`Tool ${toolName || '(missing)'} is not bound to HTML Artifact ${artifactId}`, 403, 'tool_artifact_mismatch');
    }
    const entryPath = resolveEntryPath(path, extension.directory, artifact.entry, ['.html']);
    const source = await readLimitedText(fsPromises, entryPath, MAX_INSTALLED_ARTIFACT_BYTES);
    createInstalledHTMLArtifactDocument(source);
    logger.info?.('[InteractiveUI] Agent routing outcome', {
      extensionId: extension.id,
      artifactId: artifact.id,
      tool: toolName || null,
      domain: extension.agentRouting?.domain ?? null,
      dataAuthority: extension.agentRouting?.dataAuthority ?? null,
      operation: artifact.routing?.operation ?? null,
    });
    return {
      extension: { id: extension.id, name: extension.name, version: extension.version },
      artifact: {
        id: artifact.id,
        title: artifact.title,
        scripts: true,
        displayModes: artifact.displayModes,
        inlineHeight: artifact.inlineHeight,
        business: artifact.businessActions.length > 0,
      },
      documentPath: `/api/interactive-ui/extensions/${encodeURIComponent(extension.id)}/artifacts/${encodeURIComponent(artifact.id)}`,
      integrity: `sha256-${crypto.createHash('sha256').update(source).digest('base64')}`,
    };
  };

  const getInstalledArtifactDocument = async (extensionId, artifactId) => {
    const { extension, artifact } = await findInstalledArtifact(artifactId);
    if (extension.id !== extensionId) {
      throw new InteractiveUIRuntimeError('Installed HTML Artifact asset was not found', 404, 'asset_not_found');
    }
    const entryPath = resolveEntryPath(path, extension.directory, artifact.entry, ['.html']);
    const source = await readLimitedText(fsPromises, entryPath, MAX_INSTALLED_ARTIFACT_BYTES);
    const document = createInstalledHTMLArtifactDocument(source);
    return {
      source: document,
      integrity: `sha256-${crypto.createHash('sha256').update(source).digest('base64')}`,
    };
  };

  const invokeAction = async (actionId, request) => {
    if (!isRecord(request) || typeof request.extensionId !== 'string') {
      throw new InteractiveUIRuntimeError('Action context is incomplete', 400, 'invalid_request');
    }
    const usesView = typeof request.viewId === 'string' && request.viewId.length > 0;
    const usesArtifact = typeof request.artifactId === 'string' && request.artifactId.length > 0;
    if (usesView === usesArtifact) {
      throw new InteractiveUIRuntimeError('Action must identify exactly one Interactive UI view or HTML Artifact', 400, 'invalid_request');
    }
    const resolved = usesView ? await findView(request.viewId) : await findInstalledArtifact(request.artifactId);
    const extension = resolved.extension;
    if (extension.id !== request.extensionId) {
      throw new InteractiveUIRuntimeError(
        'Action extension does not own this surface',
        403,
        usesView ? 'extension_view_mismatch' : 'extension_artifact_mismatch',
      );
    }
    const surface = usesView ? resolved.view : resolved.artifact;
    const toolName = isRecord(request.tool) && typeof request.tool.name === 'string' ? request.tool.name : '';
    if (surface.tools.length > 0 && (!toolName || !surface.tools.includes(toolName))) {
      throw new InteractiveUIRuntimeError(
        `Tool ${toolName || '(missing)'} is not bound to ${usesView ? 'view' : 'HTML Artifact'} ${surface.id}`,
        403,
        usesView ? 'tool_view_mismatch' : 'tool_artifact_mismatch',
      );
    }
    const action = extension.actions.find((candidate) => candidate.id === actionId);
    if (!action) throw new InteractiveUIRuntimeError(`Action ${actionId} is not declared by ${extension.id}`, 403, 'action_not_allowed');
    if (usesArtifact && !resolved.artifact.businessActions.includes(actionId)) {
      throw new InteractiveUIRuntimeError(`Action ${actionId} is not allowed for HTML Artifact ${resolved.artifact.id}`, 403, 'artifact_action_not_allowed');
    }
    if (action.permission === 'deny') throw new InteractiveUIRuntimeError(`Action ${actionId} is disabled by policy`, 403, 'action_denied');
    if (action.permission === 'ask') {
      const confirmation = action.confirmation ?? {};
      const fingerprint = confirmationFingerprint({
        extensionId: extension.id,
        surfaceId: surface.id,
        surfaceType: usesView ? 'view' : 'artifact',
        actionId,
        instanceId: request.instanceId,
        tool: request.tool,
        input: request.input,
      });
      if (!consumeConfirmation(request.confirmationToken, fingerprint)) {
        const challenge = issueConfirmation(fingerprint, confirmation);
        throw new InteractiveUIRuntimeError(`Action ${actionId} requires confirmation`, 409, 'confirmation_required', {
          confirmationRequired: true,
          confirmation,
          confirmationToken: challenge.token,
          confirmationExpiresAt: challenge.expiresAt,
        });
      }
    }
    const connector = extension.connectors.find((candidate) => candidate.id === action.connector);
    if (!connector) throw new InteractiveUIRuntimeError('Action connector is unavailable', 503, 'connector_unavailable');
    const target = new URL(action.request.path.slice(1), connector.baseUrl.endsWith('/') ? connector.baseUrl : `${connector.baseUrl}/`);
    if (target.origin !== connector.origin) throw new InteractiveUIRuntimeError('Action target escaped the connector origin', 403, 'network_not_allowed');

    const requestId = crypto.randomUUID();
    const headers = new Headers({ Accept: 'application/json', 'X-OpenChamber-Request-Id': requestId });
    await applyConnectorAuthentication(extension.id, connector, headers);
    const init = {
      method: action.request.method,
      headers,
      signal: AbortSignal.timeout(ACTION_TIMEOUT_MS),
    };
    if (action.request.method === 'GET') {
      if (isRecord(request.input)) {
        for (const [key, value] of Object.entries(request.input)) {
          if (value === undefined || value === null) continue;
          if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
            throw new InteractiveUIRuntimeError('GET action inputs must be scalar values', 400, 'invalid_action_input');
          }
          target.searchParams.set(key, String(value));
        }
      }
    } else {
      headers.set('Content-Type', 'application/json');
      init.body = JSON.stringify(request.input ?? {});
    }

    let response;
    try {
      response = await fetchImpl(target, init);
    } catch (error) {
      const message = error?.name === 'TimeoutError' ? 'Business system request timed out' : 'Business system request failed';
      setConnectionHealth(extension.id, connector.id, 'unreachable', 'upstream_unavailable');
      throw new InteractiveUIRuntimeError(message, 502, 'upstream_unavailable');
    }
    const body = await response.arrayBuffer();
    if (body.byteLength > MAX_UPSTREAM_BYTES) throw new InteractiveUIRuntimeError('Business system response is too large', 502, 'upstream_response_too_large');
    const text = new TextDecoder().decode(body);
    let data = null;
    if (text.trim()) {
      try {
        data = JSON.parse(text);
      } catch {
        throw new InteractiveUIRuntimeError('Business system returned invalid JSON', 502, 'invalid_upstream_response');
      }
    }
    if (!response.ok) {
      if (response.status === 401) {
        setConnectionHealth(extension.id, connector.id, 'unauthorized', 'connector_unauthorized');
        throw new InteractiveUIRuntimeError('Access key is invalid or expired', 401, 'connector_unauthorized');
      }
      if (response.status === 403) {
        setConnectionHealth(extension.id, connector.id, 'forbidden', 'connector_forbidden');
        throw new InteractiveUIRuntimeError('Access key does not have permission', 403, 'connector_forbidden');
      }
      setConnectionHealth(extension.id, connector.id, 'reachable', 'upstream_error');
      throw new InteractiveUIRuntimeError(
        `Business system rejected the request (${response.status})`,
        response.status >= 400 && response.status < 500 ? response.status : 502,
        'upstream_error',
      );
    }
    logger.info?.('[InteractiveUI] Business action completed', {
      requestId,
      extensionId: extension.id,
      ...(usesView ? { viewId: resolved.view.id } : { artifactId: resolved.artifact.id }),
      action: action.id,
      risk: action.risk,
    });
    setConnectionHealth(extension.id, connector.id, 'reachable');
    return { data, requestId };
  };

  const listExtensions = async () => {
    const { extensions, errors } = await loadExtensions();
    return {
      apiVersion: 1,
      extensions: extensions.map((extension) => ({
        id: extension.id,
        name: extension.name,
        version: extension.version,
        agentRouting: extension.agentRouting
          ? {
              domain: extension.agentRouting.domain,
              intents: extension.agentRouting.intents,
              dataAuthority: extension.agentRouting.dataAuthority,
            }
          : null,
        views: extension.views.map((view) => ({
          id: view.id,
          runtime: view.runtime,
          tools: view.tools,
          displayModes: view.displayModes,
          routing: view.routing,
        })),
        artifacts: extension.artifacts.map((artifact) => ({
          id: artifact.id,
          tools: artifact.tools,
          displayModes: artifact.displayModes,
          routing: artifact.routing,
          scripts: true,
          business: artifact.businessActions.length > 0,
        })),
        actions: extension.actions.map((action) => ({ id: action.id, risk: action.risk, permission: action.permission })),
      })),
      errors,
    };
  };

  const getRoutingCapabilities = async () => {
    const { extensions, errors } = await loadExtensions();
    const statuses = new Map();
    await Promise.all(extensions.map(async (extension) => {
      statuses.set(extension.id, await Promise.all(
        extension.connectors.map((connector) => getConnectionStatus(extension.id, connector)),
      ));
    }));
    const catalog = buildInteractiveUICapabilityCatalog(extensions, statuses);
    const serialized = JSON.stringify(catalog);
    return {
      apiVersion: 1,
      revision: `sha256-${crypto.createHash('sha256').update(serialized).digest('base64')}`,
      extensions: catalog,
      system: renderInteractiveUIRoutingSystemPrompt(catalog),
      skippedExtensions: errors.length,
    };
  };

  return {
    listExtensions,
    getRoutingCapabilities,
    listConnections,
    configureConnection,
    provisionConnection,
    removeConnection,
    removeExtensionConnections,
    testConnection,
    getViewDescriptor,
    getNativeBundle,
    getInstalledArtifactDescriptor,
    getInstalledArtifactDocument,
    invokeAction,
  };
};
