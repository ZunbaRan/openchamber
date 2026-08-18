import { describe, expect, test } from 'bun:test';
import { settingsDict as enSettingsDict } from '../i18n/messages/en.settings';
import { settingsDict as esSettingsDict } from '../i18n/messages/es.settings';
import { settingsDict as frSettingsDict } from '../i18n/messages/fr.settings';
import { settingsDict as jaSettingsDict } from '../i18n/messages/ja.settings';
import { settingsDict as koSettingsDict } from '../i18n/messages/ko.settings';
import { settingsDict as plSettingsDict } from '../i18n/messages/pl.settings';
import { settingsDict as ptBrSettingsDict } from '../i18n/messages/pt-BR.settings';
import { settingsDict as ukSettingsDict } from '../i18n/messages/uk.settings';
import { settingsDict as zhCnSettingsDict } from '../i18n/messages/zh-CN.settings';
import { settingsDict as zhTwSettingsDict } from '../i18n/messages/zh-TW.settings';
import { dict as enDict } from '../i18n/messages/en';
import { dict as esDict } from '../i18n/messages/es';
import { dict as frDict } from '../i18n/messages/fr';
import { dict as jaDict } from '../i18n/messages/ja';
import { dict as koDict } from '../i18n/messages/ko';
import { dict as plDict } from '../i18n/messages/pl';
import { dict as ptBrDict } from '../i18n/messages/pt-BR';
import { dict as ukDict } from '../i18n/messages/uk';
import { dict as zhCnDict } from '../i18n/messages/zh-CN';
import { dict as zhTwDict } from '../i18n/messages/zh-TW';
import {
  classifyCatalogInstallState,
  hasRemoteUpdateCandidateIdentity,
  isRemoteHealthProbeFailureCode,
  shouldOpenRemoteUpdateDialog,
  normalizeCatalogEntries,
  normalizeManagerSnapshot,
  normalizeConnectionSnapshot,
  normalizeMarketplaceInspection,
  normalizePackageInspection,
  normalizeRemoteInspection,
  normalizeRemoteConnectResult,
  normalizeRemoteLifecycle,
  remotePermissionGroupLabelKey,
} from './extensionManager';

describe('classifyCatalogInstallState', () => {
  test('distinguishes available, installed, update, older, and prerelease catalog entries', () => {
    expect(classifyCatalogInstallState('1.0.0')).toBe('available');
    expect(classifyCatalogInstallState('1.0.0', '1.0.0')).toBe('installed');
    expect(classifyCatalogInstallState('1.1.0', '1.0.9')).toBe('update');
    expect(classifyCatalogInstallState('1.0.0', '2.0.0')).toBe('older');
    expect(classifyCatalogInstallState('1.0.0', '1.0.0-beta.2')).toBe('update');
    expect(classifyCatalogInstallState('1.0.0-beta.2', '1.0.0-beta.10')).toBe('older');
  });
});

describe('isRemoteHealthProbeFailureCode', () => {
  test('recognizes every connector-test safe failure code emitted by the runtime', () => {
    for (const code of [
      'connection_test_unsupported',
      'connector_unconfigured',
      'credential_unavailable',
      'connector_unauthorized',
      'connector_forbidden',
      'connection_test_timeout',
      'upstream_unavailable',
      'upstream_error',
      'upstream_response_too_large',
    ]) {
      expect(isRemoteHealthProbeFailureCode(code)).toBe(true);
    }
    // Existing legacy/defensive code stays recognized (behavior preserved).
    expect(isRemoteHealthProbeFailureCode('credential_expired')).toBe(true);
  });

  test('rejects unrelated or unsafe codes and non-string inputs', () => {
    for (const code of [
      'publisher_untrusted',
      'remote_update_generation_changed',
      'remote_trust_conflict',
      'manager_data_corrupt',
      'invalid_request',
      'malicious-code',
      '',
    ]) {
      expect(isRemoteHealthProbeFailureCode(code)).toBe(false);
    }
    expect(isRemoteHealthProbeFailureCode(null)).toBe(false);
    expect(isRemoteHealthProbeFailureCode(undefined)).toBe(false);
    expect(isRemoteHealthProbeFailureCode(123)).toBe(false);
    expect(isRemoteHealthProbeFailureCode({ code: 'upstream_error' })).toBe(false);
  });
});

