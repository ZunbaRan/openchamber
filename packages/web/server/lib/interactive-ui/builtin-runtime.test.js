import { afterEach, describe, expect, it } from 'bun:test';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createBuiltInInteractiveUIRuntime } from './builtin-runtime.js';
import { reconcileOpenCodeAgentRuntime } from './agent-runtime.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

const digest = (content) => `sha256-${crypto.createHash('sha256').update(content).digest('base64')}`;

const createConfig = async (prefix = 'ocix-builtin-runtime-') => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const createExtensionRuntime = async ({
  versionsDirectory,
  id,
  version = '1.0.0',
  tool = null,
  skill = null,
}) => {
  const rootDirectory = path.join(versionsDirectory, id, version);
  const tools = [];
  const skills = [];
  if (tool) {
    const entry = `agent-runtime/tools/${tool.name}${tool.extension ?? '.ts'}`;
    await fs.mkdir(path.join(rootDirectory, 'agent-runtime', 'tools'), { recursive: true });
    await fs.writeFile(path.join(rootDirectory, ...entry.split('/')), tool.content ?? 'export default {};\n');
    tools.push({ name: tool.name, entry });
  }
  if (skill) {
    const files = ['SKILL.md', ...(skill.files ?? [])].map((file) => `agent-runtime/skills/${skill.name}/${file}`);
    for (const entry of files) {
      const target = path.join(rootDirectory, ...entry.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, entry.endsWith('SKILL.md') ? '---\nname: fixture\n---\n' : 'fixture\n');
    }
    skills.push({ name: skill.name, files });
  }
  return {
    id,
    enabled: true,
    activeVersion: version,
    versions: {
      [version]: {
        version,
        delivery: 'local',
        agentRuntime: { tools, skills },
      },
    },
  };
};

const readBuiltInManifest = async (builtIn) => JSON.parse(await fs.readFile(
  path.join(builtIn.rootDirectory, 'openchamber.extension.json'),
  'utf8',
));

