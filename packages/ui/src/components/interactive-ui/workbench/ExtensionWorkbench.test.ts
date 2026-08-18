import { describe, expect, test } from 'bun:test';

import type { McpAppResultEnvelope } from '@/lib/interactive-ui/mcpApp';
import type { WorkbenchExtensionDescriptor, WorkbenchGeneratedSnapshot } from '@/lib/interactive-ui/workbench';
import {
  persistMcpAppWorkbenchSnapshot,
  persistMcpAppOriginToolPart,
  refreshMcpAppWorkbenchSnapshot,
  resolveWorkbenchExtensionLifecycleState,
  resolveWorkbenchMcpAppFocusDisplayMode,
  resolveWorkbenchPrimaryDisplayAction,
} from './ExtensionWorkbench';

const envelope = (revision: number, resourceUri = 'ui://tldraw/canvas.html') => ({
  $schema: 'openchamber://mcp-app-result/v1',
  schemaVersion: 1,
  source: 'mcp-app',
  title: 'tldraw_open_canvas',
  binding: {
    server: 'tldraw-local',
    tool: 'tldraw_open_canvas',
    toolKey: 'tldraw-local_tldraw_open_canvas',
    resourceUri,
    meta: {
      resourceUri,
      visibility: ['model', 'app'],
    },
  },
  arguments: { canvasId: 'service-topology' },
  result: {
    content: [{ type: 'text', text: `Revision ${revision}` }],
    structuredContent: {
      canvasId: 'service-topology',
      revision,
    },
  },
}) satisfies McpAppResultEnvelope;

const snapshot = (currentEnvelope: McpAppResultEnvelope): WorkbenchGeneratedSnapshot => ({
  $schema: 'openchamber://extension-workbench-snapshot/v1',
  schemaVersion: 1,
  snapshotRef: 'snapshot_original',
  form: 'mcp-app',
  envelope: currentEnvelope,
  createdAt: '2026-08-02T00:00:00.000Z',
});

describe('Extension Workbench MCP App entry', () => {
  test('routes the App Board fullscreen glyph through MCP display-mode negotiation', () => {
    expect(resolveWorkbenchPrimaryDisplayAction('mcp-app')).toBe('mcp-fullscreen');
    expect(resolveWorkbenchPrimaryDisplayAction('interactive-ui')).toBe('focus');
    expect(resolveWorkbenchPrimaryDisplayAction('html-artifact')).toBe('focus');
    expect(resolveWorkbenchPrimaryDisplayAction('mcp-app', true)).toBe('exit-focus');
    expect(resolveWorkbenchPrimaryDisplayAction('interactive-ui', true)).toBe('exit-focus');
  });

  test('keeps MCP display mode synchronized with host tile focus', () => {
    expect(resolveWorkbenchMcpAppFocusDisplayMode('mcp-app', true, false)).toBe('fullscreen');
    expect(resolveWorkbenchMcpAppFocusDisplayMode('mcp-app', true, true)).toBe('fullscreen');
    expect(resolveWorkbenchMcpAppFocusDisplayMode('mcp-app', false, true)).toBe('inline');
    expect(resolveWorkbenchMcpAppFocusDisplayMode('mcp-app', false, false)).toBeNull();
    expect(resolveWorkbenchMcpAppFocusDisplayMode('interactive-ui', true, false)).toBeNull();
  });

  test('refreshes a pinned MCP App snapshot only for the same bound server resource', () => {
    const initial = snapshot(envelope(4));
    const refreshed = refreshMcpAppWorkbenchSnapshot(initial, envelope(5));

    expect(refreshed).not.toBe(initial);
    expect(refreshed.envelope.$schema).toBe('openchamber://mcp-app-result/v1');
    expect((refreshed.envelope as McpAppResultEnvelope).result.structuredContent).toEqual({
      canvasId: 'service-topology',
      revision: 5,
    });

    const wrongBinding = refreshMcpAppWorkbenchSnapshot(
      refreshed,
      envelope(6, 'ui://tldraw/another-canvas.html'),
    );
    expect(wrongBinding).toBe(refreshed);
  });

  test('persists same-binding MCP App updates and returns the authoritative snapshot', async () => {
    const initial = snapshot(envelope(4));
    const authoritative = {
      ...snapshot(envelope(5)),
      snapshotRef: 'snapshot_revision_5',
    };
    let persistedEnvelope: McpAppResultEnvelope | null = null;

    const persisted = await persistMcpAppWorkbenchSnapshot(
      initial,
      envelope(5),
      async (nextEnvelope) => {
        persistedEnvelope = nextEnvelope;
        return authoritative;
      },
    );

    expect(persistedEnvelope).toEqual(envelope(5));
    expect(persisted).toBe(authoritative);
    expect(persisted.snapshotRef).toBe('snapshot_revision_5');
  });

  test('rejects binding changes before invoking snapshot persistence', async () => {
    let calls = 0;
    const initial = snapshot(envelope(4));

    await expect(
      persistMcpAppWorkbenchSnapshot(
        initial,
        envelope(5, 'ui://tldraw/another-canvas.html'),
        async () => {
          calls += 1;
          return initial;
        },
      ),
    ).rejects.toThrow('snapshot binding changed');
    expect(calls).toBe(0);
  });

  test('persists App Board model context into the canonical origin ToolPart', async () => {
    const currentEnvelope = envelope(4);
    const originPart = {
      id: 'prt_tldraw',
      sessionID: 'ses_tldraw',
      messageID: 'msg_tldraw',
      type: 'tool' as const,
      callID: 'call_tldraw',
      tool: currentEnvelope.binding.toolKey,
      state: {
        status: 'completed' as const,
        input: currentEnvelope.arguments,
        output: 'Revision 4',
        title: '',
        metadata: { mcpApp: currentEnvelope.binding, structuredContent: { revision: 4 } },
        time: { start: 1, end: 2 },
      },
    };
    let writtenOutput = '';
    const persisted = await persistMcpAppOriginToolPart(
      originPart,
      envelope(5),
      async (part) => {
        if (part.state.status !== 'completed') throw new Error('expected completed');
        writtenOutput = part.state.output;
        return part;
      },
    );
    expect(persisted.state.status).toBe('completed');
    expect(writtenOutput).toContain('Revision 5');
    expect(writtenOutput).toContain('"revision":5');
  });
});