describe('normalizeManagerSnapshot', () => {
  test('migrates missing lifecycle arrays and optional response collections', () => {
    const snapshot = normalizeManagerSnapshot({
      extensions: [{
        id: 'com.acme.operations',
        name: 'Operations',
        enabled: true,
        activeVersion: '1.0.0',
        integrity: { status: 'unavailable', code: 'extension_integrity_unavailable', path: '/must-not-survive' },
        versions: {
          '1.0.0': { version: '1.0.0', publisher: { name: 'Acme' } },
        },
      }],
    });
    expect(snapshot.extensions[0].activationHistory).toEqual([]);
    expect(snapshot.extensions[0].activeVersion).toBe('1.0.0');
    expect(snapshot.extensions[0].integrity).toEqual({ status: 'unavailable', code: 'extension_integrity_unavailable' });
    expect(snapshot.publishers).toEqual([]);
    expect(snapshot.marketplaces).toEqual([]);
  });

  test('returns a safe empty snapshot for unrelated or malformed API payloads', () => {
    expect(normalizeManagerSnapshot(null)).toEqual({ extensions: [], publishers: [], marketplaces: [] });
    expect(normalizeManagerSnapshot({ extensions: {}, publishers: null })).toEqual({ extensions: [], publishers: [], marketplaces: [] });
  });

  test('defaults missing or unsupported integrity states to unknown', () => {
    const snapshot = normalizeManagerSnapshot({
      extensions: [{ id: 'com.acme.operations', activeVersion: '1.0.0', integrity: { status: 'trusted' } }],
    });
    expect(snapshot.extensions[0].integrity).toEqual({ status: 'unknown' });
  });

  test('drops malformed marketplace catalog entries instead of crashing the page', () => {
    expect(normalizeCatalogEntries([null, { id: 'com.acme.valid', name: 'Valid', version: '1.0.0' }]))
      .toHaveLength(1);
  });

  test('normalizes package capability review without accepting malformed identities', () => {
    const inspection = normalizePackageInspection({
      extension: { id: 'com.acme.operations', name: 'Operations', version: '1.0.0' },
      publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release', fingerprint: 'sha256-value', trusted: false },
      permissions: { network: ['https://api.example.com'], nativeCode: true, sandboxedArtifacts: true },
      agentRouting: {
        domain: 'operations',
        intents: ['operations.overview', 'operations.item.approve'],
        dataAuthority: 'connected-business-system',
        views: [{ id: 'com.acme.operations.overview', tools: ['operations_open'] }],
        artifacts: [{ id: 'com.acme.operations.explorer', tools: ['operations_explore'] }],
      },
      agentRuntime: {
        tools: [{ name: 'operations_open', entry: 'agent-runtime/tools/operations_open.ts' }, null],
        skills: [{ name: 'operations-ui', entry: 'agent-runtime/skills/operations-ui/SKILL.md', files: ['SKILL.md', 42] }],
      },
    });
    expect(inspection?.agentRuntime.tools.map((tool) => tool.name)).toEqual(['operations_open']);
    expect(inspection?.agentRouting).toEqual({
      domain: 'operations',
      intents: ['operations.overview', 'operations.item.approve'],
      dataAuthority: 'connected-business-system',
      views: [{ id: 'com.acme.operations.overview', tools: ['operations_open'] }],
      artifacts: [{ id: 'com.acme.operations.explorer', tools: ['operations_explore'] }],
    });
    expect(inspection?.permissions.nativeCode).toBe(true);
    expect(inspection?.permissions.sandboxedArtifacts).toBe(true);
    expect(normalizePackageInspection({ extension: {}, publisher: {} })).toBeNull();
  });

  test('normalizes Remote delivery metadata without accepting secret material', () => {
    const snapshot = normalizeManagerSnapshot({
      extensions: [{
        id: 'com.acme.remote',
        name: 'Acme Remote',
        enabled: true,
        activeVersion: '1.0.0',
        integrity: { status: 'ready' },
        versions: {
          '1.0.0': {
            version: '1.0.0',
            delivery: 'remote',
            source: { type: 'remote', appEntryUrl: 'https://apps.example.com/manifest.json', accessKey: 'must-not-survive' },
            publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', fingerprint: 'sha256-value' },
            remote: {
              appEntryUrl: 'https://apps.example.com/manifest.json',
              connectorRefs: [{ id: 'crm', origin: 'https://api.example.com', authType: 'api-key' }, null],
              acceptedManifest: { version: '1.0.0', manifestHash: 'sha256-value' },
              status: 'active',
            },
          },
        },
      }],
    });
    const version = snapshot.extensions[0]?.versions['1.0.0'];
    expect(version?.delivery).toBe('remote');
    expect(version?.source).toEqual({ type: 'remote', appEntryUrl: 'https://apps.example.com/manifest.json' });
    expect(version?.remote).toEqual({
      appEntryUrl: 'https://apps.example.com/manifest.json',
      connectorIds: ['crm'],
      acceptedManifestVersion: '1.0.0',
      acceptedManifestHash: 'sha256-value',
      status: 'active',
    });
    expect(JSON.stringify(version)).not.toContain('must-not-survive');
  });

  test('normalizes a Remote inspection review with the complete Hosted permission summary', () => {
    const inspection = normalizeRemoteInspection({
      extension: { id: 'com.acme.remote', name: 'Remote CRM', version: '1.0.0' },
      publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', fingerprint: 'sha256-value', trusted: false, publicKey: 'must-not-survive' },
      permissions: {
        resourceOrigins: ['https://apps.example.com'],
        networkOrigins: ['https://api.example.com'],
        externalLinkOrigins: [],
        credentialScopes: ['crm.read'],
        actionIds: ['com.acme.remote.read'],
        agentToolNames: ['remote_open'],
        clipboard: false,
        popups: true,
        nativeCode: true,
      },
      manifest: { appEntryUrl: 'https://apps.example.com/manifest.json', manifestHash: 'sha256-value', publishedAt: '2026-08-05T00:00:00.000Z' },
      connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
      accessKey: 'must-not-survive',
    });
    expect(inspection).toEqual({
      extension: { id: 'com.acme.remote', name: 'Remote CRM', version: '1.0.0' },
      publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', fingerprint: 'sha256-value', trusted: false },
      permissions: {
        resourceOrigins: ['https://apps.example.com'],
        networkOrigins: ['https://api.example.com'],
        externalLinkOrigins: [],
        credentialScopes: ['crm.read'],
        actionIds: ['com.acme.remote.read'],
        agentToolNames: ['remote_open'],
        clipboard: false,
        popups: true,
        nativeCode: true,
      },
      manifest: { appEntryUrl: 'https://apps.example.com/manifest.json', manifestHash: 'sha256-value', publishedAt: '2026-08-05T00:00:00.000Z' },
      connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
    });
    expect(JSON.stringify(inspection)).not.toContain('must-not-survive');
    expect(normalizeRemoteInspection({ extension: {}, publisher: {}, manifest: {}, connector: {} })).toBeNull();
  });

  test('normalizes a Remote connect result without exposing the access key or trust bookkeeping', () => {
    const result = normalizeRemoteConnectResult({
      extension: { id: 'com.acme.remote', name: 'Remote CRM', version: '1.0.0' },
      connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
      credential: { configured: true, expired: false, source: 'manual', configuredAt: '2026-08-05T00:00:00.000Z', accessKey: 'must-not-survive' },
      trustAdded: true,
    });
    expect(result).toEqual({
      extension: { id: 'com.acme.remote', name: 'Remote CRM', version: '1.0.0' },
      connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
      credential: { configured: true, expired: false, source: 'manual', configuredAt: '2026-08-05T00:00:00.000Z' },
    });
    expect(JSON.stringify(result)).not.toContain('must-not-survive');
    expect(JSON.stringify(result)).not.toContain('trustAdded');
  });

  test('keeps hosted permission normalization in sync with nativeCode exposure', () => {
    const inspection = normalizePackageInspection({
      extension: { id: 'com.acme.operations', name: 'Operations', version: '1.0.0' },
      publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release', fingerprint: 'sha256-value', trusted: true },
      hosted: {
        manifestUrl: 'https://apps.example.com/manifest.json',
        ttlSeconds: 600,
        manifestHash: 'sha256-value',
        version: '2.0.0',
        publishedAt: '2026-08-05T00:00:00.000Z',
        permissions: {
          resourceOrigins: ['https://apps.example.com'],
          networkOrigins: [],
          externalLinkOrigins: [],
          credentialScopes: [],
          actionIds: [],
          agentToolNames: [],
          clipboard: false,
          popups: false,
          nativeCode: true,
        },
      },
    });
    expect(inspection?.hosted?.permissions.nativeCode).toBe(true);
  });

  test('normalizes self-described marketplace review metadata', () => {
    expect(normalizeMarketplaceInspection({
      id: 'com.acme.marketplace',
      name: 'Acme',
      keyId: 'catalog',
      catalogUrl: 'https://extensions.example.com/catalog.json',
      fingerprint: 'sha256-value',
      extensionCount: 3,
    })?.extensionCount).toBe(3);
  });
});

