const STORE_SCHEMA = 'openchamber://connection-store/v2';
const LEGACY_STORE_SCHEMA = 'openchamber://connection-secret-store/v1';
const PROVISION_REQUEST_SCHEMA = 'openchamber://credential-request/v1';
const PROVISION_RESPONSE_SCHEMA = 'openchamber://credential-response/v1';
const MAX_ACCESS_KEY_LENGTH = 16 * 1024;
const MAX_SETUP_CODE_LENGTH = 8 * 1024;
const MAX_PROVISION_RESPONSE_BYTES = 64 * 1024;
const PROVISION_TIMEOUT_MS = 15_000;
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const CONNECTOR_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const MAX_CONNECTION_NAME_LENGTH = 200;
const MAX_ENDPOINT_LENGTH = 4 * 1024;
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_VALUE_LENGTH = 8 * 1024;
const MAX_INSTALLATION_ID_LENGTH = 128;
const HEADER_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9-]{0,63}$/;
const BLOCKED_HEADERS = new Set([
  'connection',
  'content-length',
  'cookie',
  'host',
  'origin',
  'proxy-authorization',
  'set-cookie',
  'transfer-encoding',
]);

export class InteractiveUIConnectionError extends Error {
  constructor(message, status = 400, code = 'connection_error', details = undefined) {
    super(message);
    this.name = 'InteractiveUIConnectionError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const emptyStore = () => ({ $schema: STORE_SCHEMA, connections: {} });
const recordKey = (extensionId, connectorId) => `${extensionId}:${connectorId}`;

const assertIdentity = (extensionId, connectorId) => {
  if (typeof extensionId !== 'string' || !ID_PATTERN.test(extensionId)) {
    throw new InteractiveUIConnectionError('Extension id is invalid', 400, 'invalid_extension_id');
  }
  if (typeof connectorId !== 'string' || !CONNECTOR_ID_PATTERN.test(connectorId)) {
    throw new InteractiveUIConnectionError('Connector id is invalid', 400, 'invalid_connector_id');
  }
};

// Installation ids are opaque non-empty strings bound to one Remote connect
// operation. They are never exposed through summaries/status/list responses;
// only exact equality against the stored record matters.
const assertInstallationId = (value) => {
  if (typeof value !== 'string'
    || value.length === 0
    || value.length > MAX_INSTALLATION_ID_LENGTH
    || /[\r\n\0]/.test(value)) {
    throw new InteractiveUIConnectionError('Connection installation id is invalid', 400, 'invalid_installation_id');
  }
  return value;
};

const normalizeSecret = (value, label, maximumLength) => {
  if (typeof value !== 'string' || !value.trim()) {
    throw new InteractiveUIConnectionError(`${label} is required`, 400, 'credential_required');
  }
  const normalized = value.trim();
  if (normalized.length > maximumLength || /[\r\n\0]/.test(normalized)) {
    throw new InteractiveUIConnectionError(`${label} is invalid`, 400, 'invalid_credential');
  }
  return normalized;
};

// Opaque Remote access-key contract. Remote keys are exact strings: ordinary
// leading/trailing spaces are valid credential material and MUST be preserved
// byte-for-byte/code-unit-for-code-unit — no trim, no Unicode normalization,
// no coercion. Only length and unsafe C0/DEL control characters are rejected
// with a stable sanitized 400. This is the SINGLE validator used by both the
// Remote connect route (before any Manager write) and setRemoteCredential, so
// the two can never drift.
const UNSAFE_ACCESS_KEY_CONTROL = /[\u0000-\u001F\u007F]/;
export const validateRemoteAccessKey = (value) => {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InteractiveUIConnectionError('Remote app access key is required', 400, 'remote_access_key_required');
  }
  if (value.length > MAX_ACCESS_KEY_LENGTH) {
    throw new InteractiveUIConnectionError('Remote app access key is too long', 400, 'remote_access_key_invalid');
  }
  if (UNSAFE_ACCESS_KEY_CONTROL.test(value)) {
    throw new InteractiveUIConnectionError('Remote app access key contains unsafe control characters', 400, 'remote_access_key_invalid');
  }
  return value;
};

const normalizeExpiresAt = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') {
    throw new InteractiveUIConnectionError('Credential expiry is invalid', 502, 'invalid_credential_response');
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || timestamp <= Date.now()) {
    throw new InteractiveUIConnectionError('Provisioned credential is already expired', 502, 'invalid_credential_response');
  }
  return new Date(timestamp).toISOString();
};

const normalizeOptionalName = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_CONNECTION_NAME_LENGTH) {
    throw new InteractiveUIConnectionError('Connection name is invalid', 400, 'invalid_connection_name');
  }
  return value.trim();
};

