import { describe, expect, test } from 'bun:test';
import {
  advanceWorkbenchEventTrace,
  createWorkbenchEventTrace,
  resolveWorkbenchEvent,
  WorkbenchEventError,
} from './workbench-events';
import type { WorkbenchExtensionDescriptor } from './workbench';

const extension: WorkbenchExtensionDescriptor = {
  id: 'com.acme.crm',
  name: 'CRM',
  shortName: 'CRM',
  version: '1.0.0',
  iconPath: null,
  surfaces: [
    {
      extensionId: 'com.acme.crm',
      extensionVersion: '1.0.0',
      surfaceId: 'com.acme.crm.customers',
      surfaceKind: 'view',
      form: 'interactive-ui',
      runtime: 'declarative',
      title: 'Customers',
      description: null,
      manualLaunch: { enabled: true, missingRequiredPaths: [] },
      dashboard: {
        inputSchema: { type: 'object', properties: {}, required: [] },
        defaultContext: {},
        hostContext: [],
        requiredPaths: [],
        manualLaunch: { enabled: true, missingRequiredPaths: [] },
        layout: { columns: 6, rows: 4, minColumns: 2, maxColumns: 12, minRows: 2, maxRows: 12, overflow: 'auto' },
        instances: 'byContext',
        refresh: { mode: 'manual', minimumIntervalSeconds: 30 },
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
        popout: { supported: true },
      },
    },
    {
      extensionId: 'com.acme.crm',
      extensionVersion: '1.0.0',
      surfaceId: 'com.acme.crm.detail',
      surfaceKind: 'artifact',
      form: 'html-artifact',
      runtime: 'artifact',
      title: 'Customer detail',
      description: null,
      manualLaunch: { enabled: false, missingRequiredPaths: ['customerId'] },
      dashboard: {
        inputSchema: {
          type: 'object',
          properties: {
            customerId: { type: 'string', minLength: 1 },
            projectId: { type: 'string' },
          },
          required: ['customerId', 'projectId'],
        },
        defaultContext: {},
        hostContext: [],
        requiredPaths: ['customerId', 'projectId'],
        manualLaunch: { enabled: false, missingRequiredPaths: ['customerId'] },
        layout: { columns: 6, rows: 6, minColumns: 2, maxColumns: 12, minRows: 2, maxRows: 12, overflow: 'auto' },
        instances: 'byContext',
        refresh: { mode: 'manual', minimumIntervalSeconds: 30 },
        events: { emits: [], accepts: ['customer.selected'] },
        popout: { supported: true },
      },
    },
  ],
  links: [{
    id: 'customer-to-detail',
    from: 'com.acme.crm.customers',
    event: 'customer.selected',
    to: 'com.acme.crm.detail',
    map: {
      customerId: '$event.payload.customerId',
      projectId: '$host.project.id',
    },
    relationship: 'customer',
    placement: 'adjacent',
  }],
};

describe('Extension Workbench event resolver', () => {
  test('validates a declared payload and resolves only allowlisted mapping expressions', () => {
    const result = resolveWorkbenchEvent({
      extension,
      sourceSurfaceId: 'com.acme.crm.customers',
      eventId: 'customer.selected',
      payload: { customerId: 'cust-1001' },
      sourceContext: {},
      hostContext: { project: { id: 'project-1' } },
    });
    expect(result).toHaveLength(1);
    expect(result[0].link.id).toBe('customer-to-detail');
    expect(result[0].target.surfaceId).toBe('com.acme.crm.detail');
    expect(result[0].context).toEqual({ customerId: 'cust-1001', projectId: 'project-1' });
  });

  test('rejects undeclared events and invalid payloads before creating a target', () => {
    expect(() => resolveWorkbenchEvent({
      extension,
      sourceSurfaceId: 'com.acme.crm.customers',
      eventId: 'customer.deleted',
      payload: { customerId: 'cust-1001' },
      sourceContext: {},
      hostContext: {},
    })).toThrow(WorkbenchEventError);
    expect(() => resolveWorkbenchEvent({
      extension,
      sourceSurfaceId: 'com.acme.crm.customers',
      eventId: 'customer.selected',
      payload: { customerId: 1001 },
      sourceContext: {},
      hostContext: { project: { id: 'project-1' } },
    })).toThrow('$.customerId must be a string');
  });

  test('bounds multi-level links with expiry, cycle, and hop guards', () => {
    const trace = createWorkbenchEventTrace(1_000, 'trace-test');
    const first = advanceWorkbenchEventTrace(trace, 'customer-to-detail', 1_001);
    expect(first.traceId).toBe('trace-test');
    expect(first.hop).toBe(1);
    expect(first.visitedLinkIds).toEqual(['customer-to-detail']);
    expect(() => advanceWorkbenchEventTrace(first, 'customer-to-detail', 1_002))
      .toThrow(WorkbenchEventError);
    let current = first;
    for (let index = 1; index < 8; index += 1) {
      current = advanceWorkbenchEventTrace(current, `link-${index}`, 1_002 + index);
    }
    expect(() => advanceWorkbenchEventTrace(current, 'link-overflow', 1_020))
      .toThrow(WorkbenchEventError);
    expect(() => advanceWorkbenchEventTrace(trace, 'late-link', 31_000))
      .toThrow(WorkbenchEventError);
  });
});
