import { registerFsRoutes } from '../fs/routes.js';
import { registerQuotaRoutes } from '../quota/routes.js';
import { registerSmallModelRoutes } from '../small-model/routes.js';
import { registerSessionGoalRoutes } from '../session-goal/routes.js';
import { registerGitHubRoutes } from '../github/routes.js';
import { registerGitRoutes } from '../git/routes.js';
import { registerMagicPromptRoutes } from '../magic-prompts/routes.js';
import { registerSessionFoldersRoutes } from '../session-folders/routes.js';
import { registerPermissionAutoAcceptRoutes } from '../permission-auto-accept/runtime.js';
import { registerConfigEntityRoutes } from './config-entity-routes.js';
import { registerSettingsUtilityRoutes } from './core-routes.js';
import { registerProjectIconRoutes } from './project-icon-routes.js';
import { registerScheduledTaskRoutes } from '../scheduled-tasks/routes.js';
import { registerOpenChamberSessionRoutes } from '../openchamber-sessions/routes.js';
import { registerOpenChamberControlRoutes } from '../openchamber-control/routes.js';
import { registerSkillRoutes } from './skill-routes.js';
import { registerPluginRoutes } from './plugin-routes.js';
import { getNpmInfo, clearCache as clearNpmCache } from './npm-registry.js';
import { parseNpmSpec, parsePathSpec, isExactSemver } from './plugin-spec.js';
import { registerOpenCodeRoutes } from './routes.js';
import { getProviderSources, removeProviderConfig } from './providers.js';
import { getAgentSources, getAgentConfig, createAgent, updateAgent, deleteAgent } from './agents.js';
import { getCommandSources, createCommand, updateCommand, deleteCommand } from './commands.js';
import { listMcpConfigs, getMcpConfig, createMcpConfig, updateMcpConfig, deleteMcpConfig } from './mcp.js';
import { listSnippets, getSnippet, createSnippet, updateSnippet, deleteSnippet, expandSnippets } from './snippets.js';
import {
  listPluginEntries,
  getPluginEntry,
  createPluginEntry,
  updatePluginEntry,
  deletePluginEntry,
  listPluginDirFiles,
  readPluginDirFile,
  writePluginDirFile,
  deletePluginDirFile,
  encodePluginId,
  decodePluginId,
} from './plugins.js';
import { SKILL_DIR, SKILL_SCOPE, readSkillSupportingFile, writeSkillSupportingFile, deleteSkillSupportingFile } from './shared.js';
import { getSkillSources, discoverSkills, mergeDiscoveredSkills, createSkill, updateSkill, deleteSkill } from './skills.js';
import { getCuratedSkillsSources } from '../skills-catalog/curated-sources.js';
import { getCacheKey, getCachedScan, setCachedScan } from '../skills-catalog/cache.js';
import { isClawdHubSource, parseSkillRepoSource } from '../skills-catalog/source.js';
import { scanSkillsRepository } from '../skills-catalog/scan.js';
import { installSkillsFromRepository } from '../skills-catalog/install.js';
import { scanClawdHubPage } from '../skills-catalog/clawdhub/scan.js';
import { installSkillsFromClawdHub } from '../skills-catalog/clawdhub/install.js';
import { createInteractiveUIRuntime } from '../interactive-ui/runtime.js';
import { registerInteractiveUIRoutes } from '../interactive-ui/routes.js';
import { createInteractiveUIExtensionManager } from '../interactive-ui/manager.js';
import { createInteractiveUIConnectionStore } from '../interactive-ui/connection-store.js';
import { createHTMLArtifactStore } from '../interactive-ui/artifact-store.js';
import { createBuiltInInteractiveUIRuntime } from '../interactive-ui/builtin-runtime.js';
import { createInteractiveUIWorkbenchStore } from '../interactive-ui/workbench-store.js';

// Production wiring seam for the Interactive UI runtime (module-private: the
// public surface is createFeatureRoutesRuntime(...).registerRoutes): binds the
// manager-owned Remote Phase R2 resource resolver so the shared runtime can
// lazily resolve ONE declared signed Remote resource on the first actual load,
// forwarding the captured authority context (resolved root, canonical
// extension-document hash, signed-manifest hash, opaque provenance generation)
// exactly as the runtime captured it at manifest read time. Null results are
// allowed ONLY for ordinary configured/built-in roots and authorized current
// Local installs (their exact disk path); Hosted and Remote manager-owned
// bytes are ALWAYS returned as verified Buffers from inside the manager
// mutation queue. Runtimes without a manager resolver stay non-Remote.
const createInteractiveUIRuntimeForRoutes = ({
  fsPromises,
  path,
  crypto,
  fetchImpl,
  environment,
  connectionStore,
  logger,
  manager,
  builtInRootDirectory,
  configuredRoots,
}) => createInteractiveUIRuntime({
  fsPromises,
  path,
  crypto,
  fetchImpl,
  extensionRoots: async () => [
    builtInRootDirectory,
    ...await manager.getEnabledExtensionRoots(),
    ...configuredRoots,
  ],
  environment,
  connectionStore,
  logger,
  resolveExtensionResource: (extensionId, relativePath, authority) => (
    manager.resolveExtensionResource(extensionId, relativePath, authority)
  ),
  // The runtime authorizes EVERY discovered manifest against the manager
  // BEFORE any metadata/operation exposure (same central classifier as the
  // resolver), so a configured root can never resurrect a disabled or
  // quarantined manager extension id.
  authorizeExtensionAuthority: (extensionId, authority) => (
    manager.authorizeExtensionAuthority(extensionId, authority)
  ),
});

