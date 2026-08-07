import { afterEach, describe, expect, it } from 'bun:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { createInteractiveUIExtensionManager } from './manager.js';
import { createInteractiveUIRuntime } from './runtime.js';
import { createInteractiveUIConnectionStore } from './connection-store.js';
import { createExtensionPackage, createSignedExtensionCatalog, generatePublisherKeyPair, publicKeyFingerprint } from './package-format.js';
import { createBuiltInInteractiveUIRuntime } from './builtin-runtime.js';
import {
  HOSTED_OCIX_MANIFEST_SCHEMA,
  HOSTED_OCIX_SIGNED_MANIFEST_FILE,
  canonicalStringify,
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

const createRemoteManifest = ({
  keys,
  version = '1.0.0',
  native = false,
  connectors,
  publisherKeyId = 'release-2026',
  publisherId = 'com.acme.publisher',
  publisherName = 'Acme',
  extensionId = 'com.acme.remote',
  extensionName = 'Acme Remote',
  toolName = 'remote_open',
  extensionNetwork = ['https://api.example.com'],
  viewEntry,
  resourcePath,
  viewText,
  icon = false,
  iconBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>'),
  extraResources = [],
  update = undefined,
  connectorId = 'crm',
  extraAction = false,
  extraSurface = false,
} = {}) => {
  const view = Buffer.from(JSON.stringify({
    $schema: 'openchamber://declarative-view/v1',
    id: `${extensionId}.overview`,
    layout: { type: 'text', value: viewText ?? `Remote ${version}` },
  }));
  const entryPath = viewEntry ?? (native ? 'ui/overview.view.mjs' : 'ui/overview.view.json');
  const entryMimeType = native ? 'text/javascript' : 'application/json';  const declaredResourcePath = resourcePath ?? entryPath;
  const resolvedConnectors = connectors ?? [{
    id: connectorId,
    type: 'http',
    baseUrl: 'https://api.example.com',
    auth: { type: 'api-key' },
  }];
  const resources = [{
    path: declaredResourcePath,
    url: `https://apps.example.com/${declaredResourcePath}`,
    mimeType: entryMimeType,
    sha256: hostedSha256(view),
  }];
  if (icon) {
    resources.push({
      path: 'ui/icon.svg',
      url: 'https://apps.example.com/ui/icon.svg',
      mimeType: 'image/svg+xml',
      sha256: hostedSha256(iconBytes),
    });
  }
  if (extraSurface) {
    const detail = Buffer.from(JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: `${extensionId}.detail`,
      layout: { type: 'text', value: `Detail ${version}` },
    }));
    resources.push({
      path: 'ui/detail.view.json',
      url: 'https://apps.example.com/ui/detail.view.json',
      mimeType: 'application/json',
      sha256: hostedSha256(detail),
    });
  }
  for (const extra of extraResources) {
    resources.push({
      path: extra.path,
      url: `https://apps.example.com/${extra.path}`,
      mimeType: extra.mimeType,
      sha256: hostedSha256(extra.bytes),
    });
  }
  const unsigned = {
    $schema: HOSTED_OCIX_MANIFEST_SCHEMA,
    app: {      id: extensionId,
      version,
      publishedAt: `2026-08-0${version === '1.0.0' ? '5' : '6'}T00:00:00.000Z`,
    },
    ...(update !== undefined ? { update } : {}),
    publisher: {
      id: publisherId,
      name: publisherName,
      keyId: publisherKeyId,
      publicKey: keys.publicKey,
    },
    permissions: {
      resourceOrigins: ['https://apps.example.com'],
      networkOrigins: [...extensionNetwork],
      externalLinkOrigins: [],
      credentialScopes: extraSurface ? ['crm.read', 'crm.write'] : ['crm.read'],
      actionIds: extraAction
        ? ['com.acme.remote.read', 'com.acme.remote.export']
        : extraSurface
          ? ['com.acme.remote.read', 'com.acme.remote.detail']
          : ['com.acme.remote.read'],
      agentToolNames: extraSurface ? [toolName, 'remote_detail'] : [toolName],
      clipboard: false,
      popups: false,
      nativeCode: native,
    },
    extension: {
      $schema: 'openchamber://extension/v1',
      id: extensionId,
      name: extensionName,
      version,
      agentRouting: {
        domain: 'remote',
        intents: extraSurface ? ['remote.overview', 'remote.detail'] : ['remote.overview'],
        examples: { en: ['Open Acme Remote'] },
        dataAuthority: 'user-provided',
      },
      ...(icon ? { icon: 'ui/icon.svg' } : {}),
      connectors: resolvedConnectors,
      views: [{
        id: `${extensionId}.overview`,        runtime: native ? 'native' : 'declarative',
        entry: entryPath,
        tools: [toolName],
        routing: { intents: ['remote.overview'], priority: 80, operation: 'read' },
        displayModes: ['inline', 'workspace'],
      }, ...(extraSurface ? [{
        id: `${extensionId}.detail`,
        runtime: 'declarative',
        entry: 'ui/detail.view.json',
        tools: ['remote_detail'],
        routing: { intents: ['remote.detail'], priority: 81, operation: 'read' },
        displayModes: ['inline', 'workspace'],
      }] : [])],
      actions: extraAction ? [{
        id: 'com.acme.remote.read',
        connector: connectorId,
        risk: 'read',
        request: { method: 'GET', path: '/crm' },
      }, {
        id: 'com.acme.remote.export',
        connector: connectorId,
        risk: 'write',
        request: { method: 'POST', path: '/crm/export' },
      }] : [{
        id: 'com.acme.remote.read',
        connector: connectorId,
        risk: 'read',
        request: { method: 'GET', path: '/crm' },
      }, ...(extraSurface ? [{
        id: 'com.acme.remote.detail',
        connector: connectorId,
        risk: 'read',
        request: { method: 'GET', path: '/crm/detail' },
      }] : [])],
      permissions: { network: extensionNetwork },
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
      signature: { algorithm: 'ed25519', keyId: publisherKeyId, value: signature },
    },
    view,
    ...(icon ? { icon: iconBytes } : {}),
  };
};
const remoteFetch = (manifest, requested = []) => async (url) => {
  const value = String(url);
  requested.push(value);
  if (value === 'https://apps.example.com/manifest.json') {
    return new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  if (value === 'https://apps.example.com/ui/overview.view.json') {
    return new Response('resource fetch is not allowed before connect', { status: 500 });
  }
  return new Response('not found', { status: 404 });
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
    expect((await manager.getEnabledExtensionRoots())[0].directory.endsWith(path.join('com.acme.operations', '1.1.0'))).toBe(true);

    const rolledBack = await manager.rollback('com.acme.operations');
    expect(rolledBack.activeVersion).toBe('1.0.0');    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'), 'utf8')).toContain('1.0.0');
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
    expect((await manager.getEnabledExtensionRoots())[0].directory.endsWith(path.join('com.acme.hosted', '2.0.0'))).toBe(true);
    expect(await fs.readFile(path.join(
      dataDirectory,
      'interactive-ui',      'hosted-cache',
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
    expect((await manager.getEnabledExtensionRoots())[0].directory.endsWith(path.join('com.acme.hosted', '2.0.0'))).toBe(true);
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'hosted_detail.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    await manager.refreshHosted('com.acme.hosted', {
      confirmedManifestHash: confirmation.details.manifestHash,
    });
    expect((await manager.getEnabledExtensionRoots())[0].directory.endsWith(path.join('com.acme.hosted', '2.1.0'))).toBe(true);
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
    expect((await manager.getEnabledExtensionRoots())[0].directory.endsWith(path.join('com.acme.hosted', '2.1.0'))).toBe(true);
    expect((await manager.list()).extensions[0].versions['1.0.0'].hosted).toMatchObject({
      lastGood: { version: '2.1.0' },
      lastError: { code: 'hosted_resource_integrity_failed' },    });
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

  it('discards hostile marketplace catalog/package response bodies before controlled rejections (never consumes or masks)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-marketplace-discard-');
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
    // Tracking bodies: cancellation is recorded, and ANY consumption attempt
    // (getReader) throws — so a regression that reads a discarded body
    // surfaces a different error and fails the assertions below.
    const makeDiscardBody = (state) => ({
      cancel: async () => { state.cancelled = true; },
      getReader: () => {
        state.consumed = true;
        throw new Error('discarded response body must never be consumed');
      },
    });
    const nonOkCatalog = { cancelled: false, consumed: false };
    const oversizeCatalog = { cancelled: false, consumed: false };
    const nonOkPackage = { cancelled: false, consumed: false };
    // Chunked-streaming fake reader: crossing MAX_CATALOG_BYTES cancels the
    // reader and calls releaseLock even when releaseLock itself throws.
    let readerCancelled = false;
    let releaseCalled = false;
    const fakeReader = {
      read: async () => ({ done: false, value: Buffer.alloc(3 * 1024 * 1024) }),
      cancel: async () => { readerCancelled = true; },
      releaseLock: () => {
        releaseCalled = true;
        throw new Error('simulated releaseLock failure');
      },
    };
    let mode = 'catalog-ok';
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === 'https://extensions.example.com/catalog.json') {
        if (mode === 'catalog-non-ok') {
          return { ok: false, status: 500, headers: { get: () => null }, body: makeDiscardBody(nonOkCatalog) };
        }
        if (mode === 'catalog-oversize') {
          return {
            ok: true,
            status: 200,
            headers: { get: (name) => (name === 'content-length' ? String(2 * 1024 * 1024 + 1) : null) },
            body: makeDiscardBody(oversizeCatalog),
          };
        }
        if (mode === 'catalog-chunked-oversize') {
          return {
            ok: true,
            status: 200,
            headers: { get: () => null },
            body: { getReader: () => fakeReader },
          };
        }
        return new Response(JSON.stringify(catalog), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      if (value === 'https://extensions.example.com/operations.ocix') {
        if (mode === 'package-non-ok') {
          return { ok: false, status: 500, headers: { get: () => null }, body: makeDiscardBody(nonOkPackage) };
        }
        return new Response(extensionPackage.buffer, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    };
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const inspection = await manager.inspectMarketplace('https://extensions.example.com/catalog.json');
    await manager.addMarketplace({ catalogUrl: inspection.catalogUrl, confirmedFingerprint: inspection.fingerprint });

    // (1) Non-OK catalog body is cancelled and never consumed before
    // marketplace_unavailable.
    mode = 'catalog-non-ok';
    await expect(manager.inspectMarketplace('https://extensions.example.com/catalog.json'))
      .rejects.toMatchObject({ code: 'marketplace_unavailable', status: 502 });
    expect(nonOkCatalog.cancelled).toBe(true);
    expect(nonOkCatalog.consumed).toBe(false);

    // (2) OK catalog with oversized declared Content-Length is cancelled,
    // never consumed, and returns remote_content_too_large.
    mode = 'catalog-oversize';
    await expect(manager.inspectMarketplace('https://extensions.example.com/catalog.json'))
      .rejects.toMatchObject({ code: 'remote_content_too_large', status: 413 });
    expect(oversizeCatalog.cancelled).toBe(true);
    expect(oversizeCatalog.consumed).toBe(false);

    // (3) Chunked streaming catalog crossing MAX_CATALOG_BYTES cancels the
    // reader, releases its lock, never parses/returns bytes, and returns
    // remote_content_too_large even when releaseLock is configured to throw
    // (the authoritative size error is never masked).
    mode = 'catalog-chunked-oversize';
    const chunkedError = await manager.inspectMarketplace('https://extensions.example.com/catalog.json')
      .catch((error) => error);
    expect(chunkedError).toMatchObject({ code: 'remote_content_too_large', status: 413 });
    expect(chunkedError.message).toBe('Marketplace catalog exceeds the size limit');
    expect(chunkedError.message).not.toContain('releaseLock');
    expect(readerCancelled).toBe(true);
    expect(releaseCalled).toBe(true);

    // (4) Non-OK package body is cancelled before package_download_failed.
    mode = 'package-non-ok';
    await expect(manager.installFromMarketplace('com.acme.marketplace', 'com.acme.operations', '1.0.0'))
      .rejects.toMatchObject({ code: 'package_download_failed', status: 502 });
    expect(nonOkPackage.cancelled).toBe(true);
    expect(nonOkPackage.consumed).toBe(false);
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

describe('Remote OCIX manager operations', () => {
  const appEntryUrl = 'https://apps.example.com/manifest.json';

  it('inspects a remote manifest without trusting, installing, or fetching resources', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-inspect-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys, native: true });
    const requested = [];
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      fetchImpl: remoteFetch(remote.document, requested),
    });

    const inspection = await manager.inspectRemote(appEntryUrl);
    expect(inspection).toMatchObject({
      extension: { id: 'com.acme.remote', name: 'Acme Remote', version: '1.0.0' },
      publisher: { id: 'com.acme.publisher', name: 'Acme', keyId: 'release-2026', trusted: false },
      permissions: {
        networkOrigins: ['https://api.example.com'],
        credentialScopes: ['crm.read'],
        actionIds: ['com.acme.remote.read'],
        agentToolNames: ['remote_open'],
        nativeCode: true,
      },
      manifest: { appEntryUrl, manifestHash: expect.stringMatching(/^sha256-/) },
      connector: { id: 'crm', origin: 'https://api.example.com', authType: 'api-key' },
    });
    expect(inspection.publisher.fingerprint).toMatch(/^sha256-/);
    expect(inspection.publisher.fingerprint).not.toContain('BEGIN PUBLIC KEY');
    expect(requested).toEqual([appEntryUrl]);
    expect((await manager.list()).extensions).toEqual([]);
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'trust.json')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('requires exact fingerprint and manifest hash confirmation before any write', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-confirm-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-confirm-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const requested = [];
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document, requested),
    });

    await expect(manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: 'wrong',
      confirmedManifestHash: 'wrong',
    })).rejects.toMatchObject({
      code: 'remote_confirmation_required',
      status: 403,
      details: {
        extension: { id: 'com.acme.remote' },
        manifest: { appEntryUrl, manifestHash: expect.stringMatching(/^sha256-/) },
      },
    });
    await expect(manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: 'wrong-fingerprint',
      confirmedManifestHash: (await manager.inspectRemote(appEntryUrl)).manifest.manifestHash,
    })).rejects.toMatchObject({ code: 'remote_confirmation_required' });

    expect(requested.filter((url) => url === appEntryUrl).length).toBe(3);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
    expect((await manager.list()).extensions).toEqual([]);
    expect((await manager.list()).publishers).toEqual([]);
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'remote_open.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('connects a remote app: persists trust, shell, and state without fetching resources', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-connect-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-connect-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys, native: true });
    const requested = [];
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document, requested),
    });

    const inspection = await manager.inspectRemote(appEntryUrl);
    expect(inspection.publisher.trusted).toBe(false);
    const result = await manager.connectRemote({
      appEntryUrl,

      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // The manager result is directly serializable to ONLY the public
    // extension/connector fields; raw installationId/trustAdded/generationId
    // never appear (the opaque capability is non-enumerable).
    expect(Object.keys(result).sort()).toEqual(['connector', 'extension']);
    expect(JSON.stringify(result)).not.toContain('installationId');
    expect(JSON.stringify(result)).not.toContain('trustAdded');
    expect(JSON.stringify(result)).not.toContain('generationId');
    expect(result.extension).toMatchObject({ id: 'com.acme.remote', version: '1.0.0' });
    expect(result.connector).toMatchObject({ id: 'crm', origin: 'https://api.example.com', authType: 'api-key' });
    // The stored trust record now carries exactly the candidate key, so the
    // same manifest must inspect as trusted.
    expect((await manager.inspectRemote(appEntryUrl)).publisher.trusted).toBe(true);
    const state = await manager.list();
    expect(state.publishers[0]).toMatchObject({
      id: 'com.acme.publisher',
      keys: [{ keyId: 'release-2026', source: 'remote-confirmation', fingerprint: inspection.publisher.fingerprint }],
    });
    const version = state.extensions[0].versions['1.0.0'];
    expect(state.extensions[0]).toMatchObject({ id: 'com.acme.remote', integrity: { status: 'ready' } });
    expect(version).toMatchObject({
      delivery: 'remote',
      source: { type: 'remote', appEntryUrl },
      publisher: { id: 'com.acme.publisher', keyId: 'release-2026', fingerprint: inspection.publisher.fingerprint },
      remote: {
        appEntryUrl,
        connectorRefs: [{ id: 'crm', origin: 'https://api.example.com', authType: 'api-key' }],
        acceptedManifest: { version: '1.0.0', manifestHash: inspection.manifest.manifestHash, keyId: 'release-2026' },
        approvedPermissions: { nativeCode: true },
        status: 'active',
      },
    });

    const shell = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0');
    expect(JSON.parse(await fs.readFile(path.join(shell, HOSTED_OCIX_SIGNED_MANIFEST_FILE), 'utf8')).app.id)
      .toBe('com.acme.remote');
    expect(JSON.parse(await fs.readFile(path.join(shell, 'openchamber.extension.json'), 'utf8')).id)
      .toBe('com.acme.remote');
    expect(await fs.readFile(path.join(shell, 'agent-runtime', 'tools', 'remote_open.ts'), 'utf8'))
      .toContain('openchamber://interactive-result/v1');
    await expect(fs.stat(path.join(shell, 'ui'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'remote_open.ts'), 'utf8'))
      .toContain('openchamber://interactive-result/v1');
    expect((await manager.getEnabledExtensionRoots())[0].directory.endsWith(path.join('com.acme.remote', '1.0.0'))).toBe(true);

    const serialized = JSON.stringify(state) + await fs.readFile(path.join(dataDirectory, 'interactive-ui', 'trust.json'), 'utf8');
    expect(serialized).not.toContain('sk-remote-secret');    expect(requested.filter((url) => url === appEntryUrl).length).toBe(3);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('rejects connecting an already installed remote app', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-twice-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const options = {
      appEntryUrl,

      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    };
    await manager.connectRemote(options);
    await expect(manager.connectRemote(options)).rejects.toMatchObject({
      code: 'remote_extension_installed',
      status: 409,
    });
  });

  it('rejects remote apps with zero or multiple connectors before any write', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-connectors-');
    const keys = generatePublisherKeyPair();
    const noConnector = createRemoteManifest({ keys, connectors: [] });
    const multiConnector = createRemoteManifest({
      keys,
      extensionNetwork: ['https://api.example.com', 'https://api2.example.com'],
      connectors: [
        { id: 'crm', type: 'http', baseUrl: 'https://api.example.com', auth: { type: 'api-key' } },
        { id: 'crm2', type: 'http', baseUrl: 'https://api2.example.com', auth: { type: 'api-key' } },
      ],
    });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      fetchImpl: async (url) => {
        const value = String(url);
        const document = value === appEntryUrl
          ? noConnector.document
          : multiConnector.document;
        return new Response(JSON.stringify(document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    });

    await expect(manager.inspectRemote(appEntryUrl)).rejects.toMatchObject({
      code: 'invalid_manifest',
      status: 400,
    });
    await expect(manager.inspectRemote('https://apps.example.com/multi.json')).rejects.toMatchObject({
      code: 'remote_connector_ambiguous',
      status: 409,
    });
    expect((await manager.list()).extensions).toEqual([]);
  });

  it('rejects a signed Remote manifest whose metadata fails runtime schema validation before any write', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-invalid-schema-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-invalid-schema-opencode-');
    const keys = generatePublisherKeyPair();
    // Signed and cryptographically valid, but the top-level Hosted
    // networkOrigins declares the API origin while extension.permissions.network
    // omits it: the complete runtime metadata validation must reject it before
    // any trust, shell, Manager state, Agent Runtime, or Secret Store write.
    const remote = createRemoteManifest({ keys, extensionNetwork: [] });
    const requested = [];
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document, requested),
    });

    await expect(manager.inspectRemote(appEntryUrl)).rejects.toMatchObject({
      code: 'network_not_allowed',
      status: 400,
    });
    await expect(manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: 'unused',
      confirmedManifestHash: 'unused',
    })).rejects.toMatchObject({ code: 'network_not_allowed', status: 400 });

    // No writes of any kind: no trust, no Manager state, no shell, no Agent
    // Runtime shim, no credential file. Only Manifest requests occurred.
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'remote_open.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect((await manager.list()).extensions).toEqual([]);
    expect((await manager.list()).publishers).toEqual([]);
    expect(requested.filter((url) => url === appEntryUrl).length).toBe(2);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('rejects a signed Remote manifest with a traversing entry path before any write', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-traversal-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-traversal-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys, viewEntry: '../../escape.txt', resourcePath: 'ui/overview.view.json' });
    const requested = [];
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document, requested),
    });

    await expect(manager.inspectRemote(appEntryUrl)).rejects.toMatchObject({
      code: 'invalid_hosted_resource',
      status: 400,
      details: { path: '../../escape.txt' },
    });
    await expect(manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: 'unused',
      confirmedManifestHash: 'unused',
    })).rejects.toMatchObject({ code: 'invalid_hosted_resource', status: 400 });

    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(requested.filter((url) => url === appEntryUrl).length).toBe(2);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('rejects a signed Remote manifest whose view entry is not a declared resource before any write', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-missing-entry-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-missing-entry-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys, viewEntry: 'ui/missing.view.json', resourcePath: 'ui/overview.view.json' });
    const requested = [];
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document, requested),
    });

    await expect(manager.inspectRemote(appEntryUrl)).rejects.toMatchObject({
      code: 'invalid_hosted_resource',
      status: 400,
      details: { path: 'ui/missing.view.json' },
    });
    await expect(manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: 'unused',
      confirmedManifestHash: 'unused',
    })).rejects.toMatchObject({ code: 'invalid_hosted_resource', status: 400 });

    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(requested.filter((url) => url === appEntryUrl).length).toBe(2);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('rejects a signed Remote manifest that binds a reserved Agent Tool before any write', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-reserved-tool-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-reserved-tool-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys, toolName: 'read' });
    const requested = [];
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document, requested),
    });

    await expect(manager.inspectRemote(appEntryUrl)).rejects.toMatchObject({
      code: 'invalid_hosted_agent_tool',
      status: 400,
    });
    await expect(manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: 'unused',
      confirmedManifestHash: 'unused',
    })).rejects.toMatchObject({ code: 'invalid_hosted_agent_tool', status: 400 });

    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect(requested.filter((url) => url === appEntryUrl).length).toBe(2);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('rejects a remote publisher key that conflicts with the trust store', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-conflict-');
    const keys = generatePublisherKeyPair();
    const otherKeys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    await trustPublisher(manager, otherKeys.publicKey);
    const inspection = await manager.inspectRemote(appEntryUrl);
    // A same publisher/keyId slot occupied by a different key must not be
    // reported as trusted.
    expect(inspection.publisher.trusted).toBe(false);

    await expect(manager.connectRemote({
      appEntryUrl,

      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    })).rejects.toMatchObject({ code: 'publisher_key_conflict', status: 409 });
    expect((await manager.list()).extensions).toEqual([]);
    // The pre-existing conflicting key was not replaced or removed.
    expect((await manager.list()).publishers[0].keys[0].fingerprint).not.toBe(inspection.publisher.fingerprint);
  });

  it('rolls back the shell and freshly added trust when the state commit fails', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-rollback-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
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
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      fsImpl: failingFs,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    failStateCommit = true;

    await expect(manager.connectRemote({
      appEntryUrl,

      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    })).rejects.toThrow('injected state failure');
    expect((await manager.list()).extensions).toEqual([]);
    expect((await manager.list()).publishers).toEqual([]);
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('quarantines a Remote shell when the trusted publisher key is replaced', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-trust-tamper-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-trust-tamper-opencode-');
    const keys = generatePublisherKeyPair();
    const otherKeys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });

    // Replace the trust-store key for the same publisher/keyId with another
    // valid Ed25519 key (a shell signed by the old embedded key must then fail
    // closed instead of remaining self-consistent).
    const trustPath = path.join(dataDirectory, 'interactive-ui', 'trust.json');
    const trust = JSON.parse(await fs.readFile(trustPath, 'utf8'));
    const storedKey = trust.publishers['com.acme.publisher'].keys['release-2026'];
    storedKey.publicKey = otherKeys.publicKey;
    storedKey.fingerprint = publicKeyFingerprint(otherKeys.publicKey);
    await fs.writeFile(trustPath, `${JSON.stringify(trust, null, 2)}\n`);

    expect((await manager.list()).extensions[0].integrity).toEqual({
      status: 'failed',
      code: 'remote_shell_integrity_failed',
    });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    await manager.initialize();
    await expect(fs.stat(path.join(opencodeConfigDirectory, 'tools', 'remote_open.ts')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a Remote shell whose publisher identity differs from its metadata', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-publisher-id-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // Trust the SAME key under a second publisher id so the trust lookup by
    // the tampered metadata publisher id succeeds, forcing the comparison of
    // the reverified embedded publisher id against the metadata to fail.
    await manager.trustPublisher({
      id: 'com.acme.other',
      name: 'Other',
      keyId: 'release-2026',
      publicKey: keys.publicKey,
    });
    const statePath = path.join(dataDirectory, 'interactive-ui', 'installations.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    state.extensions['com.acme.remote'].versions['1.0.0'].publisher.id = 'com.acme.other';
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

    expect((await manager.list()).extensions[0].integrity).toEqual({
      status: 'failed',
      code: 'remote_shell_integrity_failed',
    });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
  });

  it('retains a trust key during rollback when another installed extension still uses it', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-rollback-inuse-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-rollback-inuse-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const firstConnect = await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });

    // A local package from the SAME publisher/keyId installs without a new
    // confirmation because the Remote connect added the trust key.
    const localPackage = await createPackage({ version: '1.0.0', keys });
    expect((await manager.installPackage(localPackage.buffer)).installed).toBe(true);

    const rollback = await firstConnect.capability.rollback();
    expect(rollback).toMatchObject({
      removed: true,
      trustRolledBack: false,      trustRetainedInUse: true,
    });

    const snapshot = await manager.list();
    expect(snapshot.publishers[0].keys[0].keyId).toBe('release-2026');
    expect(snapshot.extensions.find((extension) => extension.id === 'com.acme.operations')).toMatchObject({
      id: 'com.acme.operations',
      integrity: { status: 'ready' },
    });
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'operations_open.ts'), 'utf8'))
      .toContain('1.0.0');
  });

  it('refuses rollback from a stale installation identity without touching the replacement shell or trust', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-stale-rollback-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-stale-rollback-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const first = await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // The manager result exposes ONLY the public extension/connector fields:
    // raw installationId/trustAdded/generationId/provenance never serialize.
    expect(Object.keys(first).sort()).toEqual(['connector', 'extension']);
    expect(JSON.stringify(first)).not.toContain('installationId');
    expect(JSON.stringify(first)).not.toContain('trustAdded');
    expect(JSON.stringify(first)).not.toContain('generationId');
    expect(JSON.stringify(first)).not.toContain('provenance');

    // Replace the connection: uninstall, then reconnect with a fresh
    // installation identity (a NEW opaque capability).
    await manager.uninstall('com.acme.remote');
    const second = await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });

    // A stale rollback through the FIRST installation's capability must
    // refuse all mutation (rollbackRemoteConnect is manager-private; only the
    // opaque capability exposes rollback).
    await expect(first.capability.rollback())
      .rejects.toMatchObject({ code: 'remote_rollback_installation_changed', status: 409 });

    // The replacement shell, its trust, and its Agent Runtime stay intact.
    const snapshot = await manager.list();
    expect(snapshot.extensions[0]).toMatchObject({
      id: 'com.acme.remote',
      integrity: { status: 'ready' },
    });
    // installationId is internal bookkeeping and never reaches the public list.
    expect(snapshot.extensions[0].versions['1.0.0'].remote.installationId).toBeUndefined();
    expect(snapshot.publishers[0].keys[0].keyId).toBe('release-2026');
    expect((await manager.getEnabledExtensionRoots())[0].directory.endsWith(path.join('com.acme.remote', '1.0.0'))).toBe(true);
    expect(await fs.readFile(path.join(opencodeConfigDirectory, 'tools', 'remote_open.ts'), 'utf8'))
      .toContain('openchamber://interactive-result/v1');
  });

  it('lazily resolves only the requested signed Remote resource and caches verified bytes inside the TTL', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-resolve-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-resolve-opencode-');
    const keys = generatePublisherKeyPair();
    const iconBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><rect width="10" height="10"/></svg>');
    const remote = createRemoteManifest({
      keys,
      icon: true,
      iconBytes,
      extraResources: [{
        path: 'ui/other.view.json',
        mimeType: 'application/json',
        bytes: Buffer.from('{"unused":true}'),
      }],
    });
    const requested = [];
    const fetchImpl = async (url) => {
      const value = String(url);
      requested.push(value);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/overview.view.json') {
        return new Response(remote.view, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/icon.svg') {
        return new Response(iconBytes, {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    requested.length = 0;

    // First load fetches ONLY the requested resource: the icon and the second
    // signed resource are not prefetched.
    const view = await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));
    expect(view).toEqual(remote.view);
    expect(requested).toEqual(['https://apps.example.com/ui/overview.view.json']);
    // Bounded wait: the exact TTL rule (0 <= now - mtime) must see a strictly
    // positive age on the cache hit below (real-clock safe).
    await new Promise((resolve) => setTimeout(resolve, 25));

    // Repeated load inside the TTL is a verified cache hit: no second request.
    const again = await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));
    expect(again).toEqual(remote.view);
    expect(requested).toEqual(['https://apps.example.com/ui/overview.view.json']);

    // The icon is a separate lazy fetch of exactly its own URL.
    const icon = await manager.resolveExtensionResource('com.acme.remote', 'ui/icon.svg', await remoteAuthorityFor(dataDirectory));
    expect(icon).toEqual(iconBytes);
    expect(requested).toEqual([
      'https://apps.example.com/ui/overview.view.json',
      'https://apps.example.com/ui/icon.svg',
    ]);

    // The cache is manager-owned, process-lifetime, and IN-MEMORY: no
    // remote-cache filesystem directory is ever created, and the
    // metadata-only shell stays fully verified.
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    const shell = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0');
    await expect(fs.stat(path.join(shell, 'ui'))).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await manager.list()).extensions[0].integrity).toEqual({ status: 'ready' });
    expect((await manager.getEnabledExtensionRoots())[0].directory).toBe(shell);
  });

  it('serves unexpired in-memory cache bytes offline and hard-fails offline on an uncached miss', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-inmemory-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys, icon: true });
    let offline = false;
    const fetchImpl = async (url) => {
      const value = String(url);
      if (offline) throw new Error('offline');
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/icon.svg') {
        return new Response(remote.icon, {
          status: 200,
          headers: { 'Content-Type': 'image/svg+xml' },
        });
      }
      return new Response(remote.view, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));

    // Unexpired in-memory cached bytes still work offline.
    offline = true;
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory)))
      .resolves.toEqual(remote.view);
    // An UNCACHED declared resource offline is a hard sanitized failure: no
    // stale bytes are ever served.
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/icon.svg', await remoteAuthorityFor(dataDirectory)))
      .rejects.toMatchObject({ code: 'hosted_resource_unavailable', status: 502 });
    // The cache is in-memory only: no filesystem directory is created.
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('rejects unknown and unsafe Remote resource paths without writing anything', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-unknown-path-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });

    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/not-declared.json', await remoteAuthorityFor(dataDirectory)))
      .rejects.toMatchObject({ code: 'invalid_hosted_resource', status: 404 });
    await expect(manager.resolveExtensionResource('com.acme.remote', '../../escape.txt', await remoteAuthorityFor(dataDirectory)))
      .rejects.toMatchObject({ code: 'invalid_hosted_resource', status: 400 });
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/icon.svg', await remoteAuthorityFor(dataDirectory)))
      .rejects.toMatchObject({ code: 'invalid_hosted_resource', status: 404 });
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('fails closed when the resource origin is no longer in the approved resourceOrigins', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-origin-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });

    // Simulate a grant removal after connect: the approved permissions no
    // longer include the resource origin.
    const statePath = path.join(dataDirectory, 'interactive-ui', 'installations.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    state.extensions['com.acme.remote'].versions['1.0.0'].remote.approvedPermissions.resourceOrigins = [];
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}
`);

    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory)))
      .rejects.toMatchObject({ code: 'hosted_permission_mismatch', status: 403 });
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('does not cache or poison retries when fetch validation fails at the manager seam', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-fetch-fail-');
    const keys = generatePublisherKeyPair();
    const extra = [
      { path: 'ui/f1.view.json', mimeType: 'application/json', bytes: Buffer.from('{"f":1}') },
      { path: 'ui/f2.view.json', mimeType: 'application/json', bytes: Buffer.from('{"f":2}') },
      { path: 'ui/f3.view.json', mimeType: 'application/json', bytes: Buffer.from('{"f":3}') },
    ];
    const remote = createRemoteManifest({ keys, extraResources: extra });
    const resources = [
      { path: 'ui/overview.view.json', bytes: remote.view, mimeType: 'application/json' },
      { path: extra[0].path, bytes: extra[0].bytes, mimeType: 'application/json' },
      { path: extra[1].path, bytes: extra[1].bytes, mimeType: 'application/json' },
      { path: extra[2].path, bytes: extra[2].bytes, mimeType: 'application/json' },
    ];
    let mode = 'ok';
    let resourceFetches = 0;
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      const current = resources.find((candidate) => `https://apps.example.com/${candidate.path}` === value);
      if (!current) {
        return new Response('not found', { status: 404 });
      }
      resourceFetches += 1;
      const bytes = mode === 'hash' ? Buffer.from('wrong bytes') : current.bytes;
      const headers = mode === 'mime'
        ? { 'Content-Type': 'text/plain' }
        : { 'Content-Type': 'application/json' };
      if (mode === 'redirect') {
        const response = new Response(bytes, { status: 200, headers });
        Object.defineProperty(response, 'url', { value: 'https://cdn.example.net/overview.view.json' });
        return response;
      }
      if (mode === 'oversize') {
        return new Response(bytes, {
          status: 200,
          headers: { 'Content-Type': 'application/json', 'Content-Length': '99999999' },
        });
      }
      return new Response(bytes, { status: 200, headers });
    };
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const authority = await remoteAuthorityFor(dataDirectory);

    for (const [index, [failingMode, code]] of [
      ['mime', 'hosted_resource_mime_mismatch'],
      ['hash', 'hosted_resource_integrity_failed'],
      ['redirect', 'hosted_resource_unavailable'],
      ['oversize', 'hosted_payload_too_large'],
    ].entries()) {
      const current = resources[index];
      mode = failingMode;
      await expect(manager.resolveExtensionResource('com.acme.remote', current.path, authority))
        .rejects.toMatchObject({ code });
      // A successful retry for the SAME resource fetches FROM SCRATCH: the
      // failed attempt cached nothing and did not poison later retries.
      mode = 'ok';
      await expect(manager.resolveExtensionResource('com.acme.remote', current.path, authority))
        .resolves.toEqual(current.bytes);
    }
    // Every success after a failure required a fresh fetch (no stale cache).
    expect(resourceFetches).toBe(8);
    // The cache is in-memory only: no filesystem directory is created.
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });  it('returns null for non-Remote and missing extensions so disk behavior is preserved', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-nonremote-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-nonremote-opencode-');
    const keys = generatePublisherKeyPair();
    const localPackage = await createPackage({ version: '1.0.0', keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
    });
    const inspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    });

    // Local delivery and unknown extensions resolve to null (never fetched,
    // never cached) so the runtime keeps its existing disk failure behavior.
    const localAuthority = await remoteAuthorityFor(dataDirectory, { extensionId: 'com.acme.operations' });
    expect(await manager.resolveExtensionResource('com.acme.operations', 'ui/view.json', localAuthority)).toBeNull();
    // A missing extension with a captured root OUTSIDE the managed versions
    // directory is a configured/built-in Local root: null disk fallback.
    const configuredOutsideRoot = path.join(dataDirectory, 'configured');
    await fs.mkdir(path.join(configuredOutsideRoot, 'com.acme.missing'), { recursive: true });
    const outsideAuthority = {
      directory: path.join(configuredOutsideRoot, 'com.acme.missing'),
      extensionHash: 'sha256-' + 'A'.repeat(43) + '=',
      signedManifestHash: null,
      // Ordinary configured/built-in root: no manager provenance.
    };
    expect(await manager.resolveExtensionResource('com.acme.missing', 'ui/view.json', outsideAuthority)).toBeNull();
    // A missing extension with a captured MANAGED root (manager-issued
    // provenance) fails closed: a stale/recreated managed path must never
    // serve bytes.
    const insideAuthority = {
      directory: path.join(dataDirectory, 'extensions', 'com.acme.missing', '1.0.0'),
      extensionHash: 'sha256-' + 'A'.repeat(43) + '=',
      signedManifestHash: null,
      provenance: { generation: 'stale-managed-generation' },
    };
    await expect(manager.resolveExtensionResource('com.acme.missing', 'ui/view.json', insideAuthority))
      .rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('clears the Remote resource cache on uninstall and on Remote rollback (in-memory semantic)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-cache-clear-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-cache-clear-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const resourceFetches = [];
    const fetchImpl = async (url) => {
      const value = String(url);
      resourceFetches.push(value);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(remote.view, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const connectOptions = {
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    };
    const connected = await manager.connectRemote(connectOptions);
    await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));
    resourceFetches.length = 0;

    // Uninstall clears the extension's in-memory cache: a reconnect must
    // fetch the resource FRESH (not serve a stale hit).
    await manager.uninstall('com.acme.remote');
    const reconnected = await manager.connectRemote(connectOptions);
    await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));
    expect(resourceFetches.filter((url) => url === 'https://apps.example.com/ui/overview.view.json')).toHaveLength(1);
    resourceFetches.length = 0;

    // Failed-connect rollback clears the cache again.
    await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));
    resourceFetches.length = 0;
    const rollback = await reconnected.capability.rollback();
    expect(rollback.removed).toBe(true);
    const third = await manager.connectRemote(connectOptions);
    await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));
    expect(resourceFetches.filter((url) => url === 'https://apps.example.com/ui/overview.view.json')).toHaveLength(1);
    // The third (post-rollback) installation is active and its cache works.
    expect((await manager.list()).extensions[0].id).toBe('com.acme.remote');
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory)))
      .resolves.toEqual(remote.view);
    // The cache is in-memory only: no filesystem directory is created.
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('uninstall clears only that extension\'s in-memory cache entries and preserves others', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-cache-clear-isolation-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-cache-clear-isolation-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(remote.view, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const connectOptions = {
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    };
    await manager.connectRemote(connectOptions);
    await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));

    // Uninstall succeeds and clears only this extension; the durable state is
    // removed and no filesystem remote-cache directory ever exists.
    const uninstallResult = await manager.uninstall('com.acme.remote');
    expect(uninstallResult.removed).toBe(true);
    expect((await manager.list()).extensions).toEqual([]);
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('Remote rollback clears the in-memory cache and stays failure-atomic', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-cache-fail-rollback-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-cache-fail-rollback-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const resourceFetches = [];
    const fetchImpl = async (url) => {
      const value = String(url);
      resourceFetches.push(value);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(remote.view, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const connectOptions = {
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    };
    const connected = await manager.connectRemote(connectOptions);
    await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));
    resourceFetches.length = 0;

    // The capability rollback succeeds, removes the durable state, and clears
    // the in-memory cache: a reconnect must fetch fresh.
    const rollback = await connected.capability.rollback();
    expect(rollback.removed).toBe(true);
    expect((await manager.list()).extensions).toEqual([]);
    const third = await manager.connectRemote(connectOptions);
    await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));
    expect(resourceFetches.filter((url) => url === 'https://apps.example.com/ui/overview.view.json')).toHaveLength(1);
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
  // Deterministic concurrency interleavings for the manager-scoped queue:
  // resolveExtensionResource (state read + reverify + exact lookup + network
  // fetch + atomic cache write) runs inside the same mutate queue as every
  // manager mutation, so an in-flight old installation load can never write
  // or serve bytes after uninstall / failed-connect rollback overtakes it.
  const createGatedRemoteFetch = (remote) => {
    const requested = [];
    let releaseResource;
    let markResourceReached;
    const gate = new Promise((resolve) => { releaseResource = resolve; });
    const reached = new Promise((resolve) => { markResourceReached = resolve; });
    const fetchImpl = async (url) => {
      const value = String(url);
      requested.push(value);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/overview.view.json') {
        markResourceReached();
        await gate;
        return new Response(remote.view, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    return { fetchImpl, requested, releaseResource, resourceReached: reached };
  };

  // Deterministic concurrency interleavings for the TWO-PHASE resolver:
  // the short phase A (classify + capture plan) and short phase C
  // (re-classify + fail-closed postflight) run inside the manager mutate
  // queue, while the network/cache phase B runs OUTSIDE it — so lifecycle
  // mutations (uninstall, failed-connect rollback) and unrelated mutations
  // complete while a Remote fetch is paused, and a stale in-flight resolve
  // NEVER returns bytes after uninstall/rollback/reconnect/disable.

  it('completes uninstall while an in-flight Remote load is paused, rejects the stale load, and fresh-refetches after reconnect', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-two-phase-uninstall-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const { fetchImpl, requested, releaseResource, resourceReached } = createGatedRemoteFetch(remote);
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const connectOptions = {
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    };
    await manager.connectRemote(connectOptions);
    requested.length = 0;
    const authority = await remoteAuthorityFor(dataDirectory);

    // Phase B runs OUTSIDE the manager queue: the network fetch does not hold
    // the global mutation queue.
    const loading = manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', authority);
    await resourceReached;

    // Uninstall proceeds WHILE the Remote fetch is still paused (no longer
    // serialized behind the load): lifecycle safety is preserved.
    const uninstalling = manager.uninstall('com.acme.remote');
    const uninstallResult = await uninstalling;
    expect(uninstallResult.removed).toBe(true);
    expect((await manager.list()).extensions).toEqual([]);

    // The stale load is still paused; once released it must NOT return bytes:
    // phase C re-runs the central classification against the ORIGINAL captured
    // authority and fails closed on the removed record.
    let loadingSettled = false;
    const observed = loading.then((value) => { loadingSettled = true; return value; });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadingSettled).toBe(false);
    releaseResource();
    await expect(observed).rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });

    // No stale bytes survive and no on-disk cache was created; the in-flight
    // fetch did not repopulate the cleared cache.
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect((await manager.list()).extensions).toEqual([]);

    // A reconnected extension performs a FRESH fetch: no stale cached bytes.
    await manager.connectRemote(connectOptions);
    requested.length = 0;
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory)))
      .resolves.toEqual(remote.view);
    expect(requested).toEqual(['https://apps.example.com/ui/overview.view.json']);
  });

  it('completes failed-connect rollback while an in-flight Remote load is paused and rejects the stale load', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-two-phase-rollback-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const { fetchImpl, requested, releaseResource, resourceReached } = createGatedRemoteFetch(remote);
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const connectOptions = {
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    };
    const connected = await manager.connectRemote(connectOptions);
    requested.length = 0;
    const authority = await remoteAuthorityFor(dataDirectory);

    // Start a lazy load and hold its network fetch (phase B, outside the queue).
    const loading = manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', authority);
    await resourceReached;

    // Failed-connect rollback completes WHILE the Remote fetch is still
    // paused (no longer queued behind the load).
    const rollingBack = connected.capability.rollback();
    const rollbackResult = await rollingBack;
    expect(rollbackResult.removed).toBe(true);
    expect((await manager.list()).extensions).toEqual([]);

    // The stale load is still paused; once released it rejects (phase C fails
    // closed on the removed record) and never serves bytes.
    let loadingSettled = false;
    const observed = loading.then((value) => { loadingSettled = true; return value; });
    await Promise.resolve();
    await Promise.resolve();
    expect(loadingSettled).toBe(false);
    releaseResource();
    await expect(observed).rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });

    // No stale bytes survive; a reconnected extension fresh-refetches.
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    await manager.connectRemote(connectOptions);
    requested.length = 0;
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory)))
      .resolves.toEqual(remote.view);
    expect(requested).toEqual(['https://apps.example.com/ui/overview.view.json']);
  });

  it('does not hold the manager mutation queue during a Remote fetch (unrelated mutation completes first)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-two-phase-isolation-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const { fetchImpl, requested, releaseResource, resourceReached } = createGatedRemoteFetch(remote);
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // An unrelated extension (ordinary authority, Local delivery) that uses
    // the same manager mutation queue.
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.local',
      extensionName: 'Acme Local',
      toolName: 'local_open',
    });
    const localInspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: localInspection.publisher.fingerprint,
    });
    requested.length = 0;
    const authority = await remoteAuthorityFor(dataDirectory);

    // Pause extension A's Remote resource fetch (phase B is OUTSIDE the queue).
    const loading = manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', authority);
    await resourceReached;

    // An unrelated manager.mutate operation (disable the Local extension)
    // completes BEFORE A's fetch is released: the global queue is not held.
    let loadingSettled = false;
    const observed = loading.then((value) => { loadingSettled = true; return value; });
    const disabled = await manager.setEnabled('com.acme.local', false);
    expect(disabled.enabled).toBe(false);
    await Promise.resolve();
    await Promise.resolve();
    expect(loadingSettled).toBe(false);

    // Releasing A lets its resolve settle normally (phase C passes: A was
    // untouched) with verified bytes.
    releaseResource();
    await expect(observed).resolves.toEqual(remote.view);
    expect(requested).toEqual(['https://apps.example.com/ui/overview.view.json']);
    expect((await manager.list()).extensions.find((extension) => extension.id === 'com.acme.local').enabled).toBe(false);
  });

  it('bases postflight on an immutable authority snapshot (caller mutation during phase B cannot redirect it)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-two-phase-snapshot-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const { fetchImpl, releaseResource, resourceReached } = createGatedRemoteFetch(remote);
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const authority = await remoteAuthorityFor(dataDirectory);

    // Phase A captures an allowlisted deep SCALAR snapshot of the caller's
    // authority. Start the load and hold its network fetch (phase B).
    const loading = manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', authority);
    await resourceReached;

    // Mutate the CALLER-OWNED authority object AFTER phase A: directory,
    // hashes, and provenance.generation are all forged. Because the plan
    // holds only the frozen captured snapshot (never this reference), the
    // postflight subject is unchanged and the healthy installation resolves.
    authority.directory = '/some/other/place';
    const forge = (value) => `sha256-${crypto.createHash('sha256').update(value).digest('base64')}`;
    authority.extensionHash = forge(Buffer.from('forged-extension'));
    authority.signedManifestHash = forge(Buffer.from('forged-manifest'));
    authority.provenance = { generation: 'forged-generation' };

    releaseResource();
    await expect(loading).resolves.toEqual(remote.view);

    // The same mutated authority, passed FRESH to a new resolve, fails closed:
    // the earlier success came from the captured snapshot, not from tolerating
    // the mutation.
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', authority))
      .rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
  });

  it('fails closed for a stale managed-root resolution after removal (no disk fallback)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-interleave-removed-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const { fetchImpl, requested } = createGatedRemoteFetch(remote);
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // Capture the authority context BEFORE removal, as a stale runtime load
    // would have done at manifest-read time.
    const authority = await remoteAuthorityFor(dataDirectory);
    await manager.uninstall('com.acme.remote');
    requested.length = 0;
    const cacheRoot = path.join(dataDirectory, 'interactive-ui', 'remote-cache', 'com.acme.remote');

    // A stale resolution with a captured MANAGED root fails closed after
    // removal: null (which would authorize disk fallback) is never returned
    // for a managed-root capture, no bytes can recreate the cache, and no
    // fetch happens.
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', authority))
      .rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });
    expect(requested).toEqual([]);
    await expect(fs.stat(cacheRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await manager.list()).extensions).toEqual([]);
  });

  // Captured authority context as the runtime would produce it at manifest
  // read time: resolved shell directory, TRUE canonical SHA-256 of the parsed
  // openchamber.extension.json document (key-sorted canonicalStringify, so
  // key order/whitespace cannot change it), and SHA-256 of the sibling signed
  // Hosted manifest bytes.
  const remoteAuthorityFor = async (dataDirectory, {
    extensionId = 'com.acme.remote',
    version = '1.0.0',
    directory = path.join(dataDirectory, 'extensions', extensionId, version),
  } = {}) => {
    const parsed = JSON.parse(await fs.readFile(path.join(directory, 'openchamber.extension.json'), 'utf8'));
    const extensionHash = `sha256-${crypto.createHash('sha256').update(
      Buffer.from(canonicalStringify(parsed)),
    ).digest('base64')}`;
    let signedManifestHash = null;
    try {
      signedManifestHash = `sha256-${crypto.createHash('sha256').update(
        await fs.readFile(path.join(directory, '.openchamber.hosted-manifest.json')),
      ).digest('base64')}`;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    // Manager-issued provenance: the CURRENT lifecycle generation from the
    // durable state, mirroring what getEnabledExtensionRoots issues to the
    // runtime inside the structured root descriptor.
    const state = JSON.parse(await fs.readFile(
      path.join(dataDirectory, 'interactive-ui', 'installations.json'),
      'utf8',
    ));
    const record = state.extensions?.[extensionId];
    const active = record?.versions?.[record.activeVersion] ?? record?.versions?.[version];
    const generation = typeof active?.generationId === 'string' ? active.generationId : null;
    return { directory, extensionHash, signedManifestHash, provenance: { generation } };
  };

  it('rejects a known disabled Remote extension without fetching or caching (no disk fallback)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-disabled-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const { fetchImpl, requested } = createGatedRemoteFetch(remote);
    const manager = createInteractiveUIExtensionManager({ dataDirectory, fetchImpl });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // Place a disk entry inside the shell so a disk-first/fallback read WOULD
    // have something to serve — the disabled Remote must never reach it.
    const shellEntry = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0', 'ui', 'overview.view.json');
    await fs.mkdir(path.dirname(shellEntry), { recursive: true });
    await fs.writeFile(shellEntry, Buffer.from('{"unsigned":"disk bytes"}'));
    // Disable the connected Remote extension.
    await manager.setEnabled('com.acme.remote', false);
    requested.length = 0;
    const cacheRoot = path.join(dataDirectory, 'interactive-ui', 'remote-cache', 'com.acme.remote');

    // A disabled KNOWN Remote fails closed with a stable sanitized error:
    // never null (which would authorize disk fallback), never a resource
    // fetch, and no cache is created.
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory)))
      .rejects.toMatchObject({ code: 'remote_shell_disabled', status: 409 });
    expect(requested).toEqual([]);
    await expect(fs.stat(cacheRoot)).rejects.toMatchObject({ code: 'ENOENT' });

    // The error is stable across retries and still never fetches or caches.
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory)))
      .rejects.toMatchObject({ code: 'remote_shell_disabled', status: 409 });
    expect(requested).toEqual([]);
    await expect(fs.stat(cacheRoot)).rejects.toMatchObject({ code: 'ENOENT' });
    expect((await manager.list()).extensions[0].enabled).toBe(false);
  });

  // PRE-resolver interleavings through the ACTUAL runtime: the runtime reads
  // and parses openchamber.extension.json (capturing the authority context)
  // and only then enters the resolver. A gated resolver wrapper schedules the
  // lifecycle operation before forwarding the EXACT captured authority — the
  // production validation is not duplicated in the test.
  const createRuntimeWithGatedResolver = ({ manager, fsImpl = fs }) => {
    let releaseGate;
    let markReached;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const reached = new Promise((resolve) => { markReached = resolve; });
    const runtime = createInteractiveUIRuntime({
      fsPromises: fsImpl,
      path,
      crypto,
      fetchImpl: async () => { throw new Error('runtime fetch must not be used for Remote resources'); },
      extensionRoots: async () => [...await manager.getEnabledExtensionRoots()],
      resolveExtensionResource: async (extensionId, entry, authority) => {
        markReached();
        await gate;
        return manager.resolveExtensionResource(extensionId, entry, authority);
      },
      logger: { info() {}, warn() {}, error() {} },
    });
    return { runtime, releaseGate, reached };
  };

  it('fails closed for a stale runtime load after uninstall even when the managed path is recreated', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-runtime-stale-uninstall-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-runtime-stale-uninstall-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });

    let markReached;
    const { runtime, releaseGate, reached } = createRuntimeWithGatedResolver({ manager });
    // The old runtime reads/parses the shell manifest (captures authority) and
    // hangs before the resolver forwards it.
    const loading = runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    await reached;

    // Uninstall the Remote extension, then RECREATE the old managed path with
    // a disk file: a disk-first/fallback read would serve these bytes.
    await manager.uninstall('com.acme.remote');
    const recreated = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0', 'ui', 'overview.view.json');
    await fs.mkdir(path.dirname(recreated), { recursive: true });
    await fs.writeFile(recreated, JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: 'recreated-disk-bytes' },
    }));

    releaseGate();
    // The stale request fails closed (missing + captured MANAGED root): the
    // recreated disk file is never served and no cache is created.
    await expect(loading).rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a stale runtime load after reconnect with a different signed manifest', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-runtime-stale-reconnect-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-runtime-stale-reconnect-opencode-');
    const keys = generatePublisherKeyPair();
    const remoteA = createRemoteManifest({ keys, viewText: 'Remote A' });
    const remoteB = createRemoteManifest({ keys, viewText: 'Remote B' });
    const viewB = Buffer.from(JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: 'Remote B' },
    }));
    const managerFetch = (() => {
      let currentDocument = remoteA.document;
      let currentView = null;
      const serve = async (url) => {
        const value = String(url);
        if (value === appEntryUrl) {
          return new Response(JSON.stringify(currentDocument), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        if (value === 'https://apps.example.com/ui/overview.view.json') {
          return new Response(currentView, {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      };
      serve.switchTo = (document, view) => {
        currentDocument = document;
        currentView = view;
      };
      return serve;
    })();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: managerFetch,
    });
    const inspectionA = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspectionA.publisher.fingerprint,
      confirmedManifestHash: inspectionA.manifest.manifestHash,
    });

    let markReached;
    const { runtime, releaseGate, reached } = createRuntimeWithGatedResolver({ manager });
    // Old runtime captures manifest A, then hangs before the resolver.
    const staleLoading = runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    await reached;

    // Uninstall and reconnect the SAME id/version with a DIFFERENT signed
    // manifest/resource (manifest B).
    await manager.uninstall('com.acme.remote');
    managerFetch.switchTo(remoteB.document, viewB);
    const inspectionB = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspectionB.publisher.fingerprint,
      confirmedManifestHash: inspectionB.manifest.manifestHash,
    });

    // The stale request rejects instead of receiving the NEW bytes: the
    // captured authority (manifest A) fails the accepted-manifest binding.
    releaseGate();
    await expect(staleLoading).rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });

    // A FRESH runtime load reads the new shell manifest (new authority) and
    // may load the new bytes.
    const fresh = await runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(fresh.declarative.layout.value).toBe('Remote B');
  });

  it('connects and lazy-loads a Remote with a signed manifest above 512 KiB within the 2 MiB transport bound', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-large-manifest-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-large-manifest-opencode-');
    const keys = generatePublisherKeyPair();
    // A declared resource with a very long URL inflates the SIGNED manifest
    // beyond the 512 KiB extension-document cap while staying inside the
    // 2 MiB Hosted manifest transport bound. It is never requested.
    const hugePath = `ui/${'a'.repeat(600 * 1024)}.json`;
    const remote = createRemoteManifest({
      keys,
      extraResources: [{ path: hugePath, mimeType: 'application/json', bytes: Buffer.from('{}') }],
    });
    expect(Buffer.byteLength(JSON.stringify(remote.document))).toBeGreaterThan(512 * 1024);
    expect(Buffer.byteLength(JSON.stringify(remote.document))).toBeLessThanOrEqual(2 * 1024 * 1024);
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/overview.view.json') {
        return new Response(remote.view, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const manager = createInteractiveUIExtensionManager({ dataDirectory, opencodeConfigDirectory, fetchImpl });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // The authority binding must succeed: the captured sibling signed
    // manifest (larger than the extension-manifest cap, within the shared
    // 2 MiB Hosted transport bound) hashes to the accepted manifest hash, so
    // the lazy load works instead of failing on a null capture.
    const view = await manager.resolveExtensionResource(
      'com.acme.remote',
      'ui/overview.view.json',
      await remoteAuthorityFor(dataDirectory),
    );
    expect(view).toEqual(remote.view);
  });

  it('fails closed when a stale Remote root is inactive after a signed Local v2 is activated (no disk fallback)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-runtime-mixed-delivery-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-runtime-mixed-delivery-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const remoteRoot = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0');

    // An old runtime captured the v1 Remote shell authority and hangs before
    // forwarding it to the manager.
    const { runtime: staleRuntime, releaseGate, reached } = createRuntimeWithGatedResolver({ manager });
    const staleLoading = staleRuntime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    await reached;

    // Install and activate a signed LOCAL v2 with the SAME extension id, tool,
    // and view identity; the old Remote v1 root stays on disk but is inactive.
    const localPackage = await createPackage({
      version: '2.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const localInspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: localInspection.publisher.fingerprint,
    });
    const active = await manager.list();
    expect(active.extensions[0].activeVersion).toBe('2.0.0');
    expect(active.extensions[0].versions['2.0.0'].delivery).toBe('local');
    expect(active.extensions[0].versions['1.0.0'].delivery).toBe('remote');

    // Plant the old missing entry under the INACTIVE Remote v1 root: a
    // disk-first/fallback read would serve these unsigned bytes.
    const planted = path.join(remoteRoot, 'ui', 'overview.view.json');
    await fs.mkdir(path.dirname(planted), { recursive: true });
    await fs.writeFile(planted, JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: 'planted-unsigned-bytes' },
    }));

    releaseGate();
    // The stale load rejects: the captured managed root (v1) is NOT the
    // current exact active directory (v2), so root classification fails
    // closed BEFORE any delivery check — the planted bytes are never served
    // and no Remote resource fetch/cache happens.
    await expect(staleLoading).rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    // A FRESH/current runtime still loads the signed LOCAL v2 entry from its
    // exact active disk directory (legitimate Local fallback preserved).
    const freshRuntime = createInteractiveUIRuntime({
      fsPromises: fs,
      path,
      crypto,
      fetchImpl: async () => { throw new Error('runtime fetch must not be used'); },
      extensionRoots: async () => [...await manager.getEnabledExtensionRoots()],
      resolveExtensionResource: (extensionId, entry, authority) => (
        manager.resolveExtensionResource(extensionId, entry, authority)
      ),
      logger: { info() {}, warn() {}, error() {} },
    });
    const fresh = await freshRuntime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(fresh.declarative).toMatchObject({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
    });
    expect(fresh.declarative.layout.value).not.toBe('planted-unsigned-bytes');
  });

  it('fails closed (never null) when current Remote metadata.remote is invalid', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-invalid-remote-metadata-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-invalid-remote-metadata-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // Corrupt the durable state: delivery stays remote but metadata.remote
    // becomes invalid. A null fallback would authorize disk bytes; the
    // resolver must fail closed instead.
    const statePath = path.join(dataDirectory, 'interactive-ui', 'installations.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    state.extensions['com.acme.remote'].versions['1.0.0'].remote = null;
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

    await expect(manager.resolveExtensionResource(
      'com.acme.remote',
      'ui/overview.view.json',
      await remoteAuthorityFor(dataDirectory),
    )).rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a current Remote authority whose captured root is outside the managed versions directory', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-remote-outside-root-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-remote-outside-root-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const requested = [];
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document, requested),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    requested.length = 0;
    const cacheRoot = path.join(dataDirectory, 'interactive-ui', 'remote-cache', 'com.acme.remote');

    // A valid current Remote authority with ONLY the directory changed to an
    // outside path (hashes stay valid): the UNCONDITIONAL current-Remote
    // exact-root invariant rejects it before any resource metadata/fetch.
    const authority = await remoteAuthorityFor(dataDirectory);
    const outsideAuthority = {
      ...authority,
      directory: path.join(dataDirectory, 'configured', 'com.acme.remote'),
    };
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', outsideAuthority))
      .rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
    expect(requested).toEqual([]);
    await expect(fs.stat(cacheRoot)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a stale Remote authority after same-version uninstall and signed Local reinstall (no disk fallback)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-runtime-same-version-reuse-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-runtime-same-version-reuse-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });

    // An old runtime captured the Remote v1 authority and hangs before
    // forwarding it.
    const { runtime: staleRuntime, releaseGate, reached } = createRuntimeWithGatedResolver({ manager });
    const staleLoading = staleRuntime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    await reached;

    // Uninstall the Remote, then install a signed LOCAL v1 at the SAME
    // managed path (same versionsDirectory/<id>/1.0.0).
    await manager.uninstall('com.acme.remote');
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const localInspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: localInspection.publisher.fingerprint,
    });
    const active = await manager.list();
    expect(active.extensions[0].activeVersion).toBe('1.0.0');
    expect(active.extensions[0].versions['1.0.0'].delivery).toBe('local');

    // Plant an unsigned file at the stale Remote entry path under the reused
    // managed directory: the stale load must never read it.
    const reusedRoot = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0');
    const planted = path.join(reusedRoot, 'ui', 'overview.view.json');
    await fs.mkdir(path.dirname(planted), { recursive: true });
    await fs.writeFile(planted, JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: 'planted-unsigned-bytes' },
    }));

    releaseGate();
    // The stale Remote authority carries a NON-NULL signed-manifest hash,
    // which no legitimate Local root has: the managed Local fallback fails
    // closed instead of serving the planted bytes, with no Remote fetch/cache.
    await expect(staleLoading).rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    // The planted file also violates the signed Local shell's exact file-set
    // integrity (extra file -> quarantine), so remove it to restore the
    // legitimate Local install before loading it fresh.
    await fs.rm(planted, { force: true });

    // A FRESH/current runtime still loads the signed LOCAL v1 entry from disk.
    const freshRuntime = createManagerResolverRuntime({
      manager,
      roots: async () => [...await manager.getEnabledExtensionRoots()],
    });
    const fresh = await freshRuntime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(fresh.declarative).toMatchObject({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
    });
    expect(fresh.declarative.layout.value).toBe('Version 1.0.0');
    expect(fresh.declarative.layout.value).not.toBe('planted-unsigned-bytes');
  });

  // A minimal configured-root Local shell (plain string root, no manager
  // provenance) with a distinctive view value.
  const writeConfiguredLocalShell = async (root, {
    id = 'com.acme.remote',
    viewId = 'com.acme.remote.overview',
    tool = 'remote_open',
    value = 'configured-copy-bytes',
  } = {}) => {
    await fs.mkdir(path.join(root, 'ui'), { recursive: true });
    await fs.writeFile(path.join(root, 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id,
      name: 'Configured Copy',
      version: '9.9.9',
      views: [{
        id: viewId,
        runtime: 'declarative',
        entry: 'ui/view.json',
        tools: [tool],
      }],
      actions: [],
      permissions: { network: [] },
      trust: { mode: 'declarative', signature: 'production' },
    }));
    await fs.writeFile(path.join(root, 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: viewId,
      layout: { type: 'text', value },
    }));
  };

  const createManagerResolverRuntime = ({ manager, roots, fetchImpl, connectionStore }) => createInteractiveUIRuntime({
    fsPromises: fs,
    path,
    crypto,
    fetchImpl: fetchImpl ?? (async () => { throw new Error('runtime fetch must not be used'); }),
    extensionRoots: roots,
    connectionStore: connectionStore ?? null,
    resolveExtensionResource: (extensionId, entry, authority) => (
      manager.resolveExtensionResource(extensionId, entry, authority)
    ),
    authorizeExtensionAuthority: (extensionId, authority) => (
      manager.authorizeExtensionAuthority(extensionId, authority)
    ),
    logger: { info() {}, warn() {}, error() {} },
  });

  it('rejects a configured outside root colliding with a disabled installed Local id (no disk bytes)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-provenance-local-disabled-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-provenance-local-disabled-opencode-');
    const keys = generatePublisherKeyPair();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
    });
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const inspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    });
    // Disable the installed Local so its manager root is omitted.
    await manager.setEnabled('com.acme.remote', false);
    // A configured OUTSIDE root (plain string) carries a copy of the same id.
    const configuredRoot = await createTemporaryDirectory('ocix-provenance-configured-');
    await writeConfiguredLocalShell(configuredRoot);

    const runtime = createManagerResolverRuntime({
      manager,
      roots: [configuredRoot],
    });
    // The record exists but the capture has NO manager provenance, so the
    // collision manifest is rejected at DISCOVERY authorization: the
    // configured copy is absent from metadata and its disk bytes are never
    // served.
    await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'view_not_found', status: 404 });
  });

  it('serves a current legitimate Local descriptor from its exact active managed root', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-provenance-local-ok-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-provenance-local-ok-opencode-');
    const keys = generatePublisherKeyPair();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
    });
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const inspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    });

    const runtime = createManagerResolverRuntime({
      manager,
      roots: async () => [...await manager.getEnabledExtensionRoots()],
    });
    const descriptor = await runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(descriptor.declarative).toMatchObject({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
    });
    expect(descriptor.declarative.layout.value).toBe('Version 1.0.0');
  });

  it('serves the current legitimate Hosted exact cache descriptor and rejects an arbitrary outside Hosted root', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-provenance-hosted-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-provenance-hosted-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createHostedRemote({ keys, version: '2.0.0' });
    const thin = await createHostedThinPackage({ keys, initialPermissions: remote.permissions });
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === 'https://apps.example.com/manifest.json') {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/overview.view.json') {
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

    // Legitimate current Hosted: the exact verified last-good cache root
    // (manager descriptor with Hosted provenance) loads from disk.
    const hostedRuntime = createManagerResolverRuntime({
      manager,
      roots: async () => [...await manager.getEnabledExtensionRoots()],
    });
    const hostedDescriptor = await hostedRuntime.getViewDescriptor('com.acme.hosted.overview', 'hosted_open');
    expect(hostedDescriptor.declarative).toMatchObject({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.hosted.overview',
    });
    expect(hostedDescriptor.declarative.layout.value).toBe('Hosted 2.0.0');

    // An ARBITRARY outside-managed root (plain string) with the same id is
    // never a legitimate Hosted fallback.
    const arbitraryRoot = await createTemporaryDirectory('ocix-provenance-hosted-arbitrary-');
    await writeConfiguredLocalShell(arbitraryRoot, {
      id: 'com.acme.hosted',
      viewId: 'com.acme.hosted.overview',
      tool: 'hosted_open',
      value: 'arbitrary-hosted-copy',
    });
    const arbitraryRuntime = createManagerResolverRuntime({
      manager,
      roots: [arbitraryRoot],
    });
    // The record exists, so the arbitrary plain-string root is rejected at
    // DISCOVERY authorization and the copy is never served.
    await expect(arbitraryRuntime.getViewDescriptor('com.acme.hosted.overview', 'hosted_open'))
      .rejects.toMatchObject({ code: 'view_not_found', status: 404 });
  });

  it('rejects a stale Remote authority with a null sibling capture after same-version Local reuse (provenance-based)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-provenance-remote-sibling-null-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-provenance-remote-sibling-null-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });

    // The old runtime captures with an injected fsImpl that makes the sibling
    // signed-manifest read fail closed (ENOENT) -> signedManifestHash null,
    // so the rejection below cannot rely on the signed-manifest hash at all.
    const fsImpl = {
      ...fs,
      async open(target, flags, mode) {
        if (String(target).includes('.openchamber.hosted-manifest.json')) {
          const error = new Error('sibling unavailable');
          error.code = 'ENOENT';
          throw error;
        }
        return fs.open(target, flags, mode);
      },
    };
    const { runtime: staleRuntime, releaseGate, reached } = createRuntimeWithGatedResolver({ manager, fsImpl });
    const staleLoading = staleRuntime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    await reached;

    // Uninstall the Remote and install a signed LOCAL v1 at the same path.
    await manager.uninstall('com.acme.remote');
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const localInspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: localInspection.publisher.fingerprint,
    });

    releaseGate();
    // The stale Remote authority carries manager provenance with the OLD
    // Remote generation; the current Local record has a different lifecycle
    // generation, so the reused-path fallback fails closed even though the
    // sibling capture was null.
    await expect(staleLoading).rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    // A fresh/current runtime still loads the signed LOCAL v1 entry from disk.
    const freshRuntime = createManagerResolverRuntime({
      manager,
      roots: async () => [...await manager.getEnabledExtensionRoots()],
    });
    const fresh = await freshRuntime.getViewDescriptor('com.acme.remote.overview', 'remote_open');
    expect(fresh.declarative.layout.value).toBe('Version 1.0.0');
  });

  it('fails closed for an unknown/corrupt delivery value on a record even outside the managed root', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-provenance-bad-delivery-outside-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-provenance-bad-delivery-outside-opencode-');
    const keys = generatePublisherKeyPair();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
    });
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const inspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    });
    // Corrupt the durable delivery value on the existing record.
    const statePath = path.join(dataDirectory, 'interactive-ui', 'installations.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    state.extensions['com.acme.remote'].versions['1.0.0'].delivery = 'weird';
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);

    // A configured OUTSIDE root (plain string, no provenance) with the same
    // id: the record exists, so it is never legitimate — fail closed.
    const configuredRoot = await createTemporaryDirectory('ocix-provenance-bad-delivery-configured-');
    await writeConfiguredLocalShell(configuredRoot);
    const runtime = createManagerResolverRuntime({ manager, roots: [configuredRoot] });
    // The record exists, so the configured copy is rejected at DISCOVERY
    // authorization (never exposed, never served).
    await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'view_not_found', status: 404 });

    // Even WITH a matching provenance (stale managed descriptor), the corrupt
    // delivery value fails closed.
    await expect(manager.resolveExtensionResource(
      'com.acme.remote',
      'ui/view.json',
      await remoteAuthorityFor(dataDirectory),
    )).rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
  });

  it('sanitizes every public Local manager result (install/setEnabled/rollback/list) and keeps internal descriptors', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-public-sanitize-local-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-public-sanitize-local-opencode-');
    const keys = generatePublisherKeyPair();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
      runtimeVersion: '1.16.5',
    });
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const inspection = await manager.inspectPackage(localPackage.buffer);
    const installed = await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    });
    const installedJson = JSON.stringify(installed);
    expect(installedJson).not.toContain('generationId');
    expect(installedJson).not.toContain('fileHashes');
    expect(installedJson).not.toContain('installationId');
    expect(installedJson).not.toContain('provenance');
    expect(installed.extension.versions['1.0.0'].generationId).toBeUndefined();

    // The internal structured root descriptor STILL carries provenance.
    const roots = await manager.getEnabledExtensionRoots();
    expect(roots[0]).toMatchObject({
      directory: expect.any(String),
      provenance: { generation: expect.any(String) },
    });
    expect(JSON.stringify(roots)).not.toContain('generationId');

    const disabled = await manager.setEnabled('com.acme.remote', false);
    expect(JSON.stringify(disabled)).not.toContain('generationId');
    expect(JSON.stringify(disabled)).not.toContain('fileHashes');
    await manager.setEnabled('com.acme.remote', true);

    const localV2 = await createPackage({
      version: '2.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const v2Inspection = await manager.inspectPackage(localV2.buffer);
    await manager.installPackage(localV2.buffer, {
      confirmedPublisherFingerprint: v2Inspection.publisher.fingerprint,
    });
    const rolledBack = await manager.rollback('com.acme.remote');
    expect(JSON.stringify(rolledBack)).not.toContain('generationId');
    expect(JSON.stringify(rolledBack)).not.toContain('fileHashes');

    const listJson = JSON.stringify(await manager.list());
    expect(listJson).not.toContain('generationId');
    expect(listJson).not.toContain('fileHashes');
    expect(listJson).not.toContain('installationId');
  });

  it('never exposes generationId or installationId through Remote connect or Hosted refresh results', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-public-sanitize-remote-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-public-sanitize-remote-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
      runtimeVersion: '1.16.5',
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const connected = await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const connectJson = JSON.stringify(connected);
    expect(connectJson).not.toContain('generationId');
    expect(connectJson).not.toContain('provenance');
    expect(connectJson).not.toContain('fileHashes');
    expect(connected.extension).toEqual({
      id: 'com.acme.remote',
      name: 'Acme Remote',
      version: '1.0.0',
    });

    // Hosted install + refresh results sanitized.
    const hostedDataDirectory = await createTemporaryDirectory('ocix-public-sanitize-hosted-');
    const hostedOpenCodeConfigDirectory = await createTemporaryDirectory('ocix-public-sanitize-hosted-opencode-');
    const hostedRemote = createHostedRemote({ keys, version: '2.0.0' });
    const thin = await createHostedThinPackage({ keys, initialPermissions: hostedRemote.permissions });
    const hostedFetchImpl = async (url) => {
      const value = String(url);
      if (value === 'https://apps.example.com/manifest.json') {
        return new Response(JSON.stringify(hostedRemote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/overview.view.json') {
        return new Response(hostedRemote.view, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const hostedManager = createInteractiveUIExtensionManager({
      dataDirectory: hostedDataDirectory,
      opencodeConfigDirectory: hostedOpenCodeConfigDirectory,
      fetchImpl: hostedFetchImpl,
      runtimeVersion: '1.16.5',
    });
    const hostedInspection = await hostedManager.inspectPackage(thin.buffer);
    const hostedInstall = await hostedManager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: hostedInspection.publisher.fingerprint,
      confirmedHostedManifestHash: hostedInspection.hosted.manifestHash,
    });
    const hostedInstallJson = JSON.stringify(hostedInstall);
    expect(hostedInstallJson).not.toContain('generationId');
    expect(hostedInstallJson).not.toContain('fileHashes');
    expect(hostedInstall.extension.versions['1.0.0'].hosted.lastGood.integrity).toBeUndefined();

    const refreshed = await hostedManager.refreshHosted('com.acme.hosted', { force: true });
    const refreshedJson = JSON.stringify(refreshed);
    expect(refreshedJson).not.toContain('generationId');
    expect(refreshedJson).not.toContain('fileHashes');
    expect(refreshed.extension.versions['1.0.0'].hosted.lastGood.integrity).toBeUndefined();
  });

  it('authorizes discovery before exposure: a configured root cannot resurrect a disabled Remote id (zero upstream)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-authorize-disabled-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-authorize-disabled-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const upstream = [];
    const fetchImpl = async (url) => {
      const value = String(url);
      upstream.push(value);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/overview.view.json') {
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
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    await manager.setEnabled('com.acme.remote', false);

    const configuredRoot = await createTemporaryDirectory('ocix-authorize-configured-');
    await fs.mkdir(path.join(configuredRoot, 'ui'), { recursive: true });
    await fs.writeFile(path.join(configuredRoot, 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.remote',
      name: 'Acme Remote',
      version: '9.9.9',
      agentRouting: { domain: 'remote', intents: ['remote.overview'], examples: { en: ['Open Acme Remote'] }, dataAuthority: 'user-provided' },
      connectors: [{ id: 'crm', type: 'http', baseUrl: 'https://api.example.com', auth: { type: 'api-key' } }],
      views: [{
        id: 'com.acme.remote.overview',
        runtime: 'declarative',
        entry: 'ui/view.json',
        tools: ['remote_open'],
        routing: { intents: ['remote.overview'], priority: 80, operation: 'read' },
        displayModes: ['inline', 'workspace'],
      }],
      actions: [{ id: 'com.acme.remote.read', connector: 'crm', risk: 'read', request: { method: 'GET', path: '/crm' } }],
      permissions: { network: ['https://api.example.com'] },
      trust: { mode: 'declarative', signature: 'production' },
    }));
    await fs.writeFile(path.join(configuredRoot, 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: 'configured-copy-bytes' },
    }));

    const runtime = createManagerResolverRuntime({ manager, roots: [configuredRoot], fetchImpl });
    const listed = await runtime.listExtensions();
    expect(listed.extensions.some((extension) => extension.id === 'com.acme.remote')).toBe(false);
    await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'view_not_found' });
    await expect(runtime.configureRemoteConnection('com.acme.remote', 'crm', 'stale-installation', 'sk-stale'))
      .rejects.toMatchObject({ code: 'extension_not_found' });
    await expect(runtime.testConnection('com.acme.remote', 'crm'))
      .rejects.toMatchObject({ code: 'extension_not_found' });
    await expect(runtime.invokeAction('com.acme.remote.read', {
      extensionId: 'com.acme.remote',
      viewId: 'com.acme.remote.overview',
    })).rejects.toMatchObject({ code: 'view_not_found' });
    expect(upstream.filter((url) => url.includes('/crm') || url.includes('api.example'))).toEqual([]);

    const unrelatedRoot = await createTemporaryDirectory('ocix-authorize-unrelated-');
    await writeConfiguredLocalShell(unrelatedRoot, {
      id: 'com.acme.unrelated',
      viewId: 'com.acme.unrelated.overview',
      tool: 'unrelated_open',
      value: 'unrelated-works',
    });
    const unrelatedRuntime = createManagerResolverRuntime({ manager, roots: [unrelatedRoot], fetchImpl });
    const unrelatedDescriptor = await unrelatedRuntime.getViewDescriptor('com.acme.unrelated.overview', 'unrelated_open');
    expect(unrelatedDescriptor.declarative.layout.value).toBe('unrelated-works');
  });

  it('serves Hosted bytes verified inside the manager queue and rejects stale/tampered authorities', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-hosted-inqueue-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-hosted-inqueue-opencode-');
    const keys = generatePublisherKeyPair();
    let hostedRemote = createHostedRemote({ keys, version: '2.0.0' });
    let resourceBody = hostedRemote.view;
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === 'https://apps.example.com/manifest.json') {
        return new Response(JSON.stringify(hostedRemote.document), {
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
    const thin = await createHostedThinPackage({ keys, initialPermissions: hostedRemote.permissions });
    const inspection = await manager.inspectPackage(thin.buffer);
    await manager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedHostedManifestHash: inspection.hosted.manifestHash,
    });

    const freshRuntime = createManagerResolverRuntime({
      manager,
      roots: async () => [...await manager.getEnabledExtensionRoots()],
    });
    const descriptor = await freshRuntime.getViewDescriptor('com.acme.hosted.overview', 'hosted_open');
    expect(descriptor.declarative.layout.value).toBe('Hosted 2.0.0');

    const hostedAuthorityFor = async (hostedCacheRoot) => {
      const state = JSON.parse(await fs.readFile(path.join(dataDirectory, 'interactive-ui', 'installations.json'), 'utf8'));
      const hostedVersion = state.extensions['com.acme.hosted'].versions['1.0.0'];
      const parsedManifest = JSON.parse(await fs.readFile(path.join(hostedCacheRoot, 'openchamber.extension.json'), 'utf8'));
      const sibling = await fs.readFile(path.join(hostedCacheRoot, '.openchamber.hosted-manifest.json'));
      return {
        directory: hostedCacheRoot,
        extensionHash: `sha256-${crypto.createHash('sha256').update(Buffer.from(canonicalStringify(parsedManifest))).digest('base64')}`,
        signedManifestHash: `sha256-${crypto.createHash('sha256').update(sibling).digest('base64')}`,
        provenance: {
          generation: `${hostedVersion.generationId}:${hostedVersion.hosted.lastGood.manifestHash}`,
        },
      };
    };

    const hostedCacheRoot = path.join(dataDirectory, 'interactive-ui', 'hosted-cache', 'com.acme.hosted', '2.0.0');
    const cachedView = path.join(hostedCacheRoot, 'ui', 'overview.view.json');
    const freshAuthority = await hostedAuthorityFor(hostedCacheRoot);
    const tamperedBytes = Buffer.from('{"tampered":true}');
    await fs.writeFile(cachedView, tamperedBytes);
    await expect(manager.resolveExtensionResource('com.acme.hosted', 'ui/overview.view.json', freshAuthority))
      .rejects.toMatchObject({ code: 'hosted_cache_integrity_failed', status: 409 });
    await fs.writeFile(cachedView, hostedRemote.view);
    const restored = await manager.resolveExtensionResource('com.acme.hosted', 'ui/overview.view.json', freshAuthority);
    expect(Buffer.from(restored).equals(hostedRemote.view)).toBe(true);

    hostedRemote = createHostedRemote({ keys, version: '2.1.0' });
    resourceBody = hostedRemote.view;
    const refreshed = await manager.refreshHosted('com.acme.hosted', { force: true });
    expect(refreshed.extension.versions['1.0.0'].hosted.lastGood.version).toBe('2.1.0');
    await expect(manager.resolveExtensionResource('com.acme.hosted', 'ui/overview.view.json', freshAuthority))
      .rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });

    const freshAfterRefreshRuntime = createManagerResolverRuntime({
      manager,
      roots: async () => [...await manager.getEnabledExtensionRoots()],
    });
    const freshAfterRefresh = await freshAfterRefreshRuntime.getViewDescriptor('com.acme.hosted.overview', 'hosted_open');
    expect(freshAfterRefresh.declarative.layout.value).toBe('Hosted 2.1.0');
  });

  it('uninstalling Local and Hosted extensions never touches the Remote cache (isolation)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-uninstall-cache-scope-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-uninstall-cache-scope-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const resourceFetches = [];
    const fetchImpl = async (url) => {
      const value = String(url);
      resourceFetches.push(value);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(remote.view, {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
    });
    // A connected Remote with a populated in-memory cache entry.
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    await manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory));
    resourceFetches.length = 0;
    // A Local install that shares no cache with the Remote.
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.local',
      extensionName: 'Acme Local',
      toolName: 'local_open',
    });
    const localInspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: localInspection.publisher.fingerprint,
    });

    // Local uninstall succeeds and the Remote\'s cache entry is preserved.
    const localUninstall = await manager.uninstall('com.acme.local');
    expect(localUninstall.removed).toBe(true);
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/overview.view.json', await remoteAuthorityFor(dataDirectory)))
      .resolves.toEqual(remote.view);
    // No extra fetch happened for the preserved Remote cache hit.
    expect(resourceFetches).toEqual([]);

    // Remote uninstall succeeds and clears its own entries.
    const remoteUninstall = await manager.uninstall('com.acme.remote');
    expect(remoteUninstall.removed).toBe(true);
    expect((await manager.list()).extensions).toEqual([]);
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('never synthesizes generationId on initialize; missing-generation records stay fail-closed (no durable mutation, no roots)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-no-migration-failclosed-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-no-migration-failclosed-opencode-');
    const keys = generatePublisherKeyPair();
    const hostedRemote = createHostedRemote({ keys, version: '2.0.0' });
    const remoteManifest = createRemoteManifest({ keys, extensionId: 'com.acme.remote', viewText: 'Remote legacy' });
    // The Remote and Hosted fixtures share the same manifest URL; the Hosted
    // install happens first (mode 'hosted'), then the Remote connect switches
    // to mode 'remote'.
    let mode = 'hosted';
    const combinedFetchImpl = async (url) => {
      const value = String(url);
      if (value === 'https://apps.example.com/manifest.json') {
        return new Response(JSON.stringify(mode === 'hosted' ? hostedRemote.document : remoteManifest.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/overview.view.json') {
        return new Response(mode === 'hosted' ? hostedRemote.view : remoteManifest.view, {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const seedingManager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: combinedFetchImpl,
      runtimeVersion: '1.16.5',
    });
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.local',
      extensionName: 'Acme Local',
      toolName: 'local_open',
    });
    const localInspection = await seedingManager.inspectPackage(localPackage.buffer);
    await seedingManager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: localInspection.publisher.fingerprint,
    });
    const thin = await createHostedThinPackage({ keys, initialPermissions: hostedRemote.permissions });
    const hostedInspection = await seedingManager.inspectPackage(thin.buffer);
    await seedingManager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: hostedInspection.publisher.fingerprint,
      confirmedHostedManifestHash: hostedInspection.hosted.manifestHash,
    });
    mode = 'remote';
    const remoteInspection = await seedingManager.inspectRemote(appEntryUrl);
    await seedingManager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: remoteInspection.publisher.fingerprint,
      confirmedManifestHash: remoteInspection.manifest.manifestHash,
    });

    // Simulate a legacy state: strip generationId from ALL three delivery
    // modes. This is a rejection/current-contract test — initialize must NOT
    // migrate these records back into usability.
    const statePath = path.join(dataDirectory, 'interactive-ui', 'installations.json');
    const state = JSON.parse(await fs.readFile(statePath, 'utf8'));
    for (const version of Object.values(state.extensions['com.acme.local'].versions)) delete version.generationId;
    for (const version of Object.values(state.extensions['com.acme.hosted'].versions)) delete version.generationId;
    for (const version of Object.values(state.extensions['com.acme.remote'].versions)) delete version.generationId;
    await fs.writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`);
    const snapshot = await fs.readFile(statePath, 'utf8');

    // initialize succeeds but performs NO migration: the durable state is
    // byte-identical (generationId is created ONLY by current install/connect).
    const legacyManager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: combinedFetchImpl,
      runtimeVersion: '1.16.5',
    });
    await legacyManager.initialize();
    expect(await fs.readFile(statePath, 'utf8')).toBe(snapshot);
    const afterInitialize = JSON.parse(snapshot);
    expect(afterInitialize.extensions['com.acme.local'].versions['1.0.0'].generationId).toBeUndefined();
    expect(afterInitialize.extensions['com.acme.hosted'].versions['1.0.0'].generationId).toBeUndefined();
    expect(afterInitialize.extensions['com.acme.remote'].versions['1.0.0'].generationId).toBeUndefined();

    // No managed root is issued for ANY delivery without a lifecycle
    // generation (Local and Hosted silently skipped, Remote quarantined).
    expect(await legacyManager.getEnabledExtensionRoots()).toEqual([]);

    // Authorization fails closed for every delivery with the SAME stable code
    // (no installationId or other compatibility fallback).
    for (const extensionId of ['com.acme.local', 'com.acme.hosted', 'com.acme.remote']) {
      const authority = await remoteAuthorityFor(dataDirectory, { extensionId });
      await expect(legacyManager.authorizeExtensionAuthority(extensionId, authority))
        .rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
    }

    // Usable again only after a CURRENT reconnect: uninstall + reconnect
    // issues a fresh generationId and restores the managed root.
    await legacyManager.uninstall('com.acme.remote');
    mode = 'remote';
    const reconnectedInspection = await legacyManager.inspectRemote(appEntryUrl);
    await legacyManager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: reconnectedInspection.publisher.fingerprint,
      confirmedManifestHash: reconnectedInspection.manifest.manifestHash,
    });
    const rootsAfterReconnect = await legacyManager.getEnabledExtensionRoots();
    expect(rootsAfterReconnect.some((root) => root.directory.endsWith(path.join('com.acme.remote', '1.0.0')))).toBe(true);
    const reconnectedState = JSON.parse(await fs.readFile(statePath, 'utf8'));
    expect(reconnectedState.extensions['com.acme.remote'].versions['1.0.0'].generationId).toEqual(expect.any(String));
  });

  it('cannot resurrect an integrity-quarantined Remote via a configured root, and never consumes its stored credential', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-quarantine-collision-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-quarantine-collision-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const upstream = [];
    const fetchImpl = async (url) => {
      const value = String(url);
      upstream.push(value);
      if (value === appEntryUrl) {
        return new Response(JSON.stringify(remote.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (value === 'https://apps.example.com/ui/overview.view.json') {
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
    const connectionStore = createInteractiveUIConnectionStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
      fetchImpl,
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    // The connect binds this exact runtime; the capability takes accessKey only.
    const healthyRuntime = createManagerResolverRuntime({
      manager,
      roots: async () => [...await manager.getEnabledExtensionRoots()],
      connectionStore,
    });
    const connected = await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    }, healthyRuntime);

    // Store a REAL installation-bound Remote credential before quarantine.
    await connected.capability.configureCredential('sk-quarantine-credential');
    const secretsPath = path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json');
    expect(JSON.parse(await fs.readFile(secretsPath, 'utf8')).connections['com.acme.remote:crm'].accessKey)
      .toBe('sk-quarantine-credential');

    // Corrupt the managed Remote shell so it is integrity-quarantined and
    // omitted from root enumeration.
    const shellRoot = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0');
    await fs.writeFile(path.join(shellRoot, 'injected.txt'), 'tamper');
    const roots = await manager.getEnabledExtensionRoots();
    expect(roots).toEqual([]);
    const listed = await manager.list();
    expect(listed.extensions[0].integrity.status).toBe('failed');

    // A plain configured root reuses the SAME extension/surface/connector/
    // action IDs.
    const configuredRoot = await createTemporaryDirectory('ocix-quarantine-configured-');
    await fs.mkdir(path.join(configuredRoot, 'ui'), { recursive: true });
    await fs.writeFile(path.join(configuredRoot, 'openchamber.extension.json'), JSON.stringify({
      $schema: 'openchamber://extension/v1',
      id: 'com.acme.remote',
      name: 'Acme Remote',
      version: '9.9.9',
      agentRouting: { domain: 'remote', intents: ['remote.overview'], examples: { en: ['Open Acme Remote'] }, dataAuthority: 'user-provided' },
      connectors: [{ id: 'crm', type: 'http', baseUrl: 'https://api.example.com', auth: { type: 'api-key' } }],
      views: [{
        id: 'com.acme.remote.overview',
        runtime: 'declarative',
        entry: 'ui/view.json',
        tools: ['remote_open'],
        routing: { intents: ['remote.overview'], priority: 80, operation: 'read' },
        displayModes: ['inline', 'workspace'],
      }],
      actions: [{ id: 'com.acme.remote.read', connector: 'crm', risk: 'read', request: { method: 'GET', path: '/crm' } }],
      permissions: { network: ['https://api.example.com'] },
      trust: { mode: 'declarative', signature: 'production' },
    }));
    await fs.writeFile(path.join(configuredRoot, 'ui', 'view.json'), JSON.stringify({
      $schema: 'openchamber://declarative-view/v1',
      id: 'com.acme.remote.overview',
      layout: { type: 'text', value: 'configured-copy-bytes' },
    }));
    upstream.length = 0;

    const quarantineRuntime = createInteractiveUIRuntime({
      fsPromises: fs,
      path,
      crypto,
      fetchImpl,
      extensionRoots: [configuredRoot],
      connectionStore,
      resolveExtensionResource: (extensionId, entry, authority) => (
        manager.resolveExtensionResource(extensionId, entry, authority)
      ),
      authorizeExtensionAuthority: (extensionId, authority) => (
        manager.authorizeExtensionAuthority(extensionId, authority)
      ),
      logger: { info() {}, warn() {}, error() {} },
    });
    // The collision manifest is skipped at DISCOVERY authorization: absent
    // from every metadata surface, unreachable for operations, and the stored
    // credential is never consumed with zero business upstream requests.
    const registry = await quarantineRuntime.listExtensions();
    expect(registry.extensions.some((extension) => extension.id === 'com.acme.remote')).toBe(false);
    const catalog = await quarantineRuntime.getWorkbenchCatalog();
    expect(catalog.extensions.some((extension) => extension.id === 'com.acme.remote')).toBe(false);
    expect(JSON.stringify(catalog)).not.toContain('configured-copy');
    expect(JSON.stringify(catalog)).not.toContain(configuredRoot);
    const connections = await quarantineRuntime.listConnections();
    expect(connections.connections.some((connection) => connection.extension.id === 'com.acme.remote')).toBe(false);
    await expect(quarantineRuntime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'view_not_found' });
    await expect(connected.capability.configureCredential('sk-other'))
      .rejects.toMatchObject({ code: 'extension_not_found' });
    await expect(quarantineRuntime.testConnection('com.acme.remote', 'crm'))
      .rejects.toMatchObject({ code: 'extension_not_found' });
    await expect(quarantineRuntime.invokeAction('com.acme.remote.read', {
      extensionId: 'com.acme.remote',
      viewId: 'com.acme.remote.overview',
    })).rejects.toMatchObject({ code: 'view_not_found' });
    // The original installation-bound credential remains stored and unused.
    expect(JSON.parse(await fs.readFile(secretsPath, 'utf8')).connections['com.acme.remote:crm'].accessKey)
      .toBe('sk-quarantine-credential');
    expect(upstream.filter((url) => url.includes('api.example'))).toEqual([]);

    // A legitimate no-record configured root still works alongside.
    const unrelatedRoot = await createTemporaryDirectory('ocix-quarantine-unrelated-');
    await writeConfiguredLocalShell(unrelatedRoot, {
      id: 'com.acme.unrelated',
      viewId: 'com.acme.unrelated.overview',
      tool: 'unrelated_open',
      value: 'unrelated-works',
    });
    const unrelatedRuntime = createManagerResolverRuntime({ manager, roots: [unrelatedRoot], fetchImpl });
    const unrelatedDescriptor = await unrelatedRuntime.getViewDescriptor('com.acme.unrelated.overview', 'unrelated_open');
    expect(unrelatedDescriptor.declarative.layout.value).toBe('unrelated-works');
  });

  it('serializes an in-flight Hosted read with refresh and rejects tampering immediately before the single-entry open', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-hosted-interleave-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-hosted-interleave-opencode-');
    const keys = generatePublisherKeyPair();
    let hostedRemote = createHostedRemote({ keys, version: '2.0.0' });
    let resourceBody = hostedRemote.view;
    const fetchImpl = async (url) => {
      const value = String(url);
      if (value === 'https://apps.example.com/manifest.json') {
        return new Response(JSON.stringify(hostedRemote.document), {
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
    let gateTarget = null;
    let tamperBeforeOpen = null;
    let releaseGate;
    let openReached;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    const reached = new Promise((resolve) => { openReached = resolve; });
    const gatedFsImpl = {
      ...fs,
      async open(target, flags, mode) {
        if (gateTarget && String(target).endsWith(gateTarget)) {
          if (tamperBeforeOpen) {
            const tamper = tamperBeforeOpen;
            tamperBeforeOpen = null;
            await fs.writeFile(String(target), tamper);
          } else {
            openReached();
            await gate;
          }
        }
        return fs.open(target, flags, mode);
      },
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl,
      fsImpl: gatedFsImpl,
      runtimeVersion: '1.16.5',
    });
    const thin = await createHostedThinPackage({ keys, initialPermissions: hostedRemote.permissions });
    const inspection = await manager.inspectPackage(thin.buffer);
    await manager.installPackage(thin.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedHostedManifestHash: inspection.hosted.manifestHash,
    });

    const hostedAuthorityFor = async (hostedCacheRoot) => {
      const state = JSON.parse(await fs.readFile(path.join(dataDirectory, 'interactive-ui', 'installations.json'), 'utf8'));
      const hostedVersion = state.extensions['com.acme.hosted'].versions['1.0.0'];
      const parsedManifest = JSON.parse(await fs.readFile(path.join(hostedCacheRoot, 'openchamber.extension.json'), 'utf8'));
      const sibling = await fs.readFile(path.join(hostedCacheRoot, '.openchamber.hosted-manifest.json'));
      return {
        directory: hostedCacheRoot,
        extensionHash: `sha256-${crypto.createHash('sha256').update(Buffer.from(canonicalStringify(parsedManifest))).digest('base64')}`,
        signedManifestHash: `sha256-${crypto.createHash('sha256').update(sibling).digest('base64')}`,
        provenance: {
          generation: `${hostedVersion.generationId}:${hostedVersion.hosted.lastGood.manifestHash}`,
        },
      };
    };

    // Phase A: the single-entry open is gated AFTER full classification; a
    // refresh queued behind it cannot reach its fetch/settle point while the
    // read is held, and the released read returns ONLY the old authorized
    // bytes.
    const oldRoot = path.join(dataDirectory, 'interactive-ui', 'hosted-cache', 'com.acme.hosted', '2.0.0');
    const oldAuthority = await hostedAuthorityFor(oldRoot);
    gateTarget = path.join('com.acme.hosted', '2.0.0', 'ui', 'overview.view.json');
    const resolving = manager.resolveExtensionResource('com.acme.hosted', 'ui/overview.view.json', oldAuthority);
    await reached;
    hostedRemote = createHostedRemote({ keys, version: '2.1.0' });
    resourceBody = hostedRemote.view;
    let refreshedSettled = false;
    const refreshing = manager.refreshHosted('com.acme.hosted', { force: true }).then((result) => {
      refreshedSettled = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(refreshedSettled).toBe(false);
    releaseGate();
    const oldBytes = await resolving;
    expect(Buffer.from(oldBytes).toString('utf8')).toContain('Hosted 2.0.0');
    const refreshed = await refreshing;
    expect(refreshed.extension.versions['1.0.0'].hosted.lastGood.version).toBe('2.1.0');
    // The stale (pre-refresh) authority is rejected; a fresh authority serves
    // the new bytes.
    await expect(manager.resolveExtensionResource('com.acme.hosted', 'ui/overview.view.json', oldAuthority))
      .rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
    const newRoot = path.join(dataDirectory, 'interactive-ui', 'hosted-cache', 'com.acme.hosted', '2.1.0');
    const newAuthority = await hostedAuthorityFor(newRoot);
    const newBytes = await manager.resolveExtensionResource('com.acme.hosted', 'ui/overview.view.json', newAuthority);
    expect(Buffer.from(newBytes).toString('utf8')).toContain('Hosted 2.1.0');

    // Phase B: tampering the target IMMEDIATELY BEFORE the single-entry open
    // (after full classification) must be rejected by the exact-byte hash.
    gateTarget = path.join('com.acme.hosted', '2.1.0', 'ui', 'overview.view.json');
    tamperBeforeOpen = Buffer.from('{"tampered":true}');
    await expect(manager.resolveExtensionResource('com.acme.hosted', 'ui/overview.view.json', newAuthority))
      .rejects.toMatchObject({ code: 'hosted_resource_integrity_failed', status: 403 });
  });

  it('binds Local authority to the signed installed manifest (red/green extensionHash)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-local-authority-binding-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-local-authority-binding-opencode-');
    const keys = generatePublisherKeyPair();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
    });
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const inspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    });
    // A genuine authority (exact root + current generation + canonical hash
    // of the signed installed manifest) is authorized and resolves to null
    // (Local disk fallback).
    const genuine = await remoteAuthorityFor(dataDirectory);
    await expect(manager.authorizeExtensionAuthority('com.acme.remote', genuine))
      .resolves.toMatchObject({ authorized: true, kind: 'local' });
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/view.json', genuine)).resolves.toBeNull();

    // RED: the SAME exact current root/provenance but a DIFFERENT valid
    // canonical extensionHash (as if a swapped-in malicious manifest was
    // captured) while the signed installed tree is intact: authorization and
    // resolution must reject.
    const forged = {
      ...genuine,
      extensionHash: `sha256-${crypto.createHash('sha256').update(Buffer.from('{"evil":true}')).digest('base64')}`,
    };
    await expect(manager.authorizeExtensionAuthority('com.acme.remote', forged))
      .rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/view.json', forged))
      .rejects.toMatchObject({ code: 'remote_shell_integrity_failed', status: 409 });
    await expect(fs.stat(path.join(dataDirectory, 'interactive-ui', 'remote-cache')))
      .rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('rejects a no-record, no-provenance authority under the managed versions tree (remote_shell_missing)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-managed-tree-bypass-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-managed-tree-bypass-opencode-');
    const keys = generatePublisherKeyPair();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
    });
    const validHash = 'sha256-' + 'A'.repeat(43) + '=';
    // A recreated managed path with NO record and NO provenance: never
    // ordinary, never null-fallback.
    const recreatedManagedPath = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0');
    const managedAuthority = {
      directory: recreatedManagedPath,
      extensionHash: validHash,
      signedManifestHash: null,
    };
    await expect(manager.authorizeExtensionAuthority('com.acme.remote', managedAuthority))
      .rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/view.json', managedAuthority))
      .rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });

    // The managed versions tree ROOT itself is also rejected.
    const treeRootAuthority = {
      directory: path.join(dataDirectory, 'extensions'),
      extensionHash: validHash,
      signedManifestHash: null,
    };
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/view.json', treeRootAuthority))
      .rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });

    // A genuine outside configured root (no record, no provenance) remains
    // ordinary.
    const outsideConfiguredRoot = path.join(dataDirectory, 'configured');
    await fs.mkdir(path.join(outsideConfiguredRoot, 'com.acme.remote'), { recursive: true });
    const outsideAuthority = {
      directory: path.join(outsideConfiguredRoot, 'com.acme.remote'),
      extensionHash: validHash,
      signedManifestHash: null,
    };
    await expect(manager.authorizeExtensionAuthority('com.acme.remote', outsideAuthority))
      .resolves.toMatchObject({ authorized: true, kind: 'ordinary' });
  });

  it('rejects a plain configured root pointed at a recreated managed path (no unsigned bytes served)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-recreated-managed-config-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-recreated-managed-config-opencode-');
    const keys = generatePublisherKeyPair();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
    });
    const localPackage = await createPackage({
      version: '1.0.0',
      keys,
      extensionId: 'com.acme.remote',
      extensionName: 'Acme Remote',
      toolName: 'remote_open',
    });
    const inspection = await manager.inspectPackage(localPackage.buffer);
    await manager.installPackage(localPackage.buffer, {
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    });
    await manager.uninstall('com.acme.remote');

    // Recreate the old managed path with an UNSIGNED manifest + bytes, then
    // point a plain configured string root at it.
    const recreated = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0');
    await writeConfiguredLocalShell(recreated, {
      id: 'com.acme.remote',
      viewId: 'com.acme.remote.overview',
      tool: 'remote_open',
      value: 'unsigned-recreated-bytes',
    });
    const runtime = createManagerResolverRuntime({ manager, roots: [recreated] });
    // Authorization at discovery rejects the managed-tree path: the unsigned
    // manifest/bytes never appear or serve.
    await expect(runtime.getViewDescriptor('com.acme.remote.overview', 'remote_open'))
      .rejects.toMatchObject({ code: 'view_not_found', status: 404 });
    const listed = await runtime.listExtensions();
    expect(listed.extensions.some((extension) => extension.id === 'com.acme.remote')).toBe(false);

    // A genuine outside configured root still works.
    const outsideRoot = await createTemporaryDirectory('ocix-recreated-managed-outside-');
    await writeConfiguredLocalShell(outsideRoot, {
      id: 'com.acme.unrelated',
      viewId: 'com.acme.unrelated.overview',
      tool: 'unrelated_open',
      value: 'outside-works',
    });
    const outsideRuntime = createManagerResolverRuntime({ manager, roots: [outsideRoot] });
    const outsideDescriptor = await outsideRuntime.getViewDescriptor('com.acme.unrelated.overview', 'unrelated_open');
    expect(outsideDescriptor.declarative.layout.value).toBe('outside-works');
  });

  it('connectRemote exposes only public fields and an opaque non-enumerable capability', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-capability-public-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-capability-public-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const connectOptions = {
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    };
    const connected = await manager.connectRemote(connectOptions);
    // rollbackRemoteConnect is manager-private: it is NOT an own public method
    // of the manager object.
    expect(manager.rollbackRemoteConnect).toBeUndefined();
    expect(Object.keys(manager).includes('rollbackRemoteConnect')).toBe(false);
    // Public snapshot: only extension/connector serialize; raw bookkeeping and
    // internal authority material never appear.
    expect(Object.keys(connected).sort()).toEqual(['connector', 'extension']);
    expect(JSON.stringify(connected)).not.toContain('installationId');
    expect(JSON.stringify(connected)).not.toContain('trustAdded');
    expect(JSON.stringify(connected)).not.toContain('generationId');
    expect(JSON.stringify(connected)).not.toContain('provenance');
    expect(JSON.stringify(connected)).not.toContain('integrity');
    expect(connected.extension).toMatchObject({ id: 'com.acme.remote', name: 'Acme Remote', version: '1.0.0' });
    expect(connected.connector).toMatchObject({ id: 'crm', authType: 'api-key' });

    // The opaque capability is bound to THIS exact installation: after a
    // replacement, the old capability's rollback refuses, while the new one
    // still works.
    await manager.uninstall('com.acme.remote');
    const second = await manager.connectRemote(connectOptions);
    await expect(connected.capability.rollback())
      .rejects.toMatchObject({ code: 'remote_rollback_installation_changed', status: 409 });
    const rollback = await second.capability.rollback();
    expect(rollback.removed).toBe(true);
    expect((await manager.list()).extensions).toEqual([]);
  });

  it('rejects a managed-tree descendant whose first component starts with two dots (component-correct containment)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-two-dot-descendant-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-two-dot-descendant-opencode-');
    const keys = generatePublisherKeyPair();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
    });
    const validHash = 'sha256-' + 'A'.repeat(43) + '=';
    // A legitimate descendant whose FIRST component is named '..managed' is
    // INSIDE the managed versions tree (only an exact '..' or '../' counts as
    // parent) — fail closed in BOTH authorize and resolve.
    const twoDotPath = path.join(dataDirectory, 'extensions', '..managed', 'com.acme.remote', '1.0.0');
    await fs.mkdir(twoDotPath, { recursive: true });
    const authority = {
      directory: twoDotPath,
      extensionHash: validHash,
      signedManifestHash: null,
    };
    await expect(manager.authorizeExtensionAuthority('com.acme.remote', authority))
      .rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/view.json', authority))
      .rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });

    // A genuine outside configured root (created so realpath succeeds) stays
    // ordinary.
    const outsideRoot = path.join(dataDirectory, 'configured', 'com.acme.outside');
    await fs.mkdir(outsideRoot, { recursive: true });
    const outsideAuthority = {
      directory: outsideRoot,
      extensionHash: validHash,
      signedManifestHash: null,
    };
    await expect(manager.authorizeExtensionAuthority('com.acme.remote', outsideAuthority))
      .resolves.toMatchObject({ authorized: true, kind: 'ordinary' });
  });

  it('rejects an outside configured root that is a symlink into the managed versions tree (canonical alias defense)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-canonical-alias-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-canonical-alias-opencode-');
    const keys = generatePublisherKeyPair();
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch((await createRemoteManifest({ keys })).document),
    });
    const validHash = 'sha256-' + 'A'.repeat(43) + '=';
    // A real managed descendant, plus an OUTSIDE lexical configured root that
    // is a symlink to it: the canonical realpath comparison must reject it in
    // BOTH authorize and resolve (no disk fallback).
    const managedDescendant = path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0');
    await fs.mkdir(managedDescendant, { recursive: true });
    const outsideLink = path.join(dataDirectory, 'configured', 'com.acme.remote-link');
    await fs.mkdir(path.dirname(outsideLink), { recursive: true });
    await fs.symlink(managedDescendant, outsideLink);
    const aliasAuthority = {
      directory: outsideLink,
      extensionHash: validHash,
      signedManifestHash: null,
    };
    await expect(manager.authorizeExtensionAuthority('com.acme.remote', aliasAuthority))
      .rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });
    await expect(manager.resolveExtensionResource('com.acme.remote', 'ui/view.json', aliasAuthority))
      .rejects.toMatchObject({ code: 'remote_shell_missing', status: 404 });

    // A genuine outside target remains allowed.
    const genuineOutside = path.join(dataDirectory, 'configured', 'com.acme.genuine');
    await fs.mkdir(genuineOutside, { recursive: true });
    const genuineAuthority = {
      directory: genuineOutside,
      extensionHash: validHash,
      signedManifestHash: null,
    };
    await expect(manager.authorizeExtensionAuthority('com.acme.remote', genuineAuthority))
      .resolves.toMatchObject({ authorized: true, kind: 'ordinary' });
  });

  it('binds the credential runtime at connect and ignores caller-supplied runtimes (no installationId capture)', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-bound-capability-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-bound-capability-opencode-');
    const keys = generatePublisherKeyPair();
    const remote = createRemoteManifest({ keys });
    const connectionStore = createInteractiveUIConnectionStore({
      dataDirectory,
      fsImpl: fs,
      pathImpl: path,
      cryptoImpl: crypto,
      fetchImpl: remoteFetch(remote.document),
    });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: remoteFetch(remote.document),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    const connectOptions = {
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    };

    // A spy runtime that records every call and would expose the installation
    // identity if it were ever invoked.
    const capturedConfigure = [];
    const capturedRemove = [];
    const spyRuntime = {
      configureRemoteConnection: async (...args) => {
        capturedConfigure.push(args);
        return { credential: { configured: true } };
      },
      removeRemoteConnection: async (...args) => {
        capturedRemove.push(args);
        return { removed: true };
      },
    };

    // A DIRECT connect (no credential runtime bound): configure/remove fail
    // with the controlled non-sensitive error and the spy runtime is NEVER
    // touched — a caller cannot redirect operations or capture the hidden
    // installationId.
    const direct = await manager.connectRemote(connectOptions);
    await expect(direct.capability.configureCredential(spyRuntime, 'sk-x'))
      .rejects.toMatchObject({ code: 'remote_credential_runtime_unavailable', status: 409 });
    await expect(direct.capability.removeCredential(spyRuntime))
      .rejects.toMatchObject({ code: 'remote_credential_runtime_unavailable', status: 409 });
    expect(capturedConfigure).toEqual([]);
    expect(capturedRemove).toEqual([]);
    expect(JSON.stringify(direct)).not.toContain('installationId');
    expect(JSON.stringify(direct)).not.toContain('trustAdded');
    // Direct connects still roll back through the capability.
    const directRollback = await direct.capability.rollback();
    expect(directRollback.removed).toBe(true);

    // A BOUND connect: the real runtime is bound at connect creation and the
    // capability accepts only the access key; a caller-supplied fake runtime
    // is ignored (never invoked, so it cannot capture the installationId).
    const boundRuntime = createManagerResolverRuntime({
      manager,
      roots: async () => [...await manager.getEnabledExtensionRoots()],
      connectionStore,
    });
    const bound = await manager.connectRemote(connectOptions, boundRuntime);
    await bound.capability.configureCredential('sk-bound-key');
    const secrets = JSON.parse(await fs.readFile(
      path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json'),
      'utf8',
    ));
    expect(secrets.connections['com.acme.remote:crm'].accessKey).toBe('sk-bound-key');
    // Attempting to redirect with a fake runtime: the fake is never called
    // (the access-key argument is the fake object, which the BOUND runtime's
    // validator rejects), and the fake never captures the hidden id.
    await expect(bound.capability.configureCredential(spyRuntime, 'sk-other'))
      .rejects.toMatchObject({ code: 'remote_access_key_required' });
    expect(capturedConfigure).toEqual([]);
    expect(capturedRemove).toEqual([]);
    expect(JSON.stringify(bound)).not.toContain('installationId');
    expect(JSON.stringify(bound)).not.toContain('trustAdded');
    // The bound capability still removes the exact installation's credential.
    await expect(bound.capability.removeCredential()).resolves.toMatchObject({ removed: true });
    const afterRemove = JSON.parse(await fs.readFile(
      path.join(dataDirectory, 'interactive-ui', 'connection-secrets.json'),
      'utf8',
    ));
    expect(afterRemove.connections['com.acme.remote:crm']).toBeUndefined();
  });
});

describe('Remote OCIX lifecycle (Phase R3)', () => {
  const appEntryUrl = 'https://apps.example.com/manifest.json';

  // Stateful fetch: serves the CURRENT holder.document so tests can switch
  // the signed manifest between checks/applies; every requested URL is
  // recorded (resource URLs prove zero eager fetch).
  const createStatefulFetch = (holder, requested = []) => async (url) => {
    const value = String(url);
    requested.push(value);
    if (value === appEntryUrl) {
      return new Response(JSON.stringify(holder.document), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  const createLifecycleManager = async ({
    holder,
    requested,
    now,
    remoteProbeTtlMs,
    opencodeConfigDirectory,
    dataDirectoryPrefix = 'ocix-manager-r3-data-',
  }) => {
    const dataDirectory = await createTemporaryDirectory(dataDirectoryPrefix);
    const opencodeConfig = opencodeConfigDirectory
      ?? await createTemporaryDirectory('ocix-manager-r3-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: createStatefulFetch(holder, requested),
      ...(now ? { now } : {}),
      ...(remoteProbeTtlMs ? { remoteProbeTtlMs } : {}),
    });
    return { dataDirectory, opencodeConfig, manager };
  };

  const connectLifecycleApp = async (manager, document) => {
    const holder = { document };
    const inspection = await manager.inspectRemote(appEntryUrl);
    return manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
  };

  it('checkRemoteUpdate reports none for an unchanged signed manifest without writes or resource fetches', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const { manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);

    const lifecycle = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(lifecycle).toMatchObject({
      status: 'none',
      currentVersion: '1.0.0',
      currentManifestHash: expect.stringMatching(/^sha256-/),
      remoteVersion: null,
      remoteManifestHash: null,
      changeSummary: null,
      permissionDelta: 'none',
      addedPermissions: null,
      keyChanged: false,
      requiresUserConfirmation: false,
      health: { status: 'reachable', checkedAt: expect.any(String) },
    });
    expect(JSON.stringify(lifecycle)).not.toContain('BEGIN PUBLIC KEY');
    expect(JSON.stringify(lifecycle)).not.toContain('installationId');
    expect(JSON.stringify(lifecycle)).not.toContain('generationId');
    expect(requested.filter((url) => url === appEntryUrl).length).toBe(3); // inspect + connect + check
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    // The cached safe lifecycle is merged into the sanitized list output.
    expect(state.extensions[0].versions['1.0.0'].remote.lifecycle).toMatchObject({
      status: 'none',
      health: { status: 'reachable' },
    });
  });

  it('classifies an expansion update and requires confirmation without applying anything', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const v2 = createRemoteManifest({ keys, version: '2.0.0', extraAction: true, update: { changeSummary: 'Adds export action' } });
    const holder = { document: v1.document };
    const requested = [];
    const { dataDirectory, manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);
    holder.document = v2.document;

    const lifecycle = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(lifecycle).toMatchObject({
      status: 'available',
      remoteVersion: '2.0.0',
      remoteManifestHash: expect.stringMatching(/^sha256-/),
      changeSummary: 'Adds export action',
      permissionDelta: 'expanded',
      keyChanged: false,
      requiresUserConfirmation: true,
      health: { status: 'reachable' },
    });
    expect(lifecycle.addedPermissions).toEqual({
      actionIds: ['com.acme.remote.export'],
    });
    // Rejection/dismissal performs no apply: the old accepted contract stays
    // exactly effective and no new shell exists.
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.version).toBe('1.0.0');
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.remote', '2.0.0')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('prepares surface use: keeps the old contract for available+expansion and blocks required+expansion with a persisted actionable error', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const { dataDirectory, manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);

    // Available + expansion: old contract stays usable, nothing applies.
    holder.document = createRemoteManifest({ keys, version: '2.0.0', extraAction: true }).document;
    const prepared = await manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true });
    expect(prepared).toMatchObject({
      status: 'available',
      permissionDelta: 'expanded',
      requiresUserConfirmation: true,
    });
    expect(prepared.applied).toBeUndefined();
    expect((await manager.list()).extensions[0].activeVersion).toBe('1.0.0');

    // Required + expansion: BLOCKED with an actionable stable error and the
    // safe pending/blocked metadata is persisted.
    holder.document = createRemoteManifest({
      keys,
      version: '2.1.0',
      extraAction: true,
      update: { required: true, changeSummary: 'Mandatory export fix' },
    }).document;
    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({
        code: 'remote_update_required_blocked',
        status: 409,
        details: {
          blocked: true,
          version: '2.1.0',
          changeSummary: 'Mandatory export fix',
          requiresUserConfirmation: true,
        },
      });
    const state = await manager.list();
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toMatchObject({
      required: true,
      version: '2.1.0',
      reason: 'confirmation-required',
    });
    // The persisted block survives an unreachable network (no bypass).
    holder.document = null;
    const fetchImpl = async () => new Response('unavailable', { status: 503 });
    const unavailableManager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: path.join(dataDirectory, 'opencode-config'),
      fetchImpl,
    });
    await expect(unavailableManager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    const blockedLifecycle = await unavailableManager.getRemoteLifecycle('com.acme.remote');
    expect(blockedLifecycle).toMatchObject({
      status: 'required',
      blocked: { code: 'remote_update_required_blocked' },
      health: { status: 'unreachable' },
    });
    // getEnabledExtensionRoots must not issue the blocked root, and enabling
    // fails closed too.
    expect(await unavailableManager.getEnabledExtensionRoots()).toEqual([]);
    await expect(unavailableManager.setEnabled('com.acme.remote', true))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
  });

  it('clears the persisted required block when the signed manifest is reachable and non-required again', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const { manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);
    holder.document = createRemoteManifest({
      keys,
      version: '2.0.0',
      extraAction: true,
      update: { required: true },
    }).document;
    await expect(manager.prepareRemoteUse('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    expect((await manager.list()).extensions[0].versions['1.0.0'].remote.blocked).toBeTruthy();

    // The vendor removes the requirement: a fresh reachable probe supersedes
    // the persisted block and clears it.
    holder.document = v1.document;
    const prepared = await manager.prepareRemoteUse('com.acme.remote', { force: true });
    expect(prepared.status).toBe('none');
    expect((await manager.list()).extensions[0].versions['1.0.0'].remote.blocked).toBeUndefined();
    const roots = await manager.getEnabledExtensionRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0].directory).toContain('com.acme.remote');
  });

  it('automatically applies same-key none/reduced candidates (including required) with zero resource fetch and preserves the old version for rollback', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys, extraSurface: true });
    const v2 = createRemoteManifest({
      keys,
      version: '2.0.0',
      update: { required: true, changeSummary: 'Removes legacy actions' },
    });
    const holder = { document: v1.document };
    const requested = [];
    const { dataDirectory, manager } = await createLifecycleManager({ holder, requested });
    const connected = await connectLifecycleApp(manager, v1.document);
    const installationId = JSON.parse(await fs.readFile(
      path.join(dataDirectory, 'interactive-ui', 'installations.json'),
      'utf8',
    )).extensions['com.acme.remote'].versions['1.0.0'].remote.installationId;
    holder.document = v2.document;

    const result = await manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true });
    expect(result).toMatchObject({
      status: 'required',
      permissionDelta: 'reduced',
      requiresUserConfirmation: false,
      applied: true,
    });
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('2.0.0');
    const version = state.extensions[0].versions['2.0.0'];
    expect(version.remote.acceptedManifest).toMatchObject({ version: '2.0.0' });
    expect(version.remote.approvedPermissions.actionIds).toEqual(['com.acme.remote.read']);
    expect(version.remote.approvedPermissions.agentToolNames).toEqual(['remote_open']);
    expect(version.remote.connectorRefs).toEqual([{ id: 'crm', origin: 'https://api.example.com', authType: 'api-key' }]);
    // Credential identity is reused verbatim; a new lifecycle generation is
    // created; the previous version stays installed for rollback.
    const raw = JSON.parse(await fs.readFile(
      path.join(dataDirectory, 'interactive-ui', 'installations.json'),
      'utf8',
    ));
    expect(raw.extensions['com.acme.remote'].versions['2.0.0'].remote.installationId).toBe(installationId);
    expect(raw.extensions['com.acme.remote'].versions['2.0.0'].generationId).not.toBe(
      raw.extensions['com.acme.remote'].versions['1.0.0'].generationId,
    );
    expect(raw.extensions['com.acme.remote'].versions['1.0.0']).toBeTruthy();
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.remote', '1.0.0')))
      .resolves.toBeTruthy();
    // Metadata-only apply: ZERO declared resource bytes were fetched.
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
    expect(requested.filter((url) => url === appEntryUrl).length).toBeGreaterThanOrEqual(3);
    // Rollback remains verifiable.
    await expect(manager.rollback('com.acme.remote')).resolves.toMatchObject({
      activeVersion: '1.0.0',
    });
    // Re-applying the same signed manifest reuses the existing shell.
    holder.document = v2.document;
    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .resolves.toMatchObject({ applied: true });
    expect((await manager.list()).extensions[0].activeVersion).toBe('2.0.0');
    expect(connected.extension.id).toBe('com.acme.remote');
  });

  it('rejects version reuse and non-required downgrades with stable errors', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const { manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);

    // Same semantic version, different signed content: invalid version reuse.
    holder.document = createRemoteManifest({ keys, update: { changeSummary: 're-signed' } }).document;
    await expect(manager.checkRemoteUpdate('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_update_version_reuse', status: 409 });
    await expect(manager.prepareRemoteUse('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_update_version_reuse' });

    // Lower version without signed required: rollback not permitted.
    holder.document = createRemoteManifest({ keys, version: '0.9.0' }).document;
    await expect(manager.checkRemoteUpdate('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_update_rollback_not_required', status: 403 });

    // Lower version WITH signed required is a valid security rollback.
    holder.document = createRemoteManifest({ keys, version: '0.9.0', update: { required: true } }).document;
    const lifecycle = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(lifecycle).toMatchObject({ status: 'required', remoteVersion: '0.9.0' });
  });

  it('classifies key rotation as re-consent (exact fingerprint confirmation) and keeps the old key for rollback', async () => {
    const keys = generatePublisherKeyPair();
    const rotatedKeys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const v2 = createRemoteManifest({
      keys: rotatedKeys,
      version: '2.0.0',
      publisherKeyId: 'release-2027',
      update: { changeSummary: 'Rotates signing key' },
    });
    const holder = { document: v1.document };
    const requested = [];
    const { manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);
    holder.document = v2.document;

    const lifecycle = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(lifecycle).toMatchObject({
      status: 'available',
      keyChanged: true,
      requiresUserConfirmation: true,
      permissionDelta: 'none',
    });
    expect(lifecycle.publisherFingerprint).toMatch(/^sha256-/);
    // Apply without the exact confirmation: no write.
    await expect(manager.applyRemoteUpdate('com.acme.remote', {}))
      .rejects.toMatchObject({ code: 'remote_confirmation_required', status: 403 });
    // Apply with exact hash + fingerprint: the new key is trusted and the OLD
    // key stays for rollback.
    await expect(manager.applyRemoteUpdate('com.acme.remote', {
      confirmedManifestHash: lifecycle.remoteManifestHash,
      confirmedPublisherFingerprint: lifecycle.publisherFingerprint,
    })).resolves.toMatchObject({ applied: true, previousVersion: '1.0.0' });
    const trust = await manager.list();
    expect(trust.publishers[0].keys.map((key) => key.keyId).sort()).toEqual(['release-2026', 'release-2027']);
    expect((await manager.list()).extensions[0].activeVersion).toBe('2.0.0');
  });

  it('fails trust_invalid on same-keyId trust conflict and publisher identity change', async () => {
    const keys = generatePublisherKeyPair();
    const otherKeys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const { manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);

    // Same keyId with a different fingerprint: trust conflict, never a silent
    // key replacement.
    holder.document = createRemoteManifest({ keys: otherKeys, version: '2.0.0' }).document;
    await expect(manager.checkRemoteUpdate('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_trust_conflict', status: 403 });
    await expect(manager.prepareRemoteUse('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_trust_invalid' });
    expect((await manager.list()).extensions[0].activeVersion).toBe('1.0.0');

    // Publisher id change fails closed too.
    holder.document = createRemoteManifest({
      keys: otherKeys,
      version: '2.0.0',
      publisherId: 'com.acme.other',
      publisherKeyId: 'release-2027',
    }).document;
    await expect(manager.checkRemoteUpdate('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_publisher_changed', status: 403 });
    await expect(manager.getRemoteLifecycle('com.acme.remote')).resolves.toMatchObject({
      health: { status: 'trust_invalid', code: 'remote_publisher_changed' },
    });
  });

  it('rejects connector identity changes as a controlled update error', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const { manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);
    holder.document = createRemoteManifest({ keys, version: '2.0.0', connectorId: 'crm2' }).document;
    await expect(manager.checkRemoteUpdate('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_connector_changed', status: 409 });
    expect((await manager.list()).extensions[0].activeVersion).toBe('1.0.0');
  });

  it('keeps unreachable health usable (old contract) and fails closed on untrusted publisher key', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const { dataDirectory, manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-unreachable-opencode-');
    const unavailableManager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    const lifecycle = await unavailableManager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(lifecycle).toMatchObject({
      status: 'none',
      health: { status: 'unreachable', code: 'hosted_manifest_unavailable' },
    });
    // Surface/Workbench use stays on the old signed contract.
    await expect(unavailableManager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .resolves.toMatchObject({ status: 'none', health: { status: 'unreachable' } });
    expect(await unavailableManager.getEnabledExtensionRoots()).toHaveLength(1);

    // Removing the trusted publisher key fails closed for use (trust_invalid).
    // The in-use guard prevents removing it through the API while installed,
    // so simulate the trust record being gone (e.g. manual edit/corruption).
    const trustPath = path.join(dataDirectory, 'interactive-ui', 'trust.json');
    const trust = JSON.parse(await fs.readFile(trustPath, 'utf8'));
    delete trust.publishers['com.acme.publisher'].keys['release-2026'];
    await fs.writeFile(trustPath, `${JSON.stringify(trust, null, 2)}\n`);
    const untrustedManager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: createStatefulFetch(holder, []),
    });
    const untrusted = await untrustedManager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(untrusted.health).toMatchObject({ status: 'trust_invalid', code: 'publisher_untrusted' });
    await expect(untrustedManager.prepareRemoteUse('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_trust_invalid' });
  });

  it('keeps a trust-invalid Remote app visible in the blocked catalog after restart when its trust slot holds a DIFFERENT valid key', async () => {
    const keys = generatePublisherKeyPair();
    const wrongKeys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const { dataDirectory, manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);
    const freshManager = (opencodeConfigDirectory) => createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
      fetchImpl: createStatefulFetch(holder, requested),
    });
    // A genuinely matching trusted app with NO required block is NOT included
    // by this catalog-only seam (never duplicated by
    // getBlockedRemoteCatalogEntries).
    const trustedFresh = freshManager(await createTemporaryDirectory('ocix-manager-r3-wrongkey-trusted-opencode-'));
    expect(await trustedFresh.getBlockedRemoteCatalogEntries()).toEqual([]);

    // Corrupt the trust slot: SAME publisher id + keyId, but a DIFFERENT
    // valid Ed25519 public key (locally derived fingerprint mismatch), as if
    // the trust record was replaced/edited out-of-band.
    const trustPath = path.join(dataDirectory, 'interactive-ui', 'trust.json');
    const trust = JSON.parse(await fs.readFile(trustPath, 'utf8'));
    trust.publishers['com.acme.publisher'].keys['release-2026'].publicKey = wrongKeys.publicKey;
    await fs.writeFile(trustPath, `${JSON.stringify(trust, null, 2)}\n`);

    // Fresh manager (restart): the executable root is excluded, lifecycle/use
    // stays trust-invalid/fail-closed, and the blocked catalog keeps the app
    // visible as a MINIMAL entry (name/version, surfaces empty) because shell
    // reverify fails closed on the mismatched key.
    const fresh = freshManager(await createTemporaryDirectory('ocix-manager-r3-wrongkey-opencode-'));
    expect(await fresh.getEnabledExtensionRoots()).toEqual([]);
    const lifecycle = await fresh.getRemoteLifecycle('com.acme.remote');
    expect(lifecycle.health).toMatchObject({ status: 'trust_invalid' });
    expect(await fresh.getBlockedRemoteCatalogEntries()).toEqual([{
      id: 'com.acme.remote',
      name: 'Acme Remote',
      version: '1.0.0',
      surfaces: [],
    }]);
    expect((await fresh.list()).extensions[0].integrity).toMatchObject({
      status: 'failed',
      code: 'remote_shell_integrity_failed',
    });
    // Zero declared resource requests: only manifest update-check fetches.
    expect(requested.every((url) => url === appEntryUrl)).toBe(true);
  });

  it('applies a confirmed expansion update atomically (TOCTOU-safe refetch) and never fetches resources', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const v2 = createRemoteManifest({ keys, version: '2.0.0', extraAction: true });
    const holder = { document: v1.document };
    const requested = [];
    const { dataDirectory, manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);
    holder.document = v2.document;
    const lifecycle = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(lifecycle.permissionDelta).toBe('expanded');

    // TOCTOU: the candidate changed between check and apply; the apply must
    // refetch and reject the stale confirmation without any write.
    const tampered = createRemoteManifest({
      keys,
      version: '2.0.0',
      extraAction: true,
      update: { changeSummary: 'different bytes' },
    });
    holder.document = tampered.document;
    await expect(manager.applyRemoteUpdate('com.acme.remote', {
      confirmedManifestHash: lifecycle.remoteManifestHash,
      confirmedPublisherFingerprint: lifecycle.publisherFingerprint,
    })).rejects.toMatchObject({ code: 'remote_confirmation_required', status: 403 });
    let state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.remote', '2.0.0')))
      .rejects.toMatchObject({ code: 'ENOENT' });

    // Confirmed apply against the exact current candidate succeeds and stays
    // metadata-only (zero resource bytes).
    holder.document = v2.document;
    const fresh = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    await expect(manager.applyRemoteUpdate('com.acme.remote', {
      confirmedManifestHash: fresh.remoteManifestHash,
      confirmedPublisherFingerprint: fresh.publisherFingerprint,
    })).resolves.toMatchObject({ applied: true, previousVersion: '1.0.0' });
    state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('2.0.0');
    expect(state.extensions[0].versions['2.0.0'].remote.approvedPermissions.actionIds)
      .toEqual(['com.acme.remote.export', 'com.acme.remote.read']);
    expect(state.extensions[0].versions['2.0.0'].remote.lastConsentAt).toBeTruthy();
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
    // No pending/blocked metadata remains after a successful apply.
    expect(state.extensions[0].versions['2.0.0'].remote.blocked).toBeUndefined();
  });

  it('caches probes with inclusive TTL boundaries and coalesces same-extension in-flight checks', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    let currentTime = 1_000_000;
    const { manager } = await createLifecycleManager({
      holder,
      requested,
      now: () => currentTime,
      remoteProbeTtlMs: 45_000,
    });
    await connectLifecycleApp(manager, v1.document);
    const manifestFetches = () => requested.filter((url) => url === appEntryUrl).length;
    const baseline = manifestFetches();

    await manager.checkRemoteUpdate('com.acme.remote');
    expect(manifestFetches()).toBe(baseline + 1);
    // Settled TTL hit: no new fetch.
    await manager.checkRemoteUpdate('com.acme.remote');
    expect(manifestFetches()).toBe(baseline + 1);
    // INCLUSIVE upper boundary: still valid at exactly expiresAt.
    currentTime += 45_000;
    await manager.checkRemoteUpdate('com.acme.remote');
    expect(manifestFetches()).toBe(baseline + 1);
    // expiresAt + 1: expired, fresh probe.
    currentTime += 1;
    await manager.checkRemoteUpdate('com.acme.remote');
    expect(manifestFetches()).toBe(baseline + 2);
    // Manual force bypasses the settled TTL entry.
    await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(manifestFetches()).toBe(baseline + 3);

    // Same-extension in-flight coalescing: two concurrent checks share ONE
    // manifest fetch.
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let gateActive = false;
    const coalescingFetch = async (url) => {
      requested.push(String(url));
      if (String(url) === appEntryUrl) {
        if (gateActive) await gate;
        return new Response(JSON.stringify(holder.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const coalescingManager = createInteractiveUIExtensionManager({
      dataDirectory: await createTemporaryDirectory('ocix-manager-r3-coalesce-data-'),
      opencodeConfigDirectory: await createTemporaryDirectory('ocix-manager-r3-coalesce-opencode-'),
      fetchImpl: coalescingFetch,
    });
    await connectLifecycleApp(coalescingManager, v1.document);
    gateActive = true;
    const before = requested.filter((url) => url === appEntryUrl).length;
    const first = coalescingManager.checkRemoteUpdate('com.acme.remote', { force: true });
    const second = coalescingManager.checkRemoteUpdate('com.acme.remote', { force: true });
    release();
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult.status).toBe('none');
    expect(secondResult.status).toBe('none');
    expect(requested.filter((url) => url === appEntryUrl).length).toBe(before + 1);
  });

  it('rejects lifecycle APIs for non-Remote extensions and never exposes secrets in update responses', async () => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-local-data-');
    const opencodeConfigDirectory = await createTemporaryDirectory('ocix-manager-r3-local-opencode-');
    const keys = generatePublisherKeyPair();
    const local = await createPackage({ version: '1.0.0', keys });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory,
    });
    await manager.trustPublisher({
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'release-2026',
      publicKey: keys.publicKey,
    });
    await manager.installPackage(local.buffer, { source: { type: 'file' } });

    await expect(manager.checkRemoteUpdate('com.acme.operations', { force: true }))
      .rejects.toMatchObject({ code: 'remote_extension_required', status: 409 });
    await expect(manager.applyRemoteUpdate('com.acme.operations'))
      .rejects.toMatchObject({ code: 'remote_extension_required' });
    await expect(manager.prepareRemoteUse('com.acme.operations'))
      .rejects.toMatchObject({ code: 'remote_extension_required' });
    await expect(manager.getRemoteLifecycle('com.acme.operations'))
      .rejects.toMatchObject({ code: 'remote_extension_required' });
    await expect(manager.checkRemoteUpdate('com.acme.missing'))
      .rejects.toMatchObject({ code: 'extension_not_found' });
  });
});

const doc = (manifest) => new Response(JSON.stringify(manifest.document), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});
const v1Document = (keys) => new Response(JSON.stringify(createRemoteManifest({ keys }).document), {
  status: 200,
  headers: { 'Content-Type': 'application/json' },
});

describe('Remote OCIX lifecycle corrections (Phase R3 review)', () => {
  const appEntryUrl = 'https://apps.example.com/manifest.json';

  const createLifecycleManager = async ({ holder, requested }) => {
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-review-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-review-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: createStatefulFetch(holder, requested),
    });
    return { dataDirectory, opencodeConfig, manager };
  };

  // Stateful fetch: serves the CURRENT holder.document so tests can switch
  // the signed manifest between checks/applies.
  const createStatefulFetch = (holder, requested = []) => async (url) => {
    const value = String(url);
    requested.push(value);
    if (value === appEntryUrl) {
      return new Response(JSON.stringify(holder.document), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  };

  const connectLifecycleApp = async (manager, document) => {
    const inspection = await manager.inspectRemote(appEntryUrl);
    return manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
  };

  it('persists a fail-closed required block when the required auto-apply refetch fails, and a fresh manager with an unreachable entry stays blocked with exact old state', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const v2 = createRemoteManifest({ keys, version: '2.0.0', update: { required: true, changeSummary: 'Mandatory fix' } });
    const holder = { document: v1.document };
    const requested = [];
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-review-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-review-opencode-');
    let fetchCount = 0;
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          // inspect (1) + connect (2) succeed; the prepare PROBE (3) succeeds
          // and sees the signed required candidate; the apply TOCTOU
          // REFETCH (4) fails — the required update cannot be applied.
          if (fetchCount >= 4) return new Response('unavailable', { status: 503 });
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const v1ManifestHash = inspection.manifest.manifestHash;
    holder.document = v2.document;

    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({
        code: 'remote_update_required_blocked',
        status: 409,
        details: {
          blocked: true,
          version: '2.0.0',
          requiresUserConfirmation: false,
        },
      });
    // The safe blocked metadata is persisted with a stable reason and the old
    // contract is byte/field-exact: active version, accepted manifest, and
    // approved permissions are untouched.
    let state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1ManifestHash);
    expect(state.extensions[0].versions['1.0.0'].remote.approvedPermissions.actionIds)
      .toEqual(['com.acme.remote.read']);
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toMatchObject({
      required: true,
      version: '2.0.0',
      reason: 'apply-failed',
    });
    expect(requested.some((url) => url.includes('overview'))).toBe(false);

    // A LATER process/manager with the entry network unreachable must still
    // refuse use and root issuance, and the enumeration seam still covers the
    // enabled Remote id for startup warm-up.
    const unavailableManager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    await expect(unavailableManager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    await expect(unavailableManager.getRemoteLifecycle('com.acme.remote')).resolves.toMatchObject({
      status: 'required',
      blocked: { code: 'remote_update_required_blocked', reason: 'apply-failed' },
      health: { status: 'unreachable' },
    });
    expect(await unavailableManager.getEnabledRemoteExtensionIds()).toEqual(['com.acme.remote']);
    expect(await unavailableManager.getEnabledExtensionRoots()).toEqual([]);
    state = await unavailableManager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1ManifestHash);
  });

  it('checkRemoteUpdate clears an obsolete persisted required block on a fresh verified reachable non-required candidate (classification only) and the root returns', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const required = createRemoteManifest({
      keys,
      version: '2.0.0',
      extraAction: true,
      update: { required: true },
    });
    const holder = { document: v1.document };
    const requested = [];
    const { manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);

    // Persist a required block through prepare (required + expansion).
    holder.document = required.document;
    await expect(manager.prepareRemoteUse('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    expect((await manager.list()).extensions[0].versions['1.0.0'].remote.blocked).toBeTruthy();
    // While blocked, the executable root is NEVER issued.
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);

    // The vendor publishes a valid REACHABLE non-required candidate: a manual
    // check supersedes and clears the stale block (classification only — no
    // apply), so the dynamic root can return and the next surface trigger can
    // auto-apply.
    holder.document = createRemoteManifest({ keys, version: '2.0.0', update: { changeSummary: 'Now optional' } }).document;
    const lifecycle = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(lifecycle).toMatchObject({
      status: 'available',
      remoteVersion: '2.0.0',
      permissionDelta: 'none',
      requiresUserConfirmation: false,
      health: { status: 'reachable' },
    });
    expect(lifecycle.blocked).toBeUndefined();
    expect((await manager.list()).extensions[0].versions['1.0.0'].remote.blocked).toBeUndefined();
    // Classification only: the check applied NOTHING.
    expect((await manager.list()).extensions[0].activeVersion).toBe('1.0.0');
    const roots = await manager.getEnabledExtensionRoots();
    expect(roots).toHaveLength(1);
    expect(roots[0].directory).toContain('com.acme.remote');
    // The next surface trigger auto-applies the superseding candidate.
    holder.document = createRemoteManifest({ keys, version: '2.0.0', update: { changeSummary: 'Now optional' } }).document;
    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .resolves.toMatchObject({ applied: true });
    expect((await manager.list()).extensions[0].activeVersion).toBe('2.0.0');
  });

  it('a stale clear never deletes a newer required block persisted under the same installed contract (deterministic TOCTOU regression)', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const requiredA = createRemoteManifest({
      keys,
      version: '2.0.0',
      extraAction: true,
      update: { required: true, changeSummary: 'Mandatory export fix' },
    });
    const requiredB = createRemoteManifest({
      keys,
      version: '2.1.0',
      extraAction: true,
      update: { required: true, changeSummary: 'Mandatory export fix v2' },
    });
    const holder = { document: v1.document };
    const requested = [];
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-toctou-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-toctou-opencode-');
    // Test-only/injected pause hook: the FIRST stale clear parks OUTSIDE the
    // mutation queue (so a concurrent persist can run), letting the test
    // interleave a newer required block between the probe and the clearing
    // comparison.
    let clearHookCalls = 0;
    let releaseClear;
    const clearGate = new Promise((resolve) => { releaseClear = resolve; });
    let hookEnteredResolve;
    const hookEntered = new Promise((resolve) => { hookEnteredResolve = resolve; });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: createStatefulFetch(holder, requested),
      beforeClearRemoteBlockedUpdate: async () => {
        clearHookCalls += 1;
        hookEnteredResolve();
        if (clearHookCalls === 1) await clearGate;
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // Persist required block A (required + expansion => confirmation-required).
    holder.document = requiredA.document;
    await expect(manager.prepareRemoteUse('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    const blockA = (await manager.list()).extensions[0].versions['1.0.0'].remote.blocked;
    expect(blockA).toMatchObject({ required: true, version: '2.0.0', reason: 'confirmation-required' });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);

    // Start the stale check: the manifest is back to the accepted v1, so the
    // check sees a superseded block and parks inside the stale clear.
    holder.document = v1.document;
    const staleCheck = manager.checkRemoteUpdate('com.acme.remote', { force: true });
    await hookEntered;
    expect(clearHookCalls).toBe(1);

    // While the stale clear is parked, a NEWER required block B (version
    // 2.1.0, distinct observedAt) REPLACES block A in the durable state under
    // the SAME installed generation/hash — exactly what another process or a
    // newer observation would write.
    const statePath = path.join(dataDirectory, 'interactive-ui', 'installations.json');
    const raw = JSON.parse(await fs.readFile(statePath, 'utf8'));
    raw.extensions['com.acme.remote'].versions['1.0.0'].remote.blockedUpdate = {
      required: true,
      version: '2.1.0',
      manifestHash: 'sha256-newer-block',
      reason: 'confirmation-required',
      observedAt: '2026-08-05T23:00:00.000Z',
    };
    await fs.writeFile(statePath, `${JSON.stringify(raw, null, 2)}\n`);
    const blockB = (await manager.list()).extensions[0].versions['1.0.0'].remote.blocked;
    expect(blockB).toMatchObject({ required: true, version: '2.1.0', manifestHash: 'sha256-newer-block' });
    expect(blockB.version).not.toBe(blockA.version);
    // The vendor now serves the NEWER required candidate: the parked check's
    // forced re-resolve must see it (never the stale non-required probe).
    holder.document = requiredB.document;

    // Resume the stale clear: the exact-match comparison must refuse to
    // delete B, and the check must re-resolve (forced) and NEVER report
    // unblocked while the newer required block remains.
    releaseClear();
    const result = await staleCheck;
    expect(result).toMatchObject({
      status: 'required',
      blocked: { code: 'remote_update_required_blocked', version: '2.1.0' },
      health: { status: 'reachable' },
    });
    // The newer block B remains; roots and use stay blocked.
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toMatchObject({
      version: '2.1.0',
      manifestHash: 'sha256-newer-block',
    });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('classifies a candidate keyId whose trust slot is occupied by a different key as remote_trust_conflict, never an impossible re-consent', async () => {
    const keys = generatePublisherKeyPair();
    const slotKeys = generatePublisherKeyPair();
    const candidateKeys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-slot-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-slot-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: createStatefulFetch(holder, requested),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // A DIFFERENT key already occupies the candidate keyId slot.
    await manager.trustPublisher({
      id: 'com.acme.publisher',
      name: 'Acme',
      keyId: 'release-2027',
      publicKey: slotKeys.publicKey,
    });
    // The candidate signs under release-2027 with YET ANOTHER key: the slot
    // collision makes re-consent impossible, so check classifies it as a
    // trust conflict (not keyChanged).
    holder.document = createRemoteManifest({
      keys: candidateKeys,
      version: '2.0.0',
      publisherKeyId: 'release-2027',
    }).document;
    await expect(manager.checkRemoteUpdate('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_trust_conflict', status: 403 });
    await expect(manager.getRemoteLifecycle('com.acme.remote')).resolves.toMatchObject({
      health: { status: 'trust_invalid', code: 'remote_trust_conflict' },
      blocked: { code: 'remote_trust_conflict' },
    });
    // prepare fails closed too, and apply rejects with the same classification
    // instead of an impossible confirmation flow.
    await expect(manager.prepareRemoteUse('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_trust_invalid' });
    const lifecycle = await manager.getRemoteLifecycle('com.acme.remote');
    await expect(manager.applyRemoteUpdate('com.acme.remote', {
      confirmedManifestHash: lifecycle.remoteManifestHash ?? 'sha256-x',
      confirmedPublisherFingerprint: lifecycle.publisherFingerprint ?? 'sha256-y',
    })).rejects.toMatchObject({ code: 'remote_trust_conflict', status: 403 });
    expect((await manager.list()).extensions[0].activeVersion).toBe('1.0.0');
    // No trust mutation happened: the slot still holds the DIFFERENT key.
    const trust = await manager.list();
    expect(trust.publishers[0].keys.find((key) => key.keyId === 'release-2027').fingerprint)
      .toMatch(/^sha256-/);
  });

  it('optional update whose apply refetch becomes expansion stays old-contract-usable pending consent (no blocked record)', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const optional = createRemoteManifest({ keys, version: '2.0.0' });
    const expanded = createRemoteManifest({ keys, version: '2.0.0', extraAction: true, update: { changeSummary: 'now expansion' } });
    const requested = [];
    let fetchCount = 0;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-toctou-optional-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-toctou-optional-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          if (fetchCount === 1 || fetchCount === 2) return v1Document(keys);
          if (fetchCount === 3) return doc(optional);
          return doc(expanded); // apply refetch + forced reclassification
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const v1Hash = inspection.manifest.manifestHash;
    const result = await manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true });
    // The fresh ordinary pending-consent lifecycle is returned: the old
    // contract stays usable and nothing was applied or blocked.
    expect(result).toMatchObject({
      status: 'available',
      remoteVersion: '2.0.0',
      permissionDelta: 'expanded',
      requiresUserConfirmation: true,
      health: { status: 'reachable' },
    });
    expect(result.applied).toBeUndefined();
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1Hash);
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toBeUndefined();
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
    expect(fetchCount).toBe(5);
  });

  it('optional update whose apply refetch becomes unreachable keeps the exact old contract usable', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const optional = createRemoteManifest({ keys, version: '2.0.0' });
    const requested = [];
    let fetchCount = 0;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-toctou-unreach-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-toctou-unreach-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          if (fetchCount === 1 || fetchCount === 2) return v1Document(keys);
          if (fetchCount === 3) return doc(optional);
          return new Response('unavailable', { status: 503 }); // refetch + reclassification
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const v1Hash = inspection.manifest.manifestHash;
    const result = await manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true });
    expect(result).toMatchObject({
      status: 'none',
      health: { status: 'unreachable', code: 'hosted_manifest_unavailable' },
    });
    expect(result.applied).toBeUndefined();
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1Hash);
    expect(state.extensions[0].versions['1.0.0'].remote.approvedPermissions.actionIds)
      .toEqual(['com.acme.remote.read']);
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toBeUndefined();
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('optional update whose atomic staging fails returns not-applied with the old contract usable; a later trigger may retry and apply', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const optional = createRemoteManifest({ keys, version: '2.0.0' });
    const requested = [];
    let fetchCount = 0;
    let armStagingFailure = true;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-toctou-stage-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-toctou-stage-opencode-');
    const fsImpl = new Proxy(fs, {
      get(target, prop) {
        if (prop === 'rename') {
          return async (from, to) => {
            if (armStagingFailure && String(to).includes('extensions/com.acme.remote/2.0.0')) {
              const error = new Error('simulated atomic staging failure');
              error.code = 'EIO';
              throw error;
            }
            return target.rename(from, to);
          };
        }
        return target[prop];
      },
    });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fsImpl,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          if (fetchCount === 1 || fetchCount === 2) return v1Document(keys);
          return doc(optional); // probe, apply refetch, reclassification
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const v1Hash = inspection.manifest.manifestHash;
    const result = await manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true });
    // Staging failed: the same valid optional candidate is still present and
    // returns as NOT applied (old contract usable), without a retry loop.
    expect(result).toMatchObject({
      status: 'available',
      remoteVersion: '2.0.0',
      permissionDelta: 'none',
      requiresUserConfirmation: false,
    });
    expect(result.applied).toBeUndefined();
    let state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1Hash);
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toBeUndefined();
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.remote', '2.0.0')))
      .rejects.toMatchObject({ code: 'ENOENT' });
    // A later trigger may retry: with staging healthy again, the next surface
    // use auto-applies.
    armStagingFailure = false;
    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .resolves.toMatchObject({ applied: true });
    state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('2.0.0');
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('required update whose apply refetch becomes ordinary expansion supersedes the stale initial observation (old contract usable, no blocked record)', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const required = createRemoteManifest({ keys, version: '2.0.0', update: { required: true } });
    const expanded = createRemoteManifest({ keys, version: '2.0.0', extraAction: true, update: { changeSummary: 'now optional expansion' } });
    const requested = [];
    let fetchCount = 0;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-toctou-reqopt-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-toctou-reqopt-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          if (fetchCount === 1 || fetchCount === 2) return v1Document(keys);
          if (fetchCount === 3) return doc(required);
          return doc(expanded); // apply refetch + forced reclassification
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const v1Hash = inspection.manifest.manifestHash;
    const result = await manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true });
    expect(result).toMatchObject({
      status: 'available',
      remoteVersion: '2.0.0',
      permissionDelta: 'expanded',
      requiresUserConfirmation: true,
      health: { status: 'reachable' },
    });
    expect(result.applied).toBeUndefined();
    expect(result.blocked).toBeUndefined();
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1Hash);
    // The stale initial required observation must NOT be persisted.
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toBeUndefined();
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('validates probe clocks: invalid/out-of-range/overflow values yield checkedAt null and no caching; backward time is a miss; inclusive expiresAt retained', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    let currentTime = 1_000_000;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-clock-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-clock-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: createStatefulFetch(holder, requested),
      now: () => currentTime,
      remoteProbeTtlMs: 45_000,
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const manifestCount = () => requested.filter((url) => url === appEntryUrl).length;
    // Invalid clocks: checkedAt null, no throw, and every check probes fresh
    // (nothing is cached under an invalid clock).
    for (const bad of [NaN, Infinity, -Infinity, 1.5, -1, 8_640_000_000_000_001, Number.MAX_SAFE_INTEGER - 1000]) {
      currentTime = bad;
      const lifecycle = await manager.checkRemoteUpdate('com.acme.remote');
      expect(lifecycle.health.checkedAt).toBeNull();
    }
    const afterInvalid = manifestCount();
    expect(afterInvalid).toBe(2 + 7);
    // Valid clock: caching works and the true probe checkedAt is used.
    currentTime = 1_000_000;
    await manager.checkRemoteUpdate('com.acme.remote');
    const validProbe = manifestCount();
    await manager.checkRemoteUpdate('com.acme.remote'); // hit
    expect(manifestCount()).toBe(validProbe);
    // Backward clock regression: now < cachedAt is a MISS, never a hit.
    currentTime = 999_999;
    await manager.checkRemoteUpdate('com.acme.remote');
    expect(manifestCount()).toBe(validProbe + 1);
    // Inclusive expiresAt boundary retained (the backward probe cached at
    // 999_999 expires at 1_044_999).
    currentTime = 1_044_999;
    await manager.checkRemoteUpdate('com.acme.remote');
    expect(manifestCount()).toBe(validProbe + 1);
    currentTime = 1_045_000;
    await manager.checkRemoteUpdate('com.acme.remote');
    expect(manifestCount()).toBe(validProbe + 2);
  });

  it('two concurrent prepares: one atomically applies, the other detects the generation switch and signals contractChanged/reload', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const v2 = createRemoteManifest({ keys, version: '2.0.0' });
    const holder = { document: v1.document };
    const requested = [];
    const { dataDirectory, manager } = await createLifecycleManager({ holder, requested });
    await connectLifecycleApp(manager, v1.document);
    holder.document = v2.document;

    const [first, second] = await Promise.all([
      manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }),
      manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }),
    ]);
    // BOTH outcomes require/reach current-contract discovery: the winner
    // applied; the loser observed the active-contract switch and signals
    // applied:true/contractChanged (reload semantics) WITHOUT claiming it
    // performed the write. remote_update_none is NOT the loser outcome here.
    expect(first.applied).toBe(true);
    expect(second.applied).toBe(true);
    expect([first.contractChanged, second.contractChanged].filter(Boolean)).toHaveLength(1);
    // Final active contract is the new version with exactly ONE atomic
    // install and zero declared resource fetches.
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('2.0.0');
    await expect(fs.stat(path.join(dataDirectory, 'extensions', 'com.acme.remote', '2.0.0')))
      .resolves.toBeTruthy();
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('optional failed-apply reclassification fails closed when trust becomes invalid between probe and apply', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const optional = createRemoteManifest({ keys, version: '2.0.0' });
    const requested = [];
    let fetchCount = 0;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-trustflip-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-trustflip-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          if (fetchCount === 1 || fetchCount === 2) return v1Document(keys);
          if (fetchCount === 3) return doc(optional); // probe: trust valid, available
          if (fetchCount === 4) {
            // Trust becomes invalid BETWEEN the probe and the apply refetch.
            const trustPath = path.join(dataDirectory, 'interactive-ui', 'trust.json');
            const trust = JSON.parse(await fs.readFile(trustPath, 'utf8'));
            delete trust.publishers['com.acme.publisher'].keys['release-2026'];
            await fs.writeFile(trustPath, `${JSON.stringify(trust, null, 2)}\n`);
            return doc(optional); // refetch (apply's trust check then fails)
          }
          return doc(optional); // forced reclassification (trust now invalid)
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const v1Hash = inspection.manifest.manifestHash;
    // The optional reclassification must fail closed on fresh trust_invalid
    // (publisher_untrusted, no update.failure) exactly like the top-level
    // path: the old surface must NOT continue.
    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_trust_invalid', status: 403 });
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1Hash);
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toBeUndefined();
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('force bypasses a settled cache even while a non-force cache resolution is in flight (cache resolution is not a joinable network probe)', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const v2 = createRemoteManifest({ keys, version: '2.0.0', extraAction: true, update: { changeSummary: 'new candidate' } });
    const holder = { document: v1.document };
    const requested = [];
    let fetchCount = 0;
    let gateActive = false;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    let parkedResolve;
    const parked = new Promise((resolve) => { parkedResolve = resolve; });
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-force-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-force-opencode-');
    // Gate the durable-state read: the NON-force caller parks INSIDE its
    // settled-cache resolution (snapshot capture), and the force caller
    // arrives during it.
    const fsImpl = new Proxy(fs, {
      get(target, prop) {
        if (prop === 'readFile') {
          return async (...args) => {
            if (gateActive && String(args[0]).endsWith('installations.json')) {
              parkedResolve();
              await gate;
            }
            return target.readFile(...args);
          };
        }
        return target[prop];
      },
    });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fsImpl,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // Prime a settled no-update cache for v1 and prove it is a cache hit.
    await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect((await manager.checkRemoteUpdate('com.acme.remote')).status).toBe('none');
    const primedFetches = fetchCount; // inspect + connect + prime probe

    // The vendor publishes v2. A non-force cache resolution parks inside its
    // snapshot capture; a concurrent force:true call must NOT join it — it
    // must bypass the settled TTL entry and fetch the fresh candidate.
    holder.document = v2.document;
    gateActive = true;
    const nonForce = manager.checkRemoteUpdate('com.acme.remote');
    await parked;
    const forced = manager.checkRemoteUpdate('com.acme.remote', { force: true });
    release();
    const [nonForceResult, forcedResult] = await Promise.all([nonForce, forced]);
    expect(forcedResult).toMatchObject({
      status: 'available',
      remoteVersion: '2.0.0',
      permissionDelta: 'expanded',
      health: { status: 'reachable' },
    });
    // The non-force caller legitimately served the settled cache.
    expect(nonForceResult.status).toBe('none');
    // Exactly ONE fresh manifest fetch: the force path's network probe (the
    // cache resolution performed none).
    expect(fetchCount).toBe(primedFetches + 1);
  });

  it('revalidates the installed contract after every network probe: a contract switch during the probe yields a fresh classification of the new currentVersion/hash', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const v2 = createRemoteManifest({ keys, version: '2.0.0' });
    const holder = { document: v1.document };
    const requested = [];
    let fetchCount = 0;
    let gateActive = false;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-reval-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-reval-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          // The check's network probe (#3) parks; the apply's refetch (#4)
          // and the post-revalidation re-probe (#5) proceed ungated.
          if (fetchCount === 3 && gateActive) await gate;
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    holder.document = v2.document;
    gateActive = true;
    const checking = manager.checkRemoteUpdate('com.acme.remote', { force: true });
    for (let i = 0; i < 200 && fetchCount < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(fetchCount).toBe(3);
    // While the network probe is parked, SWITCH the installed active
    // contract via an existing manager operation: a confirmed apply of v2.
    const applied = await manager.applyRemoteUpdate('com.acme.remote', {
      confirmedManifestHash: inspection.manifest.manifestHash.replace(/.$/, 'x'),
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
    });
    expect(applied.applied).toBe(true);
    const v2Hash = (await manager.list()).extensions[0].versions['2.0.0'].remote.acceptedManifest.manifestHash;
    expect((await manager.list()).extensions[0].activeVersion).toBe('2.0.0');
    release();
    const result = await checking;
    // The caller must classify against the NEW currentVersion/hash with a
    // FRESH fetch — never the stale pre-switch classification.
    expect(result).toMatchObject({
      status: 'none',
      currentVersion: '2.0.0',
      currentManifestHash: v2Hash,
      health: { status: 'reachable' },
    });
    expect(fetchCount).toBe(5); // probe + apply refetch + fresh re-probe
    // No stale cache: a subsequent non-force check is a cache hit on the
    // revalidated entry (no extra fetch) and still reports 2.0.0/none.
    const again = await manager.checkRemoteUpdate('com.acme.remote');
    expect(again).toMatchObject({ status: 'none', currentVersion: '2.0.0' });
    expect(fetchCount).toBe(5);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('double contract switch during bounded re-probing fails closed with the stable churn error, caches nothing, and a subsequent call probes the final current contract', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const v2 = createRemoteManifest({ keys, version: '2.0.0' });
    const v3 = createRemoteManifest({ keys, version: '2.1.0' });
    const holder = { document: v1.document };
    const requested = [];
    let fetchCount = 0;
    let release1;
    let release2;
    const gate1 = new Promise((resolve) => { release1 = resolve; });
    const gate2 = new Promise((resolve) => { release2 = resolve; });
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-double-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-double-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          // Attempt 1 (#3) and attempt 2 (#5) of the check's bounded loop
          // park; the apply refetches (#4, #6) and the final stable call (#7)
          // proceed ungated.
          if (fetchCount === 3) await gate1;
          if (fetchCount === 5) await gate2;
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    holder.document = v2.document;
    const checking = manager.checkRemoteUpdate('com.acme.remote', { force: true });
    for (let i = 0; i < 200 && fetchCount < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(fetchCount).toBe(3);
    // Contract switch #1 while attempt 1 is parked: apply v2.
    await manager.applyRemoteUpdate('com.acme.remote', {});
    expect((await manager.list()).extensions[0].activeVersion).toBe('2.0.0');
    release1();
    for (let i = 0; i < 200 && fetchCount < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(fetchCount).toBe(5);
    // Contract switch #2 while attempt 2 is parked: apply v3.
    holder.document = v3.document;
    await manager.applyRemoteUpdate('com.acme.remote', {});
    const v3Hash = (await manager.list()).extensions[0].versions['2.1.0'].remote.acceptedManifest.manifestHash;
    expect((await manager.list()).extensions[0].activeVersion).toBe('2.1.0');
    release2();
    // Both bounded attempts changed under the caller: stable controlled churn
    // error, no stale lifecycle returned and nothing cached.
    await expect(checking).rejects.toMatchObject({
      code: 'remote_update_generation_changed',
      status: 409,
    });
    // A subsequent stable call freshly probes and returns the FINAL current
    // version/hash.
    holder.document = v3.document;
    const finalCheck = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(finalCheck).toMatchObject({
      status: 'none',
      currentVersion: '2.1.0',
      currentManifestHash: v3Hash,
      health: { status: 'reachable' },
    });
    // No stale cache was left behind: the final result is a real cache hit on
    // the fresh entry (no extra fetch).
    expect(fetchCount).toBe(7);
    const cached = await manager.checkRemoteUpdate('com.acme.remote');
    expect(cached).toMatchObject({ status: 'none', currentVersion: '2.1.0' });
    expect(fetchCount).toBe(7);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('returns the post-network snapshot: a required block persisted during the probe is never stale — supersession clears it only through the exact-match path', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const optional = createRemoteManifest({ keys, version: '2.0.0' });
    const required = createRemoteManifest({ keys, version: '2.0.0', extraAction: true, update: { required: true } });
    const holder = { document: v1.document };
    const requested = [];
    let fetchCount = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-blockstate-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-blockstate-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          fetchCount += 1;
          // Capture the served document BEFORE the gate so the parked probe
          // deterministically classifies the candidate that was current when
          // its network attempt started (the optional candidate), while the
          // block is persisted under the same installed contract during the
          // pause.
          const served = fetchCount === 3 ? holder.document : null;
          if (fetchCount === 3) await gate; // the check's network probe parks
          return new Response(JSON.stringify(served ?? holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    // A SECOND manager instance (existing manager behavior, shared durable
    // state) persists the block while the first manager's probe is parked.
    const manager2 = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        if (String(url) === appEntryUrl) {
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    // The check's probe classifies a NON-required candidate...
    holder.document = optional.document;
    const checking = manager.checkRemoteUpdate('com.acme.remote', { force: true });
    for (let i = 0; i < 200 && fetchCount < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(fetchCount).toBe(3);
    // ...while it is pending, a concurrent required observation persists a
    // required block under the SAME generation/hash/appEntryUrl via the
    // second manager's prepareRemoteUse (required + expansion).
    holder.document = required.document;
    await expect(manager2.prepareRemoteUse('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    const blocked = (await manager.list()).extensions[0].versions['1.0.0'].remote.blocked;
    expect(blocked).toMatchObject({ required: true, version: '2.0.0' });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]); // root withheld while blocked
    release();
    const result = await checking;
    // The caller acted on the FRESH post-network snapshot: the newer block is
    // superseded by the freshly verified non-required candidate and cleared
    // ONLY through the existing exact-match supersession path — the caller
    // never reported/used unblocked while the newer block remained (the
    // result and the persisted state are consistent).
    expect(result).toMatchObject({
      status: 'available',
      remoteVersion: '2.0.0',
      requiresUserConfirmation: false,
    });
    expect(result.blocked).toBeUndefined();
    const state = await manager.list();
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toBeUndefined();
    expect(await manager.getEnabledExtensionRoots()).toHaveLength(1);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('manual required+confirmation update-check persists the block; a fresh manager with unreachable remote stays blocked and withholds roots', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const required = createRemoteManifest({ keys, version: '2.0.0', extraAction: true, update: { required: true, changeSummary: 'mandatory' } });
    const holder = { document: v1.document };
    const requested = [];
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-checkpersist-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-checkpersist-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    holder.document = required.document;
    const lifecycle = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    // The freshly verified required candidate PERSISTED the safe blocked
    // metadata before the API reported success, and the returned lifecycle is
    // consistent with the durable state.
    expect(lifecycle).toMatchObject({
      status: 'required',
      remoteVersion: '2.0.0',
      requiresUserConfirmation: true,
      blocked: {
        code: 'remote_update_required_blocked',
        required: true,
        version: '2.0.0',
        reason: 'confirmation-required',
      },
    });
    expect((await manager.list()).extensions[0].versions['1.0.0'].remote.blocked).toMatchObject({
      required: true,
      version: '2.0.0',
      reason: 'confirmation-required',
    });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
    // A FRESH manager/process with the entry UNREACHABLE: lifecycle/prepare
    // remain required-blocked and the enabled root is withheld.
    const fresh = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    await expect(fresh.getRemoteLifecycle('com.acme.remote')).resolves.toMatchObject({
      status: 'required',
      blocked: { code: 'remote_update_required_blocked' },
      health: { status: 'unreachable' },
    });
    await expect(fresh.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    expect(await fresh.getEnabledExtensionRoots()).toEqual([]);
    expect(await fresh.getEnabledRemoteExtensionIds()).toEqual(['com.acme.remote']);
  });

  it('required no-confirmation update-check persists, then prepareRemoteUse auto-applies the currently verified candidate and recovers root/use', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const required = createRemoteManifest({ keys, version: '2.0.0', update: { required: true } });
    const holder = { document: v1.document };
    const requested = [];
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-reqnoapply-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-reqnoapply-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    holder.document = required.document;
    const lifecycle = await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    expect(lifecycle).toMatchObject({
      status: 'required',
      requiresUserConfirmation: false,
      blocked: { code: 'remote_update_required_blocked', reason: 'required-observed' },
    });
    expect((await manager.list()).extensions[0].versions['1.0.0'].remote.blocked)
      .toMatchObject({ required: true, version: '2.0.0', reason: 'required-observed' });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    // prepareRemoteUse with the persisted block + a CURRENT required
    // no-confirmation RAW probe proceeds through the metadata-only automatic
    // apply (no retry deadlock): it switches exactly once and recovers
    // root/use, and the obsolete block does not govern the new contract.
    const prepared = await manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true });
    expect(prepared.applied).toBe(true);
    let state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('2.0.0');
    expect(state.extensions[0].versions['2.0.0'].remote.blocked).toBeUndefined();
    expect(await manager.getEnabledExtensionRoots()).toHaveLength(1);
    // Exactly one switch: the next trigger is a no-op on the new contract.
    const again = await manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true });
    expect(again.applied).toBeUndefined();
    state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('2.0.0');
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('contract switch during check persistence never writes or returns a stale block/lifecycle (bounded stabilization)', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const required = createRemoteManifest({ keys, version: '2.0.0', update: { required: true } });
    const holder = { document: v1.document };
    const requested = [];
    let stateReads = 0;
    let releasePersist;
    const persistGate = new Promise((resolve) => { releasePersist = resolve; });
    let gatePersistRead = false;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-persistrace-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-persistrace-opencode-');
    // Gate the CHECK manager's third installations.json read (the persist's
    // state read) after the check starts; the concurrent apply uses manager2
    // with its own ungated fsImpl/fetch.
    const fsImpl = new Proxy(fs, {
      get(target, prop) {
        if (prop === 'readFile') {
          return async (...args) => {
            if (String(args[0]).endsWith('installations.json')) {
              stateReads += 1;
              if (gatePersistRead && stateReads === 3) await persistGate;
            }
            return target.readFile(...args);
          };
        }
        return target[prop];
      },
    });
    const rawFetch = (url) => {
      requested.push(String(url));
      if (String(url) === appEntryUrl) {
        return Promise.resolve(new Response(JSON.stringify(holder.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }));
      }
      return Promise.resolve(new Response('not found', { status: 404 }));
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fsImpl,
      fetchImpl: rawFetch,
    });
    const manager2 = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: rawFetch,
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    stateReads = 0;
    gatePersistRead = true;
    holder.document = required.document;
    const checking = manager.checkRemoteUpdate('com.acme.remote', { force: true });
    for (let i = 0; i < 200 && stateReads < 3; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(stateReads).toBe(3);
    // While the persist's state read is parked, switch the installed active
    // contract via manager2 (an existing manager operation).
    await manager2.applyRemoteUpdate('com.acme.remote', {});
    expect((await manager2.list()).extensions[0].activeVersion).toBe('2.0.0');
    releasePersist();
    const result = await checking;
    // The stale required observation was DISCARDED (nothing written, nothing
    // returned): the caller re-resolved boundedly against the NEW current
    // contract, which now has no pending required update.
    expect(result).toMatchObject({ status: 'none', currentVersion: '2.0.0' });
    expect(result.blocked).toBeUndefined();
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('2.0.0');
    expect(state.extensions[0].versions['2.0.0'].remote.blocked).toBeUndefined();
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('classifies deterministic signed-content/trust failures as trust_invalid while transport outages stay unreachable', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const holder = { document: v1.document };
    const requested = [];
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-trustcls-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-trustcls-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const v1Hash = inspection.manifest.manifestHash;

    // Transport outage: unreachable, old contract usable.
    holder.document = null;
    manager.fetchImpl = undefined; // no-op: the fetch below is overridden per call below
    // (the manager's fetchImpl is fixed; simulate by replacing the holder with a 503 via a second manager)
    // Use a dedicated unreachable manager.
    const unavailable = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    await expect(unavailable.getRemoteLifecycle('com.acme.remote')).resolves.toMatchObject({
      health: { status: 'unreachable', code: 'hosted_manifest_unavailable' },
    });

    // INVALID SIGNATURE: deterministic trust failure → trust_invalid.
    const tampered = JSON.parse(JSON.stringify(createRemoteManifest({ keys, version: '2.0.0' }).document));
    tampered.signature = { algorithm: 'ed25519', keyId: 'release-2026', value: Buffer.alloc(64, 1).toString('base64') };
    holder.document = tampered;
    await expect(manager.checkRemoteUpdate('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'invalid_hosted_signature' });
    await expect(manager.getRemoteLifecycle('com.acme.remote')).resolves.toMatchObject({
      health: { status: 'trust_invalid', code: 'invalid_hosted_signature' },
      blocked: { code: 'invalid_hosted_signature' },
    });
    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_trust_invalid' });

    // MALFORMED signed update metadata: deterministic trust failure.
    const malformed = createRemoteManifest({ keys, version: '2.0.0' }).document;
    malformed.update = { changeSummary: 42 };
    const malformedSigned = JSON.parse(JSON.stringify(malformed));
    const { signature: _oldSig, ...malformedUnsigned } = malformedSigned;
    holder.document = {
      ...malformedUnsigned,
      signature: {
        algorithm: 'ed25519',
        keyId: 'release-2026',
        value: crypto.sign(
          null,
          Buffer.from(JSON.stringify(canonicalize(malformedUnsigned))),
          crypto.createPrivateKey(keys.privateKey),
        ).toString('base64'),
      },
    };
    await expect(manager.checkRemoteUpdate('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'invalid_hosted_manifest' });
    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_trust_invalid' });

    // SIGNED runtime-invalid candidate (undeclared view entry): trust failure.
    holder.document = createRemoteManifest({
      keys,
      version: '2.0.0',
      viewEntry: 'ui/missing.view.json',
      resourcePath: 'ui/overview.view.json',
    }).document;
    await expect(manager.checkRemoteUpdate('com.acme.remote', { force: true }))
      .rejects.toMatchObject({ code: 'invalid_hosted_resource' });
    await expect(manager.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_trust_invalid' });
    expect((await manager.list()).extensions[0].activeVersion).toBe('1.0.0');
    expect((await manager.list()).extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1Hash);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('key-rotation apply is atomic: durable trust-transaction recovery preserves exact prior state, trust, and shell under injected commit/restoration failures', async () => {
    const keys = generatePublisherKeyPair();
    const rotatedKeys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const v2 = createRemoteManifest({ keys: rotatedKeys, version: '2.0.0', publisherKeyId: 'release-2027' });
    const holder = { document: v1.document };
    const requested = [];
    let failTrustCommit = false;
    let failStateCommit = false;
    // A: exactly ONE trust restoration write fails, then recovers on the next
    // trust read.
    let failFirstTrustRestore = false;
    // B: EVERY trust restoration write fails until released (exhausted
    // recovery leaves the durable journal fail-closed).
    let failTrustRestore = false;
    // C: journal deletion fails on the successful rotation, leaving a
    // recoverable leftover journal.
    let failJournalDelete = false;
    // D: post-commit trust finalization read failure — fires ONLY after an
    // installations.json commit succeeded, so the apply's best-effort
    // finalization retains the journal instead of failing a committed apply.
    let failFinalizeTrustRead = false;
    let stateCommittedFlag = false;
    // Concurrency gate: pauses the FIRST installations.json rename (after the
    // candidate trust/journal are written, before the state commit) so the
    // test can run trust-consuming reads while the apply is in flight.
    let pauseStateCommit = false;
    let stateCommitPaused = false;
    let stateCommitGate;
    let releaseStateCommitGate;
    let onStateCommitPaused;
    // Distinguishes candidate-commit trust writes from restoration writes:
    // restoration only ever runs AFTER an installations.json commit failure.
    let sawStateCommitFailure = false;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-rotateatomic-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-rotateatomic-opencode-');
    const journalPath = path.join(dataDirectory, 'interactive-ui', 'trust-transaction.json');
    const v2ShellPath = path.join(dataDirectory, 'extensions', 'com.acme.remote', '2.0.0');
    const fsImpl = new Proxy(fs, {
      get(target, prop) {
        if (prop === 'rename') {
          return async (from, to) => {
            if (failTrustCommit && String(to).endsWith('trust.json')) {
              const error = new Error('simulated trust commit failure');
              error.code = 'EIO';
              throw error;
            }
            if (String(to).endsWith('installations.json')) {
              if (pauseStateCommit && !stateCommitPaused) {
                stateCommitPaused = true;
                onStateCommitPaused?.();
                await stateCommitGate;
              }
              if (failStateCommit) {
                sawStateCommitFailure = true;
                const error = new Error('simulated state commit failure');
                error.code = 'EIO';
                throw error;
              }
              const result = await target.rename(from, to);
              stateCommittedFlag = true;
              return result;
            }
            if (sawStateCommitFailure && String(to).endsWith('trust.json') && (failTrustRestore || failFirstTrustRestore)) {
              if (failFirstTrustRestore) failFirstTrustRestore = false;
              const error = new Error('simulated trust restoration failure');
              error.code = 'EIO';
              throw error;
            }
            return target.rename(from, to);
          };
        }
        if (prop === 'rm') {
          return async (path, options) => {
            if (failJournalDelete && String(path).endsWith('trust-transaction.json')) {
              const error = new Error('simulated trust journal delete failure');
              error.code = 'EIO';
              throw error;
            }
            return target.rm(path, options);
          };
        }
        if (prop === 'readFile') {
          return async (path, ...args) => {
            if (failFinalizeTrustRead && stateCommittedFlag && String(path).endsWith('trust.json')) {
              const error = new Error('simulated trust finalization read failure');
              error.code = 'EIO';
              throw error;
            }
            return target.readFile(path, ...args);
          };
        }
        return target[prop];
      },
    });
    const makeFetch = () => async (url) => {
      requested.push(String(url));
      if (String(url) === appEntryUrl) {
        return new Response(JSON.stringify(holder.document), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response('not found', { status: 404 });
    };
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fsImpl,
      fetchImpl: makeFetch(),
    });
    const freshManager = () => createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fsImpl,
      fetchImpl: makeFetch(),
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const readTrustKeys = async () => {
      const trust = JSON.parse(await fs.readFile(path.join(dataDirectory, 'interactive-ui', 'trust.json'), 'utf8'));
      return Object.keys(trust.publishers['com.acme.publisher'].keys).sort();
    };
    const stateSummary = async () => {
      const state = await manager.list();
      const acceptedManifest = state.extensions[0].versions['1.0.0'].remote.acceptedManifest;
      return {
        activeVersion: state.extensions[0].activeVersion,
        acceptedManifestHash: acceptedManifest.manifestHash,
        acceptedManifestVersion: acceptedManifest.version,
        acceptedManifestKeyId: acceptedManifest.keyId,
        blocked: state.extensions[0].versions['1.0.0'].remote.blocked ?? null,
      };
    };
    const expectedV1Summary = () => ({
      activeVersion: '1.0.0',
      acceptedManifestHash: inspection.manifest.manifestHash,
      acceptedManifestVersion: '1.0.0',
      acceptedManifestKeyId: 'release-2026',
      blocked: null,
    });

    holder.document = v2.document;
    const confirmed = {
      confirmedManifestHash: (await manager.inspectRemote(appEntryUrl)).manifest.manifestHash,
      confirmedPublisherFingerprint: (await manager.inspectRemote(appEntryUrl)).publisher.fingerprint,
    };
    const expectV1Recovered = async () => {
      expect(await readTrustKeys()).toEqual(['release-2026']);
      expect(await stateSummary()).toEqual(expectedV1Summary());
      await expect(fs.stat(v2ShellPath)).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await manager.getEnabledExtensionRoots()).toHaveLength(1);
      await expect(fs.stat(journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    };

    // 1. TRUST-COMMIT FAILURE: the candidate key write itself fails. The
    // durable journal is written first, so the next trust read completes
    // recovery and restores the exact v1 trust/state; the v2 shell is absent;
    // the old root stays usable.
    failTrustCommit = true;
    await expect(manager.applyRemoteUpdate('com.acme.remote', confirmed)).rejects.toThrow();
    failTrustCommit = false;
    await manager.list(); // first trust read resolves the durable journal
    await expectV1Recovered();

    // 2. STATE/RUNTIME-COMMIT FAILURE: recovery completes inside the failed
    // apply — original trust restored + journal removed, staged v2 shell
    // removed, exact prior state/root.
    sawStateCommitFailure = false;
    failStateCommit = true;
    await expect(manager.applyRemoteUpdate('com.acme.remote', confirmed)).rejects.toThrow();
    failStateCommit = false;
    await expectV1Recovered();

    // 3. SINGLE TRANSIENT RESTORATION FAILURE (A): the state commit fails AND
    // the first trust restoration write fails once. The apply fails closed
    // with the durable journal pending and the v2 shell already removed; the
    // next trust read completes recovery and restores the exact v1
    // trust/state.
    sawStateCommitFailure = false;
    failFirstTrustRestore = true;
    failStateCommit = true;
    await expect(manager.applyRemoteUpdate('com.acme.remote', confirmed))
      .rejects.toMatchObject({ code: 'remote_update_trust_rollback_failed' });
    failStateCommit = false;
    failFirstTrustRestore = false;
    await expect(fs.stat(v2ShellPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await manager.list(); // recovery: restore original trust + delete journal
    await expectV1Recovered();

    // 4. EXHAUSTED RECOVERY (B): the state commit fails AND every immediate
    // trust restoration write fails. The apply fails closed and removes the
    // v2 shell, leaving the durable journal; while recovery I/O stays broken,
    // trust-consuming APIs fail closed and can never use the candidate key.
    sawStateCommitFailure = false;
    failTrustRestore = true;
    failStateCommit = true;
    await expect(manager.applyRemoteUpdate('com.acme.remote', confirmed))
      .rejects.toMatchObject({ code: 'remote_update_trust_rollback_failed' });
    failStateCommit = false;
    await expect(fs.stat(v2ShellPath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(manager.list()).rejects.toThrow();
    await expect(manager.getEnabledExtensionRoots()).rejects.toThrow();
    const pending = JSON.parse(await fs.readFile(journalPath, 'utf8'));
    expect(pending.extensionId).toBe('com.acme.remote');
    expect(pending.candidate).toMatchObject({ version: '2.0.0', publisherKeyId: 'release-2027' });
    expect(pending.originalTrust.publishers['com.acme.publisher'].keys['release-2026']).toBeDefined();
    expect(pending.candidateTrust.publishers['com.acme.publisher'].keys['release-2027']).toBeDefined();
    // Release the I/O failure: a FRESH manager resolves the journal against
    // committed state (v2 NOT committed => exact original trust restored),
    // removing the candidate key and the journal.
    failTrustRestore = false;
    const fresh = freshManager();
    expect((await fresh.list()).extensions[0].activeVersion).toBe('1.0.0');
    expect(await readTrustKeys()).toEqual(['release-2026']);
    expect(await fresh.getEnabledExtensionRoots()).toHaveLength(1);
    await expect(fs.stat(journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(requested.some((url) => url.includes('overview'))).toBe(false);

    // 5. IN-FLIGHT AUTHORITY ISOLATION: pause the apply deterministically
    // AFTER the candidate trust/journal are written but BEFORE the
    // installations.json commit (fs gate, no sleep). Concurrent
    // trust-consuming reads must fail closed with the stable
    // transaction-in-progress error — they can never report the candidate
    // key trusted, resolve/delete the journal, or cache a classification.
    // Releasing the pause proves the apply/recovery outcome stays correct.
    sawStateCommitFailure = false;
    failStateCommit = true;
    stateCommitPaused = false;
    stateCommitGate = new Promise((resolve) => { releaseStateCommitGate = resolve; });
    const stateCommitPausedSignal = new Promise((resolve) => { onStateCommitPaused = resolve; });
    pauseStateCommit = true;
    const inFlightApply = manager.applyRemoteUpdate('com.acme.remote', confirmed);
    await stateCommitPausedSignal; // deterministic: the apply is paused pre-commit
    await expect(manager.list())
      .rejects.toMatchObject({ code: 'remote_trust_transaction_in_progress' });
    await expect(manager.inspectRemote(appEntryUrl))
      .rejects.toMatchObject({ code: 'remote_trust_transaction_in_progress' });
    await expect(fs.stat(journalPath)).resolves.toBeDefined(); // journal pending, not touched mid-apply
    releaseStateCommitGate();
    await expect(inFlightApply).rejects.toThrow(); // state commit fails => durable recovery
    pauseStateCommit = false;
    failStateCommit = false;
    await expectV1Recovered();

    // 6. SUCCESSFUL ROTATION = COMMIT POINT (revision-3 regression): v2
    // applies and BOTH keys are retained. A trust.json read/finalization
    // failure injected to fire ONLY AFTER the installations.json state commit
    // must NOT fail the committed apply: post-commit finalization is
    // best-effort, the durable journal is retained, and a FRESH manager later
    // finalizes it from exact committed v2 state — keeping both keys/v2/root
    // usable (never an erroneous rollback) — and removes the journal.
    sawStateCommitFailure = false;
    stateCommittedFlag = false; // scope the injection to THIS apply's commit
    failFinalizeTrustRead = true;
    failJournalDelete = true; // belt-and-suspenders delete-failure retention
    const committed = await manager.applyRemoteUpdate('com.acme.remote', confirmed);
    expect(committed).toMatchObject({ applied: true });
    expect(committed.extension.activeVersion).toBe('2.0.0');
    expect(await readTrustKeys()).toEqual(['release-2026', 'release-2027']);
    // The journal is retained (finalization could not verify/complete).
    const leftover = JSON.parse(await fs.readFile(journalPath, 'utf8'));
    expect(leftover.candidate).toMatchObject({ version: '2.0.0', publisherKeyId: 'release-2027' });
    // While the finalization fault persists, the retained journal blocks
    // trust use (resolution cannot verify), so no read can report v2 until
    // recovery completes.
    await expect(manager.list()).rejects.toThrow();
    // Release the fault: a FRESH manager finalizes the journal from exact
    // committed v2 state and deletes it.
    failFinalizeTrustRead = false;
    failJournalDelete = false;
    const freshAfterCommit = freshManager();
    expect((await freshAfterCommit.list()).extensions[0].activeVersion).toBe('2.0.0');
    expect(await readTrustKeys()).toEqual(['release-2026', 'release-2027']);
    await expect(fs.stat(journalPath)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await freshAfterCommit.getEnabledExtensionRoots()).toHaveLength(1);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('direct apply of a required candidate with missing confirmation subject-safely persists the block before the controlled error', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const required = createRemoteManifest({ keys, version: '2.0.0', extraAction: true, update: { required: true } });
    const holder = { document: v1.document };
    const requested = [];
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-directreq-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-directreq-opencode-');
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    holder.document = required.document;
    // No confirmation: controlled confirmation error AND the safe required
    // block is persisted subject-safely BEFORE it.
    await expect(manager.applyRemoteUpdate('com.acme.remote', {}))
      .rejects.toMatchObject({ code: 'remote_confirmation_required', status: 403 });
    expect((await manager.list()).extensions[0].versions['1.0.0'].remote.blocked).toMatchObject({
      required: true,
      version: '2.0.0',
      reason: 'confirmation-required',
    });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    // A FRESH manager with the entry unreachable stays fail-closed.
    const fresh = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    await expect(fresh.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    expect(await fresh.getEnabledExtensionRoots()).toEqual([]);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('direct apply of a CONFIRMED required+expansion candidate persists the required block before a commit failure and stays fail-closed', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const required = createRemoteManifest({ keys, version: '2.0.0', extraAction: true, update: { required: true } });
    const holder = { document: v1.document };
    const requested = [];
    let armStagingFailure = true;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-reqconfirmed-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-reqconfirmed-opencode-');
    const fsImpl = new Proxy(fs, {
      get(target, prop) {
        if (prop === 'rename') {
          return async (from, to) => {
            if (armStagingFailure && String(to).includes('extensions/com.acme.remote/2.0.0')) {
              const error = new Error('simulated atomic staging failure');
              error.code = 'EIO';
              throw error;
            }
            return target.rename(from, to);
          };
        }
        return target[prop];
      },
    });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fsImpl,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const v1Hash = inspection.manifest.manifestHash;
    holder.document = required.document;
    const confirmed = {
      confirmedManifestHash: (await manager.inspectRemote(appEntryUrl)).manifest.manifestHash,
      confirmedPublisherFingerprint: (await manager.inspectRemote(appEntryUrl)).publisher.fingerprint,
    };
    // The verified required observation is persisted BEFORE the failing
    // staging attempt; the apply rejects with the ORIGINAL failure (never a
    // silent success) and the old contract stays durably blocked.
    armStagingFailure = true;
    await expect(manager.applyRemoteUpdate('com.acme.remote', confirmed)).rejects.toThrow();
    armStagingFailure = false;
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1Hash);
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toMatchObject({
      required: true,
      version: '2.0.0',
      reason: 'apply-failed',
    });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    // A FRESH manager with the entry unreachable stays fail-closed.
    const fresh = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    await expect(fresh.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    expect(await fresh.getEnabledExtensionRoots()).toEqual([]);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });

  it('direct apply of a required no-confirmation candidate (optional→required refetch) persists the block before a commit failure and stays fail-closed', async () => {
    const keys = generatePublisherKeyPair();
    const v1 = createRemoteManifest({ keys });
    const optionalExpansion = createRemoteManifest({ keys, version: '2.0.0', extraAction: true });
    const requiredNone = createRemoteManifest({ keys, version: '2.0.0', update: { required: true } });
    const holder = { document: v1.document };
    const requested = [];
    let armStagingFailure = true;
    const dataDirectory = await createTemporaryDirectory('ocix-manager-r3-reqnoapplyfail-data-');
    const opencodeConfig = await createTemporaryDirectory('ocix-manager-r3-reqnoapplyfail-opencode-');
    const fsImpl = new Proxy(fs, {
      get(target, prop) {
        if (prop === 'rename') {
          return async (from, to) => {
            if (armStagingFailure && String(to).includes('extensions/com.acme.remote/2.0.0')) {
              const error = new Error('simulated atomic staging failure');
              error.code = 'EIO';
              throw error;
            }
            return target.rename(from, to);
          };
        }
        return target[prop];
      },
    });
    const manager = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fsImpl,
      fetchImpl: async (url) => {
        requested.push(String(url));
        if (String(url) === appEntryUrl) {
          return new Response(JSON.stringify(holder.document), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          });
        }
        return new Response('not found', { status: 404 });
      },
    });
    const inspection = await manager.inspectRemote(appEntryUrl);
    await manager.connectRemote({
      appEntryUrl,
      confirmedPublisherFingerprint: inspection.publisher.fingerprint,
      confirmedManifestHash: inspection.manifest.manifestHash,
    });
    const v1Hash = inspection.manifest.manifestHash;
    // The reviewer scenario: an initially OPTIONAL consent-awaiting candidate
    // changes before Apply to a REQUIRED no-confirmation candidate. The apply
    // REFETCHES, sees the verified required candidate, and must persist the
    // required block BEFORE the failing state commit.
    holder.document = optionalExpansion.document;
    await manager.checkRemoteUpdate('com.acme.remote', { force: true });
    holder.document = requiredNone.document;
    armStagingFailure = true;
    await expect(manager.applyRemoteUpdate('com.acme.remote', {})).rejects.toThrow();
    armStagingFailure = false;
    const state = await manager.list();
    expect(state.extensions[0].activeVersion).toBe('1.0.0');
    expect(state.extensions[0].versions['1.0.0'].remote.acceptedManifest.manifestHash).toBe(v1Hash);
    expect(state.extensions[0].versions['1.0.0'].remote.blocked).toMatchObject({
      required: true,
      version: '2.0.0',
      reason: 'apply-failed',
    });
    expect(await manager.getEnabledExtensionRoots()).toEqual([]);
    const fresh = createInteractiveUIExtensionManager({
      dataDirectory,
      opencodeConfigDirectory: opencodeConfig,
      fetchImpl: async () => new Response('unavailable', { status: 503 }),
    });
    await expect(fresh.prepareRemoteUse('com.acme.remote', { trigger: 'surface', force: true }))
      .rejects.toMatchObject({ code: 'remote_update_required_blocked' });
    expect(await fresh.getEnabledExtensionRoots()).toEqual([]);
    expect(requested.some((url) => url.includes('overview'))).toBe(false);
  });
});
