import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createInteractiveUIExtensionManager } from './manager.js';
import { createExtensionPackage, createSignedExtensionCatalog, generatePublisherKeyPair } from './package-format.js';
import { createBuiltInInteractiveUIRuntime } from './builtin-runtime.js';
import {
  HOSTED_OCIX_MANIFEST_SCHEMA,
  HOSTED_OCIX_SIGNED_MANIFEST_FILE,
} from './hosted-ocix.js';

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

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
};

const hostedSha256 = (value) => `sha256-${crypto.createHash('sha256').update(value).digest('base64')}`;

const createHostedRemote = ({
  keys,
  version,
  extraTool = false,
  native = false,
  resourcePath = 'ui/overview.view.json',
  resourceIntegrityOverride,
}) => {
  const view = Buffer.from(JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: 'com.acme.hosted.overview',
    layout: { type: 'text', value: `Hosted ${version}` },
  }));
  const resources = [{
    path: resourcePath,
    url: `https://apps.example.com/${resourcePath}`,
    mimeType: 'application/json',
    sha256: resourceIntegrityOverride ?? hostedSha256(view),
  }];
  const permissions = {
    resourceOrigins: ['https://apps.example.com'],
    networkOrigins: extraTool ? ['https://api.example.com'] : [],
    externalLinkOrigins: [],
    credentialScopes: extraTool ? ['crm.write'] : [],
    actionIds: extraTool ? ['com.acme.hosted.update'] : [],
    agentToolNames: extraTool ? ['hosted_detail', 'hosted_open'] : ['hosted_open'],
    clipboard: false,
    popups: false,
    nativeCode: native,
  };
  const unsigned = {
    $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
    app: {
      id: 'com.acme.hosted',
      version,
      publishedAt: `2026-07-${version === '2.0.0' ? '28' : '29'}T00:00:00.000Z`,
    },
    permissions,
    extension: {
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.hosted',
      name: 'Acme Hosted',
      version,
      agentRouting: {
        domain: 'hosted',
        intents: ['hosted.overview'],
        examples: { en: ['Open Acme Hosted'] },
        dataAuthority: 'user-provided',
      },
      connectors: extraTool ? [{
        id: 'crm',
        type: 'http',
        baseUrl: 'https://api.example.com',
        auth: { type: 'api-key' },
      }] : [],
      views: [{
        id: 'com.acme.hosted.overview',
        runtime: native ? 'native' : 'declarative',
        entry: 'ui/overview.view.json',
        tools: extraTool ? ['hosted_open', 'hosted_detail'] : ['hosted_open'],
        routing: { intents: ['hosted.overview'], priority: 80, operation: 'read' },
        displayModes: ['inline', 'workspace'],
      }],
      actions: extraTool ? [{
        id: 'com.acme.hosted.update',
        connector: 'crm',
        risk: 'write',
        request: { method: 'POST', path: '/crm/update' },
      }] : [],
      permissions: { network: extraTool ? ['https://api.example.com'] : [] },
      trust: { mode: native ? 'native-code' : 'declarative', signature: 'production' },
    },
    resources,
  };
  const signature = crypto.sign(
    null,
    Buffer.from(JSON.stringify(canonicalize(unsigned))),
    crypto.createPrivateKey(keys.privateKey),
  ).toString('base64');
  return {
    document: {
      ...unsigned,
      signature: { algorithm: 'ed25519', keyId: 'release-2026', value: signature },
    },
    permissions,
    view,
  };
};