export const createFeatureRoutesRuntime = (dependencies) => {
  const {
    clientReloadDelayMs,
  } = dependencies;

  let quotaProviders = null;
  const getQuotaProviders = async () => {
    if (!quotaProviders) {
      quotaProviders = await import('../quota/index.js');
    }
    return quotaProviders;
  };

  let smallModelService = null;
  const getSmallModelService = async () => {
    if (!smallModelService) {
      smallModelService = await import('../small-model/index.js');
    }
    return smallModelService;
  };

  const registerRoutes = async (app, routeDependencies) => {
    const {
      crypto,
      fs,
      os,
      path,
      fsPromises,
      spawn,
      resolveGitBinaryForSpawn,
      createFsSearchRuntime,
      openchamberDataDir,
      openchamberUserConfigRoot,
      normalizeDirectoryPath,
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      validateDirectoryPath,
      readCustomThemesFromDisk,
      refreshOpenCodeAfterConfigChange,
      getOpenCodeResolutionSnapshot,
      formatSettingsResponse,
      readSettingsFromDisk,
      readSettingsFromDiskMigrated,
      persistSettings,
      sanitizeProjects,
      sanitizeSkillCatalogs,
      isUnsafeSkillRelativePath,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
      getOpenCodePort,
      buildAugmentedPath,
      projectConfigRuntime,
      scheduledTasksRuntime,
      scheduledTaskService,
      openChamberSessionService,
      openChamberControlService,
      waitForOpenCodeReady,
      getOpenChamberEventClients,
      writeSseEvent,
      emitSessionCreatedEvent,
      permissionAutoAcceptRuntime,
      express,
      processLike,
      uiAuthController,
      openchamberVersion,
    } = routeDependencies;

    const configuredInteractiveUIRoots = typeof processLike.env.OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR === 'string'
      ? processLike.env.OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR
          .split(path.delimiter)
          .map((entry) => entry.trim())
          .filter(Boolean)
      : [];
    const testOpenCodeConfigDirectory = typeof processLike.env.OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR === 'string'
      && processLike.env.OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR.trim()
      ? path.resolve(processLike.env.OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR.trim())
      : null;
    if (testOpenCodeConfigDirectory) {
      processLike.env.OPENCODE_CONFIG_DIR = testOpenCodeConfigDirectory;
    }
    const builtInInteractiveUIRuntime = createBuiltInInteractiveUIRuntime({ pathImpl: path });
    const interactiveUIExtensionManager = createInteractiveUIExtensionManager({
      dataDirectory: openchamberDataDir,
      opencodeConfigDirectory: testOpenCodeConfigDirectory
        ?? (typeof processLike.env.OPENCODE_CONFIG_DIR === 'string' && processLike.env.OPENCODE_CONFIG_DIR.trim()
          ? path.resolve(processLike.env.OPENCODE_CONFIG_DIR.trim())
          : path.join(os.homedir(), '.config', 'opencode')),
      fsImpl: fsPromises,
      pathImpl: path,
      cryptoImpl: crypto,
      environment: processLike.env,
      logger: console,
      refreshOpenCode: () => refreshOpenCodeAfterConfigChange('Interactive UI extension Agent Runtime changed'),
      builtInRuntime: builtInInteractiveUIRuntime,
      runtimeVersion: openchamberVersion,
    });
    try {
      await interactiveUIExtensionManager.initialize();
    } catch (error) {
      if (error?.status !== 409) throw error;
      console.error(`[InteractiveUI] Built-in Agent Runtime was not installed (${error.code || 'agent_runtime_conflict'}); existing OpenCode files were preserved`);
    }
    const interactiveUIConnectionStore = createInteractiveUIConnectionStore({
      dataDirectory: openchamberDataDir,
      fsImpl: fsPromises,
      pathImpl: path,
      cryptoImpl: crypto,
    });
    const htmlArtifactStore = createHTMLArtifactStore({
      dataDirectory: openchamberDataDir,
      fsImpl: fsPromises,
      pathImpl: path,
      cryptoImpl: crypto,
      environment: processLike.env,
    });
    const interactiveUIWorkbenchStore = createInteractiveUIWorkbenchStore({
      dataDirectory: openchamberDataDir,
      fsImpl: fsPromises,
      pathImpl: path,
      cryptoImpl: crypto,
    });
    registerInteractiveUIRoutes(app, {
      express,
      manager: interactiveUIExtensionManager,
      artifactStore: htmlArtifactStore,
      workbenchStore: interactiveUIWorkbenchStore,
      uiAuthController,
      runtime: createInteractiveUIRuntimeForRoutes({
        fsPromises,
        path,
        crypto,
        environment: processLike.env,
        connectionStore: interactiveUIConnectionStore,
        logger: console,
        manager: interactiveUIExtensionManager,
        builtInRootDirectory: builtInInteractiveUIRuntime.rootDirectory,
        configuredRoots: configuredInteractiveUIRoots,
      }),
    });

    registerSettingsUtilityRoutes(app, {
      readCustomThemesFromDisk,
      refreshOpenCodeAfterConfigChange,
      clientReloadDelayMs,
    });

    registerPermissionAutoAcceptRoutes(app, permissionAutoAcceptRuntime);

    registerOpenCodeRoutes(app, {
      crypto,
      clientReloadDelayMs,
      getOpenCodeResolutionSnapshot,
      formatSettingsResponse,
      readSettingsFromDisk,
      readSettingsFromDiskMigrated,
      persistSettings,
      sanitizeProjects,
      validateDirectoryPath,
      resolveProjectDirectory,
      getProviderSources,
      removeProviderConfig,
      refreshOpenCodeAfterConfigChange,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
    });

    registerProjectIconRoutes(app, {
      fsPromises,
      path,
      crypto,
      openchamberDataDir,
      sanitizeProjects,
      readSettingsFromDiskMigrated,
      persistSettings,
      createFsSearchRuntime,
      spawn,
      resolveGitBinaryForSpawn,
    });

    registerScheduledTaskRoutes(app, {
      readSettingsFromDiskMigrated,
      sanitizeProjects,
      projectConfigRuntime,
      scheduledTasksRuntime,
      scheduledTaskService,
      getOpenChamberEventClients,
      writeSseEvent,
    });

    registerOpenChamberSessionRoutes(app, {
      readSettingsFromDiskMigrated,
      sanitizeProjects,
      validateDirectoryPath,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
      waitForOpenCodeReady,
      emitSessionCreatedEvent,
      sessionService: openChamberSessionService,
    });

    registerOpenChamberControlRoutes(app, { controlService: openChamberControlService });

    registerConfigEntityRoutes(app, {
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      refreshOpenCodeAfterConfigChange,
      clientReloadDelayMs,
      getAgentSources,
      getAgentConfig,
      createAgent,
      updateAgent,
      deleteAgent,
      getCommandSources,
      createCommand,
      updateCommand,
      deleteCommand,
      listMcpConfigs,
      getMcpConfig,
      createMcpConfig,
      updateMcpConfig,
      deleteMcpConfig,
      listSnippets,
      getSnippet,
      createSnippet,
      updateSnippet,
      deleteSnippet,
      expandSnippets,
    });

    registerPluginRoutes(app, {
      resolveOptionalProjectDirectory,
      refreshOpenCodeAfterConfigChange,
      clientReloadDelayMs,
      listPluginEntries,
      getPluginEntry,
      createPluginEntry,
      updatePluginEntry,
      deletePluginEntry,
      listPluginDirFiles,
      readPluginDirFile,
      writePluginDirFile,
      deletePluginDirFile,
      encodePluginId,
      decodePluginId,
      getNpmInfo,
      parseNpmSpec,
      parsePathSpec,
      isExactSemver,
    });

    const { getProfiles, getProfile } = await import('../git/index.js');

    registerSkillRoutes(app, {
      fs,
      path,
      os,
      resolveProjectDirectory,
      resolveOptionalProjectDirectory,
      readSettingsFromDisk,
      sanitizeSkillCatalogs,
      isUnsafeSkillRelativePath,
      refreshOpenCodeAfterConfigChange,
      clientReloadDelayMs,
      buildOpenCodeUrl,
      getOpenCodeAuthHeaders,
      getOpenCodePort,
      getSkillSources,
      discoverSkills,
      mergeDiscoveredSkills,
      createSkill,
      updateSkill,
      deleteSkill,
      readSkillSupportingFile,
      writeSkillSupportingFile,
      deleteSkillSupportingFile,
      SKILL_SCOPE,
      SKILL_DIR,
      getCuratedSkillsSources,
      getCacheKey,
      getCachedScan,
      setCachedScan,
      parseSkillRepoSource,
      scanSkillsRepository,
      installSkillsFromRepository,
      scanClawdHubPage,
      installSkillsFromClawdHub,
      isClawdHubSource,
      getProfiles,
      getProfile,
    });

    registerQuotaRoutes(app, { getQuotaProviders });
    registerSmallModelRoutes(app, { getSmallModelService });
    registerSessionGoalRoutes(app);
    registerGitHubRoutes(app);
    registerGitRoutes(app);
    registerMagicPromptRoutes(app, {
      fsPromises,
      path,
      openchamberDataDir,
    });
    registerSessionFoldersRoutes(app, {
      fsPromises,
      path,
      openchamberDataDir,
    });
    registerFsRoutes(app, {
      os,
      path,
      fsPromises,
      spawn,
      crypto,
      normalizeDirectoryPath,
      resolveProjectDirectory,
      buildAugmentedPath,
      resolveGitBinaryForSpawn,
      openchamberUserConfigRoot,
    });
  };

  return {
    registerRoutes,
  };
};
