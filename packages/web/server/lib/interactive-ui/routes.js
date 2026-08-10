import { InteractiveUIConnectionError, validateRemoteAccessKey } from './connection-store.js';
import { isWorkbenchVersionCompatible } from './workbench-version.js';
import { InteractiveUIExtensionManagerError } from './manager.js';
import { InteractiveUIRuntimeError } from './runtime.js';
import { HTMLArtifactError } from './artifact-store.js';
import { InteractiveUIWorkbenchStoreError } from './workbench-store.js';

class InteractiveUIRouteError extends Error {
  constructor(message, status = 400, code = 'invalid_request', details = undefined) {
    super(message);
    this.name = 'InteractiveUIRouteError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const WORKBENCH_SNAPSHOT_REF_PATTERN = /^snapshot_[a-f0-9]{64}$/;
const SAFE_REMOTE_CREDENTIAL_STATUS_RANGE = { min: 400, max: 599 };

// The connection store's summary is deliberately small. Keep this route
// boundary strict as well because a runtime adapter may return a richer
// object (or accidentally include credential material) than the store does.
const sanitizeCredentialSummary = (value) => {
  const nestedCredential = ownDataValue(value, 'credential');
  const source = isSerializableErrorRecord(nestedCredential) ? nestedCredential : value;
  if (!isSerializableErrorRecord(source)) return {};
  const summary = {};
  const configured = ownDataValue(source, 'configured');
  const expired = ownDataValue(source, 'expired');
  const credentialSource = ownDataValue(source, 'source');
  if (typeof configured === 'boolean') summary.configured = configured;
  if (typeof expired === 'boolean') summary.expired = expired;
  if (credentialSource === 'manual' || credentialSource === 'provisioned') summary.source = credentialSource;
  for (const field of ['configuredAt', 'expiresAt']) {
    const candidate = ownDataValue(source, field);
    if (typeof candidate === 'string' && candidate.length <= 128 && !/[\r\n\0]/.test(candidate)) {
      summary[field] = candidate;
    }
  }
  for (const field of ['displayName', 'name']) {
    const candidate = ownDataValue(source, field);
    if (typeof candidate === 'string' && candidate.length <= 200 && !/[\r\n\0]/.test(candidate)) {
      summary[field] = candidate;
    }
  }
  const endpoint = ownDataValue(source, 'endpoint');
  if (typeof endpoint === 'string' && endpoint.length <= 4096 && !/[\r\n\0]/.test(endpoint)) {
    try {
      const parsed = new URL(endpoint);
      if (['http:', 'https:'].includes(parsed.protocol)
        && !parsed.username
        && !parsed.password
        && !parsed.search
        && !parsed.hash) {
        summary.endpoint = parsed.toString();
      }
    } catch {
      // An adapter endpoint is optional public metadata, never an authority.
    }
  }
  const headerNames = sanitizeErrorList(ownDataValue(source, 'headerNames'));
  if (headerNames && headerNames.length <= 32
    && headerNames.every((name) => /^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name))) {
    summary.headerNames = headerNames;
  }
  return summary;
};

const safeRemoteCredentialErrorStatus = (value) => (
  Number.isInteger(value)
    && value >= SAFE_REMOTE_CREDENTIAL_STATUS_RANGE.min
    && value <= SAFE_REMOTE_CREDENTIAL_STATUS_RANGE.max
    ? value
    : 502
);

const safeRemoteCredentialError = (error, recovery) => new InteractiveUIRouteError(
  'Remote credential configuration failed',
  safeRemoteCredentialErrorStatus(ownDataValue(error, 'status')),
  'remote_credential_configure_failed',
  recovery,
);

// Serializes cross-subsystem Interactive UI connection mutations: the ENTIRE
// Remote connect transaction (Manager install, Secret Store configuration,
// conditional cleanup, Manager/trust rollback), extension uninstall including
// credential/workbench cleanup, generic connection PUT, issued-key provision,
// and generic connection DELETE. Read-only inspect/list/test/action routes do
// not use it. The chain always advances after completion or failure, so a
// failed operation can never poison later ones; responses are sent only after
// the whole operation (including rollback) has finished.
//
// Coordinators are scoped per manager instance (WeakMap keyed by the manager
// object): two route registrations sharing the same manager serialize, but
// unrelated manager/runtime/data-directory instances never block one another.
const createMutationCoordinator = () => {
  let tail = Promise.resolve();
  const runExclusive = (operation) => {
    const pending = tail.then(operation, operation);
    tail = pending.then(() => undefined, () => undefined);
    return pending;
  };
  return { runExclusive };
};
const coordinatorByManager = new WeakMap();
const coordinatorFor = (manager) => {
  let coordinator = coordinatorByManager.get(manager);
  if (!coordinator) {
    coordinator = createMutationCoordinator();
    coordinatorByManager.set(manager, coordinator);
  }
  return coordinator;
};

const SAFE_ERROR_CODE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const SAFE_ERROR_STRING_LIMIT = 4 * 1024;
// Error details cross an untyped HTTP boundary.  Only fields that are part of
// an existing Interactive UI response contract may escape; arbitrary adapter
// details frequently contain paths, credentials, or installation identities.
// Keep this list deliberately small and map an inner `code` to `reason` so it
// can never shadow the canonical outer error code.
const SAFE_ERROR_DETAIL_KEYS = new Set([
  'extension',
  'publisher',
  'permissions',
  'manifest',
  'connector',
  'update',
  'blocked',
  'currentVersion',
  'currentManifestHash',
  'version',
  'manifestHash',
  'changeSummary',
  'permissionDelta',
  'addedPermissions',
  'keyChanged',
  'requiresUserConfirmation',
  'staticAvailable',
  'rematerializable',
  'expectedRevision',
  'actualRevision',
  'expectedForm',
  'field',
  'extensionRemoved',
  'credentialRemoved',
  'credentialMismatch',
  'credentialRollbackBlocked',
  'rollbackSkipped',
  'trustRolledBack',
  'credentialRollbackError',
  'rollbackError',
  'causeCode',
  'reason',
  'confirmationRequired',
  'confirmation',
  'confirmationToken',
  'confirmationExpiresAt',
  'workbench',
]);

const isSafeErrorCode = (value) => typeof value === 'string'
  && value.length <= SAFE_ERROR_STRING_LIMIT
  && SAFE_ERROR_CODE_PATTERN.test(value);

const safeErrorString = (value, max = SAFE_ERROR_STRING_LIMIT) => (
  typeof value === 'string'
    && value.length <= max
    && !/[\r\n\0]/.test(value)
    ? value
    : undefined
);

const safeErrorScalar = (value) => {
  if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  return safeErrorString(value);
};

const isSerializableErrorRecord = (value) => {
  try {
    return isRecord(value);
  } catch {
    return false;
  }
};

// Never invoke getters or accept inherited values while serializing an error.
// Adapter errors are an untyped boundary; even reading a property can execute
// attacker-controlled code when a Proxy or accessor is supplied.
const ownDataProperty = (value, key) => {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    return descriptor && Object.prototype.hasOwnProperty.call(descriptor, 'value')
      ? descriptor.value
      : undefined;
  } catch {
    return undefined;
  }
};