describe('normalizeConnectionSnapshot', () => {
  test('keeps only public connection status and supported auth types', () => {
    expect(normalizeConnectionSnapshot({
      connections: [{
        extension: { id: 'com.acme.crm', name: 'CRM', version: '1.0.0' },
        connector: {
          id: 'crm-api', origin: 'https://crm.example.com', authType: 'api-key', testable: true, configurable: true, provisionable: false,
        },
        credential: { configured: true, expired: false, source: 'manual', accessKey: 'must-not-survive' },
        health: { status: 'reachable', checkedAt: '2026-07-22T10:00:00.000Z', secret: 'must-not-survive' },
      }, { connector: {} }],
    })).toEqual({
      connections: [{
        extension: { id: 'com.acme.crm', name: 'CRM', version: '1.0.0' },
        connector: {
          id: 'crm-api', origin: 'https://crm.example.com', authType: 'api-key', testable: true, configurable: true, provisionable: false,
        },
        credential: { configured: true, expired: false, source: 'manual' },
        health: { status: 'reachable', checkedAt: '2026-07-22T10:00:00.000Z' },
      }],
    });
  });

  test('defaults malformed runtime health to unknown', () => {
    expect(normalizeConnectionSnapshot({
      connections: [{
        extension: { id: 'com.acme.crm' },
        connector: { id: 'crm-api', authType: 'api-key' },
        credential: { configured: true },
        health: { status: 'admin', checkedAt: 42 },
      }],
    }).connections[0]?.health).toEqual({ status: 'unknown', checkedAt: null });
  });
});