describe('Extension Workbench Remote lifecycle state (Phase R3)', () => {
  const baseExtension = (overrides: Record<string, unknown> = {}): WorkbenchExtensionDescriptor => ({
    id: 'com.acme.remote',
    name: 'Acme Remote',
    shortName: 'Remote',
    version: '1.0.0',
    iconPath: null,
    surfaces: [{
      extensionId: 'com.acme.remote',
      extensionVersion: '1.0.0',
      surfaceId: 'com.acme.remote.overview',
      surfaceKind: 'view',
      form: 'interactive-ui',
      runtime: 'declarative',
      title: 'Overview',
      description: null,
      manualLaunch: { enabled: true, missingRequiredPaths: [], reason: undefined },
      dashboard: null,
    }],
    links: [],
    ...overrides,
  });

  test('blocks launching only for required/trust_invalid/blocked, not merely unreachable', () => {
    expect(resolveWorkbenchExtensionLifecycleState(baseExtension())).toEqual({
      blocked: false,
      unreachable: false,
      warning: false,
    });
    // Unreachable is a warning; surfaces stay launchable (read-only capable).
    expect(resolveWorkbenchExtensionLifecycleState(baseExtension({
      lifecycle: { status: 'none', health: { status: 'unreachable', checkedAt: '2026-08-05T00:00:00.000Z', code: 'hosted_manifest_unavailable' } },
    }))).toEqual({ blocked: false, unreachable: true, warning: true });
    // Required update: blocked.
    expect(resolveWorkbenchExtensionLifecycleState(baseExtension({
      lifecycle: { status: 'required', health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' }, requiresUserConfirmation: true },
    }))).toEqual({ blocked: true, unreachable: false, warning: true });
    // Persisted blocked detail: blocked.
    expect(resolveWorkbenchExtensionLifecycleState(baseExtension({
      lifecycle: { status: 'none', health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' }, blocked: { code: 'remote_update_required_blocked' } },
    }))).toEqual({ blocked: true, unreachable: false, warning: true });
    // trust_invalid health: blocked even with no status/blocked field.
    expect(resolveWorkbenchExtensionLifecycleState(baseExtension({
      lifecycle: { status: 'none', health: { status: 'trust_invalid', checkedAt: null, code: 'publisher_untrusted' } },
    }))).toEqual({ blocked: true, unreachable: false, warning: true });
    // Healthy extension with consent-awaiting available update stays usable.
    expect(resolveWorkbenchExtensionLifecycleState(baseExtension({
      lifecycle: { status: 'available', health: { status: 'reachable', checkedAt: '2026-08-05T00:00:00.000Z' }, requiresUserConfirmation: true },
    }))).toEqual({ blocked: false, unreachable: false, warning: false });
    // Missing lifecycle block never crashes the catalog.
    expect(resolveWorkbenchExtensionLifecycleState(baseExtension({ lifecycle: undefined })))
      .toEqual({ blocked: false, unreachable: false, warning: false });
  });
});
