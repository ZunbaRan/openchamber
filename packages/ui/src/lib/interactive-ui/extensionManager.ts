import type { I18nKey } from '@/lib/i18n';

export interface InstalledVersion {
  version: string;
  installedAt: string;
  packageHash: string;
  source: { type: string; marketplaceId?: string; appEntryUrl?: string };
  publisher: { id: string; name: string; keyId: string; fingerprint: string };
  agentRuntime: AgentRuntimeSummary;
  delivery: 'local' | 'hosted' | 'remote';
  hosted?: {
    manifestUrl: string;
    lastGoodVersion?: string;
    pendingManifestHash?: string;
    lastErrorCode?: string;
  };
  remote?: {
    appEntryUrl: string;
    connectorIds: string[];
    acceptedManifestVersion?: string;
    acceptedManifestHash?: string;
    status?: string;
    lifecycle?: RemoteLifecycle;
    blocked?: RemoteBlockedSummary | null;
  };
}

export interface AgentRuntimeSummary {
  tools: Array<{ name: string; entry: string }>;
  skills: Array<{ name: string; entry: string; files: string[] }>;
  unresolvedViewTools: string[];
  unresolvedSurfaceTools: string[];
}

export interface PackageInspection {
  extension: { id: string; name: string; version: string };
  publisher: { id: string; name: string; keyId: string; fingerprint: string; trusted: boolean };
  permissions: { network: string[]; nativeCode: boolean; sandboxedArtifacts: boolean };
  agentRouting: {
    domain: string;
    intents: string[];
    dataAuthority: string;
    views: Array<{ id: string; tools: string[] }>;
    artifacts: Array<{ id: string; tools: string[] }>;
  } | null;
  agentRuntime: AgentRuntimeSummary;
  delivery: 'local' | 'hosted';
  hosted?: {
    manifestUrl: string;
    ttlSeconds: number;
    manifestHash: string;
    version: string;
    publishedAt: string;
    permissions: HostedPermissions;
  };
}

export interface HostedPermissions {
  resourceOrigins: string[];
  networkOrigins: string[];
  externalLinkOrigins: string[];
  credentialScopes: string[];
  actionIds: string[];
  agentToolNames: string[];
  clipboard: boolean;
  popups: boolean;
  nativeCode: boolean;
}

export interface RemoteConnectorBinding {
  id: string;
  origin: string;
  authType: 'api-key';
}

export interface RemoteInspection {
  extension: { id: string; name: string; version: string };
  publisher: { id: string; name: string; keyId: string; fingerprint: string; trusted: boolean };
  permissions: HostedPermissions;
  manifest: { appEntryUrl: string; manifestHash: string; publishedAt: string };
  connector: RemoteConnectorBinding;
}

export interface RemoteConnectResult {
  extension: { id: string; name: string; version: string };
  connector: RemoteConnectorBinding;
  credential: {
    configured: boolean;
    expired: boolean;
    source?: string;
    configuredAt?: string;
  };
}

export interface MarketplaceInspection {
  id: string;
  name: string;
  keyId: string;
  catalogUrl: string;
  fingerprint: string;
  extensionCount: number;
}

export interface InstalledExtension {
  id: string;
  name: string;
  enabled: boolean;
  activeVersion: string;
  activationHistory: string[];
  versions: Record<string, InstalledVersion>;
  integrity: {
    status: 'ready' | 'unavailable' | 'failed' | 'unknown';
    code?: string;
  };
}

export interface TrustedPublisher {
  id: string;
  name: string;
  keys: Array<{ keyId: string; fingerprint: string; source: string; trustedAt: string }>;
}

export interface Marketplace {
  id: string;
  name: string;
  keyId: string;
  catalogUrl: string;
  fingerprint: string;
}

export interface CatalogEntry {
  id: string;
  name: string;
  version: string;
  publisher: { id: string; name: string; keyId: string };
}

type CatalogInstallState = 'available' | 'installed' | 'update' | 'older';