describe('normalizeRemoteLifecycle', () => {
  test('normalizes a safe lifecycle result and rejects unknown/secret fields', () => {
    const lifecycle = normalizeRemoteLifecycle({
      status: 'available',
      currentVersion: '1.0.0',
      currentManifestHash: 'sha256-current',
      remoteVersion: '2.0.0',
      remoteManifestHash: 'sha256-remote',
      changeSummary: 'Adds export',
      permissionDelta: 'expanded',
      addedPermissions: { actionIds: ['com.acme.remote.export'], nativeCode: true, unknown: 'x' },
      keyChanged: false,
      requiresUserConfirmation: true,
      publisherFingerprint: 'sha256-fingerprint',
      health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z', code: null, secret: 'must-not-survive' },
      blocked: { code: 'remote_update_required_blocked', required: true, version: '2.0.0' },
      publicKey: 'BEGIN PUBLIC KEY must not survive',
      installationId: 'must-not-survive',
    });
    expect(lifecycle).toEqual({
      status: 'available',
      currentVersion: '1.0.0',
      currentManifestHash: 'sha256-current',
      remoteVersion: '2.0.0',
      remoteManifestHash: 'sha256-remote',
      changeSummary: 'Adds export',
      permissionDelta: 'expanded',
      addedPermissions: { actionIds: ['com.acme.remote.export'], nativeCode: true },
      keyChanged: false,
      requiresUserConfirmation: true,
      publisherFingerprint: 'sha256-fingerprint',
      health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' },
      blocked: { code: 'remote_update_required_blocked', required: true, version: '2.0.0' },
    });
    expect(JSON.stringify(lifecycle)).not.toContain('must-not-survive');
    expect(JSON.stringify(lifecycle)).not.toContain('BEGIN PUBLIC KEY');
  });

  test('returns null for malformed payloads and defaults unknown health', () => {
    expect(normalizeRemoteLifecycle(null)).toBeNull();
    expect(normalizeRemoteLifecycle({ status: 'available' })).toBeNull();
    expect(normalizeRemoteLifecycle({ status: 'weird', currentVersion: '1.0.0', currentManifestHash: 'x' })).toBeNull();
    const untrusted = normalizeRemoteLifecycle({
      status: 'none',
      currentVersion: '1.0.0',
      currentManifestHash: 'sha256-x',
      health: { status: 'trust_invalid', checkedAt: 'not-a-date', code: 'publisher_untrusted' },
    });
    expect(untrusted).not.toBeNull();
    if (untrusted) {
      expect(untrusted).toEqual({
        status: 'none',
        currentVersion: '1.0.0',
        currentManifestHash: 'sha256-x',
        remoteVersion: null,
        remoteManifestHash: null,
        changeSummary: null,
        permissionDelta: 'none',
        addedPermissions: null,
        keyChanged: false,
        requiresUserConfirmation: false,
        publisherFingerprint: null,
        health: { status: 'trust_invalid', checkedAt: null, code: 'publisher_untrusted' },
      });
    }
  });

  test('normalizes required + reduced updates without consent flags', () => {
    const lifecycle = normalizeRemoteLifecycle({
      status: 'required',
      currentVersion: '1.0.0',
      currentManifestHash: 'sha256-current',
      remoteVersion: '2.0.0',
      remoteManifestHash: 'sha256-remote',
      changeSummary: 'Removes legacy actions',
      permissionDelta: 'reduced',
      addedPermissions: null,
      keyChanged: true,
      requiresUserConfirmation: false,
      publisherFingerprint: 'sha256-new',
      health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' },
      applied: true,
    });
    expect(lifecycle).not.toBeNull();
    if (lifecycle) {
      expect(lifecycle).toEqual({
        status: 'required',
        currentVersion: '1.0.0',
        currentManifestHash: 'sha256-current',
        remoteVersion: '2.0.0',
        remoteManifestHash: 'sha256-remote',
        changeSummary: 'Removes legacy actions',
        permissionDelta: 'reduced',
        addedPermissions: null,
        keyChanged: true,
        requiresUserConfirmation: false,
        publisherFingerprint: 'sha256-new',
        health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' },
        applied: true,
      });
    }
  });

  test('accepts remote lifecycle and blocked summaries through the manager snapshot normalizer', () => {
    const snapshot = normalizeManagerSnapshot({
      extensions: [{
        id: 'com.acme.remote',
        name: 'Acme Remote',
        enabled: true,
        activeVersion: '1.0.0',
        integrity: { status: 'ready' },
        versions: {
          '1.0.0': {
            version: '1.0.0',
            delivery: 'remote',
            source: { type: 'remote', appEntryUrl: 'https://apps.example.com/manifest.json' },
            publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', fingerprint: 'sha256-value' },
            remote: {
              appEntryUrl: 'https://apps.example.com/manifest.json',
              connectorRefs: [{ id: 'crm' }],
              acceptedManifest: { version: '1.0.0', manifestHash: 'sha256-accepted' },
              status: 'active',
              lifecycle: {
                status: 'required',
                currentVersion: '1.0.0',
                currentManifestHash: 'sha256-accepted',
                remoteVersion: '2.0.0',
                remoteManifestHash: 'sha256-remote',
                changeSummary: 'Mandatory fix',
                permissionDelta: 'expanded',
                addedPermissions: { actionIds: ['com.acme.remote.export'] },
                keyChanged: false,
                requiresUserConfirmation: true,
                publisherFingerprint: 'sha256-fingerprint',
                health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' },
                blocked: { code: 'remote_update_required_blocked' },
              },
              blocked: { required: true, version: '2.0.0', manifestHash: 'sha256-remote', reason: 'confirmation-required', observedAt: '2026-08-05T00:00:00.000Z' },
            },
          },
        },
      }],
    });
    const remote = snapshot.extensions[0]?.versions['1.0.0'].remote;
    expect(remote?.lifecycle).not.toBeNull();
    if (remote?.lifecycle) {
      expect(remote.lifecycle).toEqual({
        status: 'required',
        currentVersion: '1.0.0',
        currentManifestHash: 'sha256-accepted',
        remoteVersion: '2.0.0',
        remoteManifestHash: 'sha256-remote',
        changeSummary: 'Mandatory fix',
        permissionDelta: 'expanded',
        addedPermissions: { actionIds: ['com.acme.remote.export'] },
        keyChanged: false,
        requiresUserConfirmation: true,
        publisherFingerprint: 'sha256-fingerprint',
        health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' },
        blocked: { code: 'remote_update_required_blocked' },
      });
    }
    expect(remote?.blocked).toEqual({
      required: true,
      version: '2.0.0',
      manifestHash: 'sha256-remote',
      reason: 'confirmation-required',
      observedAt: '2026-08-05T00:00:00.000Z',
    });
  });
});

