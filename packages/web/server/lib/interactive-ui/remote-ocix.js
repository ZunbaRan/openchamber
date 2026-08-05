import nodeCrypto from 'node:crypto';
import { normalizeEd25519PublicKey, publicKeyFingerprint } from './package-format.js';
import {
  HOSTED_OCIX_MANIFEST_SCHEMA,
  HostedOcixError,
  fetchHostedOcixManifest,
  verifyHostedOcixManifest,
} from './hosted-ocix.js';

// Remote OCIX is the product main path on top of the Hosted OCIX kernel: the
// v1 appEntryUrl is a direct signed Hosted OCIX Manifest URL and the manifest
// carries the publisher envelope INSIDE the signed payload. There is no
// parallel unsigned protocol and no connect handshake indirection.
//
// A directly connected remote manifest must contain:
//   publisher: { id, name, keyId, publicKey }
// The manifest signature is verified with this embedded Ed25519 public key,
// the key is normalized with the existing package-format helpers, and the
// fingerprint is derived locally. A fingerprint string from the server is
// never trusted. The signature keyId must match publisher.keyId.

const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BLOCKED_KEY_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const HOSTED_TOOL_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
const RESERVED_TOOL_NAMES = new Set([
  'apply_patch', 'bash', 'edit', 'glob', 'grep', 'html_artifact', 'interactive_ui',
  'list', 'read', 'skill', 'task', 'todo', 'webfetch', 'write',
]);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

// Pure hosted Agent Runtime surface-tool binding constraints shared by the
// Remote preflight and by installHostedAgentRuntime/createHostedCacheIntegrity:
// valid tool name pattern, reserved OpenCode built-in names, and
// duplicate/cross-surface conflicts. Throws the stable invalid_hosted_agent_tool
// code before any trust, staging, Manager state, Agent Runtime, or Secret
// Store write when called from preflight.
export const hostedSurfaceBindings = (extension) => {
  const bindings = new Map();
  for (const [kind, surfaces] of [
    ['view', Array.isArray(extension?.views) ? extension.views : []],
    ['artifact', Array.isArray(extension?.artifacts) ? extension.artifacts : []],
  ]) {
    for (const surface of surfaces) {
      if (!isRecord(surface) || typeof surface.id !== 'string') continue;
      for (const name of Array.isArray(surface.tools) ? surface.tools : []) {
        if (typeof name !== 'string'
          || !HOSTED_TOOL_NAME_PATTERN.test(name)
          || RESERVED_TOOL_NAMES.has(name)) {
          throw new HostedOcixError(
            `Hosted surface ${surface.id} declares an invalid or reserved Agent Tool`,
            'invalid_hosted_agent_tool',
            400,
          );
        }
        const existing = bindings.get(name);
        if (existing && (existing.surfaceId !== surface.id || existing.kind !== kind)) {
          throw new HostedOcixError(
            `Hosted Agent Tool ${name} is bound to more than one surface`,
            'invalid_hosted_agent_tool',
            400,
          );
        }
        bindings.set(name, {
          name,
          kind,
          surfaceId: surface.id,
          title: typeof surface.title === 'string' && surface.title.trim()
            ? surface.title.trim()
            : surface.id,
          defaultContext: isRecord(surface.dashboard?.defaultContext)
            ? JSON.parse(JSON.stringify(surface.dashboard.defaultContext))
            : {},
        });
      }
    }
  }
  return [...bindings.values()];
};

/**
 * Verifies a remote signed Hosted OCIX manifest whose signed payload embeds
 * the publisher envelope. Reuses the existing Hosted OCIX manifest schema,
 * permission derivation, signature verification, and URL policy. Returns the
 * verified Hosted OCIX result plus the locally derived publisher identity.
 *
 * Rejects before any write: malformed/unsigned manifest, invalid embedded
 * key, keyId mismatch, signature failure, extension identity mismatch.
 */