const compareSemver = (left: string, right: string): number => {
  const parse = (value: string) => {
    const [core, prerelease = ''] = value.split('-', 2);
    return { core: core.split('.').map((part) => Number(part)), prerelease: prerelease.split('.').filter(Boolean) };
  };
  const leftVersion = parse(left);
  const rightVersion = parse(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (leftVersion.core[index] ?? 0) - (rightVersion.core[index] ?? 0);
    if (delta !== 0) return delta;
  }
  if (leftVersion.prerelease.length === 0 || rightVersion.prerelease.length === 0) {
    if (leftVersion.prerelease.length === rightVersion.prerelease.length) return 0;
    return leftVersion.prerelease.length === 0 ? 1 : -1;
  }
  for (let index = 0; index < Math.max(leftVersion.prerelease.length, rightVersion.prerelease.length); index += 1) {
    const leftPart = leftVersion.prerelease[index];
    const rightPart = rightVersion.prerelease[index];
    if (leftPart === rightPart) continue;
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    const leftNumber = Number(leftPart);
    const rightNumber = Number(rightPart);
    const leftNumeric = Number.isSafeInteger(leftNumber) && String(leftNumber) === leftPart;
    const rightNumeric = Number.isSafeInteger(rightNumber) && String(rightNumber) === rightPart;
    if (leftNumeric && rightNumeric) return leftNumber - rightNumber;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart.localeCompare(rightPart);
  }
  return 0;
};

export const classifyCatalogInstallState = (catalogVersion: string, installedVersion?: string): CatalogInstallState => {
  if (!installedVersion) return 'available';
  const comparison = compareSemver(catalogVersion, installedVersion);
  if (comparison === 0) return 'installed';
  return comparison > 0 ? 'update' : 'older';
};

type ConnectionAuthType = 'none' | 'env-bearer' | 'api-key' | 'issued-key';
export type ConnectionHealthStatus = 'unknown' | 'reachable' | 'unreachable' | 'unauthorized' | 'forbidden';

export type RemoteLifecycleStatus = 'none' | 'available' | 'required';
export type RemoteLifecycleHealthStatus = 'unknown' | 'reachable' | 'unreachable' | 'trust_invalid';
export type RemotePermissionDelta = 'none' | 'expanded' | 'reduced';

// Safe Remote lifecycle summary: never accepts or exposes public keys,
// signed documents, installation ids, credentials, or internal paths.
export interface RemoteLifecycle {
  status: RemoteLifecycleStatus;
  currentVersion: string;
  currentManifestHash: string;
  remoteVersion: string | null;
  remoteManifestHash: string | null;
  changeSummary: string | null;
  permissionDelta: RemotePermissionDelta;
  addedPermissions: Partial<HostedPermissions> | null;
  keyChanged: boolean;
  requiresUserConfirmation: boolean;
  publisherFingerprint: string | null;
  health: {
    status: RemoteLifecycleHealthStatus;
    checkedAt: string | null;
    code?: string;
  };
  blocked?: {
    code: string;
    required?: boolean;
    version?: string;
    manifestHash?: string;
    reason?: string;
  };
  applied?: boolean;
}

export interface RemoteBlockedSummary {
  required: boolean;
  version?: string;
  manifestHash?: string;
  reason?: string;
  observedAt?: string;
}

export interface ManagedConnection {
  extension: { id: string; name: string; version: string };
  connector: {
    id: string;
    origin: string;
    endpoint?: string | null;
    authType: ConnectionAuthType;
    testable: boolean;
    configurable: boolean;
    provisionable: boolean;
  };
  credential: {
    configured: boolean;
    expired: boolean;
    source?: string;
    configuredAt?: string;
    expiresAt?: string | null;
    displayName?: string | null;
    name?: string | null;
    endpoint?: string | null;
    endpointConfigured?: boolean;
    endpointSource?: 'user' | 'environment' | 'manifest' | null;
    headerNames?: string[];
  };
  health: {
    status: ConnectionHealthStatus;
    checkedAt: string | null;
    code?: string;
  };
}

export interface ConnectionSnapshot {
  connections: ManagedConnection[];
}

export interface ManagerSnapshot {
  extensions: InstalledExtension[];
  publishers: TrustedPublisher[];
  marketplaces: Marketplace[];
}

export const EMPTY_MANAGER_SNAPSHOT: ManagerSnapshot = { extensions: [], publishers: [], marketplaces: [] };
export const EMPTY_CONNECTION_SNAPSHOT: ConnectionSnapshot = { connections: [] };