describe('normalizeRemoteLifecycle consent correlation (Phase R3 review)', () => {
  const consentBase = {
    status: 'available',
    currentVersion: '1.0.0',
    currentManifestHash: 'sha256-current',
    remoteVersion: '2.0.0',
    remoteManifestHash: 'sha256-remote',
    changeSummary: 'Adds export',
    permissionDelta: 'expanded',
    addedPermissions: { actionIds: ['com.acme.remote.export'] },
    keyChanged: false,
    requiresUserConfirmation: true,
    publisherFingerprint: 'sha256-fingerprint',
    health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' },
  };

  test('accepts a consent payload carrying the full exact candidate identity', () => {
    const lifecycle = normalizeRemoteLifecycle(consentBase);
    expect(lifecycle).not.toBeNull();
    if (lifecycle) {
      expect(lifecycle).toEqual({
        ...consentBase,
        addedPermissions: { actionIds: ['com.acme.remote.export'] },
        requiresUserConfirmation: true,
        permissionDelta: 'expanded',
        keyChanged: false,
      });
      expect(lifecycle.remoteManifestHash).toBe('sha256-remote');
      expect(lifecycle.publisherFingerprint).toBe('sha256-fingerprint');
    }
  });

  test('rejects a consent payload missing any of remoteVersion, remoteManifestHash, or publisherFingerprint', () => {
    expect(normalizeRemoteLifecycle({ ...consentBase, remoteVersion: null })).toBeNull();
    expect(normalizeRemoteLifecycle({ ...consentBase, remoteVersion: '' })).toBeNull();
    expect(normalizeRemoteLifecycle({ ...consentBase, remoteManifestHash: undefined })).toBeNull();
    expect(normalizeRemoteLifecycle({ ...consentBase, remoteManifestHash: '' })).toBeNull();
    expect(normalizeRemoteLifecycle({ ...consentBase, publisherFingerprint: null })).toBeNull();
    expect(normalizeRemoteLifecycle({ ...consentBase, publisherFingerprint: '' })).toBeNull();
  });

  test('accepts a non-consent payload without candidate identity fields', () => {
    const lifecycle = normalizeRemoteLifecycle({
      status: 'none',
      currentVersion: '1.0.0',
      currentManifestHash: 'sha256-current',
      requiresUserConfirmation: false,
      health: { status: 'unreachable', checkedAt: '2026-08-05T00:00:00.000Z' },
    });
    expect(lifecycle).not.toBeNull();
    if (lifecycle) {
      expect(lifecycle.remoteVersion).toBeNull();
      expect(lifecycle.remoteManifestHash).toBeNull();
      expect(lifecycle.publisherFingerprint).toBeNull();
      expect(lifecycle.requiresUserConfirmation).toBe(false);
    }
  });
});