const normalizeOptionalEndpoint = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > MAX_ENDPOINT_LENGTH) {
    throw new InteractiveUIConnectionError('Connection endpoint is invalid', 400, 'invalid_connection_endpoint');
  }
  let endpoint;
  try {
    endpoint = new URL(value.trim());
  } catch {
    throw new InteractiveUIConnectionError('Connection endpoint must be an absolute HTTP(S) URL', 400, 'invalid_connection_endpoint');
  }
  if (!['http:', 'https:'].includes(endpoint.protocol) || endpoint.username || endpoint.password) {
    throw new InteractiveUIConnectionError('Connection endpoint must use HTTP(S) without embedded credentials', 400, 'invalid_connection_endpoint');
  }
  return endpoint.toString();
};

const normalizeOptionalHeaders = (value) => {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value) || Object.keys(value).length > MAX_HEADER_COUNT) {
    throw new InteractiveUIConnectionError('Connection headers are invalid', 400, 'invalid_connection_headers');
  }
  const headers = {};
  for (const [rawName, rawValue] of Object.entries(value)) {
    const name = rawName.trim();
    if (!HEADER_NAME_PATTERN.test(name)
      || BLOCKED_HEADERS.has(name.toLowerCase())
      || name.toLowerCase().startsWith('x-openchamber-')
      || typeof rawValue !== 'string'
      || rawValue.length > MAX_HEADER_VALUE_LENGTH
      || /[\r\n\0]/.test(rawValue)) {
      throw new InteractiveUIConnectionError('Connection headers are invalid', 400, 'invalid_connection_headers');
    }
    headers[name] = rawValue;
  }
  return headers;
};

const validateStoredRecord = (record, key) => {
  if (!isRecord(record) || recordKey(record.extensionId, record.connectorId) !== key
    || typeof record.accessKey !== 'string' || !record.accessKey
    || !['manual', 'provisioned'].includes(record.source)
    || typeof record.configuredAt !== 'string' || typeof record.installationId !== 'string') {
    throw new InteractiveUIConnectionError('Connection secret store is invalid', 500, 'connection_store_corrupt');
  }
  normalizeOptionalName(record.name);
  normalizeOptionalEndpoint(record.endpoint);
  normalizeOptionalHeaders(record.headers);
};

const responseBytes = async (response) => {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_PROVISION_RESPONSE_BYTES) {
    throw new InteractiveUIConnectionError('Credential response exceeds the size limit', 502, 'credential_response_too_large');
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length > MAX_PROVISION_RESPONSE_BYTES) {
    throw new InteractiveUIConnectionError('Credential response exceeds the size limit', 502, 'credential_response_too_large');
  }
  return bytes;
};

