import { registerFsRoutes } from '../fs/routes.js';
import { registerQuotaRoutes } from '../quota/routes.js';
import { registerSmallModelRoutes } from '../small-model/routes.js';
import { registerWalkthroughRoutes } from '../walkthrough/routes.js';
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
import { getProviderSources, removeProviderConfig, upsertProviderConfig } from './providers.js';
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
import { getSkillSources, discoverSkills, mergeDiscoveredSkills, createSkill, updateSkill, deleteSkill, renameSkill, isManagedSkillPath } from './skills.js';
import { getCuratedSkillsSources } from '../skills-catalog/curated-sources.js';
import { getCacheKey, getCachedScan, setCachedScan } from '../skills-catalog/cache.js';
import { isClawdHubSource, parseSkillRepoSource } from '../skills-catalog/source.js';
import { scanSkillsRepository } from '../skills-catalog/scan.js';
import { installSkillsFromRepository } from '../skills-catalog/install.js';
import { scanClawdHubPage } from '../skills-catalog/clawdhub/scan.js';
import { installSkillsFromClawdHub } from '../skills-catalog/clawdhub/install.js';
import { createInteractiveUIRuntime, normalizeExtensionManifest } from '../interactive-ui/runtime.js';
import { registerInteractiveUIRoutes } from '../interactive-ui/routes.js';
import { createInteractiveUIExtensionManager, InteractiveUIExtensionManagerError } from '../interactive-ui/manager.js';
import { createInteractiveUIConnectionStore } from '../interactive-ui/connection-store.js';
import { createHTMLArtifactStore } from '../interactive-ui/artifact-store.js';
import { createBuiltInInteractiveUIRuntime } from '../interactive-ui/builtin-runtime.js';
import { createInteractiveUIWorkbenchStore } from '../interactive-ui/workbench-store.js';
import { reconcileOpenCodeAgentRuntime } from '../interactive-ui/agent-runtime.js';