describe('remotePermissionGroupLabelKey (Phase R3 review)', () => {
  test('maps every Hosted permission group to its localized label key while preserving the technical id', () => {
    expect(remotePermissionGroupLabelKey('networkOrigins')).toBe('settings.interactiveUI.permissionGroups.networkOrigins');
    expect(remotePermissionGroupLabelKey('resourceOrigins')).toBe('settings.interactiveUI.permissionGroups.resourceOrigins');
    expect(remotePermissionGroupLabelKey('externalLinkOrigins')).toBe('settings.interactiveUI.permissionGroups.externalLinkOrigins');
    expect(remotePermissionGroupLabelKey('credentialScopes')).toBe('settings.interactiveUI.permissionGroups.credentialScopes');
    expect(remotePermissionGroupLabelKey('actionIds')).toBe('settings.interactiveUI.permissionGroups.actionIds');
    expect(remotePermissionGroupLabelKey('agentToolNames')).toBe('settings.interactiveUI.permissionGroups.agentToolNames');
    expect(remotePermissionGroupLabelKey('clipboard')).toBe('settings.interactiveUI.permissionGroups.clipboard');
    expect(remotePermissionGroupLabelKey('popups')).toBe('settings.interactiveUI.permissionGroups.popups');
    expect(remotePermissionGroupLabelKey('nativeCode')).toBe('settings.interactiveUI.permissionGroups.nativeCode');
  });

  test('returns null for unknown keys so the dialog falls back to the raw technical id', () => {
    expect(remotePermissionGroupLabelKey('unknown')).toBeNull();
    expect(remotePermissionGroupLabelKey('')).toBeNull();
  });

  test('every mapped key exists in the en and zh-CN settings dictionaries', () => {
    const en = enSettingsDict as Record<string, string>;
    const zh = zhCnSettingsDict as Record<string, string>;
    for (const key of ['resourceOrigins', 'networkOrigins', 'externalLinkOrigins', 'credentialScopes', 'actionIds', 'agentToolNames', 'clipboard', 'popups', 'nativeCode']) {
      const labelKey = remotePermissionGroupLabelKey(key);
      expect(labelKey).not.toBeNull();
      expect(en[labelKey as string]).toBeTruthy();
      expect(zh[labelKey as string]).toBeTruthy();
    }
  });
});

