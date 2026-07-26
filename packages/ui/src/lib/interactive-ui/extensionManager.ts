export interface InstalledVersion {
  version: string;
  installedAt: string;
  packageHash: string;
  source: { type: string; marketplaceId?: string };
  publisher: { id: string; name: string; keyId: string; fingerprint: string };
  agentRuntime: AgentRuntimeSummary;
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

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const stringValue = (value: unknown, fallback = ''): string => typeof value === 'string' ? value : fallback;

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
  if (!version) return null;
  return {
    version,
    installedAt: stringValue(value.installedAt),
    packageHash: stringValue(value.packageHash),
    source: {
      type: stringValue(source.type, 'unknown'),
      ...(typeof source.marketplaceId === 'string' ? { marketplaceId: source.marketplaceId } : {}),
    },
    publisher: {
      id: stringValue(publisher.id),
      name: stringValue(publisher.name),
      keyId: stringValue(publisher.keyId),
      fingerprint: stringValue(publisher.fingerprint),
    },
    agentRuntime: normalizeAgentRuntime(value.agentRuntime),
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