// Production wiring seam for Interactive UI / OCIX (module-private; the public
// surface is createFeatureRoutesRuntime(...).registerRoutes).
// Binds Manager adapters:
// - validateStagedPackage → authoritative runtime parser against ONLY the
//   staged tree, before any version destination or activation change
// - validateRemoteMetadata → runtime single-source manifest normalizer
// - reconcileActivation → durable previousAssets + Agent Runtime materializer
// Registers explicit Interactive UI routes before generic OpenCode proxy work.
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
  authorizeExtensionAuthority: (extensionId, authority) => (
    manager.authorizeExtensionAuthority(extensionId, authority)
  ),
  prepareExtensionUse: (extensionId, options) => (
    manager.prepareRemoteUse(extensionId, options)
  ),
  getExtensionLifecycle: (extensionId) => manager.getRemoteLifecycle(extensionId),
  listEnabledRemoteExtensions: () => manager.getEnabledRemoteExtensionIds(),
  getBlockedCatalogEntries: () => manager.getBlockedRemoteCatalogEntries(),
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

  let walkthroughService = null;
  const getWalkthroughService = async () => {
    if (!walkthroughService) {
      const [service, pullRequest] = await Promise.all([
        import('../walkthrough/index.js'),
        import('../walkthrough/pull-request.js'),
      ]);
      walkthroughService = { ...service, getPullRequestDiff: pullRequest.getPullRequestDiff };
    }
    return walkthroughService;
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
      getOpenCodeUpgradeCapability,
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

    const processRef = processLike ?? globalThis.process;
    const configuredInteractiveUIRoots = typeof processRef?.env?.OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR === 'string'
      ? processRef.env.OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter(Boolean)
      : [];
    const testOpenCodeConfigDirectory = typeof processRef?.env?.OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR === 'string'
      && processRef.env.OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR.trim()
      ? path.resolve(processRef.env.OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR.trim())
      : null;
    if (testOpenCodeConfigDirectory && processRef?.env) {
      processRef.env.OPENCODE_CONFIG_DIR = testOpenCodeConfigDirectory;
    }
    const opencodeConfigDirectory = testOpenCodeConfigDirectory
      ?? (typeof processRef?.env?.OPENCODE_CONFIG_DIR === 'string' && processRef.env.OPENCODE_CONFIG_DIR.trim()
        ? path.resolve(processRef.env.OPENCODE_CONFIG_DIR.trim())
        : path.join(os.homedir(), '.config', 'opencode'));
    const builtInInteractiveUIRuntime = createBuiltInInteractiveUIRuntime({ pathImpl: path });
    const interactiveUIExtensionManager = createInteractiveUIExtensionManager({
      dataDirectory: openchamberDataDir,
      fsImpl: fsPromises,
      pathImpl: path,
      cryptoImpl: crypto,
      logger: console,
      validateStagedPackage: async ({ directory, verified }) => {
        // Production staged-tree validator: a fresh authoritative runtime
        // parses ONLY the staged directory (never the manager version store or
        // any configured root). Any load error, any result other than exactly
        // one extension, or an id/version mismatch with the verified package
        // fails closed with a controlled Manager error — no staged path or raw
        // parser error is ever exposed.
        const stagedRuntime = createInteractiveUIRuntime({
          fsPromises,
          path,
          crypto,
          environment: processRef?.env,
          extensionRoots: [directory],
          logger: console,
        });
        let listing;
        try {
          listing = await stagedRuntime.listExtensions();
        } catch {
          throw new InteractiveUIExtensionManagerError(
            'Staged extension tree does not satisfy the Interactive UI runtime contract',
            'staged_extension_invalid',
            400,
          );
        }
        if (listing.errors.length > 0 || listing.extensions.length !== 1) {
          throw new InteractiveUIExtensionManagerError(
            'Staged extension tree does not satisfy the Interactive UI runtime contract',
            'staged_extension_invalid',
            400,
          );
        }
        const stagedExtension = listing.extensions[0];
        if (stagedExtension.id !== verified.manifest.id || stagedExtension.version !== verified.manifest.version) {
          throw new InteractiveUIExtensionManagerError(
            'Staged extension identity does not match the verified package',
            'staged_extension_identity_mismatch',
            400,
          );
        }
      },
      validateRemoteMetadata: async ({ extension }) => {
        // Single-source normalizer: Remote shells only accept metadata that the
        // runtime would accept for Local/built-in manifests. Adapter failures
        // become controlled Manager errors before any credential or shell write.
        const normalized = normalizeExtensionManifest(extension, processRef?.env);
        return {
          connectors: normalized.connectors ?? extension?.connectors ?? [],
        };
      },
      reconcileActivation: async ({ previousState, nextState, versionsDirectory }) => {
        const deployment = await reconcileOpenCodeAgentRuntime({
          state: nextState,
          previousAssets: previousState.agentRuntime?.assets ?? {},
          configDirectory: opencodeConfigDirectory,
          versionsDirectory,
          builtInRuntime: builtInInteractiveUIRuntime,
          fsImpl: fsPromises,
          pathImpl: path,
          cryptoImpl: crypto,
        });
        let openCode = {
          changed: deployment.changed === true,
          reloaded: false,
          external: false,
        };
        if (deployment.changed === true && typeof refreshOpenCodeAfterConfigChange === 'function') {
          try {
            const refreshed = await refreshOpenCodeAfterConfigChange('Interactive UI extension Agent Runtime changed');
            openCode = {
              changed: true,
              reloaded: refreshed?.reloaded === true,
              external: refreshed?.external === true,
            };
          } catch (error) {
            console.error('[InteractiveUI] Agent Runtime files changed, but OpenCode refresh failed', error);
            openCode = {
              changed: true,
              reloaded: false,
              external: false,
            };
          }
        }
        return {
          openCode,
          assets: deployment.assets,
          rollback: deployment.rollback,
        };
      },
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
      environment: processRef?.env,
    });
    const interactiveUIWorkbenchStore = createInteractiveUIWorkbenchStore({
      dataDirectory: openchamberDataDir,
      fsImpl: fsPromises,
      pathImpl: path,
      cryptoImpl: crypto,
    });
    const interactiveUIRuntime = createInteractiveUIRuntimeForRoutes({
      fsPromises,
      path,
      crypto,
      environment: processRef?.env,
      connectionStore: interactiveUIConnectionStore,
      logger: console,
      manager: interactiveUIExtensionManager,
      builtInRootDirectory: builtInInteractiveUIRuntime.rootDirectory,
      configuredRoots: configuredInteractiveUIRoots,
    });
    // Explicit OpenChamber Interactive UI routes must win before the generic
    // OpenCode proxy. The target global `/api` gate remains the sole local /
    // tunnel auth authority (routes intentionally do not add a second gate).
    registerInteractiveUIRoutes(app, {
      express,
      manager: interactiveUIExtensionManager,
      artifactStore: htmlArtifactStore,
      workbenchStore: interactiveUIWorkbenchStore,
      runtime: interactiveUIRuntime,
    });
    void interactiveUIRuntime.warmRemoteLifecycle({ concurrency: 4 }).catch((error) => {
      console.error('[InteractiveUI] Remote lifecycle warm-up failed', {
        code: typeof error?.code === 'string' && /^[a-z0-9_]+$/.test(error.code)
          ? error.code
          : 'warm_remote_lifecycle_failed',
      });
    });
    // uiAuthController remains the global /api gate owner (issue-008); routes
    // deliberately do not install a second UI-only gate. openchamberVersion is
    // reserved for future capability/provenance documents.
    void uiAuthController;
    void openchamberVersion;

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
      getOpenCodeUpgradeCapability,
      formatSettingsResponse,
      readSettingsFromDisk,
      readSettingsFromDiskMigrated,
      persistSettings,
      sanitizeProjects,
      validateDirectoryPath,
      resolveProjectDirectory,
      getProviderSources,
      removeProviderConfig,
      upsertProviderConfig,
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
      renameSkill,
      isManagedSkillPath,
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
    registerWalkthroughRoutes(app, { getWalkthroughService });
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
