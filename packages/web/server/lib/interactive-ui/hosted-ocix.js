import nodeCrypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import nodePath from 'node:path';

export const HOSTED_OCIX_MANIFEST_SCHEMA = 'openchamber://hosted-ocix-manifest/v1';
export const HOSTED_OCIX_CACHE_INTEGRITY_SCHEMA = 'openchamber://hosted-ocix-cache-integrity/v1';
export const HOSTED_OCIX_SIGNED_MANIFEST_FILE = '.openchamber.hosted-manifest.json';

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
// Single-source internal bound for the Hosted signed-manifest TRANSPORT: the
// manifest fetch size cap AND the runtime's signed-manifest authority capture
// both use this exact constant (the runtime's openchamber.extension.json cap
// stays at 512 KiB). Do not loosen.
export const HOSTED_OCIX_MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_MANIFEST_BYTES = HOSTED_OCIX_MAX_MANIFEST_BYTES;
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_RESOURCE_BYTES = 16 * 1024 * 1024;
const MAX_RESOURCES = 512;
const MAX_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const DEFAULT_TTL_SECONDS = 15 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;
const MEDIA_TYPE_PATTERN = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

export class HostedOcixError extends Error {
  constructor(message, code = 'hosted_ocix_error', status = 400, details = undefined) {
    super(message);
    this.name = 'HostedOcixError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().flatMap((key) => value[key] === undefined
      ? []
      : [[key, canonicalize(value[key])]]),
  );
};

// Stable canonical JSON serialization (key-sorted, undefined-dropping) shared
// by the Hosted kernel, the manager, and the runtime's captured authority
// hashing so all sides compute byte-identical canonical digests.
export const canonicalStringify = (value) => JSON.stringify(canonicalize(value));

const sha256 = (cryptoImpl, value) => `sha256-${cryptoImpl.createHash('sha256').update(value).digest('base64')}`;

export const normalizeMediaType = (value, label) => {
  const mediaType = typeof value === 'string'
    ? value.split(';', 1)[0].trim().toLowerCase()
    : '';
  if (!MEDIA_TYPE_PATTERN.test(mediaType)) {
    throw new HostedOcixError(`${label} is invalid`, 'invalid_hosted_resource');
  }
  return mediaType;
};

export const safeRelativePath = (value) => {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return null;
  const normalized = nodePath.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
};

const hostedResourceReservedNamespace = (resourcePath) => {
  const [root] = resourcePath.split('/');
  if (root === 'agent-runtime') return 'agent-runtime';
  if (root === '.openchamber' || root.startsWith('.openchamber.')) return '.openchamber';
  if (root === 'openchamber.extension.json') return 'openchamber.extension.json';
  return null;
};

const normalizeHttpsUrl = (value, label) => {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HostedOcixError(`${label} must be an absolute URL`, 'invalid_hosted_url');
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if ((parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback))
    || parsed.username
    || parsed.password
    || parsed.hash) {
    throw new HostedOcixError(
      `${label} must use HTTPS (HTTP is allowed only for loopback) without credentials or fragments`,
      'unsafe_hosted_url',
    );
  }
  return parsed;
};

const normalizeStringSet = (value, label, mapper = (item) => item) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new HostedOcixError(`${label} must be an array of strings`, 'invalid_hosted_permissions');
  }
  return [...new Set(value.map((item) => mapper(item.trim())))].sort();
};

const normalizeOrigins = (value, label) => normalizeStringSet(value, label, (item) => {
  const parsed = normalizeHttpsUrl(item, label);
  if (parsed.pathname !== '/' || parsed.search) {
    throw new HostedOcixError(`${label} entries must be origins`, 'invalid_hosted_permissions');
  }
  return parsed.origin;
});

