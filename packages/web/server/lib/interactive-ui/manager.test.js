import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createInteractiveUIExtensionManager } from './manager.js';
import { createExtensionPackage, createSignedExtensionCatalog, generatePublisherKeyPair } from './package-format.js';
import { createBuiltInInteractiveUIRuntime } from './builtin-runtime.js';

const temporaryDirectories = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

const createTemporaryDirectory = async (prefix) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
};

const createPackage = async ({
  version,
  keys,
  extensionId = 'com.acme.operations',
  extensionName = 'Acme Operations',
  toolName = 'operations_open',
  skillName = 'acme-operations',
  htmlArtifact = false,
} = {}) => {
  const domain = extensionId.split(/[._-]/).at(-1);
  const directory = await createTemporaryDirectory('ocix-manager-extension-');
  await fs.mkdir(path.join(directory, 'ui'), { recursive: true });
  await fs.mkdir(path.join(directory, 'agent-runtime', 'tools'), { recursive: true });
  await fs.mkdir(path.join(directory, 'agent-runtime', 'skills', skillName), { recursive: true });
  await fs.writeFile(path.join(directory, 'openchamber.extension.json'), JSON.stringify({
    $schema: 'openchamber://extension/v1',
    id: extensionId,
    name: extensionName,
    version,
    agentRouting: {
      domain,
      intents: [`${domain}.overview`, ...(htmlArtifact ? [`${domain}.explorer`] : [])],
      examples: { en: [`Open ${extensionName}`] },
      dataAuthority: 'user-provided',
    },
    connectors: [],
    views: [{
      id: `${extensionId}.overview`,
      runtime: 'declarative',
      entry: 'ui/view.json',
      tools: [toolName],
      routing: { intents: [`${domain}.overview`], priority: 80, operation: 'read' },
      displayModes: ['inline', 'workspace'],
    }],
    ...(htmlArtifact ? {
      artifacts: [{
        id: `${extensionId}.explorer`,
        title: `${extensionName} Explorer`,
        entry: 'ui/explorer.html',
        tools: [`${toolName}_explore`],
        routing: { intents: [`${domain}.explorer`], priority: 82, operation: 'read' },
        capabilities: { scripts: true, businessActions: [] },
      }],
    } : {}),
    actions: [],
    permissions: { network: [] },
    trust: { mode: 'declarative', signature: 'production' },
  }, null, 2));
  await fs.writeFile(path.join(directory, 'ui', 'view.json'), JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: `${extensionId}.overview`,
    layout: { type: 'text', value: `Version ${version}` },
  }));
  if (htmlArtifact) {
    await fs.writeFile(path.join(directory, 'ui', 'explorer.html'), '<!doctype html><html><body><script>document.body.dataset.ready="true"</script></body></html>');
    await fs.writeFile(path.join(directory, 'agent-runtime', 'tools', `${toolName}_explore.ts`), `export default { description: "Explore ${extensionName}" };\n`);
  }
  await fs.writeFile(path.join(directory, 'agent-runtime', 'tools', `${toolName}.ts`), `export default { description: ${JSON.stringify(`Open ${extensionName}`)}, execute: async () => ({ version: ${JSON.stringify(version)} }) };\n`);
  await fs.writeFile(path.join(directory, 'agent-runtime', 'skills', skillName, 'SKILL.md'), `---\nname: ${skillName}\ndescription: Open ${extensionName} views.\n---\n\nUse ${toolName}.\n`);
  return createExtensionPackage({
    extensionDirectory: directory,
    privateKey: keys.privateKey,
    publisherId: 'com.acme.publisher',
    publisherName: 'Acme',
    keyId: 'release-2026',
    createdAt: '2026-07-18T00:00:00.000Z',
  });
};

const trustPublisher = (manager, publicKey) => manager.trustPublisher({
  id: 'com.acme.publisher',
  name: 'Acme',
  keyId: 'release-2026',
  publicKey,
});