// Connector-test SAFE failure codes emitted by the server runtime's
// connection test (and invokeAction credential resolution): a "Check health &
// updates" health probe that fails with any of these is a RECOVERABLE health
// failure — the UI records/surfaces it, still calls the dedicated Remote
// update-check route (force:true) so update classification stays current, and
// refreshes. Unrelated/unsafe codes are never treated as recoverable health
// probe failures and route to the generic outer failure instead.
const REMOTE_HEALTH_PROBE_FAILURE_CODES = new Set([
  'connection_test_unsupported',
  'connector_unconfigured',
  'credential_expired',
  'credential_unavailable',
  'connector_unauthorized',
  'connector_forbidden',
  'connection_test_timeout',
  'upstream_unavailable',
  'upstream_error',
  'upstream_response_too_large',
]);

export const isRemoteHealthProbeFailureCode = (code: unknown): code is string => (
  typeof code === 'string' && REMOTE_HEALTH_PROBE_FAILURE_CODES.has(code)
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const stringValue = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;

const normalizeHostedPermissions = (value: unknown): HostedPermissions => {
  const permissions = isRecord(value) ? value : {};
  const strings = (entry: unknown) => Array.isArray(entry)
    ? entry.filter((item): item is string => typeof item === 'string')
    : [];
  return {
    resourceOrigins: strings(permissions.resourceOrigins),
    networkOrigins: strings(permissions.networkOrigins),
    externalLinkOrigins: strings(permissions.externalLinkOrigins),
    credentialScopes: strings(permissions.credentialScopes),
    actionIds: strings(permissions.actionIds),
    agentToolNames: strings(permissions.agentToolNames),
    clipboard: permissions.clipboard === true,
    popups: permissions.popups === true,
    nativeCode: permissions.nativeCode === true,
  };
};

const normalizeAgentRuntime = (value: unknown): AgentRuntimeSummary => {
  const runtime = isRecord(value) ? value : {};
  return {
    tools: Array.isArray(runtime.tools) ? runtime.tools.flatMap((tool) => (
      isRecord(tool) && typeof tool.name === 'string' && typeof tool.entry === 'string'
        ? [{ name: tool.name, entry: tool.entry }]
        : []
    )) : [],
    skills: Array.isArray(runtime.skills) ? runtime.skills.flatMap((skill) => (
      isRecord(skill) && typeof skill.name === 'string' && typeof skill.entry === 'string'
        ? [{
            name: skill.name,
            entry: skill.entry,
            files: Array.isArray(skill.files) ? skill.files.filter((file): file is string => typeof file === 'string') : [],
          }]
        : []
    )) : [],
    unresolvedViewTools: Array.isArray(runtime.unresolvedViewTools)
      ? runtime.unresolvedViewTools.filter((name): name is string => typeof name === 'string')
      : [],
    unresolvedSurfaceTools: Array.isArray(runtime.unresolvedSurfaceTools)
      ? runtime.unresolvedSurfaceTools.filter((name): name is string => typeof name === 'string')
      : Array.isArray(runtime.unresolvedViewTools)
        ? runtime.unresolvedViewTools.filter((name): name is string => typeof name === 'string')
        : [],
  };
};

const normalizeVersion = (value: unknown, fallbackVersion: string): InstalledVersion | null => {
  if (!isRecord(value)) return null;
  const version = stringValue(value.version, fallbackVersion);
  const publisher = isRecord(value.publisher) ? value.publisher : {};
  const source = isRecord(value.source) ? value.source : {};
  const hosted = isRecord(value.hosted) ? value.hosted : null;
  const lastGood = hosted && isRecord(hosted.lastGood) ? hosted.lastGood : null;
  const pendingUpdate = hosted && isRecord(hosted.pendingUpdate) ? hosted.pendingUpdate : null;
  const lastError = hosted && isRecord(hosted.lastError) ? hosted.lastError : null;
  const remote = isRecord(value.remote) ? value.remote : null;
  const remoteManifest = remote && isRecord(remote.acceptedManifest) ? remote.acceptedManifest : null;
  if (!version) return null;
  const delivery = value.delivery === 'hosted' || value.delivery === 'remote' ? value.delivery : 'local';
  return {
    version,
    installedAt: stringValue(value.installedAt),
    packageHash: stringValue(value.packageHash),
    source: {
      type: stringValue(source.type, 'unknown'),
      ...(typeof source.marketplaceId === 'string' ? { marketplaceId: source.marketplaceId } : {}),
      ...(typeof source.appEntryUrl === 'string' ? { appEntryUrl: source.appEntryUrl } : {}),
    },
    publisher: {
      id: stringValue(publisher.id),
      name: stringValue(publisher.name),
      keyId: stringValue(publisher.keyId),
      fingerprint: stringValue(publisher.fingerprint),
    },
    agentRuntime: normalizeAgentRuntime(value.agentRuntime),
    delivery,
    ...(hosted ? {
      hosted: {
        manifestUrl: stringValue(hosted.manifestUrl),
        ...(typeof lastGood?.version === 'string' ? { lastGoodVersion: lastGood.version } : {}),
        ...(typeof pendingUpdate?.manifestHash === 'string' ? { pendingManifestHash: pendingUpdate.manifestHash } : {}),
        ...(typeof lastError?.code === 'string' ? { lastErrorCode: lastError.code } : {}),
      },
    } : {}),
    ...(remote ? {
      remote: {
        appEntryUrl: stringValue(remote.appEntryUrl),
        connectorIds: Array.isArray(remote.connectorRefs)
          ? remote.connectorRefs.flatMap((ref) => (isRecord(ref) && typeof ref.id === 'string' ? [ref.id] : []))
          : [],
        ...(remoteManifest && typeof remoteManifest.version === 'string' ? { acceptedManifestVersion: remoteManifest.version } : {}),
        ...(remoteManifest && typeof remoteManifest.manifestHash === 'string' ? { acceptedManifestHash: remoteManifest.manifestHash } : {}),
        ...(typeof remote.status === 'string' ? { status: remote.status } : {}),
        ...(isRecord(remote.lifecycle) ? { lifecycle: normalizeRemoteLifecycle(remote.lifecycle) ?? undefined } : {}),
        ...(isRecord(remote.blocked) ? {
          blocked: {
            required: remote.blocked.required === true,
            ...(typeof remote.blocked.version === 'string' ? { version: remote.blocked.version } : {}),
            ...(typeof remote.blocked.manifestHash === 'string' ? { manifestHash: remote.blocked.manifestHash } : {}),
            ...(typeof remote.blocked.reason === 'string' ? { reason: remote.blocked.reason } : {}),
            ...(typeof remote.blocked.observedAt === 'string' ? { observedAt: remote.blocked.observedAt } : {}),
          },
        } : {}),
      },
    } : {}),
  };
};

export const normalizePackageInspection = (value: unknown): PackageInspection | null => {
  if (!isRecord(value) || !isRecord(value.extension) || !isRecord(value.publisher)) return null;
  const id = stringValue(value.extension.id);
  const version = stringValue(value.extension.version);
  const publisherId = stringValue(value.publisher.id);
  const fingerprint = stringValue(value.publisher.fingerprint);
  if (!id || !version || !publisherId || !fingerprint) return null;
  const permissions = isRecord(value.permissions) ? value.permissions : {};
  const routing = isRecord(value.agentRouting) ? value.agentRouting : null;
  const hosted = isRecord(value.hosted) ? value.hosted : null;
  return {
    extension: { id, name: stringValue(value.extension.name, id), version },
    publisher: {
      id: publisherId,
      name: stringValue(value.publisher.name, publisherId),
      keyId: stringValue(value.publisher.keyId),
      fingerprint,
      trusted: value.publisher.trusted === true,
    },
    permissions: {
      network: Array.isArray(permissions.network)
        ? permissions.network.filter((entry): entry is string => typeof entry === 'string')
        : [],
      nativeCode: permissions.nativeCode === true,
      sandboxedArtifacts: permissions.sandboxedArtifacts === true,
    },
    agentRouting: routing && typeof routing.domain === 'string' && typeof routing.dataAuthority === 'string'
      ? {
          domain: routing.domain,
          intents: Array.isArray(routing.intents)
            ? routing.intents.filter((intent): intent is string => typeof intent === 'string')
            : [],
          dataAuthority: routing.dataAuthority,
          views: Array.isArray(routing.views)
            ? routing.views.flatMap((surface) => isRecord(surface) && typeof surface.id === 'string'
              ? [{
                  id: surface.id,
                  tools: Array.isArray(surface.tools) ? surface.tools.filter((tool): tool is string => typeof tool === 'string') : [],
                }]
              : [])
            : [],
          artifacts: Array.isArray(routing.artifacts)
            ? routing.artifacts.flatMap((surface) => isRecord(surface) && typeof surface.id === 'string'
              ? [{
                  id: surface.id,
                  tools: Array.isArray(surface.tools) ? surface.tools.filter((tool): tool is string => typeof tool === 'string') : [],
                }]
              : [])
            : [],
        }
      : null,
    agentRuntime: normalizeAgentRuntime(value.agentRuntime),
    delivery: value.delivery === 'hosted' ? 'hosted' : 'local',
    ...(hosted && typeof hosted.manifestHash === 'string'
      ? {
          hosted: {
            manifestUrl: stringValue(hosted.manifestUrl),
            ttlSeconds: Number.isInteger(hosted.ttlSeconds) ? hosted.ttlSeconds as number : 0,
            manifestHash: hosted.manifestHash,
            version: stringValue(hosted.version),
            publishedAt: stringValue(hosted.publishedAt),
            permissions: normalizeHostedPermissions(hosted.permissions),
          },
        }
      : {}),
  };
};

export const normalizeMarketplaceInspection = (value: unknown): MarketplaceInspection | null => {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const catalogUrl = stringValue(value.catalogUrl);
  const fingerprint = stringValue(value.fingerprint);
  if (!id || !catalogUrl || !fingerprint) return null;
  return {
    id,
    name: stringValue(value.name, id),
    keyId: stringValue(value.keyId),
    catalogUrl,
    fingerprint,
    extensionCount: Number.isSafeInteger(value.extensionCount) ? value.extensionCount as number : 0,
  };
};

export const normalizeRemoteInspection = (value: unknown): RemoteInspection | null => {
  if (!isRecord(value) || !isRecord(value.extension) || !isRecord(value.publisher) || !isRecord(value.manifest) || !isRecord(value.connector)) return null;
  const id = stringValue(value.extension.id);
  const fingerprint = stringValue(value.publisher.fingerprint);
  const manifestHash = stringValue(value.manifest.manifestHash);
  const connectorId = stringValue(value.connector.id);
  const appEntryUrl = stringValue(value.manifest.appEntryUrl);
  if (!id || !fingerprint || !manifestHash || !connectorId || !appEntryUrl) return null;
  return {
    extension: { id, name: stringValue(value.extension.name, id), version: stringValue(value.extension.version) },
    publisher: {
      id: stringValue(value.publisher.id),
      name: stringValue(value.publisher.name, stringValue(value.publisher.id)),
      keyId: stringValue(value.publisher.keyId),
      fingerprint,
      trusted: value.publisher.trusted === true,
    },
    permissions: normalizeHostedPermissions(value.permissions),
    manifest: { appEntryUrl, manifestHash, publishedAt: stringValue(value.manifest.publishedAt) },
    connector: {
      id: connectorId,
      origin: stringValue(value.connector.origin),
      authType: 'api-key',
    },
  };
};

const normalizeLifecycleHealth = (value: unknown): RemoteLifecycle['health'] => {
  const health = isRecord(value) ? value : {};
  const status = typeof health.status === 'string' && ['unknown', 'reachable', 'unreachable', 'trust_invalid'].includes(health.status)
    ? health.status as RemoteLifecycleHealthStatus
    : 'unknown';
  return {
    status,
    checkedAt: typeof health.checkedAt === 'string' && Number.isFinite(Date.parse(health.checkedAt)) ? health.checkedAt : null,
    ...(typeof health.code === 'string' ? { code: health.code } : {}),
  };
};

// Human-readable i18n label key for each Hosted permission group, used by the
// re-consent dialog to render "Network origins (networkOrigins)" — a localized
// group label while retaining the exact technical id. Unknown keys yield null
// (the caller falls back to the raw technical id).
export const remotePermissionGroupLabelKey = (key: string): I18nKey | null => {
  switch (key) {
    case 'resourceOrigins': return 'settings.interactiveUI.permissionGroups.resourceOrigins';
    case 'networkOrigins': return 'settings.interactiveUI.permissionGroups.networkOrigins';
    case 'externalLinkOrigins': return 'settings.interactiveUI.permissionGroups.externalLinkOrigins';
    case 'credentialScopes': return 'settings.interactiveUI.permissionGroups.credentialScopes';
    case 'actionIds': return 'settings.interactiveUI.permissionGroups.actionIds';
    case 'agentToolNames': return 'settings.interactiveUI.permissionGroups.agentToolNames';
    case 'clipboard': return 'settings.interactiveUI.permissionGroups.clipboard';
    case 'popups': return 'settings.interactiveUI.permissionGroups.popups';
    case 'nativeCode': return 'settings.interactiveUI.permissionGroups.nativeCode';
    default: return null;
  }
};

const normalizeLifecycleAddedPermissions = (value: unknown): Partial<HostedPermissions> | null => {
  if (!isRecord(value)) return null;
  const result: Partial<HostedPermissions> = {};
  let found = false;
  for (const key of ['resourceOrigins', 'networkOrigins', 'externalLinkOrigins', 'credentialScopes', 'actionIds', 'agentToolNames'] as const) {
    if (Array.isArray(value[key])) {
      const entries = value[key].filter((entry): entry is string => typeof entry === 'string');
      result[key] = entries;
      if (entries.length > 0) found = true;
    }
  }
  for (const key of ['clipboard', 'popups', 'nativeCode'] as const) {
    if (typeof value[key] === 'boolean') {
      result[key] = value[key];
      found = true;
    }
  }
  return found ? result : null;
};

// Safe Remote lifecycle/update normalizer: accepts ONLY the documented safe
// fields with their exact shapes and never accepts unknown fields or secret
// material (public keys, installation ids, credentials, internal paths are
// dropped before they reach React state).
export const normalizeRemoteLifecycle = (value: unknown): RemoteLifecycle | null => {
  if (!isRecord(value)) return null;
  const status = typeof value.status === 'string' && ['none', 'available', 'required'].includes(value.status)
    ? value.status as RemoteLifecycleStatus
    : null;
  const currentVersion = typeof value.currentVersion === 'string' ? value.currentVersion : '';
  const currentManifestHash = typeof value.currentManifestHash === 'string' ? value.currentManifestHash : '';
  if (!status || !currentVersion || !currentManifestHash) return null;
  const permissionDelta = typeof value.permissionDelta === 'string'
    && ['none', 'expanded', 'reduced'].includes(value.permissionDelta)
    ? value.permissionDelta as RemotePermissionDelta
    : 'none';
  const addedPermissions = normalizeLifecycleAddedPermissions(value.addedPermissions);
  const requiresUserConfirmation = value.requiresUserConfirmation === true;
  const remoteVersion = typeof value.remoteVersion === 'string' && value.remoteVersion.length > 0
    ? value.remoteVersion
    : null;
  const remoteManifestHash = typeof value.remoteManifestHash === 'string' && value.remoteManifestHash.length > 0
    ? value.remoteManifestHash
    : null;
  const publisherFingerprint = typeof value.publisherFingerprint === 'string' && value.publisherFingerprint.length > 0
    ? value.publisherFingerprint
    : null;
  // Correlation-invariant: a consent-requiring payload MUST carry the exact
  // candidate identity (version, manifest hash, publisher fingerprint) that a
  // confirm would apply; a payload claiming requiresUserConfirmation without
  // all three is rejected outright so the re-consent dialog can never open on
  // an unconfirmable candidate.
  if (requiresUserConfirmation && (!remoteVersion || !remoteManifestHash || !publisherFingerprint)) {
    return null;
  }
  const blockedValue = isRecord(value.blocked) && typeof value.blocked.code === 'string'
    ? {
        code: value.blocked.code,
        ...(value.blocked.required === true ? { required: true } : {}),
        ...(typeof value.blocked.version === 'string' ? { version: value.blocked.version } : {}),
        ...(typeof value.blocked.manifestHash === 'string' ? { manifestHash: value.blocked.manifestHash } : {}),
        ...(typeof value.blocked.reason === 'string' ? { reason: value.blocked.reason } : {}),
      }
    : undefined;
  return {
    status,
    currentVersion,
    currentManifestHash,
    remoteVersion,
    remoteManifestHash,
    changeSummary: typeof value.changeSummary === 'string' ? value.changeSummary : null,
    permissionDelta,
    addedPermissions,
    keyChanged: value.keyChanged === true,
    requiresUserConfirmation,
    publisherFingerprint,
    health: normalizeLifecycleHealth(value.health),
    ...(blockedValue ? { blocked: blockedValue } : {}),
    ...(value.applied === true ? { applied: true } : {}),
  };
};

// A Remote update candidate is confirmable ONLY when the exact current
// verified candidate identity is complete: non-empty remote version, manifest
// hash, and publisher fingerprint. A persisted required block whose current
// probe is unreachable/unverifiable carries null candidate identity and must
// never open the review/apply dialog — it stays visibly required/blocked with
// the existing health/toast/refresh behavior instead.
export const hasRemoteUpdateCandidateIdentity = (lifecycle: RemoteLifecycle): boolean => (
  Boolean(lifecycle.remoteVersion)
  && Boolean(lifecycle.remoteManifestHash)
  && Boolean(lifecycle.publisherFingerprint)
);

// The re-consent review/apply dialog opens ONLY when BOTH the lifecycle
// warrants it (a required update — including required no-confirmation
// updates, which keep an immediate manual Apply path — or a consent-awaiting
// available update) AND the exact current verified candidate identity is
// complete (non-empty remoteVersion, remoteManifestHash, and
// publisherFingerprint). A persisted required block whose current probe is
// unreachable/unverifiable (identity fields null) stays visibly
// required/blocked but must NOT open Apply; a plain available/none lifecycle
// keeps the existing toast behavior.
export const shouldOpenRemoteUpdateDialog = (lifecycle: RemoteLifecycle): boolean => (
  (lifecycle.status === 'required' || lifecycle.requiresUserConfirmation)
  && hasRemoteUpdateCandidateIdentity(lifecycle)
);

export const normalizeRemoteConnectResult = (value: unknown): RemoteConnectResult | null => {
  if (!isRecord(value) || !isRecord(value.extension) || !isRecord(value.connector) || !isRecord(value.credential)) return null;
  const id = stringValue(value.extension.id);
  const connectorId = stringValue(value.connector.id);
  if (!id || !connectorId) return null;
  return {
    extension: { id, name: stringValue(value.extension.name, id), version: stringValue(value.extension.version) },
    connector: {
      id: connectorId,
      origin: stringValue(value.connector.origin),
      authType: 'api-key',
    },
    credential: {
      configured: value.credential.configured === true,
      expired: value.credential.expired === true,
      ...(typeof value.credential.source === 'string' ? { source: value.credential.source } : {}),
      ...(typeof value.credential.configuredAt === 'string' ? { configuredAt: value.credential.configuredAt } : {}),
    },
  };
};

const normalizeExtension = (value: unknown): InstalledExtension | null => {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  const activeVersion = stringValue(value.activeVersion);
  if (!id || !activeVersion) return null;
  const versionsValue = isRecord(value.versions) ? value.versions : {};
  const versions = Object.fromEntries(Object.entries(versionsValue).flatMap(([version, metadata]) => {
    const normalized = normalizeVersion(metadata, version);
    return normalized ? [[version, normalized]] : [];
  }));
  const integrityValue = isRecord(value.integrity) ? value.integrity : {};
  const integrityStatus = stringValue(integrityValue.status, 'unknown');
  return {
    id,
    name: stringValue(value.name, id),
    enabled: value.enabled !== false,
    activeVersion,
    activationHistory: Array.isArray(value.activationHistory)
      ? value.activationHistory.filter((version): version is string => typeof version === 'string')
      : [],
    versions,
    integrity: {
      status: ['ready', 'unavailable', 'failed'].includes(integrityStatus)
        ? integrityStatus as 'ready' | 'unavailable' | 'failed'
        : 'unknown',
      ...(typeof integrityValue.code === 'string' ? { code: integrityValue.code } : {}),
    },
  };
};

const normalizePublisher = (value: unknown): TrustedPublisher | null => {
  if (!isRecord(value)) return null;
  const id = stringValue(value.id);
  if (!id) return null;
  return {
    id,
    name: stringValue(value.name, id),
    keys: Array.isArray(value.keys) ? value.keys.flatMap((key) => {
      if (!isRecord(key) || typeof key.keyId !== 'string') return [];
      return [{
        keyId: key.keyId,
        fingerprint: stringValue(key.fingerprint),
        source: stringValue(key.source),
        trustedAt: stringValue(key.trustedAt),
      }];
    }) : [],
  };
};

const normalizeMarketplace = (value: unknown): Marketplace | null => {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return {
    id: value.id,
    name: stringValue(value.name, value.id),
    keyId: stringValue(value.keyId),
    catalogUrl: stringValue(value.catalogUrl),
    fingerprint: stringValue(value.fingerprint),
  };
};

export const normalizeManagerSnapshot = (value: unknown): ManagerSnapshot => {
  if (!isRecord(value)) return EMPTY_MANAGER_SNAPSHOT;
  return {
    extensions: Array.isArray(value.extensions) ? value.extensions.flatMap((extension) => {
      const normalized = normalizeExtension(extension);
      return normalized ? [normalized] : [];
    }) : [],
    publishers: Array.isArray(value.publishers) ? value.publishers.flatMap((publisher) => {
      const normalized = normalizePublisher(publisher);
      return normalized ? [normalized] : [];
    }) : [],
    marketplaces: Array.isArray(value.marketplaces) ? value.marketplaces.flatMap((marketplace) => {
      const normalized = normalizeMarketplace(marketplace);
      return normalized ? [normalized] : [];
    }) : [],
  };
};

export const normalizeCatalogEntries = (value: unknown): CatalogEntry[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || typeof entry.name !== 'string' || typeof entry.version !== 'string') return [];
    const publisher = isRecord(entry.publisher) ? entry.publisher : {};
    return [{
      id: entry.id,
      name: entry.name,
      version: entry.version,
      publisher: {
        id: stringValue(publisher.id),
        name: stringValue(publisher.name),
        keyId: stringValue(publisher.keyId),
      },
    }];
  });
};