export const normalizeHostedDelivery = (manifest) => {
  if (!isRecord(manifest?.delivery) || manifest.delivery.type !== 'hosted') return null;
  const manifestUrl = normalizeHttpsUrl(manifest.delivery.manifestUrl, 'Hosted manifest URL').toString();
  const ttlSeconds = manifest.delivery.ttlSeconds === undefined
    ? DEFAULT_TTL_SECONDS
    : manifest.delivery.ttlSeconds;
  if (!Number.isInteger(ttlSeconds) || ttlSeconds < MIN_TTL_SECONDS || ttlSeconds > MAX_TTL_SECONDS) {
    throw new HostedOcixError(
      `Hosted manifest ttlSeconds must be an integer from ${MIN_TTL_SECONDS} to ${MAX_TTL_SECONDS}`,
      'invalid_hosted_delivery',
    );
  }
  const minimumRuntimeVersion = typeof manifest.delivery.minimumRuntimeVersion === 'string'
    ? manifest.delivery.minimumRuntimeVersion.trim()
    : undefined;
  if (minimumRuntimeVersion !== undefined && !SEMVER_PATTERN.test(minimumRuntimeVersion)) {
    throw new HostedOcixError(
      'Hosted minimumRuntimeVersion must use semantic versioning',
      'invalid_hosted_delivery',
    );
  }
  const initialPermissions = normalizeHostedPermissions(manifest.delivery.initialPermissions ?? {});
  return {
    type: 'hosted',
    manifestUrl,
    ttlSeconds,
    updatePolicy: 'permission-stable',
    minimumRuntimeVersion,
    initialPermissions,
  };
};

export const normalizeHostedPermissions = (value) => {
  if (!isRecord(value)) {
    throw new HostedOcixError('Hosted permissions must be an object', 'invalid_hosted_permissions');
  }
  return {
    resourceOrigins: normalizeOrigins(value.resourceOrigins, 'Hosted resource origins'),
    networkOrigins: normalizeOrigins(value.networkOrigins, 'Hosted network origins'),
    externalLinkOrigins: normalizeOrigins(value.externalLinkOrigins, 'Hosted external-link origins'),
    credentialScopes: normalizeStringSet(value.credentialScopes, 'Hosted credential scopes'),
    actionIds: normalizeStringSet(value.actionIds, 'Hosted action IDs'),
    agentToolNames: normalizeStringSet(value.agentToolNames, 'Hosted Agent Tool names'),
    clipboard: value.clipboard === true,
    popups: value.popups === true,
    nativeCode: value.nativeCode === true,
  };
};

export const hostedPermissionExpansion = (approvedValue, candidateValue) => {
  const approved = normalizeHostedPermissions(approvedValue);
  const candidate = normalizeHostedPermissions(candidateValue);
  const added = {};
  for (const key of [
    'resourceOrigins',
    'networkOrigins',
    'externalLinkOrigins',
    'credentialScopes',
    'actionIds',
    'agentToolNames',
  ]) {
    const prior = new Set(approved[key]);
    const values = candidate[key].filter((item) => !prior.has(item));
    if (values.length) added[key] = values;
  }
  if (!approved.clipboard && candidate.clipboard) added.clipboard = true;
  if (!approved.popups && candidate.popups) added.popups = true;
  if (!approved.nativeCode && candidate.nativeCode) added.nativeCode = true;
  return Object.keys(added).length ? added : null;
};

const decodeSignature = (value) => {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new HostedOcixError('Hosted manifest signature is invalid', 'invalid_hosted_signature', 403);
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 64 || bytes.toString('base64') !== value) {
    throw new HostedOcixError('Hosted manifest signature is invalid', 'invalid_hosted_signature', 403);
  }
  return bytes;
};

const validateExtensionIdentity = (extension, extensionId, version) => {
  if (!isRecord(extension)
    || extension.$schema !== 'openchamber://extension/v1'
    || extension.id !== extensionId
    || !ID_PATTERN.test(extension.id)
    || extension.version !== version
    || !SEMVER_PATTERN.test(extension.version)
    || typeof extension.name !== 'string'
    || !extension.name.trim()) {
    throw new HostedOcixError('Hosted extension identity does not match the thin package', 'hosted_identity_mismatch', 403);
  }
};