describe('production built-in Interactive UI Agent Runtime package', () => {
  it('ships a self-consistent manifest and deterministic Tool/Skill asset hashes', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const manifest = await readBuiltInManifest(builtIn);

    expect(builtIn.extensionId).toBe('com.openchamber.builtin.interactive-ui');
    expect(builtIn.version).toBe('1.3.0');
    expect(manifest).toMatchObject({
      id: builtIn.extensionId,
      version: builtIn.version,
      $schema: 'openchamber://extension/v1',
    });
    expect(manifest.views.map((view) => view.id)).toEqual([
      'com.openchamber.builtin.interactive-ui.gallery',
      'com.openchamber.builtin.interactive-ui.process-flow',
      'com.openchamber.builtin.interactive-ui.generated',
    ]);
    expect(Object.keys(builtIn.legacyAssets).sort()).toEqual([
      'skills/interactive-ui-visualization/SKILL.md',
      'tools/html_artifact.ts',
      'tools/interactive_ui.ts',
    ]);

    const configDirectory = await createConfig();
    const result = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: {},
      configDirectory,
      versionsDirectory: await createConfig('ocix-builtin-versions-'),
      builtInRuntime: builtIn,
    });

    expect(result.changed).toBe(true);
    const expectedAssets = [
      ...builtIn.agentRuntime.tools.map((tool) => ({
        target: `tools/${tool.name}.ts`,
        source: tool.entry,
        kind: 'tool',
        name: tool.name,
      })),
      ...builtIn.agentRuntime.skills.flatMap((skill) => skill.files.map((entry) => ({
        target: entry.replace(/^agent-runtime\//, ''),
        source: entry,
        kind: 'skill',
        name: skill.name,
      }))),
    ];
    for (const expected of expectedAssets) {
      const content = await fs.readFile(path.join(builtIn.rootDirectory, ...expected.source.split('/')));
      const target = path.join(configDirectory, ...expected.target.split('/'));
      expect(await fs.readFile(target)).toEqual(content);
      expect(result.assets[expected.target]).toMatchObject({
        extensionId: builtIn.extensionId,
        version: builtIn.version,
        kind: expected.kind,
        name: expected.name,
        sha256: digest(content),
      });
    }

    const ownershipPath = path.join(
      configDirectory,
      'openchamber',
      `${builtIn.extensionId}.agent-runtime.v1.json`,
    );
    const ownership = JSON.parse(await fs.readFile(ownershipPath, 'utf8'));
    expect(ownership).toMatchObject({
      schemaVersion: 1,
      managedBy: 'openchamber',
      extensionId: builtIn.extensionId,
      versions: [builtIn.version],
    });
    expect(ownership.assets.map((asset) => asset.target)).toEqual(
      expectedAssets.map((asset) => asset.target).sort(),
    );
  });

  it('is idempotent on reload and returns a rollback transaction that cleans every asset', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const first = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: {},
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    });
    const ownershipPath = path.join(
      configDirectory,
      'openchamber',
      `${builtIn.extensionId}.agent-runtime.v1.json`,
    );
    const ownershipBefore = await fs.readFile(ownershipPath);

    const second = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: first.assets,
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    });
    expect(second.changed).toBe(false);
    expect(await fs.readFile(ownershipPath)).toEqual(ownershipBefore);

    await first.rollback();
    for (const target of Object.keys(first.assets)) {
      await expect(fs.stat(path.join(configDirectory, ...target.split('/')))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(fs.stat(ownershipPath)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses unmanaged Tool conflicts without overwriting user content', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const target = path.join(configDirectory, 'tools', 'interactive_ui.ts');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, 'export default { description: "user-owned" };\n');

    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: {},
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    })).rejects.toMatchObject({ code: 'agent_tool_conflict', status: 409 });
    expect(await fs.readFile(target, 'utf8')).toContain('user-owned');
    await expect(fs.stat(path.join(configDirectory, 'openchamber'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses unmanaged Skill files without overwriting the existing directory', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const target = path.join(configDirectory, 'skills', 'interactive-ui-visualization', 'SKILL.md');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, '---\nname: user-owned\ndescription: user-owned\n---\n');

    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: {},
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    })).rejects.toMatchObject({ code: 'agent_skill_conflict', status: 409 });
    expect(await fs.readFile(target, 'utf8')).toContain('name: user-owned');
    await expect(fs.stat(path.join(configDirectory, 'openchamber'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails explicitly for a missing built-in source asset and cleans failed writes', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const missing = await createConfig('ocix-builtin-missing-');
    const brokenRuntime = {
      ...builtIn,
      rootDirectory: missing,
    };
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');

    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: {},
      configDirectory,
      versionsDirectory,
      builtInRuntime: brokenRuntime,
    })).rejects.toMatchObject({ code: 'agent_runtime_source_missing' });
    await expect(fs.stat(path.join(configDirectory, 'tools'))).rejects.toMatchObject({ code: 'ENOENT' });

    let renameCount = 0;
    const failingFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'rename') {
          return async (source, destination) => {
            renameCount += 1;
            if (renameCount === 2) {
              const error = new Error('injected asset publish failure');
              error.code = 'EIO';
              throw error;
            }
            return target.rename(source, destination);
          };
        }
        return target[property];
      },
    });
    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: {},
      configDirectory: await createConfig('ocix-builtin-failure-config-'),
      versionsDirectory,
      builtInRuntime: builtIn,
      fsImpl: failingFs,
    })).rejects.toMatchObject({ code: 'EIO' });
    const failedConfig = temporaryDirectories.at(-1);
    await expect(fs.readdir(failedConfig)).resolves.toEqual([]);
  });

  it('uses persisted state plus its durable ownership inventory after restart to remove stale assets', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const first = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    });

    const restarted = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: first.assets,
      configDirectory,
      versionsDirectory,
      builtInRuntime: null,
    });

    expect(restarted.changed).toBe(true);
    expect(restarted.assets).toEqual({});
    for (const target of Object.keys(first.assets)) {
      await expect(fs.stat(path.join(configDirectory, ...target.split('/')))).rejects.toMatchObject({ code: 'ENOENT' });
    }
    await expect(fs.readdir(configDirectory)).resolves.toEqual([]);
  });

  it('never treats an edited ownership record as deletion authority', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const first = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    });
    const userTarget = path.join(configDirectory, 'tools', 'user_owned.ts');
    const userContent = Buffer.from('export default { description: "user owned" };\n');
    await fs.writeFile(userTarget, userContent);
    const ownershipPath = path.join(
      configDirectory,
      'openchamber',
      `${builtIn.extensionId}.agent-runtime.v1.json`,
    );
    const forged = JSON.parse(await fs.readFile(ownershipPath, 'utf8'));
    forged.assets.push({
      target: 'tools/user_owned.ts',
      version: builtIn.version,
      kind: 'tool',
      name: 'user_owned',
      sha256: digest(userContent),
    });
    await fs.writeFile(ownershipPath, `${JSON.stringify(forged, null, 2)}\n`);

    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: first.assets,
      configDirectory,
      versionsDirectory,
      builtInRuntime: null,
    })).rejects.toMatchObject({ code: 'agent_runtime_state_invalid', status: 500 });
    await expect(fs.readFile(userTarget)).resolves.toEqual(userContent);
  });

  it('fails closed when a managed asset or its durable ownership record is missing', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const first = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    });
    const missingTarget = path.join(configDirectory, 'tools', 'interactive_ui_gallery.ts');
    await fs.rm(missingTarget);
    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: first.assets,
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    })).rejects.toMatchObject({ code: 'agent_runtime_modified', status: 409 });

    await fs.writeFile(
      missingTarget,
      await fs.readFile(path.join(builtIn.rootDirectory, 'agent-runtime', 'tools', 'interactive_ui_gallery.ts')),
    );
    await fs.rm(path.join(
      configDirectory,
      'openchamber',
      `${builtIn.extensionId}.agent-runtime.v1.json`,
    ));
    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: first.assets,
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    })).rejects.toMatchObject({ code: 'agent_runtime_state_invalid', status: 500 });
  });

  it('does not adopt an unmanaged file merely because its bytes equal the desired Tool', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const target = path.join(configDirectory, 'tools', 'interactive_ui_gallery.ts');
    const source = path.join(builtIn.rootDirectory, 'agent-runtime', 'tools', 'interactive_ui_gallery.ts');
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, await fs.readFile(source));

    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    })).rejects.toMatchObject({ code: 'agent_tool_conflict', status: 409 });
    expect(await fs.readFile(target)).toEqual(await fs.readFile(source));
  });

  it('rejects cross-extension Tool name collisions and managed source escapes', async () => {
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const configDirectory = await createConfig();
    const first = await createExtensionRuntime({
      versionsDirectory,
      id: 'com.example.first',
      tool: { name: 'shared', extension: '.ts' },
    });
    const second = await createExtensionRuntime({
      versionsDirectory,
      id: 'com.example.second',
      tool: { name: 'shared', extension: '.js' },
    });
    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: { [first.id]: first, [second.id]: second } },
      configDirectory,
      versionsDirectory,
    })).rejects.toMatchObject({ code: 'agent_runtime_conflict', status: 409 });
    await expect(fs.readdir(configDirectory)).resolves.toEqual([]);

    const outside = await createConfig('ocix-builtin-outside-');
    const escapedRoot = path.join(outside, '1.0.0');
    await fs.mkdir(path.join(escapedRoot, 'agent-runtime', 'tools'), { recursive: true });
    await fs.writeFile(path.join(escapedRoot, 'agent-runtime', 'tools', 'escape.ts'), 'export default {};\n');
    const symlinkId = 'com.example.escape';
    await fs.symlink(outside, path.join(versionsDirectory, symlinkId));
    const escaped = {
      id: symlinkId,
      enabled: true,
      activeVersion: '1.0.0',
      versions: {
        '1.0.0': {
          version: '1.0.0',
          delivery: 'local',
          agentRuntime: {
            tools: [{ name: 'escape', entry: 'agent-runtime/tools/escape.ts' }],
            skills: [],
          },
        },
      },
    };
    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: { [escaped.id]: escaped } },
      configDirectory,
      versionsDirectory,
    })).rejects.toMatchObject({ code: 'agent_runtime_source_invalid', status: 500 });

    const remoteSymlinkId = 'com.example.remote-escape';
    await fs.symlink(outside, path.join(versionsDirectory, remoteSymlinkId));
    const remoteEscaped = {
      ...escaped,
      id: remoteSymlinkId,
      versions: {
        '1.0.0': {
          ...escaped.versions['1.0.0'],
          delivery: 'remote',
          source: {
            type: 'remote',
            appEntryUrl: 'https://apps.example.com/manifest.json',
          },
        },
      },
    };
    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: { [remoteEscaped.id]: remoteEscaped } },
      configDirectory,
      versionsDirectory,
    })).rejects.toMatchObject({ code: 'agent_runtime_source_invalid', status: 500 });

    const hosted = {
      ...escaped,
      id: 'com.example.hosted',
      versions: {
        '1.0.0': {
          ...escaped.versions['1.0.0'],
          delivery: 'hosted',
          hosted: { lastGood: { version: '../../outside' } },
        },
      },
    };
    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: { [hosted.id]: hosted } },
      configDirectory,
      versionsDirectory,
      hostedCacheDirectory: versionsDirectory,
    })).rejects.toMatchObject({ code: 'agent_runtime_state_invalid', status: 500 });
  });

  it('records the actual Hosted last-good runtime version', async () => {
    const hostedCacheDirectory = await createConfig('ocix-builtin-hosted-');
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const configDirectory = await createConfig();
    const hostedSource = await createExtensionRuntime({
      versionsDirectory: hostedCacheDirectory,
      id: 'com.example.hosted-runtime',
      version: '2.0.0',
      tool: { name: 'hosted_tool', content: 'export default { version: "2.0.0" };\n' },
    });
    const state = {
      id: hostedSource.id,
      enabled: true,
      activeVersion: '1.0.0',
      versions: {
        '1.0.0': {
          version: '1.0.0',
          delivery: 'hosted',
          hosted: { lastGood: { version: '2.0.0' } },
          agentRuntime: hostedSource.versions['2.0.0'].agentRuntime,
        },
      },
    };
    const result = await reconcileOpenCodeAgentRuntime({
      state: { extensions: { [state.id]: state } },
      configDirectory,
      versionsDirectory,
      hostedCacheDirectory,
    });
    expect(result.assets['tools/hosted_tool.ts'].version).toBe('2.0.0');
    expect(await fs.readFile(path.join(configDirectory, 'tools', 'hosted_tool.ts'), 'utf8'))
      .toContain('2.0.0');
  });

  it('materializes a Manager-owned Direct Remote shell from the versions store', async () => {
    const versionsDirectory = await createConfig('ocix-remote-versions-');
    const hostedCacheDirectory = await createConfig('ocix-remote-hosted-cache-');
    const configDirectory = await createConfig('ocix-remote-config-');
    const remoteToolContent = 'export default { source: "remote" };\n';
    const remote = await createExtensionRuntime({
      versionsDirectory,
      id: 'com.example.remote-runtime',
      version: '1.0.0',
      tool: { name: 'remote_tool', content: remoteToolContent },
    });
    await createExtensionRuntime({
      versionsDirectory: hostedCacheDirectory,
      id: remote.id,
      version: '1.0.0',
      tool: { name: 'remote_tool', content: 'export default { source: "poisoned-hosted-cache" };\n' },
    });
    remote.versions['1.0.0'].delivery = 'remote';
    remote.versions['1.0.0'].source = {
      type: 'remote',
      appEntryUrl: 'https://apps.example.com/manifest.json',
    };
    remote.versions['1.0.0'].remote = {
      status: 'active',
      connectorRefs: [{ id: 'crm', origin: 'https://api.example.com', authType: 'api-key' }],
    };

    const first = await reconcileOpenCodeAgentRuntime({
      state: { extensions: { [remote.id]: remote } },
      previousAssets: {},
      configDirectory,
      versionsDirectory,
      hostedCacheDirectory,
    });
    expect(first.assets['tools/remote_tool.ts']).toMatchObject({
      extensionId: remote.id,
      version: '1.0.0',
      kind: 'tool',
      name: 'remote_tool',
    });
    await expect(fs.readFile(path.join(configDirectory, 'tools', 'remote_tool.ts'), 'utf8'))
      .resolves.toBe(remoteToolContent);
    expect(first.assets['tools/remote_tool.ts'].sha256).toBe(digest(remoteToolContent));

    const reloaded = await reconcileOpenCodeAgentRuntime({
      state: { extensions: { [remote.id]: remote } },
      previousAssets: first.assets,
      configDirectory,
      versionsDirectory,
      hostedCacheDirectory,
    });
    expect(reloaded.changed).toBe(false);

    remote.enabled = false;
    const cleaned = await reconcileOpenCodeAgentRuntime({
      state: { extensions: { [remote.id]: remote } },
      previousAssets: reloaded.assets,
      configDirectory,
      versionsDirectory,
      hostedCacheDirectory,
    });
    expect(cleaned.changed).toBe(true);
    expect(cleaned.assets).toEqual({});
    await expect(fs.stat(path.join(configDirectory, 'tools', 'remote_tool.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('publishes ownership only after assets and removes ownership only after assets', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const installConfig = await createConfig();
    const renameTargets = [];
    const observingInstallFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'rename') {
          return async (source, destination) => {
            renameTargets.push(destination);
            return target.rename(source, destination);
          };
        }
        return target[property];
      },
    });
    const installed = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      configDirectory: installConfig,
      versionsDirectory,
      builtInRuntime: builtIn,
      fsImpl: observingInstallFs,
    });
    const ownershipPath = path.join(
      installConfig,
      'openchamber',
      `${builtIn.extensionId}.agent-runtime.v1.json`,
    );
    const ownershipRename = renameTargets.indexOf(ownershipPath);
    const assetRenames = Object.keys(installed.assets)
      .map((target) => renameTargets.indexOf(path.join(installConfig, ...target.split('/'))));
    expect(assetRenames.every((index) => index >= 0 && index < ownershipRename)).toBe(true);

    const removedTargets = [];
    const observingRemovalFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'rm') {
          return async (candidate, options) => {
            removedTargets.push(candidate);
            return target.rm(candidate, options);
          };
        }
        return target[property];
      },
    });
    await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: installed.assets,
      configDirectory: installConfig,
      versionsDirectory,
      builtInRuntime: null,
      fsImpl: observingRemovalFs,
    });
    const ownershipRemoval = removedTargets.indexOf(ownershipPath);
    const assetRemovals = Object.keys(installed.assets)
      .map((target) => removedTargets.indexOf(path.join(installConfig, ...target.split('/'))));
    expect(assetRemovals.every((index) => index >= 0 && index < ownershipRemoval)).toBe(true);
  });

  it('fails closed when a newly-created target is replaced before rollback', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const deployment = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    });
    const target = path.join(configDirectory, 'tools', 'interactive_ui.ts');
    const externalContent = Buffer.from('export default { description: "external owner" };\n');
    await fs.writeFile(target, externalContent);

    await expect(deployment.rollback()).rejects.toMatchObject({
      code: 'agent_runtime_rollback_failed',
      status: 500,
    });
    await expect(fs.readFile(target)).resolves.toEqual(externalContent);
    await expect(fs.stat(path.join(
      configDirectory,
      'openchamber',
      '.agent-runtime.transaction.v1.json',
    ))).resolves.toBeDefined();
  });

  it('fails closed when an overwritten managed target is externally modified before rollback', async () => {
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const configDirectory = await createConfig();
    const firstExtension = await createExtensionRuntime({
      versionsDirectory,
      id: 'com.example.rollback-overwrite',
      version: '1.0.0',
      tool: { name: 'rollback_tool', content: 'export default { version: "one" };\n' },
    });
    const first = await reconcileOpenCodeAgentRuntime({
      state: { extensions: { [firstExtension.id]: firstExtension } },
      configDirectory,
      versionsDirectory,
    });
    const secondExtension = await createExtensionRuntime({
      versionsDirectory,
      id: firstExtension.id,
      version: '2.0.0',
      tool: { name: 'rollback_tool', content: 'export default { version: "two" };\n' },
    });
    const second = await reconcileOpenCodeAgentRuntime({
      state: { extensions: { [secondExtension.id]: secondExtension } },
      previousAssets: first.assets,
      configDirectory,
      versionsDirectory,
    });
    const target = path.join(configDirectory, 'tools', 'rollback_tool.ts');
    const externalContent = Buffer.from('export default { description: "external overwrite" };\n');
    await fs.writeFile(target, externalContent);

    await expect(second.rollback()).rejects.toMatchObject({
      code: 'agent_runtime_rollback_failed',
      status: 500,
    });
    await expect(fs.readFile(target)).resolves.toEqual(externalContent);
    await expect(fs.stat(path.join(
      configDirectory,
      'openchamber',
      '.agent-runtime.transaction.v1.json',
    ))).resolves.toBeDefined();
  });

  it('surfaces atomic temporary cleanup residue and blocks later reconciliation', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const failingFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'rename') {
          return async () => {
            const error = new Error('injected publish failure');
            error.code = 'EIO';
            throw error;
          };
        }
        if (property === 'rm') {
          return async (candidate, options) => {
            if (String(candidate).endsWith('.tmp')) {
              const error = new Error('injected temporary cleanup failure');
              error.code = 'EACCES';
              throw error;
            }
            return target.rm(candidate, options);
          };
        }
        return target[property];
      },
    });
    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
      fsImpl: failingFs,
    })).rejects.toMatchObject({ code: 'agent_runtime_rollback_failed', status: 500 });
    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
    })).rejects.toMatchObject({ code: 'agent_runtime_recovery_required', status: 500 });
  });

  it('never follows a managed-target ancestor symlink during removal', async () => {
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    const configDirectory = await createConfig();
    const extension = await createExtensionRuntime({
      versionsDirectory,
      id: 'com.example.skill',
      skill: { name: 'safe-skill', files: ['nested/payload.txt'] },
    });
    const first = await reconcileOpenCodeAgentRuntime({
      state: { extensions: { [extension.id]: extension } },
      configDirectory,
      versionsDirectory,
    });
    const outside = await createConfig('ocix-builtin-outside-');
    const outsideNested = path.join(outside, 'nested');
    await fs.mkdir(outsideNested);
    const outsidePayload = path.join(outsideNested, 'payload.txt');
    await fs.writeFile(outsidePayload, 'fixture\n');
    const managedNested = path.join(configDirectory, 'skills', 'safe-skill', 'nested');
    await fs.rm(managedNested, { recursive: true });
    await fs.symlink(outsideNested, managedNested);

    await expect(reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      previousAssets: first.assets,
      configDirectory,
      versionsDirectory,
    })).rejects.toMatchObject({ code: 'agent_runtime_modified', status: 409 });
    await expect(fs.readFile(outsidePayload, 'utf8')).resolves.toBe('fixture\n');
  });

  it('reports rollback failures instead of claiming a successful restoration', async () => {
    const builtIn = createBuiltInInteractiveUIRuntime();
    const configDirectory = await createConfig();
    const versionsDirectory = await createConfig('ocix-builtin-versions-');
    let failRollback = false;
    const failingFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'rm') {
          return async (candidate, options) => {
            if (failRollback && candidate === path.join(configDirectory, 'tools', 'interactive_ui_gallery.ts')) {
              const error = new Error('injected rollback failure');
              error.code = 'EACCES';
              throw error;
            }
            return target.rm(candidate, options);
          };
        }
        return target[property];
      },
    });
    const deployment = await reconcileOpenCodeAgentRuntime({
      state: { extensions: {} },
      configDirectory,
      versionsDirectory,
      builtInRuntime: builtIn,
      fsImpl: failingFs,
    });
    failRollback = true;
    await expect(deployment.rollback()).rejects.toMatchObject({
      code: 'agent_runtime_rollback_failed',
      status: 500,
    });
    await expect(fs.stat(path.join(configDirectory, 'tools', 'interactive_ui_gallery.ts'))).resolves.toBeDefined();
  });
});