const ownDataValue = (value, key) => (
  isSerializableErrorRecord(value) ? ownDataProperty(value, key) : undefined
);

const sanitizeErrorList = (value) => {
  try {
    if (!Array.isArray(value)) return undefined;
    const length = ownDataProperty(value, 'length');
    if (!Number.isSafeInteger(length) || length < 0 || length > 128) return undefined;
    const list = [];
    for (let index = 0; index < length; index += 1) {
      const entry = safeErrorString(ownDataProperty(value, String(index)), 512);
      if (entry === undefined) return undefined;
      list.push(entry);
    }
    return list;
  } catch {
    return undefined;
  }
};

const SAFE_PERMISSION_SCOPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SAFE_PERMISSION_ACTION_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const SAFE_PERMISSION_TOOL_PATTERN = /^[a-z][a-z0-9_]{0,127}$/;

const sanitizeErrorOriginList = (value) => {
  const list = sanitizeErrorList(value);
  if (list === undefined) return undefined;
  const origins = [];
  for (const entry of list) {
    try {
      const parsed = new URL(entry);
      const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
      if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
        || parsed.username
        || parsed.password
        || parsed.hash
        || parsed.search
        || parsed.pathname !== '/') return undefined;
      origins.push(parsed.origin);
    } catch {
      return undefined;
    }
  }
  return origins;
};

const sanitizeErrorPermissionList = (value, field) => {
  if (['resourceOrigins', 'networkOrigins', 'externalLinkOrigins'].includes(field)) {
    return sanitizeErrorOriginList(value);
  }
  const list = sanitizeErrorList(value);
  if (list === undefined) return undefined;
  const pattern = field === 'credentialScopes'
    ? SAFE_PERMISSION_SCOPE_PATTERN
    : field === 'actionIds'
      ? SAFE_PERMISSION_ACTION_PATTERN
      : SAFE_PERMISSION_TOOL_PATTERN;
  return list.every((entry) => pattern.test(entry)) ? list : undefined;
};