const derivePermissions = (document, resources) => {
  const declared = normalizeHostedPermissions(document.permissions ?? {});
  const resourceOrigins = [...new Set(resources.map((resource) => new URL(resource.url).origin))].sort();
  const extensionNetwork = normalizeOrigins(
    Array.isArray(document.extension?.permissions?.network)
      ? document.extension.permissions.network
      : [],
    'Hosted extension network origins',
  );
  const actionIds = normalizeStringSet(
    Array.isArray(document.extension?.actions)
      ? document.extension.actions.map((action) => action?.id).filter((value) => typeof value === 'string')
      : [],
    'Hosted action IDs',
  );
  const agentToolNames = normalizeStringSet(
    [
      ...(Array.isArray(document.extension?.views) ? document.extension.views : []),
      ...(Array.isArray(document.extension?.artifacts) ? document.extension.artifacts : []),
    ].flatMap((surface) => Array.isArray(surface?.tools) ? surface.tools : []),
    'Hosted Agent Tool names',
  );
  const nativeCode = Array.isArray(document.extension?.views)
    && document.extension.views.some((view) => view?.runtime === 'native');
  if (nativeCode && document.extension?.trust?.mode !== 'native-code') {
    throw new HostedOcixError(
      'Hosted Native surfaces require extension trust.mode = native-code',
      'hosted_native_trust_required',
      403,
    );
  }
  if (nativeCode && !declared.nativeCode) {
    throw new HostedOcixError(
      'Hosted Native surfaces must declare nativeCode in their permission summary',
      'hosted_permission_mismatch',
      403,
    );
  }
  const merged = {
    ...declared,
    resourceOrigins: [...new Set([...declared.resourceOrigins, ...resourceOrigins])].sort(),
    networkOrigins: [...new Set([...declared.networkOrigins, ...extensionNetwork])].sort(),
    actionIds: [...new Set([...declared.actionIds, ...actionIds])].sort(),
    agentToolNames: [...new Set([...declared.agentToolNames, ...agentToolNames])].sort(),
    nativeCode,
  };
  for (const origin of resourceOrigins) {
    if (!declared.resourceOrigins.includes(origin)) {
      throw new HostedOcixError(
        `Hosted resource origin is not declared: ${origin}`,
        'hosted_permission_mismatch',
        403,
      );
    }
  }
  for (const origin of extensionNetwork) {
    if (!declared.networkOrigins.includes(origin)) {
      throw new HostedOcixError(
        `Hosted connector origin is not declared: ${origin}`,
        'hosted_permission_mismatch',
        403,
      );
    }
  }
  for (const actionId of actionIds) {
    if (!declared.actionIds.includes(actionId)) {
      throw new HostedOcixError(
        `Hosted action is not declared in its permission summary: ${actionId}`,
        'hosted_permission_mismatch',
        403,
      );
    }
  }
  for (const toolName of agentToolNames) {
    if (!declared.agentToolNames.includes(toolName)) {
      throw new HostedOcixError(
        `Hosted Agent Tool is not declared in its permission summary: ${toolName}`,
        'hosted_permission_mismatch',
        403,
      );
    }
  }
  return merged;
};

