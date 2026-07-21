import { describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBuiltInInteractiveUIRuntime } from './builtin-runtime.js';
import { createInteractiveUIRuntime } from './runtime.js';

describe('production built-in Interactive UI runtime', () => {
  it('ships a valid Generated View, two Agent Tools, and the routing Skill', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const runtime = createInteractiveUIRuntime({
      fsPromises: fs,
      path,
      crypto,
      extensionRoots: [builtIn.rootDirectory],
      logger: { info() {}, warn() {} },
    });

    const listed = await runtime.listExtensions();
    expect(listed.errors).toEqual([]);
    expect(listed.extensions).toHaveLength(1);
    expect(listed.extensions[0]).toMatchObject({
      id: builtIn.extensionId,
      version: builtIn.version,
    });
    expect(listed.extensions[0].views.map((view) => view.id)).toEqual([
      'com.openchamber.builtin.interactive-ui.process-flow',
      'com.openchamber.builtin.interactive-ui.generated',
    ]);

    const generated = await runtime.getViewDescriptor(
      'com.openchamber.builtin.interactive-ui.generated',
      'interactive_ui',
    );
    expect(generated.declarative.layout).toMatchObject({ type: 'generated-layout' });
    for (const tool of builtIn.agentRuntime.tools) {
      await expect(fs.stat(path.join(builtIn.rootDirectory, ...tool.entry.split('/')))).resolves.toMatchObject({});
    }
    for (const skill of builtIn.agentRuntime.skills) {
      for (const entry of skill.files) {
        await expect(fs.stat(path.join(builtIn.rootDirectory, ...entry.split('/')))).resolves.toMatchObject({});
      }
    }
  });
});
