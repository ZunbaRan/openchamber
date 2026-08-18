import { describe, expect, it } from 'bun:test';
import {
  applyDashboardContextMigration,
  normalizeExtensionDashboardContract,
  sanitizeDashboardContext,
  validateExtensionIconAsset,
} from './dashboard-contract.js';

const createManifest = () => ({
  $schema: 'openchamber://extension/v1',
  id: 'com.acme.crm',
  name: 'Acme Enterprise CRM',
  shortName: 'CRM',
  icon: 'assets/crm.svg',
  version: '2.0.0',
  views: [{
    id: 'com.acme.crm.customers',
    title: 'Customers',
    runtime: 'declarative',
    entry: 'ui/customers.json',
    dashboard: {
      description: 'Browse customers',
      inputSchema: {
        type: 'object',
        properties: {
          region: { type: 'string', enum: ['all', 'apac'] },
          host: {
            type: 'object',
            properties: { projectId: { type: 'string', minLength: 1 } },
            required: ['projectId'],
          },
        },
        required: ['region', 'host'],
      },
      defaultContext: { region: 'all' },
      hostContext: [{ source: 'project.id', to: 'host.projectId' }],
      layout: {
        columns: 6,
        rows: 5,
        minColumns: 4,
        maxColumns: 12,
        minRows: 3,
        maxRows: 12,
        overflow: 'auto',
      },
      instances: 'byContext',
      refresh: { mode: 'onFocus', minimumIntervalSeconds: 30 },
      events: {
        emits: [{
          id: 'customer.selected',
          payloadSchema: {
            type: 'object',
            properties: { customerId: { type: 'string', minLength: 1 } },
            required: ['customerId'],
          },
        }],
        accepts: [],
      },
      migrations: [{
        fromVersion: '^1.0.0',
        operations: [
          { op: 'rename', from: 'territory', to: 'region' },
          { op: 'setDefault', path: 'host.projectId', value: 'migrated-project' },
        ],
      }],
    },
  }],
  artifacts: [{
    id: 'com.acme.crm.customer-detail',
    title: 'Customer detail',
    entry: 'ui/customer-detail.html',
    capabilities: { scripts: true, businessActions: [] },
    dashboard: {
      inputSchema: {
        type: 'object',
        properties: { customerId: { type: 'string', minLength: 1 } },
        required: ['customerId'],
      },
      events: { emits: [], accepts: ['customer.selected'] },
    },
  }],
  links: [{
    id: 'customer-list-to-detail',
    from: 'com.acme.crm.customers',
    event: 'customer.selected',
    to: 'com.acme.crm.customer-detail',
    map: { customerId: '$event.payload.customerId' },
    relationship: 'customer',
    placement: 'adjacent',
  }],
});