export const verifyHostedOcixManifest = ({
  document,
  extensionId,
  publisherKeyId,
  publisherPublicKey,
  cryptoImpl = nodeCrypto,
}) => {
  if (!isRecord(document)
    || document.$schema !== HOSTED_OCIX_MANIFEST_SCHEMA
    || !isRecord(document.app)
    || document.app.id !== extensionId
    || !SEMVER_PATTERN.test(document.app.version ?? '')
    || typeof document.app.publishedAt !== 'string'
    || !Number.isFinite(Date.parse(document.app.publishedAt))) {
    throw new HostedOcixError('Hosted OCIX manifest is invalid', 'invalid_hosted_manifest');
  }
  if (!isRecord(document.signature)
    || document.signature.algorithm !== 'ed25519'
    || document.signature.keyId !== publisherKeyId) {
    throw new HostedOcixError('Hosted manifest signing identity does not match the thin package', 'hosted_signature_identity_mismatch', 403);
  }
  const { signature, ...unsigned } = document;
  let publicKey;
  try {
    publicKey = cryptoImpl.createPublicKey(publisherPublicKey);
  } catch {
    throw new HostedOcixError('Hosted publisher public key is invalid', 'invalid_hosted_publisher_key', 403);
  }
  if (publicKey.asymmetricKeyType !== 'ed25519'
    || !cryptoImpl.verify(
      null,
      Buffer.from(canonicalStringify(unsigned)),
      publicKey,
      decodeSignature(signature.value),
    )) {
    throw new HostedOcixError('Hosted manifest signature verification failed', 'invalid_hosted_signature', 403);
  }

  validateExtensionIdentity(document.extension, extensionId, document.app.version);
  if (!Array.isArray(document.resources)
    || document.resources.length === 0
    || document.resources.length > MAX_RESOURCES) {
    throw new HostedOcixError('Hosted manifest has an invalid resource list', 'invalid_hosted_resources');
  }
  const seen = new Set();
  const resources = document.resources.map((resource) => {
    if (!isRecord(resource)) {
      throw new HostedOcixError('Hosted resource is invalid', 'invalid_hosted_resource');
    }
    const path = safeRelativePath(resource.path);
    if (!path || seen.has(path)) {
      throw new HostedOcixError('Hosted resource path is invalid or duplicated', 'invalid_hosted_resource');
    }
    const reservedNamespace = hostedResourceReservedNamespace(path);
    if (reservedNamespace) {
      throw new HostedOcixError(
        `Hosted resource path conflicts with the host-reserved ${reservedNamespace} namespace: ${path}`,
        'invalid_hosted_resource',
        400,
        { path, reservedNamespace },
      );
    }
    seen.add(path);
    if (!SHA256_PATTERN.test(resource.sha256 ?? '')) {
      throw new HostedOcixError(`Hosted resource metadata is invalid: ${path}`, 'invalid_hosted_resource');
    }
    const url = normalizeHttpsUrl(resource.url, `Hosted resource ${path}`).toString();
    const mimeType = normalizeMediaType(resource.mimeType, `Hosted resource MIME type for ${path}`);
    return { path, url, mimeType, sha256: resource.sha256 };
  });
  const permissions = derivePermissions(document, resources);
  return {
    extensionId,
    version: document.app.version,
    publishedAt: document.app.publishedAt,
    extension: canonicalize(document.extension),
    resources,
    permissions,
    signedDocument: canonicalize(document),
    manifestHash: sha256(cryptoImpl, Buffer.from(canonicalStringify(document))),
  };
};

// Best-effort async disposal of a response body BEFORE a pre-consumption
// rejection: cancels the underlying stream so hostile/unbounded bodies are
// not retained across retries. Cancellation failure is ignored — it must
// never mask the authoritative HostedOcixError and never causes a forbidden
// next-hop contact.
const discardResponseBody = async (response) => {
  try {
    if (response?.body?.cancel) await response.body.cancel();
  } catch {
    // Best-effort only.
  }
};

const readResponseBytes = async (response, limit, label) => {
  const length = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(length) && length > limit) {
    await discardResponseBody(response);
    throw new HostedOcixError(`${label} exceeds its size limit`, 'hosted_payload_too_large', 413);
  }
  const body = response.body;
  if (body && typeof body.getReader === 'function') {
    // Streaming-bounded read: accumulate only up to the limit and cancel
    // immediately on overflow so an unbounded/chunked body is never fully
    // consumed into memory. The reader lock is ALWAYS released in finally,
    // including after cancel() on overflow; a release failure must never
    // mask the original outcome.
    const reader = body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > limit) {
          await reader.cancel().catch(() => {});
          throw new HostedOcixError(`${label} exceeds its size limit`, 'hosted_payload_too_large', 413);
        }
        chunks.push(value);
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Already released or invalid: never mask the original error.
      }
    }
    return Buffer.concat(chunks, total);
  }
  // Fallback for test-only or non-stream responses: read the whole body and
  // then post-check the size (never returns oversized bytes).
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) {
    throw new HostedOcixError(`${label} exceeds its size limit`, 'hosted_payload_too_large', 413);
  }
  return bytes;
};