describe('hasRemoteUpdateCandidateIdentity (Phase R3 review)', () => {
  const base = {
    status: 'required' as const,
    currentVersion: '1.0.0',
    currentManifestHash: 'sha256-current',
    remoteVersion: '2.0.0',
    remoteManifestHash: 'sha256-remote',
    changeSummary: null,
    permissionDelta: 'none' as const,
    addedPermissions: null,
    keyChanged: false,
    requiresUserConfirmation: false,
    publisherFingerprint: 'sha256-fp',
    health: { status: 'reachable' as const, checkedAt: '2026-08-05T00:00:00.000Z' },
  };

  test('accepts a complete verified candidate identity', () => {
    expect(hasRemoteUpdateCandidateIdentity(base)).toBe(true);
  });

  test('rejects when ANY ONE identity field is missing or empty', () => {
    expect(hasRemoteUpdateCandidateIdentity({ ...base, remoteVersion: null })).toBe(false);
    expect(hasRemoteUpdateCandidateIdentity({ ...base, remoteVersion: '' })).toBe(false);
    expect(hasRemoteUpdateCandidateIdentity({ ...base, remoteManifestHash: null })).toBe(false);
    expect(hasRemoteUpdateCandidateIdentity({ ...base, remoteManifestHash: '' })).toBe(false);
    expect(hasRemoteUpdateCandidateIdentity({ ...base, publisherFingerprint: null })).toBe(false);
    expect(hasRemoteUpdateCandidateIdentity({ ...base, publisherFingerprint: '' })).toBe(false);
  });
});

describe('shouldOpenRemoteUpdateDialog (Phase R3 review)', () => {
  const base = {
    currentVersion: '1.0.0',
    currentManifestHash: 'sha256-current',
    remoteVersion: '2.0.0',
    remoteManifestHash: 'sha256-remote',
    changeSummary: null,
    permissionDelta: 'none' as const,
    addedPermissions: null,
    keyChanged: false,
    publisherFingerprint: 'sha256-fp',
    health: { status: 'reachable' as const, checkedAt: '2026-08-05T00:00:00.000Z' },
  };

  test('opens the dialog for any REQUIRED lifecycle with complete candidate identity, including no-confirmation ones', () => {
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'required', requiresUserConfirmation: false })).toBe(true);
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'required', requiresUserConfirmation: true })).toBe(true);
  });

  test('opens the dialog for a consent-awaiting available update with complete identity and keeps plain updates as toasts', () => {
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'available', requiresUserConfirmation: true })).toBe(true);
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'available', requiresUserConfirmation: false })).toBe(false);
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'none', requiresUserConfirmation: false })).toBe(false);
  });

  test('does NOT open the dialog for a persisted required block whose current probe is unreachable/unverifiable (all identity fields null)', () => {
    expect(shouldOpenRemoteUpdateDialog({
      ...base,
      status: 'required',
      requiresUserConfirmation: false,
      remoteVersion: null,
      remoteManifestHash: null,
      publisherFingerprint: null,
    })).toBe(false);
  });

  test('rejects the dialog when ANY ONE candidate identity field is missing', () => {
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'required', requiresUserConfirmation: false, remoteVersion: null })).toBe(false);
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'required', requiresUserConfirmation: false, remoteManifestHash: null })).toBe(false);
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'required', requiresUserConfirmation: false, publisherFingerprint: null })).toBe(false);
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'available', requiresUserConfirmation: true, remoteManifestHash: '' })).toBe(false);
    expect(shouldOpenRemoteUpdateDialog({ ...base, status: 'required', requiresUserConfirmation: true, remoteVersion: '' })).toBe(false);
  });
});