export const normalizeConnectionSnapshot = (value: unknown): ConnectionSnapshot => {
  if (!isRecord(value) || !Array.isArray(value.connections)) return EMPTY_CONNECTION_SNAPSHOT;
  return {
    connections: value.connections.flatMap((entry): ManagedConnection[] => {
      if (!isRecord(entry) || !isRecord(entry.extension) || !isRecord(entry.connector) || !isRecord(entry.credential)) return [];
      const extensionId = stringValue(entry.extension.id);
      const connectorId = stringValue(entry.connector.id);
      const authType = stringValue(entry.connector.authType);
      if (!extensionId || !connectorId || !['none', 'env-bearer', 'api-key', 'issued-key'].includes(authType)) return [];
      return [{
        extension: {
          id: extensionId,
          name: stringValue(entry.extension.name, extensionId),
          version: stringValue(entry.extension.version),
        },
        connector: {
          id: connectorId,
          origin: stringValue(entry.connector.origin),
          ...(typeof entry.connector.endpoint === 'string' || entry.connector.endpoint === null
            ? { endpoint: entry.connector.endpoint }
            : {}),
          authType: authType as ConnectionAuthType,
          testable: entry.connector.testable === true,
          configurable: entry.connector.configurable === true,
          provisionable: entry.connector.provisionable === true,
        },
        credential: {
          configured: entry.credential.configured === true,
          expired: entry.credential.expired === true,
          ...(typeof entry.credential.source === 'string' ? { source: entry.credential.source } : {}),
          ...(typeof entry.credential.configuredAt === 'string' ? { configuredAt: entry.credential.configuredAt } : {}),
          ...(typeof entry.credential.expiresAt === 'string' || entry.credential.expiresAt === null ? { expiresAt: entry.credential.expiresAt } : {}),
          ...(typeof entry.credential.displayName === 'string' || entry.credential.displayName === null ? { displayName: entry.credential.displayName } : {}),
          ...(typeof entry.credential.name === 'string' || entry.credential.name === null ? { name: entry.credential.name } : {}),
          ...(typeof entry.credential.endpoint === 'string' || entry.credential.endpoint === null ? { endpoint: entry.credential.endpoint } : {}),
          ...(typeof entry.credential.endpointConfigured === 'boolean' ? { endpointConfigured: entry.credential.endpointConfigured } : {}),
          ...(['user', 'environment', 'manifest'].includes(String(entry.credential.endpointSource)) || entry.credential.endpointSource === null
            ? { endpointSource: entry.credential.endpointSource as 'user' | 'environment' | 'manifest' | null }
            : {}),
          ...(Array.isArray(entry.credential.headerNames)
            ? { headerNames: entry.credential.headerNames.filter((name): name is string => typeof name === 'string') }
            : {}),
        },
        health: (() => {
          const value = isRecord(entry.health) ? entry.health : {};
          const status = typeof value.status === 'string' && ['unknown', 'reachable', 'unreachable', 'unauthorized', 'forbidden'].includes(value.status)
            ? value.status as ConnectionHealthStatus
            : 'unknown';
          return {
            status,
            checkedAt: typeof value.checkedAt === 'string' && Number.isFinite(Date.parse(value.checkedAt)) ? value.checkedAt : null,
            ...(typeof value.code === 'string' ? { code: value.code } : {}),
          };
        })(),
      }];
    }),
  };
};