// Resolves a redirect Location against the current URL and enforces the
// ORIGINAL requested origin plus the existing HTTPS/loopback-http/no-credential
// URL policy BEFORE any next-hop request is made. Throws a stable
// HostedOcixError; a forbidden next hop is never contacted.
const resolveRedirectTarget = ({
  location,
  currentUrl,
  originalOrigin,
  label,
  code,
  status,
}) => {
  if (typeof location !== 'string' || !location.trim()) {
    throw new HostedOcixError(`${label} redirected without a valid Location`, code, status);
  }
  let target;
  try {
    target = new URL(location, currentUrl);
  } catch {
    throw new HostedOcixError(`${label} redirect Location is invalid`, code, status);
  }
  if (target.origin !== originalOrigin) {
    throw new HostedOcixError(`${label} redirected to a different origin`, code, status);
  }
  normalizeHttpsUrl(target.toString(), label);
  return target;
};

// Bounded manual redirect loop shared by the Hosted manifest and resource
// transports: every next hop is validated (original origin + URL policy)
// BEFORE it is contacted; redirect bodies are discarded; an unexpected
// cross-origin response.url is rejected defensively (covers custom fetch
// implementations that ignore redirect: 'manual'). GET/Accept/timeout
// semantics are kept; the redirect count is bounded by MAX_REDIRECTS.
const fetchWithManualRedirects = async ({
  url,
  fetchImpl,
  headers,
  label,
  originChangedCode,
  originChangedStatus,
  failedCode,
  failedStatus,
}) => {
  const original = new URL(url);
  const originalOrigin = original.origin;
  let current = original;
  for (let attempt = 0; attempt <= MAX_REDIRECTS; attempt += 1) {
    let response;
    try {
      response = await fetchImpl(current, {
        headers,
        signal: AbortSignal.timeout(15_000),
        redirect: 'manual',
      });
    } catch {
      throw new HostedOcixError(`${label} request failed`, failedCode, failedStatus);
    }
    // Defensive: a custom fetch that followed redirects despite
    // redirect: 'manual' must never hand back a cross-origin response. The
    // body is discarded before the rejection so it is not retained.
    if (typeof response?.url === 'string' && response.url) {
      let responseUrl;
      try {
        responseUrl = new URL(response.url);
      } catch {
        await discardResponseBody(response);
        throw new HostedOcixError(`${label} returned an invalid response URL`, originChangedCode, originChangedStatus);
      }
      if (responseUrl.origin !== originalOrigin) {
        await discardResponseBody(response);
        throw new HostedOcixError(`${label} redirected to a different origin`, originChangedCode, originChangedStatus);
      }
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      if (attempt >= MAX_REDIRECTS) {
        await discardResponseBody(response);
        throw new HostedOcixError(`${label} exceeded its redirect limit`, originChangedCode, originChangedStatus);
      }
      // Await best-effort cancellation of the redirect body BEFORE issuing
      // the next same-origin hop; cancellation failure may be ignored but
      // never blocks or masks, and a forbidden next hop is still never
      // contacted (resolveRedirectTarget validates before contact).
      try {
        if (response.body?.cancel) await response.body.cancel();
      } catch {
        // Best-effort: cancellation failure is ignored.
      }
      current = resolveRedirectTarget({
        location: response.headers?.get?.('location'),
        currentUrl: current,
        originalOrigin,
        label,
        code: originChangedCode,
        status: originChangedStatus,
      });
      continue;
    }
    return response;
  }
  throw new HostedOcixError(`${label} exceeded its redirect limit`, originChangedCode, originChangedStatus);
};

