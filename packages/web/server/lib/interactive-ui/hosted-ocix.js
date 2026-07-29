import nodeCrypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import nodePath from 'node:path';

export const HOSTED_OCIX_MANIFEST_SCHEMA = 'openchamber://hosted-ocix-manifest/v1';

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
const MAX_MANIFEST_BYTES = 2 * 1024 * 1024;
const MAX_RESOURCE_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_RESOURCE_BYTES = 16 * 1024 * 1024;
const MAX_RESOURCES = 512;
const DEFAULT_TTL_SECONDS = 15 * 60;
const MIN_TTL_SECONDS = 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

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

const canonicalStringify = (value) => JSON.stringify(canonicalize(value));

const sha256 = (cryptoImpl, value) => `sha256-${cryptoImpl.createHash('sha256').update(value).digest('base64')}`;

const safeRelativePath = (value) => {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) return null;
  const normalized = nodePath.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) return null;
  return normalized;
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
  const initialPermissions = normalizeHostedPermissions(manifest.delivery.initialPermissions ?? {});
  return {
    type: 'hosted',
    manifestUrl,
    ttlSeconds,
    updatePolicy: 'permission-stable',
    minimumRuntimeVersion: typeof manifest.delivery.minimumRuntimeVersion === 'string'
      ? manifest.delivery.minimumRuntimeVersion.trim()
      : undefined,
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
  const merged = {
    ...declared,
    resourceOrigins: [...new Set([...declared.resourceOrigins, ...resourceOrigins])].sort(),
    networkOrigins: [...new Set([...declared.networkOrigins, ...extensionNetwork])].sort(),
    actionIds: [...new Set([...declared.actionIds, ...actionIds])].sort(),
    agentToolNames: [...new Set([...declared.agentToolNames, ...agentToolNames])].sort(),
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
    if (!path || path === 'openchamber.extension.json' || seen.has(path)) {
      throw new HostedOcixError('Hosted resource path is invalid or duplicated', 'invalid_hosted_resource');
    }
    seen.add(path);
    if (!SHA256_PATTERN.test(resource.sha256 ?? '')
      || typeof resource.mimeType !== 'string'
      || !resource.mimeType.trim()) {
      throw new HostedOcixError(`Hosted resource metadata is invalid: ${path}`, 'invalid_hosted_resource');
    }
    const url = normalizeHttpsUrl(resource.url, `Hosted resource ${path}`).toString();
    return { path, url, mimeType: resource.mimeType.trim(), sha256: resource.sha256 };
  });
  const permissions = derivePermissions(document, resources);
  return {
    extensionId,
    version: document.app.version,
    publishedAt: document.app.publishedAt,
    extension: canonicalize(document.extension),
    resources,
    permissions,
    manifestHash: sha256(cryptoImpl, Buffer.from(canonicalStringify(document))),
  };
};

const readResponseBytes = async (response, limit, label) => {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > limit) {
    throw new HostedOcixError(`${label} exceeds its size limit`, 'hosted_payload_too_large', 413);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > limit) {
    throw new HostedOcixError(`${label} exceeds its size limit`, 'hosted_payload_too_large', 413);
  }
  return bytes;
};

export const fetchHostedOcixManifest = async ({
  manifestUrl,
  fetchImpl = globalThis.fetch,
}) => {
  const requested = normalizeHttpsUrl(manifestUrl, 'Hosted manifest URL');
  let response;
  try {
    response = await fetchImpl(requested, {
      headers: { Accept: 'application/vnd.openchamber.hosted-ocix+json, application/json' },
      signal: AbortSignal.timeout(15_000),
      redirect: 'follow',
    });
  } catch {
    throw new HostedOcixError('Hosted manifest request failed', 'hosted_manifest_unavailable', 502);
  }
  if (!response.ok) {
    throw new HostedOcixError(
      `Hosted manifest request failed (${response.status})`,
      'hosted_manifest_unavailable',
      502,
    );
  }
  if (response.url && new URL(response.url).origin !== requested.origin) {
    throw new HostedOcixError(
      'Hosted manifest redirected to a different origin',
      'hosted_manifest_origin_changed',
      403,
    );
  }
  const bytes = await readResponseBytes(response, MAX_MANIFEST_BYTES, 'Hosted manifest');
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new HostedOcixError('Hosted manifest is not valid JSON', 'invalid_hosted_manifest', 502);
  }
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
  const destination = pathImpl.join(cacheDirectory, verified.extensionId, verified.version);
  const staging = pathImpl.join(cacheDirectory, '.staging', cryptoImpl.randomUUID());
  let total = 0;
  try {
    await fsImpl.mkdir(staging, { recursive: true, mode: 0o700 });
    for (const resource of verified.resources) {
      let response;
      try {
        response = await fetchImpl(resource.url, {
          headers: { Accept: resource.mimeType },
          signal: AbortSignal.timeout(15_000),
          redirect: 'follow',
        });
      } catch {
        throw new HostedOcixError(
          `Hosted resource request failed: ${resource.path}`,
          'hosted_resource_unavailable',
          502,
        );
      }
      if (!response.ok || new URL(response.url || resource.url).origin !== new URL(resource.url).origin) {
        throw new HostedOcixError(
          `Hosted resource request failed or redirected across origins: ${resource.path}`,
          'hosted_resource_unavailable',
          502,
        );
      }
      const bytes = await readResponseBytes(response, MAX_RESOURCE_BYTES, `Hosted resource ${resource.path}`);
      total += bytes.length;
      if (total > MAX_TOTAL_RESOURCE_BYTES) {
        throw new HostedOcixError('Hosted resources exceed the total size limit', 'hosted_payload_too_large', 413);
      }
      if (sha256(cryptoImpl, bytes) !== resource.sha256) {
        throw new HostedOcixError(
          `Hosted resource integrity check failed: ${resource.path}`,
          'hosted_resource_integrity_failed',
          403,
        );
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