export const createInteractiveUIConnectionStore = ({
  dataDirectory,
  fsImpl,
  pathImpl,
  cryptoImpl,
  fetchImpl = globalThis.fetch,
} = {}) => {
  if (typeof dataDirectory !== 'string' || !dataDirectory.trim() || !fsImpl || !pathImpl || !cryptoImpl || typeof fetchImpl !== 'function') {
    throw new Error('Interactive UI connection store dependencies are incomplete');
  }
  const directory = pathImpl.join(pathImpl.resolve(dataDirectory), 'interactive-ui');
  const storePath = pathImpl.join(directory, 'connection-secrets.json');
  let mutationQueue = Promise.resolve();

  const mutate = (operation) => {
    const pending = mutationQueue.then(operation, operation);
    mutationQueue = pending.catch(() => {});
    return pending;
  };

  const readStore = async () => {
    let store;
    try {
      store = JSON.parse(await fsImpl.readFile(storePath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return emptyStore();
      throw new InteractiveUIConnectionError('Connection secret store is unreadable', 500, 'connection_store_corrupt');
    }
    if (!isRecord(store) || ![STORE_SCHEMA, LEGACY_STORE_SCHEMA].includes(store.$schema) || !isRecord(store.connections)) {
      throw new InteractiveUIConnectionError('Connection secret store is invalid', 500, 'connection_store_corrupt');
    }
    for (const [key, record] of Object.entries(store.connections)) validateStoredRecord(record, key);
    return store.$schema === STORE_SCHEMA ? store : { ...store, $schema: STORE_SCHEMA };
  };

  const writeStore = async (store) => {
    await fsImpl.mkdir(directory, { recursive: true, mode: 0o700 });
    const temporaryPath = `${storePath}.${cryptoImpl.randomUUID()}.tmp`;
    try {
      await fsImpl.writeFile(temporaryPath, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fsImpl.rename(temporaryPath, storePath);
    } catch (error) {
      await fsImpl.rm(temporaryPath, { force: true }).catch(() => {});
      throw error;
    }
  };

  const getRecord = async (extensionId, connectorId) => {
    assertIdentity(extensionId, connectorId);
    return (await readStore()).connections[recordKey(extensionId, connectorId)] ?? null;
  };

  const summarize = (record) => {
    if (!record) return { configured: false, expired: false };
    const expired = typeof record.expiresAt === 'string' && Date.parse(record.expiresAt) <= Date.now();
    return {
      configured: !expired,
      expired,
      source: record.source,
      configuredAt: record.configuredAt,
      expiresAt: record.expiresAt ?? null,
      displayName: record.displayName ?? null,
      name: record.name ?? null,
      endpoint: record.endpoint ?? null,
      headerNames: Object.keys(record.headers ?? {}),
    };
  };

  const getStatus = async (extensionId, connectorId) => summarize(await getRecord(extensionId, connectorId));

  const resolveCredential = async (extensionId, connectorId) => {
    const record = await getRecord(extensionId, connectorId);
    if (!record) return null;
    if (typeof record.expiresAt === 'string' && Date.parse(record.expiresAt) <= Date.now()) {
      throw new InteractiveUIConnectionError('Connector credential is expired', 503, 'credential_expired');
    }
    return { accessKey: record.accessKey };
  };

  const getConfiguration = async (extensionId, connectorId) => {
    const record = await getRecord(extensionId, connectorId);
    if (!record) return null;
    if (typeof record.expiresAt === 'string' && Date.parse(record.expiresAt) <= Date.now()) {
      throw new InteractiveUIConnectionError('Connector credential is expired', 503, 'credential_expired');
    }
    return {
      accessKey: record.accessKey,
      endpoint: record.endpoint ?? null,
      name: record.name ?? null,
      headers: { ...(record.headers ?? {}) },
    };
  };

  const setManualCredential = (extensionId, connectorId, input) => mutate(async () => {
    assertIdentity(extensionId, connectorId);
    const store = await readStore();
    const key = recordKey(extensionId, connectorId);
    const existing = store.connections[key];
    const options = isRecord(input) ? input : { accessKey: input };
    const rawAccessKey = options.accessKey === undefined || options.accessKey === null || options.accessKey === ''
      ? existing?.accessKey
      : options.accessKey;
    const record = {
      extensionId,
      connectorId,
      accessKey: normalizeSecret(rawAccessKey, 'Access key', MAX_ACCESS_KEY_LENGTH),
      source: 'manual',
      configuredAt: new Date().toISOString(),
      installationId: existing?.installationId ?? cryptoImpl.randomUUID(),
      ...(options.name === undefined && existing?.name
        ? { name: existing.name }
        : normalizeOptionalName(options.name) ? { name: normalizeOptionalName(options.name) } : {}),
      ...(options.endpoint === undefined && existing?.endpoint
        ? { endpoint: existing.endpoint }
        : normalizeOptionalEndpoint(options.endpoint) ? { endpoint: normalizeOptionalEndpoint(options.endpoint) } : {}),
      ...(options.headers === undefined && existing?.headers
        ? { headers: existing.headers }
        : normalizeOptionalHeaders(options.headers) ? { headers: normalizeOptionalHeaders(options.headers) } : {}),
    };
    store.connections[key] = record;
    await writeStore(store);
    return summarize(record);
  });

  const provisionCredential = (extensionId, connector, setupCode) => mutate(async () => {
    assertIdentity(extensionId, connector?.id);
    if (connector?.auth?.type !== 'issued-key' || typeof connector.auth.provisioningUrl !== 'string') {
      throw new InteractiveUIConnectionError('Connector does not support credential provisioning', 409, 'provisioning_unsupported');
    }
    const normalizedSetupCode = normalizeSecret(setupCode, 'Setup code', MAX_SETUP_CODE_LENGTH);
    const store = await readStore();
    const key = recordKey(extensionId, connector.id);
    const installationId = store.connections[key]?.installationId ?? cryptoImpl.randomUUID();
    let response;
    try {
      response = await fetchImpl(connector.auth.provisioningUrl, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          $schema: PROVISION_REQUEST_SCHEMA,
          extensionId,
          connectorId: connector.id,
          installationId,
          setupCode: normalizedSetupCode,
        }),
        signal: AbortSignal.timeout(PROVISION_TIMEOUT_MS),
      });
    } catch (error) {
      const timeout = error?.name === 'TimeoutError';
      throw new InteractiveUIConnectionError(
        timeout ? 'Credential provisioning timed out' : 'Credential provisioning request failed',
        502,
        timeout ? 'credential_provisioning_timeout' : 'credential_provisioning_unavailable',
      );
    }
    if (!response.ok) {
      throw new InteractiveUIConnectionError(
        `Credential issuer rejected the request (${response.status})`,
        response.status >= 400 && response.status < 500 ? response.status : 502,
        'credential_provisioning_rejected',
      );
    }
    let payload;
    try {
      payload = JSON.parse((await responseBytes(response)).toString('utf8'));
    } catch (error) {
      if (error instanceof InteractiveUIConnectionError) throw error;
      throw new InteractiveUIConnectionError('Credential issuer returned invalid JSON', 502, 'invalid_credential_response');
    }
    if (!isRecord(payload) || payload.$schema !== PROVISION_RESPONSE_SCHEMA || payload.credentialType !== 'api-key') {
      throw new InteractiveUIConnectionError('Credential issuer returned an unsupported response', 502, 'invalid_credential_response');
    }
    const displayName = isRecord(payload.display) && typeof payload.display.name === 'string' && payload.display.name.trim()
      ? payload.display.name.trim().slice(0, 200)
      : undefined;
    const expiresAt = normalizeExpiresAt(payload.expiresAt);
    const record = {
      extensionId,
      connectorId: connector.id,
      accessKey: normalizeSecret(payload.accessKey, 'Provisioned access key', MAX_ACCESS_KEY_LENGTH),
      source: 'provisioned',
      configuredAt: new Date().toISOString(),
      installationId,
      ...(expiresAt ? { expiresAt } : {}),
      ...(displayName ? { displayName } : {}),
    };
    store.connections[key] = record;
    await writeStore(store);
    return summarize(record);
  });

  const removeCredential = (extensionId, connectorId) => mutate(async () => {
    assertIdentity(extensionId, connectorId);
    const store = await readStore();
    const key = recordKey(extensionId, connectorId);
    if (!store.connections[key]) return { removed: false };
    delete store.connections[key];
    await writeStore(store);
    return { removed: true };
  });

  // Remote connect credentials are bound to the installationId of the connect
  // operation that created them. The setter refuses to overwrite a record that
  // belongs to a DIFFERENT installation, and the conditional remover deletes
  // only the record of the exact installation that requests cleanup. This
  // keeps a stale connect's failure path from deleting a replacement
  // credential that a later connect stored for the same extension/connector.
  const setRemoteCredential = (extensionId, connectorId, installationId, accessKey) => mutate(async () => {
    assertIdentity(extensionId, connectorId);
    const normalizedInstallationId = assertInstallationId(installationId);
    const store = await readStore();
    const key = recordKey(extensionId, connectorId);
    const existing = store.connections[key];
    if (existing && existing.installationId !== normalizedInstallationId) {
      throw new InteractiveUIConnectionError(
        'Connection belongs to a different Remote installation',
        409,
        'remote_installation_conflict',
      );
    }
    const record = {
      extensionId,
      connectorId,
      accessKey: validateRemoteAccessKey(accessKey),
      source: 'manual',
      configuredAt: new Date().toISOString(),
      installationId: normalizedInstallationId,
    };
    store.connections[key] = record;
    await writeStore(store);
    return summarize(record);
  });

  const removeRemoteCredential = (extensionId, connectorId, installationId) => mutate(async () => {
    assertIdentity(extensionId, connectorId);
    const normalizedInstallationId = assertInstallationId(installationId);
    const store = await readStore();
    const key = recordKey(extensionId, connectorId);
    const record = store.connections[key];
    if (!record) return { removed: false };
    if (record.installationId !== normalizedInstallationId) {
      // Non-sensitive indicator only: the actual ids are never exposed.
      return { removed: false, mismatch: true };
    }
    delete store.connections[key];
    await writeStore(store);
    return { removed: true };
  });

  const removeExtensionCredentials = (extensionId) => mutate(async () => {
    if (typeof extensionId !== 'string' || !ID_PATTERN.test(extensionId)) {
      throw new InteractiveUIConnectionError('Extension id is invalid', 400, 'invalid_extension_id');
    }
    const store = await readStore();
    let removed = 0;
    for (const [key, record] of Object.entries(store.connections)) {
      if (record.extensionId !== extensionId) continue;
      delete store.connections[key];
      removed += 1;
    }
    if (removed > 0) await writeStore(store);
    return { removed };
  });

  return {
    getStatus,
    getConfiguration,
    resolveCredential,
    setManualCredential,
    setRemoteCredential,
    provisionCredential,
    removeCredential,
    removeRemoteCredential,
    removeExtensionCredentials,
  };
};