export const fetchHostedOcixManifest = async ({
  manifestUrl,
  fetchImpl = globalThis.fetch,
}) => {
  const requested = normalizeHttpsUrl(manifestUrl, 'Hosted manifest URL');
  const response = await fetchWithManualRedirects({
    url: requested,
    fetchImpl,
    headers: { Accept: 'application/vnd.openchamber.hosted-ocix+json, application/json' },
    label: 'Hosted manifest',
    originChangedCode: 'hosted_manifest_origin_changed',
    originChangedStatus: 403,
    failedCode: 'hosted_manifest_unavailable',
    failedStatus: 502,
  });
  if (!response.ok) {
    await discardResponseBody(response);
    throw new HostedOcixError(
      `Hosted manifest request failed (${response.status})`,
      'hosted_manifest_unavailable',
      502,
    );
  }
  const bytes = await readResponseBytes(response, MAX_MANIFEST_BYTES, 'Hosted manifest');
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new HostedOcixError('Hosted manifest is not valid JSON', 'invalid_hosted_manifest', 502);
  }
};

// Single-resource fetch verification shared by full Hosted materialization and
// the Remote lazy resource cache: bounded HTTP fetch, same-origin redirect
// enforcement, normalized Content-Type against the signed mimeType, size
// limit, and exact signed sha256. Returns the verified bytes or throws a
// stable HostedOcixError; never returns bytes that failed any check.
export const fetchVerifiedHostedResource = async ({
  resource,
  fetchImpl = globalThis.fetch,
  cryptoImpl = nodeCrypto,
  maxBytes = MAX_RESOURCE_BYTES,
}) => {
  if (!isRecord(resource) || typeof resource.url !== 'string' || !SHA256_PATTERN.test(resource.sha256 ?? '')) {
    throw new HostedOcixError('Hosted resource metadata is invalid', 'invalid_hosted_resource');
  }
  // Normalize/enforce the initial resource URL with the existing URL policy
  // (HTTPS, loopback-only HTTP, no credentials/fragments) BEFORE the first
  // request: a signed-manifest caller already normalized it, but the shared
  // exported verifier fails closed itself so an unsafe URL is never contacted.
  const resourceUrl = normalizeHttpsUrl(resource.url, `Hosted resource ${resource.path}`);
  const response = await fetchWithManualRedirects({
    url: resourceUrl,
    fetchImpl,
    headers: { Accept: resource.mimeType },
    label: `Hosted resource ${resource.path}`,
    originChangedCode: 'hosted_resource_unavailable',
    originChangedStatus: 502,
    failedCode: 'hosted_resource_unavailable',
    failedStatus: 502,
  });
  if (!response.ok) {
    await discardResponseBody(response);
    throw new HostedOcixError(
      `Hosted resource request failed: ${resource.path}`,
      'hosted_resource_unavailable',
      502,
    );
  }
  let responseMimeType;
  try {
    responseMimeType = normalizeMediaType(
      response.headers?.get?.('content-type'),
      `Hosted resource response MIME type for ${resource.path}`,
    );
  } catch {
    await discardResponseBody(response);
    throw new HostedOcixError(
      `Hosted resource response is missing a valid Content-Type: ${resource.path}`,
      'hosted_resource_mime_mismatch',
      403,
      { expected: resource.mimeType, actual: response.headers?.get?.('content-type') ?? null },
    );
  }
  if (responseMimeType !== resource.mimeType) {
    await discardResponseBody(response);
    throw new HostedOcixError(
      `Hosted resource Content-Type does not match its signed manifest: ${resource.path}`,
      'hosted_resource_mime_mismatch',
      403,
      { expected: resource.mimeType, actual: responseMimeType },
    );
  }
  const bytes = await readResponseBytes(response, maxBytes, `Hosted resource ${resource.path}`);
  if (sha256(cryptoImpl, bytes) !== resource.sha256) {
    throw new HostedOcixError(
      `Hosted resource integrity check failed: ${resource.path}`,
      'hosted_resource_integrity_failed',
      403,
    );
  }
  return bytes;
};

