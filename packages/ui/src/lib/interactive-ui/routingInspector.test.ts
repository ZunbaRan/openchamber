import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { InteractiveUIRoutingContext } from './routing';

mock.module('@/lib/runtime-switch', () => ({
  getRuntimeKey: () => 'runtime-a',
}));

const {
  buildRoutingDiagnosticsReport,
  getRoutingInspectionSnapshot,
  recordRoutingDispatch,
  recordRoutingDispatchFailure,
  recordRoutingArtifactObservation,
  recordRoutingToolObservation,
  recordRoutingViewObservation,
  resetRoutingInspectorForTests,
} = await import(`./routingInspector?test=${Date.now()}`);

const context: InteractiveUIRoutingContext = {
  runtimeKey: 'runtime-a',
  revision: 'sha256-routing-revision',
  system: '<openchamber_interactive_ui_routing />',
  skippedExtensions: 0,
  extensions: [{
    id: 'com.acme.crm',
    version: '1.0.0',
    domain: 'crm',
    dataAuthority: 'connected-business-system',
    connection: { required: true, configured: true, expired: false, status: 'configured' },
    tools: [{
      name: 'crm_open_overview',
      views: ['com.acme.crm.overview'],
      intents: ['crm.overview'],
      priority: 90,
      operation: 'read',
      dataAuthority: 'connected-business-system',
    }],
  }],
};

beforeEach(() => resetRoutingInspectorForTests());

describe('Interactive UI routing inspector', () => {
  test('records declared candidates and observed Tool/View stages without retaining prompt text', () => {
    const privatePrompt = 'Use crm_open_overview and include customer secret 123';
    recordRoutingDispatch({ sessionId: 'session-private', messageId: 'message-private', context, text: privatePrompt });

    const dispatched = getRoutingInspectionSnapshot()[0];
    expect(dispatched.systemInjected).toBe(true);
    expect(dispatched.status).toBe('awaiting-tool');
    expect(dispatched.candidates[0]?.tool).toBe('crm_open_overview');
    expect(dispatched.candidates[0]?.explicitlyNamed).toBe(true);

    recordRoutingToolObservation({
      sessionId: 'session-private',
      toolPartId: 'tool-part-1',
      tool: 'crm_open_overview',
      status: 'completed',
      viewId: 'com.acme.crm.overview',
    });
    recordRoutingViewObservation({
      sessionId: 'session-private',
      toolPartId: 'tool-part-1',
      viewId: 'com.acme.crm.overview',
      status: 'rendered',
    });

    const rendered = getRoutingInspectionSnapshot()[0];
    expect(rendered.status).toBe('view-rendered');
    expect(rendered.selection?.tool).toBe('crm_open_overview');
    expect(rendered.selection?.reason).toBe('explicit-tool');
    expect(rendered.selection?.viewId).toBe('com.acme.crm.overview');
    const report = buildRoutingDiagnosticsReport();
    expect(report).not.toContain(privatePrompt);
    expect(report).not.toContain('customer secret 123');
    expect(report).not.toContain('session-private');
    expect(report).toContain('crm_open_overview');
  });

  test('classifies business selection, generic fallback, and dispatch failure from observable events', () => {
    recordRoutingDispatch({ sessionId: 'session-1', messageId: 'message-1', context, text: 'show the pipeline' });
    recordRoutingToolObservation({ sessionId: 'session-1', toolPartId: 'part-1', tool: 'crm_open_overview', status: 'running' });
    expect(getRoutingInspectionSnapshot()[0].status).toBe('tool-running');
    expect(getRoutingInspectionSnapshot()[0].selection?.reason).toBe('installed-business-tool');

    recordRoutingDispatch({ sessionId: 'session-2', messageId: 'message-2', context, text: 'draw a generic flow' });
    recordRoutingToolObservation({ sessionId: 'session-2', toolPartId: 'part-2', tool: 'interactive_ui', status: 'completed' });
    expect(getRoutingInspectionSnapshot()[0].status).toBe('tool-completed');
    expect(getRoutingInspectionSnapshot()[0].selection?.reason).toBe('generic-interactive-ui');

    recordRoutingDispatch({ sessionId: 'session-artifact', messageId: 'message-artifact', context, text: 'build a simulator' });
    recordRoutingToolObservation({ sessionId: 'session-artifact', toolPartId: 'part-artifact', tool: 'html_artifact', status: 'completed' });
    expect(getRoutingInspectionSnapshot()[0].selection?.reason).toBe('generic-html-artifact');
    recordRoutingArtifactObservation({ sessionId: 'session-artifact', toolPartId: 'part-artifact', status: 'materializing' });
    expect(getRoutingInspectionSnapshot()[0].status).toBe('artifact-materializing');
    recordRoutingArtifactObservation({ sessionId: 'session-artifact', toolPartId: 'part-artifact', status: 'rendered' });
    expect(getRoutingInspectionSnapshot()[0].status).toBe('artifact-rendered');

    recordRoutingDispatch({ sessionId: 'session-3', messageId: 'message-3' });
    recordRoutingDispatchFailure('session-3', 'message-3');
    expect(getRoutingInspectionSnapshot()[0].status).toBe('send-failed');
  });

  test('ignores unrelated Tool events and keeps a bounded trace history', () => {
    recordRoutingDispatch({ sessionId: 'session-ignore', messageId: 'message-ignore', context });
    recordRoutingToolObservation({ sessionId: 'session-ignore', toolPartId: 'part-bash', tool: 'bash', status: 'completed' });
    expect(getRoutingInspectionSnapshot()[0].selection).toBe(undefined);

    for (let index = 0; index < 60; index += 1) {
      recordRoutingDispatch({ sessionId: `session-${index}`, messageId: `message-${index}`, context });
    }
    expect(getRoutingInspectionSnapshot()).toHaveLength(50);
  });
});