describe('OCIX extension dashboard contract', () => {
  it('normalizes mixed surfaces while deriving manual launchability', () => {
    const contract = normalizeExtensionDashboardContract(createManifest());
    expect(contract).toMatchObject({
      shortName: 'CRM',
      icon: 'assets/crm.svg',
      links: [{
        id: 'customer-list-to-detail',
        from: 'com.acme.crm.customers',
        to: 'com.acme.crm.customer-detail',
      }],
    });
    expect(contract.surfaces.get('com.acme.crm.customers')).toMatchObject({
      title: 'Customers',
      kind: 'view',
      dashboard: {
        manualLaunch: { enabled: true, missingRequiredPaths: [] },
        layout: { columns: 6, rows: 5, overflow: 'auto' },
        migrations: [{
          fromVersion: '^1.0.0',
          operations: [
            { op: 'rename', from: 'territory', to: 'region' },
            { op: 'setDefault', path: 'host.projectId', value: 'migrated-project' },
          ],
        }],
      },
    });
    expect(contract.surfaces.get('com.acme.crm.customer-detail')).toMatchObject({
      kind: 'artifact',
      dashboard: {
        manualLaunch: { enabled: false, missingRequiredPaths: ['customerId'] },
        layout: { columns: 6, rows: 4 },
      },
    });
  });

  it('applies bounded declarative migrations without executing extension code', () => {
    const dashboard = normalizeExtensionDashboardContract(createManifest())
      .surfaces.get('com.acme.crm.customers').dashboard;
    expect(applyDashboardContextMigration(
      dashboard,
      dashboard.migrations[0],
      { territory: 'apac' },
    )).toEqual({
      host: { projectId: 'migrated-project' },
      region: 'apac',
    });

    expect(() => applyDashboardContextMigration(
      dashboard,
      dashboard.migrations[0],
      { region: 'all', territory: 'apac' },
    )).toThrow('target region already exists');

    const executable = createManifest();
    executable.views[0].dashboard.migrations[0].script = 'return context';
    expect(() => normalizeExtensionDashboardContract(executable)).toThrow('unsupported field script');
  });

  it('keeps legacy manifests valid without inventing a dashboard contract', () => {
    const manifest = createManifest();
    delete manifest.shortName;
    delete manifest.icon;
    delete manifest.links;
    for (const surface of [...manifest.views, ...manifest.artifacts]) delete surface.dashboard;
    const contract = normalizeExtensionDashboardContract(manifest);
    expect(contract.shortName).toBeNull();
    expect(contract.icon).toBeNull();
    expect(contract.links).toEqual([]);
    expect(contract.surfaces.get('com.acme.crm.customers')?.dashboard).toBeNull();
  });

  it('sanitizes canonical context and removes undeclared fields', () => {
    const schema = createManifest().views[0].dashboard.inputSchema;
    expect(sanitizeDashboardContext(schema, {
      host: { ignored: true, projectId: 'project-1' },
      ignored: 'value',
      region: 'all',
    })).toEqual({
      host: { projectId: 'project-1' },
      region: 'all',
    });
    expect(() => sanitizeDashboardContext(schema, {
      host: { projectId: 'project-1' },
      region: 'invalid',
    })).toThrow('not one of the allowed values');
  });

  it('rejects executable schemas, cross-extension links, and undeclared mappings', () => {
    const executable = createManifest();
    executable.views[0].dashboard.inputSchema.$ref = 'https://attacker.example/schema.json';
    expect(() => normalizeExtensionDashboardContract(executable)).toThrow('unsupported field $ref');

    const crossExtension = createManifest();
    crossExtension.links[0].to = 'com.attacker.crm.customer-detail';
    expect(() => normalizeExtensionDashboardContract(crossExtension)).toThrow('cannot target another extension');

    const undeclaredMapping = createManifest();
    undeclaredMapping.links[0].map.secret = '$event.payload.secret';
    expect(() => normalizeExtensionDashboardContract(undeclaredMapping)).toThrow('is not declared');
  });

  it('rejects event mismatches, inconsistent layout bounds, and unsafe host context', () => {
    const eventMismatch = createManifest();
    eventMismatch.artifacts[0].dashboard.events.accepts = ['order.selected'];
    expect(() => normalizeExtensionDashboardContract(eventMismatch)).toThrow('does not accept customer.selected');

    const invalidLayout = createManifest();
    invalidLayout.views[0].dashboard.layout.columns = 3;
    expect(() => normalizeExtensionDashboardContract(invalidLayout)).toThrow('column bounds are inconsistent');

    const unsafeHost = createManifest();
    unsafeHost.views[0].dashboard.hostContext[0].source = 'customer.id';
    expect(() => normalizeExtensionDashboardContract(unsafeHost)).toThrow('source is unsupported');

    const invalidMigrationTarget = createManifest();
    invalidMigrationTarget.views[0].dashboard.migrations[0].operations[0].to = 'undeclared';
    expect(() => normalizeExtensionDashboardContract(invalidMigrationTarget)).toThrow('is not declared in inputSchema');
  });

  it('validates bounded local SVG and PNG icon assets', () => {
    expect(validateExtensionIconAsset(
      'assets/crm.svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h1v1z"/></svg>'),
    )).toMatchObject({ type: 'svg' });
    expect(() => validateExtensionIconAsset(
      'assets/crm.svg',
      Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'),
    )).toThrow('unsupported active or external content');

    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(32, 16);
    png.writeUInt32BE(32, 20);
    expect(validateExtensionIconAsset('assets/crm.png', png)).toMatchObject({
      type: 'png',
      width: 32,
      height: 32,
    });
  });
});