const atomicWrite = async (fsImpl, pathImpl, cryptoImpl, target, bytes) => {
  await fsImpl.mkdir(pathImpl.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${cryptoImpl.randomUUID()}.tmp`;
  try {
    await fsImpl.writeFile(temporary, bytes, { mode: 0o600, flag: 'wx' });
    await fsImpl.rename(temporary, target);
  } catch (error) {
    await fsImpl.rm(temporary, { force: true }).catch(() => {});
    throw error;
  }
};

export const materializeHostedOcix = async ({
  verified,
  cacheDirectory,
  fetchImpl = globalThis.fetch,
  fsImpl = fsPromises,
  pathImpl = nodePath,
  cryptoImpl = nodeCrypto,
  validate = async () => {},
}) => {
  if (!isRecord(verified?.signedDocument)
    || !SHA256_PATTERN.test(verified?.manifestHash ?? '')
    || sha256(cryptoImpl, Buffer.from(canonicalStringify(verified.signedDocument)))
      !== verified.manifestHash) {
    throw new HostedOcixError(
      'Hosted OCIX materialization requires its verified signed manifest',
      'hosted_cache_integrity_unavailable',
      409,
    );
  }
  const destination = pathImpl.join(cacheDirectory, verified.extensionId, verified.version);
  const staging = pathImpl.join(cacheDirectory, '.staging', cryptoImpl.randomUUID());
  let total = 0;
  try {
    await fsImpl.mkdir(staging, { recursive: true, mode: 0o700 });
    for (const resource of verified.resources) {
      const bytes = await fetchVerifiedHostedResource({ resource, fetchImpl, cryptoImpl });
      total += bytes.length;
      if (total > MAX_TOTAL_RESOURCE_BYTES) {
        throw new HostedOcixError('Hosted resources exceed the total size limit', 'hosted_payload_too_large', 413);
      }
      await atomicWrite(
        fsImpl,
        pathImpl,
        cryptoImpl,
        pathImpl.join(staging, ...resource.path.split('/')),
        bytes,
      );
    }
    await atomicWrite(
      fsImpl,
      pathImpl,
      cryptoImpl,
      pathImpl.join(staging, 'openchamber.extension.json'),
      Buffer.from(`${JSON.stringify(verified.extension, null, 2)}\n`),
    );
    await atomicWrite(
      fsImpl,
      pathImpl,
      cryptoImpl,
      pathImpl.join(staging, HOSTED_OCIX_SIGNED_MANIFEST_FILE),
      Buffer.from(canonicalStringify(verified.signedDocument)),
    );
    await validate(staging);
    await fsImpl.mkdir(pathImpl.dirname(destination), { recursive: true, mode: 0o700 });
    await fsImpl.rm(destination, { recursive: true, force: true });
    await fsImpl.rename(staging, destination);
    return destination;
  } catch (error) {
    await fsImpl.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
};

const collectCacheFiles = async ({
  directory,
  current = directory,
  fsImpl,
  pathImpl,
  result = [],
}) => {
  const entries = await fsImpl.readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = pathImpl.join(current, entry.name);
    const stat = await fsImpl.lstat(absolute);
    if (stat.isSymbolicLink()) {
      throw new HostedOcixError(
        'Hosted OCIX cache contains a symbolic link',
        'hosted_cache_integrity_failed',
        409,
      );
    }
    if (stat.isDirectory()) {
      await collectCacheFiles({ directory, current: absolute, fsImpl, pathImpl, result });
      continue;
    }
    if (!stat.isFile()) {
      throw new HostedOcixError(
        'Hosted OCIX cache contains an unsupported filesystem entry',
        'hosted_cache_integrity_failed',
        409,
      );
    }
    result.push(pathImpl.relative(directory, absolute).split(pathImpl.sep).join('/'));
  }
  return result;
};

export const createHostedOcixCacheIntegrity = ({
  verified,
  additionalFiles = new Map(),
  cryptoImpl = nodeCrypto,
} = {}) => {
  if (!isRecord(verified)
    || !ID_PATTERN.test(verified.extensionId ?? '')
    || !SEMVER_PATTERN.test(verified.version ?? '')
    || !SHA256_PATTERN.test(verified.manifestHash ?? '')
    || !isRecord(verified.signedDocument)
    || sha256(cryptoImpl, Buffer.from(canonicalStringify(verified.signedDocument)))
      !== verified.manifestHash) {
    throw new HostedOcixError(
      'Hosted OCIX cache integrity source is invalid',
      'hosted_cache_integrity_unavailable',
      409,
    );
  }
  const files = {
    [HOSTED_OCIX_SIGNED_MANIFEST_FILE]: verified.manifestHash,
    'openchamber.extension.json': sha256(
      cryptoImpl,
      Buffer.from(`${JSON.stringify(verified.extension, null, 2)}\n`),
    ),
  };
  for (const resource of verified.resources ?? []) {
    if (!safeRelativePath(resource?.path) || !SHA256_PATTERN.test(resource?.sha256 ?? '')) {
      throw new HostedOcixError(
        'Hosted OCIX cache integrity resource is invalid',
        'hosted_cache_integrity_unavailable',
        409,
      );
    }
    files[resource.path] = resource.sha256;
  }
  const entries = additionalFiles instanceof Map
    ? additionalFiles.entries()
    : Object.entries(additionalFiles ?? {});
  for (const [relativePath, content] of entries) {
    const normalized = safeRelativePath(relativePath);
    if (!normalized || files[normalized] !== undefined) {
      throw new HostedOcixError(
        'Hosted OCIX cache integrity contains an invalid or duplicate path',
        'hosted_cache_integrity_unavailable',
        409,
      );
    }
    files[normalized] = sha256(
      cryptoImpl,
      Buffer.isBuffer(content) ? content : Buffer.from(String(content)),
    );
  }
  return {
    $schema: HOSTED_OCIX_CACHE_INTEGRITY_SCHEMA,
    extensionId: verified.extensionId,
    version: verified.version,
    manifestHash: verified.manifestHash,
    files: Object.fromEntries(Object.entries(files).sort(([left], [right]) => left.localeCompare(right))),
  };
};

export const verifyHostedOcixCacheIntegrity = async ({
  directory,
  integrity,
  fsImpl = fsPromises,
  pathImpl = nodePath,
  cryptoImpl = nodeCrypto,
} = {}) => {
  if (!isRecord(integrity)
    || integrity.$schema !== HOSTED_OCIX_CACHE_INTEGRITY_SCHEMA
    || !ID_PATTERN.test(integrity.extensionId ?? '')
    || !SEMVER_PATTERN.test(integrity.version ?? '')
    || !SHA256_PATTERN.test(integrity.manifestHash ?? '')
    || !isRecord(integrity.files)
    || Object.keys(integrity.files).length === 0
    || Object.entries(integrity.files).some(
      ([filePath, hash]) => !safeRelativePath(filePath) || !SHA256_PATTERN.test(hash ?? ''),
    )) {
    throw new HostedOcixError(
      'Hosted OCIX cache has no valid signed integrity record',
      'hosted_cache_integrity_unavailable',
      409,
    );
  }
  const root = pathImpl.resolve(directory ?? '');
  const expectedPaths = Object.keys(integrity.files).sort();
  let actualPaths;
  try {
    actualPaths = (await collectCacheFiles({
      directory: root,
      fsImpl,
      pathImpl,
    })).sort();
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new HostedOcixError(
        'Hosted OCIX cache is missing',
        'hosted_cache_integrity_failed',
        409,
      );
    }
    throw error;
  }
  if (expectedPaths.length !== actualPaths.length
    || expectedPaths.some((filePath, index) => filePath !== actualPaths[index])) {
    throw new HostedOcixError(
      'Hosted OCIX cache files do not match the signed integrity record',
      'hosted_cache_integrity_failed',
      409,
    );
  }
  for (const relativePath of expectedPaths) {
    const target = pathImpl.join(root, ...relativePath.split('/'));
    const relative = pathImpl.relative(root, target);
    if (!relative || relative.startsWith('..') || pathImpl.isAbsolute(relative)) {
      throw new HostedOcixError(
        'Hosted OCIX cache integrity path is invalid',
        'hosted_cache_integrity_failed',
        409,
      );
    }
    const content = await fsImpl.readFile(target);
    if (sha256(cryptoImpl, content) !== integrity.files[relativePath]) {
      throw new HostedOcixError(
        `Hosted OCIX cache file was modified: ${relativePath}`,
        'hosted_cache_integrity_failed',
        409,
      );
    }
  }
  return { status: 'ready', files: expectedPaths.length };
};
