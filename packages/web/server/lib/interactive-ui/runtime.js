const MANIFEST_FILE = 'openchamber.extension.json';
const MAX_MANIFEST_BYTES = 512 * 1024;
const MAX_VIEW_BYTES = 512 * 1024;
const MAX_NATIVE_BUNDLE_BYTES = 2 * 1024 * 1024;
const MAX_UPSTREAM_BYTES = 2 * 1024 * 1024;
const ACTION_TIMEOUT_MS = 15_000;
const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const ACTION_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const ENV_REFERENCE_PATTERN = /^\$\{([A-Z][A-Z0-9_]*)\}$/;

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
  if (auth.type !== 'none' && auth.type !== 'env-bearer') {
    throw new InteractiveUIRuntimeError(`Connector ${connector.id} uses an unsupported auth type`, 400, 'invalid_manifest');
  }
  if (auth.type === 'env-bearer' && (typeof auth.env !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(auth.env))) {
    throw new InteractiveUIRuntimeError(`Connector ${connector.id} must declare a valid bearer-token environment variable`, 400, 'invalid_manifest');
  }
  return {
    id: connector.id,
    type: 'http',
    baseUrl: baseUrl.toString(),
    origin: baseUrl.origin,
    auth: auth.type === 'env-bearer' ? { type: 'env-bearer', env: auth.env } : { type: 'none' },
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

const normalizeView = (view, extensionId) => {
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
    displayModes: Array.isArray(view.displayModes)
      ? view.displayModes.filter((mode) => ['inline', 'workspace', 'fullscreen'].includes(mode))
      : ['inline'],
  };
};

const normalizeManifest = (raw, directory, environment) => {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !EXTENSION_ID_PATTERN.test(raw.id)) {
    throw new InteractiveUIRuntimeError('Extension manifest has an invalid namespaced id', 400, 'invalid_manifest');
  }
  if (typeof raw.name !== 'string' || !raw.name.trim() || typeof raw.version !== 'string' || !raw.version.trim()) {
    throw new InteractiveUIRuntimeError(`Extension ${raw.id} must declare name and version`, 400, 'invalid_manifest');
  }
  const views = Array.isArray(raw.views) ? raw.views.map((view) => normalizeView(view, raw.id)) : [];
  if (views.length === 0) throw new InteractiveUIRuntimeError(`Extension ${raw.id} does not declare any views`, 400, 'invalid_manifest');
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

  return {
    id: raw.id,
    name: raw.name.trim(),
    version: raw.version.trim(),
    directory,
    views,
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
  logger = console,
} = {}) => {
  if (!fsPromises || !path || !crypto || typeof fetchImpl !== 'function') {
    throw new Error('Interactive UI runtime dependencies are incomplete');
  }

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
    const views = new Set();
    for (const extension of extensions) {
      if (ids.has(extension.id)) throw new InteractiveUIRuntimeError(`Duplicate extension ID ${extension.id}`, 409, 'duplicate_extension');
      ids.add(extension.id);
      for (const view of extension.views) {
        if (views.has(view.id)) throw new InteractiveUIRuntimeError(`Duplicate view ID ${view.id}`, 409, 'duplicate_view');
        views.add(view.id);
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

  const getViewDescriptor = async (viewId, toolName = '') => {
    const { extension, view } = await findView(viewId);
    if (view.tools.length > 0 && (!toolName || !view.tools.includes(toolName))) {
      throw new InteractiveUIRuntimeError(`Tool ${toolName || '(missing)'} is not bound to view ${viewId}`, 403, 'tool_view_mismatch');
    }
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

  const invokeAction = async (actionId, request) => {
    if (!isRecord(request) || typeof request.extensionId !== 'string' || typeof request.viewId !== 'string') {
      throw new InteractiveUIRuntimeError('Action context is incomplete', 400, 'invalid_request');
    }
    const { extension, view } = await findView(request.viewId);
    if (extension.id !== request.extensionId) throw new InteractiveUIRuntimeError('Action extension does not own this view', 403, 'extension_view_mismatch');
    const action = extension.actions.find((candidate) => candidate.id === actionId);
    if (!action) throw new InteractiveUIRuntimeError(`Action ${actionId} is not declared by ${extension.id}`, 403, 'action_not_allowed');
    if (action.permission === 'deny') throw new InteractiveUIRuntimeError(`Action ${actionId} is disabled by policy`, 403, 'action_denied');
    if (action.permission === 'ask' && request.confirmed !== true) {
      throw new InteractiveUIRuntimeError(`Action ${actionId} requires confirmation`, 409, 'confirmation_required', {
        confirmationRequired: true,
        confirmation: action.confirmation ?? {},
      });
    }
    const connector = extension.connectors.find((candidate) => candidate.id === action.connector);
    if (!connector) throw new InteractiveUIRuntimeError('Action connector is unavailable', 503, 'connector_unavailable');
    const target = new URL(action.request.path.slice(1), connector.baseUrl.endsWith('/') ? connector.baseUrl : `${connector.baseUrl}/`);
    if (target.origin !== connector.origin) throw new InteractiveUIRuntimeError('Action target escaped the connector origin', 403, 'network_not_allowed');

    const requestId = crypto.randomUUID();
    const headers = new Headers({ Accept: 'application/json', 'X-OpenChamber-Request-Id': requestId });
    if (connector.auth.type === 'env-bearer') {
      const token = environment[connector.auth.env];
      if (typeof token !== 'string' || !token.trim()) {
        throw new InteractiveUIRuntimeError('Connector credentials are not configured', 503, 'connector_unconfigured');
      }
      headers.set('Authorization', `Bearer ${token.trim()}`);
    }
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
      const upstreamMessage = isRecord(data) && typeof data.error === 'string' ? data.error : `Business system rejected the request (${response.status})`;
      throw new InteractiveUIRuntimeError(upstreamMessage, response.status >= 400 && response.status < 500 ? response.status : 502, 'upstream_error');
    }
    logger.info?.('[InteractiveUI] Business action completed', {
      requestId,
      extensionId: extension.id,
      viewId: view.id,
      action: action.id,
      risk: action.risk,
    });
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
        views: extension.views.map((view) => ({
          id: view.id,
          runtime: view.runtime,
          tools: view.tools,
          displayModes: view.displayModes,
        })),
        actions: extension.actions.map((action) => ({ id: action.id, risk: action.risk, permission: action.permission })),
      })),
      errors,
    };
  };

  return { listExtensions, getViewDescriptor, getNativeBundle, invokeAction };
};