describe('R3 translation audit (Phase R3 review)', () => {
  // EXACT R3-added keys (33 settings + 3 workbench) — audited across every
  // locale dictionary without touching unrelated keys.
  const R3_SETTINGS_KEYS = [
    'settings.interactiveUI.remote.healthUnknown',
    'settings.interactiveUI.remote.healthReachable',
    'settings.interactiveUI.remote.healthUnreachable',
    'settings.interactiveUI.remote.healthTrustInvalid',
    'settings.interactiveUI.remote.updateNone',
    'settings.interactiveUI.remote.updateAvailable',
    'settings.interactiveUI.remote.updateRequired',
    'settings.interactiveUI.remote.blockedRequired',
    'settings.interactiveUI.actions.checkHealthUpdates',
    'settings.interactiveUI.remoteUpdate.title',
    'settings.interactiveUI.permissionGroups.resourceOrigins',
    'settings.interactiveUI.permissionGroups.networkOrigins',
    'settings.interactiveUI.permissionGroups.externalLinkOrigins',
    'settings.interactiveUI.permissionGroups.credentialScopes',
    'settings.interactiveUI.permissionGroups.actionIds',
    'settings.interactiveUI.permissionGroups.agentToolNames',
    'settings.interactiveUI.permissionGroups.clipboard',
    'settings.interactiveUI.permissionGroups.popups',
    'settings.interactiveUI.permissionGroups.nativeCode',
    'settings.interactiveUI.remoteUpdate.description',
    'settings.interactiveUI.remoteUpdate.requiredDescription',
    'settings.interactiveUI.remoteUpdate.app',
    'settings.interactiveUI.remoteUpdate.versionChange',
    'settings.interactiveUI.remoteUpdate.changeSummary',
    'settings.interactiveUI.remoteUpdate.addedPermissions',
    'settings.interactiveUI.remoteUpdate.keyChanged',
    'settings.interactiveUI.remoteUpdate.nativeCodeWarning',
    'settings.interactiveUI.remoteUpdate.confirm',
    'settings.interactiveUI.remoteUpdate.notNow',
    'settings.interactiveUI.toast.remoteUpdateApplied',
    'settings.interactiveUI.toast.remoteUpdatePending',
    'settings.interactiveUI.toast.remoteUpdateRequired',
    'settings.interactiveUI.toast.remoteUpdateNone',
  ];
  const R3_WORKBENCH_KEYS = [
    'workbench.catalog.lifecycleBlocked',
    'workbench.catalog.lifecycleBlockedReason',
    'workbench.catalog.lifecycleUnreachable',
  ];
  const LOCALES = ['es', 'fr', 'ja', 'ko', 'pl', 'pt-BR', 'uk', 'zh-CN', 'zh-TW'];
  const PARAMETERIZED = [
    'settings.interactiveUI.remoteUpdate.description',
    'settings.interactiveUI.remoteUpdate.requiredDescription',
  ];

  const SETTINGS_DICTS: Record<string, Record<string, string>> = {
    en: enSettingsDict,
    es: esSettingsDict,
    fr: frSettingsDict,
    ja: jaSettingsDict,
    ko: koSettingsDict,
    pl: plSettingsDict,
    'pt-BR': ptBrSettingsDict,
    uk: ukSettingsDict,
    'zh-CN': zhCnSettingsDict,
    'zh-TW': zhTwSettingsDict,
  };
  const DICTS: Record<string, Record<string, string>> = {
    en: enDict,
    es: esDict,
    fr: frDict,
    ja: jaDict,
    ko: koDict,
    pl: plDict,
    'pt-BR': ptBrDict,
    uk: ukDict,
    'zh-CN': zhCnDict,
    'zh-TW': zhTwDict,
  };

  test('every R3 key is present and nonblank in every locale dictionary', () => {
    for (const locale of ['en', ...LOCALES]) {
      const settings = SETTINGS_DICTS[locale];
      const dict = DICTS[locale];
      for (const key of R3_SETTINGS_KEYS) {
        expect(typeof settings[key]).toBe('string');
        expect(settings[key].trim().length).toBeGreaterThan(0);
      }
      for (const key of R3_WORKBENCH_KEYS) {
        expect(typeof dict[key]).toBe('string');
        expect(dict[key].trim().length).toBeGreaterThan(0);
      }
    }
  });

  test('every non-English R3 value is a real translation, not a byte-identical English copy', () => {
    const enSettings = enSettingsDict as Record<string, string>;
    const enTopLevel = enDict as Record<string, string>;
    for (const locale of LOCALES) {
      const settings = SETTINGS_DICTS[locale];
      const dict = DICTS[locale];
      for (const key of R3_SETTINGS_KEYS) {
        expect(settings[key]).not.toBe(enSettings[key]);
      }
      for (const key of R3_WORKBENCH_KEYS) {
        expect(dict[key]).not.toBe(enTopLevel[key]);
      }
    }
  });

  test('parameterized R3 translations preserve the exact {name} placeholder', () => {
    const enSettings = enSettingsDict as Record<string, string>;
    for (const locale of LOCALES) {
      const settings = SETTINGS_DICTS[locale];
      for (const key of PARAMETERIZED) {
        expect(settings[key]).toContain('{name}');
        expect(enSettings[key]).toContain('{name}');
      }
    }
  });
});
