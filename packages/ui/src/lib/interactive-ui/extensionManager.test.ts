import { describe, expect, test } from 'bun:test';
import {
  normalizeCatalogEntries,
  normalizeManagerSnapshot,
  normalizeConnectionSnapshot,
  normalizeMarketplaceInspection,
  normalizePackageInspection,
} from './extensionManager';

describe('normalizeManagerSnapshot', () => {
  test('migrates missing lifecycle arrays and optional response collections', () => {
    const snapshot = normalizeManagerSnapshot({
      extensions: [{
        id: 'com.acme.operations',
        name: 'Operations',
        enabled: true,
        activeVersion: '1.0.0',
        versions: {
          '1.0.0': { version: '1.0.0', publisher: { name: 'Acme' } },
        },
      }],
    });
    expect(snapshot.extensions[0].activationHistory).toEqual([]);
    expect(snapshot.extensions[0].activeVersion).toBe('1.0.0');
    expect(snapshot.publishers).toEqual([]);
    expect(snapshot.marketplaces).toEqual([]);
  });

  test('returns a safe empty snapshot for unrelated or malformed API payloads', () => {
    expect(normalizeManagerSnapshot(null)).toEqual({ extensions: [], publishers: [], marketplaces: [] });
    expect(normalizeManagerSnapshot({ extensions: {}, publishers: null })).toEqual({ extensions: [], publishers: [], marketplaces: [] });
  });

  test('drops malformed marketplace catalog entries instead of crashing the page', () => {
    expect(normalizeCatalogEntries([null, { id: 'com.acme.valid', name: 'Valid', version: '1.0.0' }]))
      .toHaveLength(1);
  });

  test('normalizes package capability review without accepting malformed identities', () => {
    const inspection = normalizePackageInspection({
      extension: { id: 'com.acme.operations', name: 'Operations', version: '1.0.0' },
      publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release', fingerprint: 'sha256-value', trusted: false },
      permissions: { network: ['https://api.example.com'], nativeCode: true },
      agentRuntime: {
        tools: [{ name: 'operations_open', entry: 'agent-runtime/tools/operations_open.ts' }, null],
        skills: [{ name: 'operations-ui', entry: 'agent-runtime/skills/operations-ui/SKILL.md', files: ['SKILL.md', 42] }],
      },
    });
    expect(inspection?.agentRuntime.tools.map((tool) => tool.name)).toEqual(['operations_open']);
    expect(inspection?.permissions.nativeCode).toBe(true);
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
      }, { connector: {} }],
    })).toEqual({
      connections: [{
        extension: { id: 'com.acme.crm', name: 'CRM', version: '1.0.0' },
        connector: {
          id: 'crm-api', origin: 'https://crm.example.com', authType: 'api-key', testable: true, configurable: true, provisionable: false,
        },
        credential: { configured: true, expired: false, source: 'manual' },
      }],
    });
  });
});
