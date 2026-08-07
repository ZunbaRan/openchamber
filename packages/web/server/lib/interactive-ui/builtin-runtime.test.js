import { describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createBuiltInInteractiveUIRuntime } from './builtin-runtime.js';
import { createInteractiveUIRuntime } from './runtime.js';

describe('production built-in Interactive UI runtime', () => {
  it('ships valid Generated and Gallery Views, three Agent Tools, and the routing Skill', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    expect(builtIn.version).toBe('1.3.0');
    expect(Object.keys(builtIn.legacyAssets).sort()).toEqual([
      'skills/interactive-ui-visualization/SKILL.md',
      'tools/html_artifact.ts',
      'tools/interactive_ui.ts',
    ]);
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
      'com.openchamber.builtin.interactive-ui.gallery',
      'com.openchamber.builtin.interactive-ui.process-flow',
      'com.openchamber.builtin.interactive-ui.generated',
    ]);

    const generated = await runtime.getViewDescriptor(
      'com.openchamber.builtin.interactive-ui.generated',
      'interactive_ui',
    );
    expect(generated.declarative.layout).toMatchObject({ type: 'generated-layout' });
    const gallery = await runtime.getViewDescriptor(
      'com.openchamber.builtin.interactive-ui.gallery',
      'interactive_ui_gallery',
    );
    expect(gallery.declarative.layout).toMatchObject({ type: 'generated-layout' });
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