const sanitizeErrorPermissions = (value) => {
  if (!isSerializableErrorRecord(value)) return undefined;
  const result = {};
  for (const field of [
    'resourceOrigins',
    'networkOrigins',
    'externalLinkOrigins',
    'credentialScopes',
    'actionIds',
    'agentToolNames',
  ]) {
    const list = sanitizeErrorPermissionList(ownDataValue(value, field), field);
    if (list !== undefined) result[field] = list;
  }
  for (const field of ['clipboard', 'popups', 'nativeCode']) {
    const candidate = ownDataValue(value, field);
    if (typeof candidate === 'boolean') result[field] = candidate;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const sanitizeErrorRecord = (value, allowedKeys, sanitizer = safeErrorScalar) => {
  if (!isSerializableErrorRecord(value)) return undefined;
  const result = {};
  for (const key of allowedKeys) {
    const candidate = ownDataValue(value, key);
    if (candidate === undefined) continue;
    const sanitized = sanitizer(candidate, key);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return Object.keys(result).length > 0 ? result : undefined;
};

const sanitizeErrorDetail = (value, key) => {
  if (['expectedRevision', 'actualRevision'].includes(key)) {
    return Number.isInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER ? value : undefined;
  }
  if (key === 'addedPermissions') {
    if (!isSerializableErrorRecord(value)) return undefined;
    const result = {};
    for (const field of ['networkOrigins', 'externalLinkOrigins', 'credentialScopes', 'actionIds', 'agentToolNames']) {
      const list = sanitizeErrorPermissionList(ownDataValue(value, field), field);
      if (list !== undefined) result[field] = list;
    }
    for (const field of ['clipboard', 'popups', 'nativeCode']) {
      const candidate = ownDataValue(value, field);
      if (typeof candidate === 'boolean') result[field] = candidate;
    }
    return Object.keys(result).length > 0 ? result : undefined;
  }
  if (key === 'permissions') return sanitizeErrorPermissions(value);
  if (key === 'extension') return sanitizeErrorRecord(
    value,
    ['id', 'name', 'version'],
    (candidate) => safeErrorString(candidate, 512),
  );
  if (key === 'publisher') return sanitizeErrorRecord(
    value,
    ['id', 'name', 'keyId', 'fingerprint', 'trusted'],
    (candidate, field) => field === 'trusted'
      ? (typeof candidate === 'boolean' ? candidate : undefined)
      : safeErrorString(candidate, 512),
  );
  if (key === 'manifest') return sanitizeErrorRecord(
    value,
    ['appEntryUrl', 'manifestHash', 'publishedAt', 'version'],
    (candidate) => safeErrorString(candidate, 4_096),
  );
  if (key === 'connector') return sanitizeErrorRecord(
    value,
    ['id', 'origin', 'authType'],
    (candidate) => safeErrorString(candidate, 4_096),
  );
  if (key === 'update') return sanitizeErrorRecord(value, [
    'version',
    'manifestHash',
    'changeSummary',
    'permissionDelta',
    'addedPermissions',
    'keyChanged',
  ], sanitizeErrorDetail);
  if (key === 'blocked') {
    if (typeof value === 'boolean') return value;
    return sanitizeErrorRecord(value, ['required', 'version', 'manifestHash', 'reason', 'observedAt'], (candidate, field) => {
      if (field === 'required') return typeof candidate === 'boolean' ? candidate : undefined;
      if (field === 'reason') return isSafeErrorCode(candidate) ? candidate : undefined;
      return safeErrorScalar(candidate);
    });
  }
  if (key === 'confirmation') return sanitizeErrorRecord(
    value,
    ['title', 'description'],
    (candidate) => safeErrorString(candidate, 2_000),
  );
  if (key === 'workbench') return sanitizeErrorRecord(
    value,
    ['removed', 'projects'],
    (candidate) => Number.isSafeInteger(candidate) && candidate >= 0 ? candidate : undefined,
  );
  if (['reason', 'causeCode', 'credentialRollbackError', 'rollbackError'].includes(key)) {
    return isSafeErrorCode(value) ? value : undefined;
  }
  if (key === 'confirmationToken') return safeErrorString(value, 512);
  if (key === 'confirmationExpiresAt') return Number.isFinite(value) ? value : undefined;
  if (key === 'currentVersion' || key === 'version' || key === 'currentManifestHash' || key === 'manifestHash') {
    return safeErrorString(value, 512);
  }
  if (key === 'changeSummary') return safeErrorString(value, 2_000);
  if (key === 'permissionDelta') return ['none', 'expanded', 'reduced', 'changed'].includes(value) ? value : undefined;
  if (key === 'field' || key === 'expectedForm') return safeErrorString(value, 256);
  if ([
    'keyChanged',
    'requiresUserConfirmation',
    'staticAvailable',
    'rematerializable',
    'extensionRemoved',
    'credentialRemoved',
    'credentialMismatch',
    'credentialRollbackBlocked',
    'rollbackSkipped',
    'trustRolledBack',
    'confirmationRequired',
  ].includes(key)) return typeof value === 'boolean' ? value : undefined;
  return undefined;
};

const serializeErrorDetails = (details) => {
  if (!isSerializableErrorRecord(details)) return {};
  const result = {};
  const nestedCode = ownDataValue(details, 'code');
  if (isSafeErrorCode(nestedCode)) result.reason = nestedCode;
  for (const key of SAFE_ERROR_DETAIL_KEYS) {
    const value = ownDataValue(details, key);
    if (value === undefined) continue;
    const sanitized = sanitizeErrorDetail(value, key);
    if (sanitized !== undefined) result[key] = sanitized;
  }
  return result;
};

const TRUSTED_ERROR_TYPES = [
  InteractiveUIRouteError,
  InteractiveUIConnectionError,
  InteractiveUIExtensionManagerError,
  InteractiveUIRuntimeError,
  HTMLArtifactError,
  InteractiveUIWorkbenchStoreError,
];

const isTrustedInteractiveUIError = (error) => {
  try {
    return TRUSTED_ERROR_TYPES.some((ErrorType) => error instanceof ErrorType);
  } catch {
    return false;
  }
};

const sendError = (res, error, additionalDetails = undefined) => {
  const recovery = serializeErrorDetails(additionalDetails);
  if (isTrustedInteractiveUIError(error)) {
    const rawStatus = ownDataValue(error, 'status');
    const rawMessage = ownDataValue(error, 'message');
    const rawCode = ownDataValue(error, 'code');
    const rawDetails = ownDataValue(error, 'details');
    const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599
      ? rawStatus
      : 500;
    const message = safeErrorString(rawMessage) ?? 'Interactive UI request failed';
    const code = isSafeErrorCode(rawCode) ? rawCode : 'internal_error';
    return res.status(status).json({
      error: message,
      code,
      ...serializeErrorDetails(rawDetails),
      ...recovery,
    });
  }
  return res.status(500).json({
    error: 'Interactive UI request failed',
    code: 'internal_error',
    ...recovery,
  });
};

const decodePackage = (value) => {
  if (typeof value !== 'string' || value.length === 0 || value.length > 28 * 1024 * 1024 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new InteractiveUIRouteError('Extension package must be valid base64', 400, 'invalid_package_encoding');
  }
  return Buffer.from(value, 'base64');
};

const staticArtifactContentSecurityPolicy = () => [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  'img-src data: blob:',
  'font-src data:',
  "connect-src 'none'",
  "worker-src 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "media-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self' openchamber-ui://app",
].join('; ');

const brokerContentSecurityPolicy = () => [
  "default-src 'none'",
  "script-src 'unsafe-inline'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "font-src 'none'",
  "connect-src 'none'",
  "worker-src 'none'",
  'frame-src data:',
  "object-src 'none'",
  "media-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  'sandbox allow-scripts',
  "frame-ancestors 'self' openchamber-ui://app",
].join('; ');

const createArtifactBrokerDocument = (artifactDocument) => {
  const dataUrl = `data:text/html;base64,${Buffer.from(artifactDocument, 'utf8').toString('base64')}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}iframe{display:block;width:100%;height:100%;border:0;background:transparent}</style></head><body data-ocix-artifact-broker><script>(()=>{"use strict";const frame=document.createElement("iframe"),pending=[];let channel="",loaded=false,loadCount=0,navigationBlocked=false;const size=value=>{try{return new TextEncoder().encode(JSON.stringify(value)).byteLength}catch{return Infinity}};const record=value=>value&&typeof value==="object"&&!Array.isArray(value);const keys=value=>Object.keys(value).every(key=>["source","direction","bridgeVersion","channelId","sequence","type","payload"].includes(key));const validChannel=value=>typeof value==="string"&&value.length>=16&&value.length<=128;const hostMessage=value=>record(value)&&size(value)<=2200000&&keys(value)&&value.source==="openchamber-host"&&value.direction==="host-to-artifact"&&value.bridgeVersion===1&&["host.init","host.businessResult"].includes(value.type)&&validChannel(value.channelId);const artifactMessage=value=>record(value)&&size(value)<=65536&&keys(value)&&value.source==="openchamber-artifact"&&value.direction==="artifact-to-host"&&value.bridgeVersion===1&&value.channelId===channel;const reportNavigation=()=>{navigationBlocked=true;if(!channel)return;parent.postMessage({source:"openchamber-artifact-broker",direction:"broker-to-host",bridgeVersion:1,channelId:channel,type:"broker.navigationBlocked",payload:{}},"*")};addEventListener("message",event=>{const value=event.data;if(event.source===parent&&hostMessage(value)){if(value.type==="host.init")channel=value.channelId;else if(!channel||value.channelId!==channel)return;if(navigationBlocked){reportNavigation();return}if(loaded)frame.contentWindow?.postMessage(value,"*");else pending.push(value);return}if(event.source===frame.contentWindow&&artifactMessage(value))parent.postMessage(value,"*")});frame.title="Artifact content";frame.setAttribute("sandbox","allow-scripts");frame.src=${JSON.stringify(dataUrl)};frame.addEventListener("load",()=>{loadCount+=1;if(loadCount>1){frame.remove();reportNavigation();return}loaded=true;for(const message of pending.splice(0))frame.contentWindow?.postMessage(message,"*")});document.body.append(frame)})();</script></body></html>`;
};

const setArtifactDocumentHeaders = (res, scripts) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Content-Security-Policy', scripts ? brokerContentSecurityPolicy() : staticArtifactContentSecurityPolicy());
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'accelerometer=(), autoplay=(), camera=(), clipboard-read=(), clipboard-write=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()');
};

export const registerInteractiveUIRoutes = (app, {
  express,
  runtime,
  manager,
  artifactStore,
  workbenchStore = null,
}) => {
  // The target server installs its scope-aware `/api` gate before feature
  // routes. Do not add a UI-only second gate here: tunnel requests must remain
  // under tunnel auth, while local requests remain under UI auth.

  const authorizeWorkbenchAction = async (request) => {
    if (!isRecord(request)) return request;
    const {
      __workbenchAuthorization: _untrustedAuthorization,
      ...cleanRequest
    } = request;
    if (!isRecord(request.workbench)) return cleanRequest;
    if (!workbenchStore) {
      throw new InteractiveUIRouteError(
        'Extension Workbench is unavailable in this runtime',
        501,
        'workbench_unsupported',
      );
    }
    const projectId = typeof request.workbench.projectId === 'string'
      ? request.workbench.projectId.trim()
      : '';
    const tileId = typeof request.workbench.tileId === 'string'
      ? request.workbench.tileId.trim()
      : '';
    if (!projectId || !tileId) {
      throw new InteractiveUIRouteError(
        'Workbench action context is incomplete',
        400,
        'invalid_workbench_action',
      );
    }
    const snapshot = await workbenchStore.read(projectId);
    const board = snapshot.boards.find((candidate) => candidate.id === snapshot.activeBoardId);
    const tile = board?.tiles.find((candidate) => candidate.tileId === tileId);
    if (!tile) {
      throw new InteractiveUIRouteError(
        'Workbench tile was not found',
        404,
        'workbench_tile_not_found',
      );
    }
    if (tile.source.kind !== 'third-party-extension') {
      throw new InteractiveUIRouteError(
        'Generated Workbench tiles cannot call the Business Gateway',
        403,
        'workbench_business_not_allowed',
      );
    }
    const surfaceId = typeof request.viewId === 'string'
      ? request.viewId
      : typeof request.artifactId === 'string'
        ? request.artifactId
        : '';
    if (request.extensionId !== tile.source.extensionId || surfaceId !== tile.source.surfaceId) {
      throw new InteractiveUIRouteError(
        'Workbench tile does not own this action surface',
        403,
        'workbench_surface_mismatch',
      );
    }
    if ((request.viewId && tile.form !== 'interactive-ui')
      || (request.artifactId && tile.form !== 'html-artifact')) {
      throw new InteractiveUIRouteError(
        'Workbench tile form does not match the requested action',
        403,
        'workbench_form_mismatch',
      );
    }
    const catalog = await runtime.getWorkbenchCatalog();
    const extension = catalog.extensions.find((candidate) => candidate.id === tile.source.extensionId);
    const surface = extension?.surfaces.find((candidate) => candidate.surfaceId === tile.source.surfaceId);
    if (!extension || !surface) {
      throw new InteractiveUIRouteError(
        'Workbench extension or surface is disabled or unavailable',
        409,
        'workbench_surface_unavailable',
      );
    }
    if (!isWorkbenchVersionCompatible(tile.source.compatibleVersion, extension.version)) {
      throw new InteractiveUIRouteError(
        'Workbench tile requires migration before it can call the Business Gateway',
        409,
        'workbench_migration_required',
      );
    }
    try {
      await runtime.prepareWorkbenchTile({
        tileId: tile.tileId,
        source: {
          kind: 'third-party-extension',
          extensionId: tile.source.extensionId,
          surfaceId: tile.source.surfaceId,
        },
        form: tile.form,
        context: tile.context,
        layout: tile.layout,
        displayMode: tile.displayMode,
        relationship: tile.relationship,
        origin: tile.origin,
      });
    } catch (error) {
      throw new InteractiveUIRouteError(
        'Workbench tile is incompatible with the installed surface and requires migration',
        409,
        'workbench_migration_required',
        { causeCode: typeof error?.code === 'string' ? error.code : 'invalid_workbench_context' },
      );
    }
    return {
      ...cleanRequest,
      __workbenchAuthorization: {
        projectId,
        tileId,
        contextDigest: tile.contextDigest,
      },
    };
  };

  app.get('/api/interactive-ui/artifacts/capabilities', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(artifactStore.getCapabilities());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/artifacts/materialize', express.json({ limit: '300kb' }), async (req, res) => {
    try {
      const result = await artifactStore.materialize(req.body, {
        sessionId: req.get('x-openchamber-session-id') || undefined,
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.cacheHit ? 200 : 201).json({
        ...result,
        documentPath: `/api/interactive-ui/artifacts/${result.artifactId}/document`,
        metadataPath: `/api/interactive-ui/artifacts/${result.artifactId}/metadata`,
      });
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/artifacts/:artifactId/document', async (req, res) => {
    try {
      const artifact = await artifactStore.getDocument(req.params.artifactId);
      setArtifactDocumentHeaders(res, artifact.metadata.scripts === true);
      res.send(artifact.metadata.scripts ? createArtifactBrokerDocument(artifact.html) : artifact.html);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/artifacts/:artifactId/metadata', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await artifactStore.getMetadata(req.params.artifactId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/artifacts/cache', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await artifactStore.clear());
    } catch (error) {
      sendError(res, error);
    }
  });

  // Keep only the exact official OpenCode session DELETE request on the generic
  // proxy; nested session resources must never release Artifact references.
  // Cleanup runs only after that authoritative request succeeds, and failure is
  // conservative: stale cache may remain, but another session's Artifact is
  // never deleted on an unconfirmed session mutation.
  app.delete('/api/session/:sessionId', (req, res, next) => {
    res.once('finish', () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      void artifactStore.releaseSession(req.params.sessionId).catch(() => undefined);
    });
    next();
  });

  app.get('/api/interactive-ui/manager', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.list());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/publishers', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      res.status(201).json(await manager.trustPublisher(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/manager/publishers/:publisherId/keys/:keyId', async (req, res) => {
    try {
      res.json(await manager.removeTrustedPublisherKey(req.params.publisherId, req.params.keyId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/packages', express.json({ limit: '28mb' }), async (req, res) => {
    try {
      res.status(201).json(await manager.installPackage(decodePackage(req.body?.packageBase64), {
        source: { type: 'file' },
        confirmedPublisherFingerprint: req.body?.confirmedPublisherFingerprint,
        confirmedHostedManifestHash: req.body?.confirmedHostedManifestHash,
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/packages/inspect', express.json({ limit: '28mb' }), async (req, res) => {
    try {
      res.json(await manager.inspectPackage(decodePackage(req.body?.packageBase64)));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/remote/inspect', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.inspectRemote(req.body?.appEntryUrl));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/remote/connect', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      if (!isRecord(req.body)) {
        throw new InteractiveUIRouteError('Remote connect body is invalid', 400, 'remote_connect_body_invalid');
      }
      // Validate the opaque Access Key with the shared Remote validator BEFORE
      // entering manager.connectRemote — before any trust, staging, Manager
      // state, Agent Runtime, or Secret Store write. The validator preserves
      // the exact string byte-for-byte (leading/trailing spaces are valid
      // credential material and are never trimmed); this exact value is the
      // only one captured by the coordinated transaction and forwarded to
      // runtime.configureRemoteConnection.
      const accessKey = validateRemoteAccessKey(req.body.accessKey);
      // The whole transaction (Manager install + Secret Store configuration +
      // conditional cleanup + Manager/trust rollback) runs under the mutation
      // coordinator so no other connection mutation can interleave.
      const outcome = await coordinatorFor(manager).runExclusive(async () => {
        const connected = await manager.connectRemote({
          appEntryUrl: req.body.appEntryUrl,
          confirmedPublisherFingerprint: req.body.confirmedPublisherFingerprint,
          confirmedManifestHash: req.body.confirmedManifestHash,
        }, runtime);
        // The route uses ONLY the opaque manager-owned capability bound to
        // this exact installation AND this exact runtime (configure/remove/
        // rollback operations with zero redirection); raw installationId/
        // trustAdded are never destructured, passed, or serialized.
        try {
          const credential = await connected.capability.configureCredential(accessKey);
          return {
            status: 201,
            body: {
              extension: connected.extension,
              connector: connected.connector,
              credential: sanitizeCredentialSummary(credential),
            },
          };
        } catch (error) {
          // Failure-atomic for the newly connected extension, bound to THIS
          // connect's installation identity: conditionally remove only that
          // installation's credential, then uninstall the new shell, and drop
          // the publisher trust only when this operation added it and no other
          // installed version uses it. The original error is preserved and only
          // sanitized recovery details are added; the installation id and the
          // access key never appear in the response or logs.
          const recovery = { credentialRemoved: false, extensionRemoved: false, trustRolledBack: false };
          let credentialCleanupSafe = false;
          try {
            const removed = await connected.capability.removeCredential();
            const removedFlag = ownDataValue(removed, 'removed');
            const mismatch = ownDataValue(removed, 'mismatch');
            if (removedFlag === true) {
              recovery.credentialRemoved = true;
              credentialCleanupSafe = true;
            } else if (removedFlag === false && mismatch !== true) {
              // An explicit clean absence is safe: this connect did not leave
              // a credential behind, so deleting only its new shell is safe.
              credentialCleanupSafe = true;
            } else if (mismatch === true) {
              recovery.credentialMismatch = true;
            } else {
              recovery.credentialRollbackBlocked = true;
            }
          } catch {
            recovery.credentialRollbackError = 'remote_credential_rollback_failed';
          }
          if (credentialCleanupSafe) {
            try {
              const rollback = await connected.capability.rollback();
              recovery.extensionRemoved = ownDataValue(rollback, 'removed') === true;
              recovery.trustRolledBack = ownDataValue(rollback, 'trustRolledBack') === true;
            } catch {
              recovery.rollbackError = 'remote_rollback_failed';
            }
          } else {
            recovery.rollbackSkipped = true;
          }
          throw safeRemoteCredentialError(error, recovery);
        }
      });
      res.setHeader('Cache-Control', 'no-store');
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/interactive-ui/manager/extensions/:extensionId', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.json(await manager.setEnabled(req.params.extensionId, req.body?.enabled));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/extensions/:extensionId/hosted/refresh', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.refreshHosted(req.params.extensionId, {
        confirmedManifestHash: req.body?.confirmedManifestHash,
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/extensions/:extensionId/remote/update-check', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.checkRemoteUpdate(req.params.extensionId, {
        force: req.body?.force === true,
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/extensions/:extensionId/remote/update-apply', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.applyRemoteUpdate(req.params.extensionId, {
        confirmedManifestHash: req.body?.confirmedManifestHash,
        confirmedPublisherFingerprint: req.body?.confirmedPublisherFingerprint,
      }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/extensions/:extensionId/rollback', async (req, res) => {
    try {
      res.json(await manager.rollback(req.params.extensionId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/manager/extensions/:extensionId/uninstall-impact', async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(await workbenchStore.getExtensionTileImpact(req.params.extensionId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/manager/extensions/:extensionId', async (req, res) => {
    try {
      // Uninstall (credential/workbench cleanup + shell removal) is a
      // cross-subsystem mutation and runs under the manager-scoped coordinator
      // so it cannot interleave with a Remote connect transaction. ALL
      // fallible external cleanup runs FIRST while the shell still exists, so
      // any remaining secret still has an owner; manager.uninstall is only
      // called after cleanup succeeds.
      const outcome = await coordinatorFor(manager).runExclusive(async () => {
        if (!workbenchStore) {
          throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
        }
        const credentials = await runtime.removeExtensionConnections(req.params.extensionId);
        const workbench = await workbenchStore.removeExtensionTiles(req.params.extensionId);
        const result = await manager.uninstall(req.params.extensionId);
        return {
          ...result,
          credentials,
          workbench,
        };
      });
      res.json(outcome);
    } catch (error) {
      // Cleanup or uninstall failure leaves the managed extension installed
      // (manager.uninstall restores from trash on its own failure), so the
      // response never claims extension removal.
      sendError(res, error, { extensionRemoved: false });
    }
  });

  app.post('/api/interactive-ui/manager/marketplaces', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      res.status(201).json(await manager.addMarketplace(req.body));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/marketplaces/inspect', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.json(await manager.inspectMarketplace(req.body?.catalogUrl));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/manager/marketplaces/:marketplaceId', async (req, res) => {
    try {
      res.json(await manager.removeMarketplace(req.params.marketplaceId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/manager/marketplaces/:marketplaceId/catalog', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await manager.fetchMarketplaceCatalog(req.params.marketplaceId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/manager/marketplaces/:marketplaceId/install', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.status(201).json(await manager.installFromMarketplace(req.params.marketplaceId, req.body?.extensionId, req.body?.version));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/capabilities', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.getRoutingCapabilities());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/extensions', async (_req, res) => {
    try {
      res.json(await runtime.listExtensions());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/workbench/catalog', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.getWorkbenchCatalog());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/workbench/snapshots', express.json({ limit: '600kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      if (req.body?.form === 'html-artifact') {
        await artifactStore.materialize(req.body?.envelope);
      }
      const snapshot = await workbenchStore.writeSnapshot(req.body?.form, req.body?.envelope);
      res.setHeader('Cache-Control', 'no-store');
      res.status(201).json(snapshot);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/workbench/snapshots/:snapshotRef', async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(await workbenchStore.readSnapshot(req.params.snapshotRef));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/workbench/boards/:projectId', async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      res.setHeader('Cache-Control', 'no-store');
      res.json(await workbenchStore.read(req.params.projectId));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/workbench/boards/:projectId/tiles', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      if (req.body?.tile?.source?.kind === 'agent-generated') {
        await workbenchStore.readSnapshot(req.body?.tile?.source?.snapshotRef);
      }
      const tile = await runtime.prepareWorkbenchTile(req.body?.tile);
      const result = await workbenchStore.upsertTile(req.params.projectId, req.body?.expectedRevision, tile);
      res.setHeader('Cache-Control', 'no-store');
      res.status(result.created ? 201 : 200).json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/interactive-ui/workbench/boards/:projectId/tiles/:tileId', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      const result = await workbenchStore.updateTile(
        req.params.projectId,
        req.params.tileId,
        req.body?.expectedRevision,
        req.body?.patch,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.patch('/api/interactive-ui/workbench/boards/:projectId/layouts', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      const result = await workbenchStore.updateTileLayouts(
        req.params.projectId,
        req.body?.expectedRevision,
        req.body?.layouts,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/workbench/boards/:projectId/tiles/:tileId/migrate', express.json({ limit: '64kb' }), async (req, res) => {
    try {
      if (!workbenchStore || typeof runtime.migrateWorkbenchTile !== 'function') {
        throw new InteractiveUIRouteError('Extension Workbench migration is unavailable', 501, 'workbench_unsupported');
      }
      const current = await workbenchStore.read(req.params.projectId);
      const board = current.boards.find((candidate) => candidate.id === current.activeBoardId);
      const tile = board?.tiles.find((candidate) => candidate.tileId === req.params.tileId);
      if (!tile) {
        throw new InteractiveUIRouteError('Workbench tile was not found', 404, 'workbench_tile_not_found');
      }
      const migrated = await runtime.migrateWorkbenchTile(tile);
      const result = await workbenchStore.migrateTile(
        req.params.projectId,
        req.params.tileId,
        req.body?.expectedRevision,
        migrated,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/workbench/boards/:projectId/tiles/:tileId/replace-generated-snapshot', express.json({ limit: '600kb' }), async (req, res) => {
    try {
      if (!workbenchStore || typeof workbenchStore.replaceGeneratedTileSnapshot !== 'function') {
        throw new InteractiveUIRouteError('Extension Workbench snapshot replacement is unavailable', 501, 'workbench_unsupported');
      }
      if (!isRecord(req.body)
        || Object.keys(req.body).some((key) => !['expectedRevision', 'expectedSnapshotRef', 'form', 'envelope'].includes(key))
        || !['interactive-ui', 'html-artifact', 'mcp-app'].includes(req.body.form)
        || !isRecord(req.body.envelope)) {
        throw new InteractiveUIRouteError(
          'Workbench generated snapshot replacement body is invalid',
          400,
          'invalid_workbench_snapshot_replace',
        );
      }
      if (!Number.isInteger(req.body.expectedRevision) || req.body.expectedRevision < 0) {
        throw new InteractiveUIRouteError(
          'expectedRevision is required',
          400,
          'workbench_revision_required',
        );
      }
      if (req.body.expectedSnapshotRef === undefined) {
        throw new InteractiveUIRouteError(
          'expectedSnapshotRef is required',
          400,
          'workbench_snapshot_ref_required',
        );
      }
      if (typeof req.body.expectedSnapshotRef !== 'string'
        || !WORKBENCH_SNAPSHOT_REF_PATTERN.test(req.body.expectedSnapshotRef)) {
        throw new InteractiveUIRouteError(
          'expectedSnapshotRef is invalid',
          400,
          'workbench_snapshot_ref_invalid',
        );
      }
      if (req.body.form === 'html-artifact') {
        await artifactStore.materialize(req.body.envelope);
      }
      const result = await workbenchStore.replaceGeneratedTileSnapshot(
        req.params.projectId,
        req.params.tileId,
        req.body.expectedRevision,
        req.body.expectedSnapshotRef,
        req.body.form,
        req.body.envelope,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/workbench/boards/:projectId/tiles/:tileId', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      if (!workbenchStore) {
        throw new InteractiveUIRouteError('Extension Workbench is unavailable in this runtime', 501, 'workbench_unsupported');
      }
      const result = await workbenchStore.removeTile(
        req.params.projectId,
        req.params.tileId,
        req.body?.expectedRevision,
      );
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/connections', async (_req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.listConnections());
    } catch (error) {
      sendError(res, error);
    }
  });

  app.put('/api/interactive-ui/connections/:extensionId/:connectorId', express.json({ limit: '32kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const result = await coordinatorFor(manager).runExclusive(() => (
        runtime.configureConnection(req.params.extensionId, req.params.connectorId, req.body)
      ));
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/connections/:extensionId/:connectorId/provision', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const result = await coordinatorFor(manager).runExclusive(() => (
        runtime.provisionConnection(req.params.extensionId, req.params.connectorId, req.body)
      ));
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/connections/:extensionId/:connectorId/test', express.json({ limit: '16kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      // Manual health always uses force (bypasses a settled TTL entry while
      // still joining an in-flight probe). An optional update check also runs
      // forced and contributes a safe update result when the extension is a
      // Remote app; the response may include it.
      const health = await runtime.testConnection(req.params.extensionId, req.params.connectorId, { force: true });
      if (req.body?.checkForUpdates !== true) {
        res.json(health);
        return;
      }
      let update = null;
      try {
        update = await manager.checkRemoteUpdate(req.params.extensionId, { force: true });
      } catch (error) {
        if (error?.code !== 'remote_extension_required' && error?.code !== 'extension_not_found') throw error;
      }
      res.json(update ? { ...health, update } : health);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.delete('/api/interactive-ui/connections/:extensionId/:connectorId', async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      const result = await coordinatorFor(manager).runExclusive(() => (
        runtime.removeConnection(req.params.extensionId, req.params.connectorId)
      ));
      res.json(result);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/views/:viewId', async (req, res) => {
    try {
      const tool = typeof req.query?.tool === 'string' ? req.query.tool : '';
      const launchSource = req.query?.launch === 'workbench' ? 'workbench' : 'tool';
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.getViewDescriptor(req.params.viewId, tool, { launchSource }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/installed-artifacts/:artifactId', async (req, res) => {
    try {
      const tool = typeof req.query?.tool === 'string' ? req.query.tool : '';
      const launchSource = req.query?.launch === 'workbench' ? 'workbench' : 'tool';
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.getInstalledArtifactDescriptor(req.params.artifactId, tool, { launchSource }));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/extensions/:extensionId/icon', async (req, res) => {
    try {
      const icon = await runtime.getExtensionIcon(req.params.extensionId);
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.setHeader('Content-Type', icon.contentType);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.send(icon.content);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/extensions/:extensionId/artifacts/:artifactId', async (req, res) => {
    try {
      const artifact = await runtime.getInstalledArtifactDocument(req.params.extensionId, req.params.artifactId);
      setArtifactDocumentHeaders(res, true);
      res.setHeader('ETag', `"${artifact.integrity}"`);
      res.send(createArtifactBrokerDocument(artifact.source));
    } catch (error) {
      sendError(res, error);
    }
  });

  app.get('/api/interactive-ui/extensions/:extensionId/native/:viewId', async (req, res) => {
    try {
      const bundle = await runtime.getNativeBundle(req.params.extensionId, req.params.viewId);
      res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
      res.setHeader('Cache-Control', 'private, no-cache');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('ETag', `"${bundle.integrity}"`);
      res.send(bundle.source);
    } catch (error) {
      sendError(res, error);
    }
  });

  app.post('/api/interactive-ui/actions/:actionId', express.json({ limit: '256kb' }), async (req, res) => {
    try {
      res.setHeader('Cache-Control', 'no-store');
      res.json(await runtime.invokeAction(
        req.params.actionId,
        await authorizeWorkbenchAction(req.body),
      ));
    } catch (error) {
      sendError(res, error);
    }
  });
};
