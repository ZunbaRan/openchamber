import { describe, expect, test } from 'bun:test';

import type { McpAppResultEnvelope } from '@/lib/interactive-ui/mcpApp';
import type { WorkbenchGeneratedSnapshot } from '@/lib/interactive-ui/workbench';
import {
  persistMcpAppWorkbenchSnapshot,
  persistMcpAppOriginToolPart,
  refreshMcpAppWorkbenchSnapshot,
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
