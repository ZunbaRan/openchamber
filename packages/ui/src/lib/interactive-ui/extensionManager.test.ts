import { describe, expect, test } from 'bun:test';
import {
  classifyCatalogInstallState,
  normalizeCatalogEntries,
  normalizeManagerSnapshot,
  normalizeConnectionSnapshot,
  normalizeMarketplaceInspection,
  normalizePackageInspection,
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