describe('Interactive UI extension manager', () => {
  it('installs the production built-in Tools and Skill idempotently before OpenCode starts', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-builtin-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-builtin-config-');
    let refreshCount = 0;
    const builtInRuntime = createBuiltInInteractiveUIRuntime();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      builtInRuntime,
      refreshOpenCode: async () => {
        refreshCount += 1;
        return { reloaded: true, external: false };
      },
    });

    expect(await manager.initialize()).toMatchObject({ changed: true, reloaded: false });
    expect(await manager.initialize()).toMatchObject({ changed: false, reloaded: false });
    expect(refreshCount).toBe(0);
    const installedInteractiveUITool = await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'interactive_ui.ts'), 'utf8');
    const installedInteractiveUISkill = await fs.readFile(path.join(opencodeConfigDirectory, 'skills', 'interactive-ui-visualization', 'SKILL.md'), 'utf8');
    expect(installedInteractiveUITool).toContain('openchamber://interactive-result/v1');
    expect(installedInteractiveUITool).toContain('不同量纲');
    expect(installedInteractiveUITool).toContain('interactive_ui requires at least one valid section');
    expect(installedInteractiveUITool).toContain('interactive_ui requires at least one supported widget');
    expect(installedInteractiveUITool).toContain('normalizeTableCellValue');
    expect(installedInteractiveUITool).toContain("presentation: tool.schema.enum(['stack', 'tabs', 'accordion'])");
    expect(installedInteractiveUITool).toContain('children.length > 1');
    expect(installedInteractiveUITool).toContain('inheritedMetricColumns');
    expect(installedInteractiveUITool).toContain('只补一句');
    const installedInteractiveUIGalleryTool = await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'interactive_ui_gallery.ts'), 'utf8');
    expect(installedInteractiveUIGalleryTool).toContain('com.openchamber.builtin.interactive-ui.gallery');
    expect(installedInteractiveUIGalleryTool).toContain("type: 'heatmap'");
    const installedHTMLArtifactTool = await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'html_artifact.ts'), 'utf8');
    expect(installedHTMLArtifactTool).toContain('openchamber://html-artifact-result/v1');
    expect(installedHTMLArtifactTool).toContain('禁止硬编码白色画布');
    expect(installedHTMLArtifactTool).toContain('Artifact HTML contains executable markup');
    expect(installedHTMLArtifactTool).toContain('validateArtifactHTML');
    expect(installedHTMLArtifactTool).toContain('Artifact HTML exceeds 4,000 elements');
    expect(installedHTMLArtifactTool).toContain('scripts: tool.schema.boolean().describe');
    expect(installedInteractiveUISkill).toContain('name: interactive-ui-visualization');
    expect(installedInteractiveUISkill).toContain('incompatible units');
    expect(await manager.list()).toMatchObject({
      builtInRuntime: {
        id: 'com.openchamber.builtin.interactive-ui',
        version: '1.2.1',
        status: 'ready',
      },
      extensions: [],
    });
  });

  it('adopts and upgrades an exact legacy built-in Tool while preserving arbitrary user Tools', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-builtin-legacy-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-builtin-legacy-config-');
    const legacyContent = 'export default { description: "legacy OpenChamber built-in" };\n';
    const legacySha256 = `sha256-${crypto.createHash('sha256').update(legacyContent).digest('base64')}`;
    const builtIn = createBuiltInInteractiveUIRuntime();
    const builtInRuntime = {
      ...builtIn,
      legacyAssets: {
        ...builtIn.legacyAssets,
        'tools/interactive_ui.ts': [legacySha256],
      },
    };
    const existingTool = path.join(opencodeConfigDirectory, 'tools', 'interactive_ui.ts');
    await fs.mkdir(path.dirname(existingTool), { recursive: true });
    await fs.writeFile(existingTool, legacyContent);
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      builtInRuntime,
    });

    await expect(manager.initialize()).resolves.toMatchObject({ changed: true });
    expect(await fs.readFile(existingTool, 'utf8')).toContain('openchamber://interactive-result/v1');
    expect((await manager.list()).builtInRuntime).toMatchObject({ version: '1.2.1', status: 'ready' });
  });

  it('preserves an unmanaged Tool and reports a built-in initialization conflict', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-builtin-conflict-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-builtin-conflict-config-');
    await fs.mkdir(path.join(opencodeConfigDirectory, 'tools'), { recursive: true });
    const existingTool = path.join(opencodeConfigDirectory, 'tools', 'interactive_ui.ts');
    await fs.writeFile(existingTool, 'export default { description: "user-owned" };\n');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      builtInRuntime: createBuiltInInteractiveUIRuntime(),
    });

    await expect(manager.initialize()).rejects.toMatchObject({ code: 'agent_tool_conflict' });
    expect(await fs.readFile(existingTool, 'utf8')).toContain('user-owned');
    expect((await manager.list()).builtInRuntime).toMatchObject({
      status: 'conflict',
      errorCode: 'agent_tool_conflict',
    });
  });

  it('adopts byte-identical built-in files without overwriting their content', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-builtin-adopt-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-builtin-adopt-config-');
    const builtInRuntime = createBuiltInInteractiveUIRuntime();
    const source = path.join(builtInRuntime.rootDirectory, 'agent-runtime', 'tools', 'interactive_ui.ts');
    const target = path.join(opencodeConfigDirectory, 'tools', 'interactive_ui.ts');
    const sourceContent = await fs.readFile(source);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, sourceContent);
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      builtInRuntime,
    });

    await expect(manager.initialize()).resolves.toMatchObject({ changed: true });
    expect(await fs.readFile(target)).toEqual(sourceContent);
    expect((await manager.list()).builtInRuntime.status).toBe('ready');
  });

  it('installs, updates, disables, rolls back, and recoverably uninstalls signed extensions', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-opencode-config-');
    const keys = generatePublisherKeyPair();
    const versionOne = await createPackage({ version: '1.0.0', keys });
    const versionTwo = await createPackage({ version: '1.1.0', keys });
    const refreshReasons = [];
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      refreshOpenCode: async () => {
        refreshReasons.push('refresh');
        return { reloaded: true, external: false };
      },
    });

    const inspection = await manager.inspectPackage(versionOne.buffer);
    expect(inspection.publisher.trusted).toBe(false);
    expect(inspection.agentRuntime.tools.map((tool) => tool.name)).toEqual(['operations_open']);
    expect(inspection.agentRouting).toMatchObject({
      domain: 'operations',
      intents: ['operations.overview'],
      dataAuthority: 'user-provided',
    });
    await expect(manager.installPackage(versionOne.buffer)).rejects.toMatchObject({ code: 'publisher_confirmation_required' });
    expect((await manager.installPackage(versionOne.buffer, { confirmedPublisherFingerprint: inspection.publisher.fingerprint })).installed).toBe(true);
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'), 'utf8')).toContain('1.0.0');
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'skills', 'acme-operations', 'SKILL.md'), 'utf8')).toContain('Use operations_open');
    expect((await manager.installPackage(versionTwo.buffer)).installed).toBe(true);
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'), 'utf8')).toContain('1.1.0');
    expect((await manager.getEnabledExtensionRoots())[0]).toEndWith(path.join('com.acme.operations', '1.1.0'));

    const rolledBack = await manager.rollback('com.acme.operations');
    expect(rolledBack.activeVersion).toBe('1.0.0');
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'), 'utf8')).toContain('1.0.0');
    await manager.setEnabled('com.acme.operations', false);
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'skills', 'acme-operations', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });

    const removed = await manager.uninstall('com.acme.operations');
    expect(removed.recoveryPath).toBeTruthy();
    expect((await fs.stat(removed.recoveryPath)).isDirectory()).toBe(true);
    expect((await manager.list()).extensions).toEqual([]);
    expect(refreshReasons.length).toBeGreaterThanOrEqual(4);
  });

  it('keeps multiple OCIX Agent Runtimes in the shared OpenCode config without requiring OPENCODE_CONFIG_DIR', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-multiple-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-opencode-multiple-');
    const keys = generatePublisherKeyPair();
    const operations = await createPackage({ version: '1.0.0', keys });
    const finance = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.finance',
      extensionName: 'Acme Finance',
      toolName: 'finance_open',
      skillName: 'acme-finance',
    });
    const manager = createInteractiveUIExtensionManager({ dataDirectory, opencodeConfigDirectory });
    const inspection = await manager.inspectPackage(operations.buffer);
    await manager.installPackage(operations.buffer, { confirmedPublisherFingerprint: inspection.publisher.fingerprint });
    await manager.installPackage(finance.buffer);

    expect((await fs.readdir(path.join(opencodeConfigDirectory, 'tools'))).sort()).toEqual(['finance_open.ts', 'operations_open.ts']);
    expect((await fs.readdir(path.join(opencodeConfigDirectory, 'skills'))).sort()).toEqual(['acme-finance', 'acme-operations']);
  });

  it('reviews and installs a mixed Interactive UI plus HTML Artifact package', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-hybrid-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-hybrid-config-');
    const keys = generatePublisherKeyPair();
    const hybrid = await createPackage({ version: '1.0.0', keys, htmlArtifact: true });
    const manager = createInteractiveUIExtensionManager({ dataDirectory, opencodeConfigDirectory });
    const inspection = await manager.inspectPackage(hybrid.buffer);

    expect(inspection.permissions).toMatchObject({ nativeCode: false, sandboxedArtifacts: true });
    expect(inspection.agentRouting.views).toHaveLength(1);
    expect(inspection.agentRouting.artifacts).toEqual([expect.objectContaining({ id: 'com.acme.operations.explorer' })]);
    await expect(manager.installPackage(hybrid.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    })).resolves.toMatchObject({ installed: true });
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'operations_open_explore.ts'), 'utf8'))
      .toContain('Explore Acme Operations');
  });

  it('refuses to overwrite an unmanaged global OpenCode Tool', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-conflict-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-opencode-conflict-');
    await fs.mkdir(path.join(opencodeConfigDirectory, 'tools'), { recursive: true });
    const existingTool = path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts');
    await fs.writeFile(existingTool, 'export default { description: "user-owned" };\n');
    const keys = generatePublisherKeyPair();
    const extensionPackage = await createPackage({ version: '1.0.0', keys });
    const manager = createInteractiveUIExtensionManager({ dataDirectory, opencodeConfigDirectory });
    const inspection = await manager.inspectPackage(extensionPackage.buffer);

    await expect(manager.installPackage(extensionPackage.buffer, { confirmedPublisherFingerprint: inspection.publisher.fingerprint }))
      .rejects.toMatchObject({ code: 'agent_tool_conflict' });
    expect(await fs.readFile(existingTool, 'utf8')).toContain('user-owned');
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.operations', '1.0.0'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('refuses to follow a symlinked OpenCode Tool root', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-symlink-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-opencode-symlink-');
    const outsideDirectory = await createTemporaryDirectory('ocix-opencode-outside-');
    await fs.symlink(outsideDirectory, path.join(opencodeConfigDirectory, 'tools'));
    const keys = generatePublisherKeyPair();
    const extensionPackage = await createPackage({ version: '1.0.0', keys });
    const manager = createInteractiveUIExtensionManager({ dataDirectory, opencodeConfigDirectory });
    const inspection = await manager.inspectPackage(extensionPackage.buffer);

    await expect(manager.installPackage(extensionPackage.buffer, { confirmedPublisherFingerprint: inspection.publisher.fingerprint }))
      .rejects.toMatchObject({ code: 'agent_runtime_conflict' });
    expect(await fs.readdir(outsideDirectory)).toEqual([]);
  });

  it('does not remove a managed Tool after it was modified outside OpenChamber', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-modified-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-opencode-modified-');
    const keys = generatePublisherKeyPair();
    const extensionPackage = await createPackage({ version: '1.0.0', keys });
    const manager = createInteractiveUIExtensionManager({ dataDirectory, opencodeConfigDirectory });
    const inspection = await manager.inspectPackage(extensionPackage.buffer);
    await manager.installPackage(extensionPackage.buffer, { confirmedPublisherFingerprint: inspection.publisher.fingerprint });
    const toolPath = path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts');
    await fs.writeFile(toolPath, 'export default { description: "locally modified" };\n');

    await expect(manager.setEnabled('com.acme.operations', false)).rejects.toMatchObject({ code: 'agent_runtime_modified' });
    expect(await fs.readFile(toolPath, 'utf8')).toContain('locally modified');
    expect((await manager.list()).extensions[0].enabled).toBe(true);
  });

  it('fails closed when an installed UI asset is modified after signature verification', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-integrity-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-opencode-integrity-');
    const keys = generatePublisherKeyPair();
    const extensionPackage = await createPackage({ version: '1.0.0', keys });
    const manager = createInteractiveUIExtensionManager({ dataDirectory, opencodeConfigDirectory });
    const inspection = await manager.inspectPackage(extensionPackage.buffer);
    await manager.installPackage(extensionPackage.buffer, { confirmedPublisherFingerprint: inspection.publisher.fingerprint });

    await fs.appendFile(path.join(dataDirectory, 'extensions', 'com.acme.operations', '1.0.0', 'ui', 'view.json'), '\n');
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    expect((await manager.list()).extensions[0].integrity).toEqual({
      status: 'failed',
      code: 'extension_integrity_failed',
    });
    await manager.initialize();
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(manager.installPackage(extensionPackage.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    })).rejects.toMatchObject({ code: 'extension_integrity_failed' });
  });

  it('quarantines legacy versions without signed file records and keeps them uninstallable', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-legacy-integrity-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-legacy-integrity-opencode-');
    const keys = generatePublisherKeyPair();
    const extensionPackage = await createPackage({ version: '1.0.0', keys });
    const manager = createInteractiveUIExtensionManager({ dataDirectory, opencodeConfigDirectory });
    const inspection = await manager.inspectPackage(extensionPackage.buffer);
    await manager.installPackage(extensionPackage.buffer, { confirmedPublisherFingerprint: inspection.publisher.fingerprint });

    const statePath = path.join(dataDirectory, 'interactive-ui', 'installations.json');
    const legacyState = JSON.parse(await fs.readFile(statePath, 'utf8'));
    delete legacyState.extensions['com.acme.operations'].versions['1.0.0'].fileHashes;
    await fs.writeFile(statePath, `${JSON.stringify(legacyState, null, 2)}\n`);

    const restartedManager = createInteractiveUIExtensionManager({ dataDirectory, opencodeConfigDirectory });
    await restartedManager.initialize();

    expect(await restartedManager.getEnabledExtensionRoots()).toEqual([]);
    expect((await restartedManager.list()).extensions[0]).toMatchObject({
      id: 'com.acme.operations',
      enabled: true,
      integrity: { status: 'unavailable', code: 'extension_integrity_unavailable' },
    });
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'))).rejects.toMatchObject({ code: 'ENOENT' });

    expect(await restartedManager.uninstall('com.acme.operations')).toMatchObject({ removed: true });
    expect((await restartedManager.list()).extensions).toEqual([]);
  });

  it('does not leave extracted code behind when the persistent state commit fails', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-failure-');
    const keys = generatePublisherKeyPair();
    const extensionPackage = await createPackage({ version: '1.0.0', keys });
    let failStateCommit = false;
    const failingFs = new Proxy(fs, {
      get(target, property) {
        if (property === 'rename') {
          return async (source, destination) => {
            if (failStateCommit && destination.endsWith('installations.json')) throw new Error('injected state failure');
            return target.rename(source, destination);
          };
        }
        return target[property];
      },
    });
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fsImpl: failingFs });
    await trustPublisher(manager, keys.publicKey);
    failStateCommit = true;

    await expect(manager.installPackage(extensionPackage.buffer)).rejects.toThrow('injected state failure');
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.operations', '1.0.0'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('migrates manager records created before activation history was persisted', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-migration-');
    const managerDirectory = path.join(dataDirectory, 'interactive-ui');
    await fs.mkdir(managerDirectory, { recursive: true });
    await fs.writeFile(path.join(managerDirectory, 'installations.json'), JSON.stringify({
      $schema: 'openchamber://extension-manager-state/v1',
      extensions: {
        'com.acme.operations': {
          id: 'com.acme.operations',
          name: 'Acme Operations',
          activeVersion: '1.0.0',
          versions: { '1.0.0': { version: '1.0.0' } },
        },
      },
    }));
    const manager = createInteractiveUIExtensionManager({ dataDirectory });

    expect((await manager.list()).extensions[0]).toMatchObject({ enabled: true, activationHistory: [] });
  });

  it('never returns trusted public-key material or managed filesystem paths to the settings client', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-sanitize-');
    const keys = generatePublisherKeyPair();
    const extensionPackage = await createPackage({ version: '1.0.0', keys });
    const manager = createInteractiveUIExtensionManager({ dataDirectory });
    await trustPublisher(manager, keys.publicKey);
    await manager.installPackage(extensionPackage.buffer);

    const serialized = JSON.stringify(await manager.list());
    expect(serialized).not.toContain('BEGIN PUBLIC KEY');
    expect(serialized).not.toContain(dataDirectory);
  });

  it('installs from a signed marketplace catalog and scopes publisher trust to that marketplace', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-marketplace-');
    const marketplaceKeys = generatePublisherKeyPair();
    const publisherKeys = generatePublisherKeyPair();
    const extensionPackage = await createPackage({ version: '1.0.0', keys: publisherKeys });
    const catalog = createSignedExtensionCatalog({
      marketplaceId: 'com.acme.marketplace',
      marketplaceName: 'Acme Marketplace',
      keyId: 'catalog-2026',
      privateKey: marketplaceKeys.privateKey,
      entries: [{
        id: 'com.acme.operations',
        name: 'Acme Operations',
        version: '1.0.0',
        packageUrl: 'https://extensions.example.com/operations.ocix',
        packageHash: extensionPackage.packageHash,
        publisher: {
          id: 'com.acme.publisher',
          name: 'Acme',
          keyId: 'release-2026',
          publicKey: publisherKeys.publicKey,
        },
      }],
    });
    const fetchImpl = async (url) => {
      if (url.toString() === 'https://extensions.example.com/catalog.json') {
        return new Response(JSON.stringify(catalog), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (url.toString() === 'https://extensions.example.com/operations.ocix') {
        return new Response(extensionPackage.buffer, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const marketplaceInspection = await manager.inspectMarketplace('https://extensions.example.com/catalog.json');
    expect(marketplaceInspection).toMatchObject({
      id: 'com.acme.marketplace',
      keyId: 'catalog-2026',
      extensionCount: 1,
    });
    await expect(manager.addMarketplace({ catalogUrl: marketplaceInspection.catalogUrl }))
      .rejects.toMatchObject({ code: 'marketplace_confirmation_required' });
    await manager.addMarketplace({
      catalogUrl: marketplaceInspection.catalogUrl,
      confirmedFingerprint: marketplaceInspection.fingerprint,
    });

    const result = await manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0');
    expect(result.installed).toBe(true);
    const snapshot = await manager.list();
    expect(snapshot.publishers[0].keys[0].source).toBe('marketplace:com.acme.marketplace');
    expect(snapshot.extensions[0].activeVersion).toBe('1.0.0');
  });

  it('rolls back marketplace-delegated publisher trust when staged runtime validation fails', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-marketplace-failure-');
    const extensionDirectory = await createTemporaryDirectory('ocix-manager-invalid-extension-');
    const marketplaceKeys = generatePublisherKeyPair();
    const publisherKeys = generatePublisherKeyPair();
    await fs.writeFile(path.join(extensionDirectory, 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.broken',
      name: 'Broken Extension',
      version: '1.0.0',
      connectors: [],
      views: [{ id: 'com.acme.broken.overview', runtime: 'declarative', entry: 'missing.json', tools: ['broken_open'] }],
      actions: [],
      permissions: { network: [] },
    }));
    const brokenPackage = await createExtensionPackage({
      extensionDirectory,
      privateKey: publisherKeys.privateKey,
      publisherId: 'com.acme.publisher',
      publisherName: 'Acme',
      keyId: 'release-2026',
    });
    const catalog = createSignedExtensionCatalog({
      marketplaceId: 'com.acme.marketplace',
      marketplaceName: 'Acme Marketplace',
      keyId: 'catalog-2026',
      privateKey: marketplaceKeys.privateKey,
      entries: [{
        id: 'com.acme.broken',
        name: 'Broken Extension',
        version: '1.0.0',
        packageUrl: 'https://extensions.example.com/broken.ocix',
        packageHash: brokenPackage.packageHash,
        publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', publicKey: publisherKeys.publicKey },
      }],
    });
    const fetchImpl = async (url) => url.toString().endsWith('catalog.json')
      ? new Response(JSON.stringify(catalog), { status: 200 })
      : new Response(brokenPackage.buffer, { status: 200 });
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    await manager.addMarketplace({
      id: 'com.acme.marketplace',
      name: 'Acme Marketplace',
      keyId: 'catalog-2026',
      catalogUrl: 'https://extensions.example.com/catalog.json',
      publicKey: marketplaceKeys.publicKey,
    });

    await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.broken', '1.0.0'))
      .rejects.toMatchObject({ code: 'extension_validation_failed' });
    expect((await manager.list()).publishers).toEqual([]);
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.broken', '1.0.0'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