export const verifyRemoteOcixManifest = ({
  document,
  cryptoImpl = nodeCrypto,
}) => {
  if (!isRecord(document)
    || document.$schema !== HOSTED_OCIX_MANIFEST_SCHEMA
    || !isRecord(document.publisher)
    || !ID_PATTERN.test(document.publisher.id ?? '')
    || typeof document.publisher.name !== 'string'
    || !document.publisher.name.trim()
    || !KEY_ID_PATTERN.test(document.publisher.keyId ?? '')
    || BLOCKED_KEY_IDS.has(document.publisher.keyId)
    || typeof document.publisher.publicKey !== 'string'
    || !document.publisher.publicKey.trim()) {
    throw new HostedOcixError(
      'Remote manifest publisher envelope is invalid',
      'invalid_hosted_manifest',
    );
  }
  if (!isRecord(document.signature) || document.signature.algorithm !== 'ed25519') {
    throw new HostedOcixError(
      'Remote manifest signature is missing or invalid',
      'invalid_hosted_manifest',
    );
  }
  if (document.signature.keyId !== document.publisher.keyId) {
    throw new HostedOcixError(
      'Remote manifest signing identity does not match its publisher envelope',
      'hosted_signature_identity_mismatch',
      403,
    );
  }
  let publicKey;
  let fingerprint;
  try {
    publicKey = normalizeEd25519PublicKey(document.publisher.publicKey, cryptoImpl);
    fingerprint = publicKeyFingerprint(publicKey, cryptoImpl);
  } catch {
    throw new HostedOcixError(
      'Remote publisher public key is invalid',
      'invalid_hosted_publisher_key',
      403,
    );
  }
  const extensionId = document.app?.id;
  const verified = verifyHostedOcixManifest({
    document,
    extensionId,
    publisherKeyId: document.publisher.keyId,
    publisherPublicKey: publicKey,
    cryptoImpl,
  });
  return {
    ...verified,
    publisher: {
      id: document.publisher.id,
      name: document.publisher.name.trim(),
      keyId: document.publisher.keyId,
      publicKey,
      fingerprint,
    },
  };
};

/**
 * Fetches and verifies a remote signed Hosted OCIX manifest from its
 * appEntryUrl. The fetch reuses the Hosted manifest transport: HTTPS only
 * (loopback HTTP exception), no credentials/fragments, cross-origin redirects
 * rejected, bounded size, JSON only.
 */
export const fetchRemoteOcixManifest = async ({
  appEntryUrl,
  fetchImpl = globalThis.fetch,
  cryptoImpl = nodeCrypto,
}) => {
  const document = await fetchHostedOcixManifest({
    manifestUrl: appEntryUrl,
    fetchImpl,
  });
  return verifyRemoteOcixManifest({ document, cryptoImpl });
};

const connectorOrigin = (connector) => {
  if (!isRecord(connector) || typeof connector.baseUrl !== 'string' || !connector.baseUrl) return '';
  try {
    return new URL(connector.baseUrl).origin;
  } catch {
    return '';
  }
};

/**
 * Phase R1 supports exactly one connector and it must use auth.type
 * "api-key". Zero or multiple eligible connectors are rejected with stable
 * actionable error codes before any trust or install write.
 */
export const selectRemoteConnector = (extension) => {
  const connectors = Array.isArray(extension?.connectors) ? extension.connectors : [];
  if (connectors.length === 0
    || (connectors.length === 1 && connectors[0]?.auth?.type !== 'api-key')) {
    throw new HostedOcixError(
      'Remote app must declare exactly one api-key connector; connect is not supported',
      'remote_connector_required',
      409,
    );
  }
  if (connectors.length !== 1) {
    throw new HostedOcixError(
      'Remote app declares multiple connectors; connect is not supported',
      'remote_connector_ambiguous',
      409,
    );
  }
  const connector = connectors[0];
  if (!isRecord(connector) || typeof connector.id !== 'string' || !connector.id) {
    throw new HostedOcixError(
      'Remote app connector id is invalid',
      'remote_connector_required',
      409,
    );
  }
  return {
    id: connector.id,
    origin: connectorOrigin(connector),
    authType: 'api-key',
  };
};