const createHostedThinPackage = async ({ keys, initialPermissions }) => {
  const directory = await createTemporaryDirectory('ocix-manager-hosted-thin-');
  await fs.writeFile(path.join(directory, 'openchamber.extension.json'), JSON.stringify({
    $schema: 'openchamber://extension/v1',
    id: 'com.acme.hosted',
    name: 'Acme Hosted',
    version: '1.0.0',
    delivery: {
      type: 'hosted',
      manifestUrl: 'https://apps.example.com/manifest.json',
      ttlSeconds: 60,
      minimumRuntimeVersion: '1.16.3',
      initialPermissions,
    },
    permissions: { network: [] },
  }, null, 2));
  return createExtensionPackage({
    extensionDirectory: directory,
    privateKey: keys.privateKey,
    publisherId: 'com.acme.publisher',
    publisherName: 'Acme',
    keyId: 'release-2026',
    createdAt: '2026-07-29T00:00:00.000Z',
  });
};

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
    const ownershipPath = path.join(opencodeConfigDirectory, 'openchamber', 'com.acme.operations.agent-runtime.v1.json');
    expect(JSON.parse(await fs.readFile(ownershipPath, 'utf8'))).toMatchObject({
      schemaVersion: 1,
      managedBy: 'openchamber',
      extensionId: 'com.acme.operations',
      versions: ['1.0.0'],
    });
    expect((await manager.installPackage(versionTwo.buffer)).installed).toBe(true);
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'), 'utf8')).toContain('1.1.0');
    expect(JSON.parse(await fs.readFile(ownershipPath, 'utf8'))).toMatchObject({ versions: ['1.1.0'] });
    expect((await manager.getEnabledExtensionRoots())[0].endsWith(path.join('com.acme.operations', '1.1.0'))).toBe(true);

    const rolledBack = await manager.rollback('com.acme.operations');
    expect(rolledBack.activeVersion).toBe('1.0.0');
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'), 'utf8')).toContain('1.0.0');
    await manager.setEnabled('com.acme.operations', false);
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'skills', 'acme-operations', 'SKILL.md'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(ownershipPath)).rejects.toMatchObject({ code: 'ENOENT' });

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

  it('installs a thin Hosted OCIX, confirms permission expansion, and falls back after resource tampering', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-hosted-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-hosted-opencode-');
    const keys = generatePublisherKeyPair();
    let remote = createHostedRemote({ keys, version: '2.0.0' });
    const thin = await createHostedThinPackage({ keys, initialPermissions: remote.permissions });
    let resourceBody = remote.view;
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === 'https://apps.example.com/manifest.json') {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/overview.view.json') {
        return new Response(resourceBody, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
      runtimeVersion: '1.16.5',
    });

    const inspection = await manager.inspectPackage(thin.buffer);
    expect(inspection).toMatchObject({
      delivery: 'hosted',
      hosted: { version: '2.0.0', permissions: { agentToolNames: ['hosted_open'] } },
    });
    await expect(manager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    })).rejects.toMatchObject({ code: 'hosted_manifest_confirmation_required' });
    await manager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedHostedManifestHash: inspection.hosted.manifestHash,
    });
    expect((await manager.getEnabledExtensionRoots())[0].endsWith(path.join('com.acme.hosted', '2.0.0'))).toBe(true);
    expect(await fs.readFile(path.join(
      dataDirectory,
      'interactive-ui',
      'hosted-cache',
      'com.acme.hosted',
      '2.0.0',
      'agent-runtime',
      'tools',
      'hosted_open.ts',
    ), 'utf8')).toContain('openchamber://interactive-result/v1');
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'hosted_open.ts'), 'utf8'))
      .toContain('openchamber://interactive-result/v1');

    remote = createHostedRemote({ keys, version: '2.1.0', extraTool: true });
    resourceBody = remote.view;
    let confirmation;
    try {
      await manager.refreshHosted('com.acme.hosted');
    } catch (error) {
      confirmation = error;
    }
    expect(confirmation).toMatchObject({
      code: 'hosted_permission_confirmation_required',
      details: {
        version: '2.1.0',
        addedPermissions: {
          networkOrigins: ['https://api.example.com'],
          credentialScopes: ['crm.write'],
          actionIds: ['com.acme.hosted.update'],
          agentToolNames: ['hosted_detail'],
        },
      },
    });
    expect((await manager.getEnabledExtensionRoots())[0].endsWith(path.join('com.acme.hosted', '2.0.0'))).toBe(true);
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'hosted_detail.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    await manager.refreshHosted('com.acme.hosted', {
      confirmedManifestHash: confirmation.details.manifestHash,
    });
    expect((await manager.getEnabledExtensionRoots())[0].endsWith(path.join('com.acme.hosted', '2.1.0'))).toBe(true);
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'hosted_detail.ts'), 'utf8'))
      .toContain('com.acme.hosted.overview');

    remote = createHostedRemote({
      keys,
      version: '2.2.0',
      extraTool: true,
      resourceIntegrityOverride: hostedSha256(Buffer.from('expected bytes')),
    });
    resourceBody = Buffer.from('tampered bytes');
    await expect(manager.refreshHosted('com.acme.hosted')).resolves.toMatchObject({ fallback: true });
    expect((await manager.getEnabledExtensionRoots())[0].endsWith(path.join('com.acme.hosted', '2.1.0'))).toBe(true);
    expect((await manager.list()).extensions[0].versions['1.0.0'].hosted).toMatchObject({
      lastGood: { version: '2.1.0' },
      lastError: { code: 'hosted_resource_integrity_failed' },
    });
  });

  it('fails with a structured conflict instead of overwriting a Hosted Agent Runtime path', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-hosted-runtime-conflict-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-hosted-runtime-conflict-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createHostedRemote({ keys, version: '2.0.0' });
    const thin = await createHostedThinPackage({ keys, initialPermissions: remote.permissions });
    let conflictPath;
    const fsImpl = {
      ...fs,
      async mkdir(target, options) {
        if (String(target).endsWith(`${path.sep}agent-runtime`) && options?.recursive !== true) {
          conflictPath = String(target);
          await fs.mkdir(target, { recursive: true, mode: 0o700 });
          await fs.writeFile(path.join(target, 'remote-owned.txt'), 'do not replace\n');
          const error = new Error('file already exists');
          error.code = 'EEXIST';
          throw error;
        }
        return fs.mkdir(target, options);
      },
    };
    const fetchImpl = async (url) => String(url).endsWith('/manifest.json')
      ? new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response(remote.view, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
      fsImpl,
      runtimeVersion: '1.16.5',
    });
    const inspection = await manager.inspectPackage(thin.buffer);

    await expect(manager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedHostedManifestHash: inspection.hosted.manifestHash,
    })).rejects.toMatchObject({
      code: 'hosted_agent_runtime_conflict',
      status: 409,
    });
    expect(await fs.readFile(path.join(conflictPath, 'remote-owned.txt'), 'utf8'))
      .toBe('do not replace\n');
    await expect(fs.stat(path.join(conflictPath, 'tools', 'hosted_open.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('returns a structured manager error for a Hosted resource in the Agent Runtime namespace', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-hosted-reserved-resource-');
    const keys = generatePublisherKeyPair();
    const remote = createHostedRemote({
      keys,
      version: '2.0.0',
      resourcePath: 'agent-runtime/tools/hosted_open.ts',
    });
    const thin = await createHostedThinPackage({ keys, initialPermissions: remote.permissions });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      runtimeVersion: '1.16.5',
      fetchImpl: async () => new Response(JSON.stringify(remote.document), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    await expect(manager.inspectPackage(thin.buffer)).rejects.toMatchObject({
      code: 'invalid_hosted_resource',
      status: 400,
      details: {
        path: 'agent-runtime/tools/hosted_open.ts',
        reservedNamespace: 'agent-runtime',
      },
    });
  });

  it('rejects Hosted OCIX packages that require a newer OpenChamber runtime', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-hosted-runtime-');
    const keys = generatePublisherKeyPair();
    const remote = createHostedRemote({ keys, version: '2.0.0' });
    const thin = await createHostedThinPackage({ keys, initialPermissions: remote.permissions });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      runtimeVersion: '1.16.2',
      fetchImpl: async () => new Response(JSON.stringify(remote.document), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    });

    await expect(manager.inspectPackage(thin.buffer)).rejects.toMatchObject({
      code: 'hosted_runtime_incompatible',
      status: 409,
      details: {
        minimumRuntimeVersion: '1.16.3',
        runtimeVersion: '1.16.2',
      },
    });
  });

  it('quarantines a modified Hosted cache before restart Agent Runtime sync', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-hosted-cache-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-hosted-cache-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createHostedRemote({ keys, version: '2.0.0' });
    const thin = await createHostedThinPackage({ keys, initialPermissions: remote.permissions });
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value.endsWith('/manifest.json')) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value.endsWith('/ui/overview.view.json')) {
        return new Response(remote.view, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
      runtimeVersion: '1.16.5',
    });
    const inspection = await manager.inspectPackage(thin.buffer);
    await manager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedHostedManifestHash: inspection.hosted.manifestHash,
    });
    const hostedView = path.join(
      dataDirectory,
      'interactive-ui',
      'hosted-cache',
      'com.acme.hosted',
      '2.0.0',
      'ui',
      'overview.view.json',
    );
    await fs.writeFile(hostedView, '{"tampered":true}');

    await manager.initialize();
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'hosted_open.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect((await manager.list()).extensions[0].integrity).toEqual({
      status: 'failed',
      code: 'hosted_cache_integrity_failed',
    });
  });

  it('re-verifies the cached Hosted manifest signature even if local integrity state was edited', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-hosted-signature-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-hosted-signature-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createHostedRemote({ keys, version: '2.0.0' });
    const thin = await createHostedThinPackage({ keys, initialPermissions: remote.permissions });
    const fetchImpl = async (url) => String(url).endsWith('/manifest.json')
      ? new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response(remote.view, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
      runtimeVersion: '1.16.5',
    });
    const inspection = await manager.inspectPackage(thin.buffer);
    await manager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedHostedManifestHash: inspection.hosted.manifestHash,
    });

    const signedManifestPath = path.join(
      dataDirectory,
      'interactive-ui',
      'hosted-cache',
      'com.acme.hosted',
      '2.0.0',
      HOSTED_OCIX_SIGNED_MANIFEST_FILE,
    );
    const cachedManifest = JSON.parse(await fs.readFile(signedManifestPath, 'utf8'));
    cachedManifest.extension.name = 'Tampered Hosted';
    const tamperedBytes = Buffer.from(JSON.stringify(canonicalize(cachedManifest)));
    await fs.writeFile(signedManifestPath, tamperedBytes);

    const statePath = path.join(dataDirectory, 'interactive-ui', 'installations.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    state.extensions['com.acme.hosted'].versions['1.0.0']
      .hosted.lastGood.integrity.files[HOSTED_OCIX_SIGNED_MANIFEST_FILE] = hostedSha256(tamperedBytes);
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

    const restartedManager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
      runtimeVersion: '1.16.5',
    });
    await restartedManager.initialize();
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'hosted_open.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect((await restartedManager.list()).extensions[0].integrity).toEqual({
      status: 'failed',
      code: 'invalid_hosted_signature',
    });
  });

  it('requires confirmation when a Hosted update adds Native code', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-hosted-native-data-');
    const keys = generatePublisherKeyPair();
    let remote = createHostedRemote({ keys, version: '2.0.0' });
    const initialPermissions = {
      ...remote.permissions,
      nativeCode: true,
    };
    const thin = await createHostedThinPackage({ keys, initialPermissions });
    const fetchImpl = async (url) => String(url).endsWith('/manifest.json')
      ? new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      : new Response(remote.view, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      fetchImpl,
      runtimeVersion: '1.16.5',
    });
    const inspection = await manager.inspectPackage(thin.buffer);
    await manager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedHostedManifestHash: inspection.hosted.manifestHash,
    });

    remote = createHostedRemote({ keys, version: '2.1.0', native: true });
    await expect(manager.refreshHosted('com.acme.hosted')).rejects.toMatchObject({
      code: 'hosted_permission_confirmation_required',
      details: {
        addedPermissions: { nativeCode: true },
      },
    });
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
