import crypto from 'node:crypto';

export const ARTIFACT_RUNNER_LIMITS = Object.freeze({
  global: 8,
  perWindow: 4,
  leaseMs: 15 * 60_000,
  memoryWorkingSetKb: 256 * 1024,
  cpuPercent: 90,
  cpuSamples: 5,
  messageBytes: 65_536,
});

const GENERATED_ARTIFACT_PATH = /^\/api\/interactive-ui\/artifacts\/[a-f0-9]{64}\/document$/;
const INSTALLED_ARTIFACT_PATH = /^\/api\/interactive-ui\/extensions\/[A-Za-z0-9._-]+\/artifacts\/[A-Za-z0-9._-]+$/;

export const validateArtifactRunnerUrl = (rawUrl) => {
  if (typeof rawUrl !== 'string' || rawUrl.length > 8_192) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (!GENERATED_ARTIFACT_PATH.test(url.pathname) && !INSTALLED_ARTIFACT_PATH.test(url.pathname)) return null;
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
};

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, value));

const normalizeSurfaceBounds = (value) => ({
  x: clamp(Math.trunc(Number(value?.x) || 0), -8_192, 8_192),
  y: clamp(Math.trunc(Number(value?.y) || 0), -8_192, 8_192),
  width: Math.max(1, Math.min(8_192, Math.trunc(Number(value?.width) || 1))),
  height: Math.max(1, Math.min(8_192, Math.trunc(Number(value?.height) || 1))),
});

const normalizeClipBounds = (value) => ({
  x: clamp(Math.trunc(Number(value?.x) || 0), 0, 8_192),
  y: clamp(Math.trunc(Number(value?.y) || 0), 0, 8_192),
  width: clamp(Math.trunc(Number(value?.width) || 0), 0, 8_192),
  height: clamp(Math.trunc(Number(value?.height) || 0), 0, 8_192),
});

const resolveGeometry = (owner, rawBounds, rawClipBounds) => {
  const bounds = normalizeSurfaceBounds(rawBounds);
  const ownerBounds = owner.getContentBounds?.();
  const ownerWidth = clamp(Math.trunc(Number(ownerBounds?.width) || 8_192), 1, 8_192);
  const ownerHeight = clamp(Math.trunc(Number(ownerBounds?.height) || 8_192), 1, 8_192);
  const clipBounds = rawClipBounds
    ? normalizeClipBounds(rawClipBounds)
    : {
        x: Math.max(0, bounds.x),
        y: Math.max(0, bounds.y),
        width: Math.max(0, Math.min(ownerWidth, bounds.x + bounds.width) - Math.max(0, bounds.x)),
        height: Math.max(0, Math.min(ownerHeight, bounds.y + bounds.height) - Math.max(0, bounds.y)),
      };
  const left = Math.max(0, bounds.x, clipBounds.x);
  const top = Math.max(0, bounds.y, clipBounds.y);
  const right = Math.min(ownerWidth, bounds.x + bounds.width, clipBounds.x + clipBounds.width);
  const bottom = Math.min(ownerHeight, bounds.y + bounds.height, clipBounds.y + clipBounds.height);
  const width = Math.max(0, right - left);
  const height = Math.max(0, bottom - top);
  return {
    bounds,
    clipBounds,
    visible: width > 0 && height > 0,
    viewBounds: {
      x: left,
      y: top,
      width: Math.max(1, width),
      height: Math.max(1, height),
    },
    contentLayout: {
      width: bounds.width,
      height: bounds.height,
      offsetX: left - bounds.x,
      offsetY: top - bounds.y,
    },
  };
};

const serializedBytes = (value) => {
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8');
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

export const createArtifactRunnerManager = ({
  WebContentsView,
  session,
  app,
  preloadPath,
  emit,
  logger = console,
  now = () => Date.now(),
  setIntervalImpl = setInterval,
  clearIntervalImpl = clearInterval,
} = {}) => {
  if (!WebContentsView || !session || !app || typeof preloadPath !== 'string' || typeof emit !== 'function') {
    throw new Error('Artifact Runner dependencies are incomplete');
  }
  const runners = new Map();
  const runnerByWebContentsId = new Map();

  const publicState = (runner) => ({
    id: runner.id,
    state: runner.state,
    reason: runner.reason ?? null,
    expiresAt: runner.expiresAt,
  });

  const notify = (runner, type, detail = {}) => {
    emit(runner.owner, {
      runnerId: runner.id,
      type,
      ...detail,
    });
  };

  const stageGeometry = (runner, geometry) => {
    runner.pendingGeometry = geometry;
    runner.layoutRevision += 1;
    runner.view.setVisible(false);
    runner.webContents.send('openchamber:artifact-runner-layout', {
      ...geometry.contentLayout,
      revision: runner.layoutRevision,
    });
  };

  const handleLayoutApplied = (sender, value) => {
    const id = runnerByWebContentsId.get(sender?.id);
    const runner = id ? runners.get(id) : null;
    const revision = Math.trunc(Number(value?.revision));
    if (!runner || sender !== runner.webContents || !Number.isSafeInteger(revision)
      || revision !== runner.layoutRevision || !runner.pendingGeometry) return false;
    const geometry = runner.pendingGeometry;
    runner.pendingGeometry = null;
    runner.committedGeometry = geometry;
    runner.view.setBounds(geometry.viewBounds);
    runner.view.setVisible(runner.requestedVisible && geometry.visible);
    if (!runner.loadedNotified) {
      runner.loadedNotified = true;
      notify(runner, 'loaded');
    }
    return true;
  };

  const stop = (id, reason = 'stopped') => {
    const runner = runners.get(id);
    if (!runner) return { stopped: false };
    runners.delete(id);
    runnerByWebContentsId.delete(runner.webContents.id);
    runner.state = reason === 'stopped' ? 'stopped' : 'terminated';
    runner.reason = reason;
    try { runner.owner.contentView.removeChildView(runner.view); } catch {}
    try { runner.view.setVisible(false); } catch {}
    try { runner.webContents.close({ waitForBeforeUnload: false }); } catch {
      try { runner.webContents.forcefullyCrashRenderer(); } catch {}
    }
    void runner.partitionSession.clearStorageData().catch(() => {});
    notify(runner, 'terminated', { reason });
    return { stopped: true, ...publicState(runner) };
  };

  const start = async (owner, { url: rawUrl, bounds, clipBounds, visible = true } = {}) => {
    if (!owner || owner.isDestroyed?.()) throw new Error('Artifact Runner requires a live owner window');
    const url = validateArtifactRunnerUrl(rawUrl);
    if (!url) throw new Error('Artifact Runner URL is not an allowed artifact document');
    if (runners.size >= ARTIFACT_RUNNER_LIMITS.global) throw new Error('Artifact Runner global limit reached');
    const ownerCount = Array.from(runners.values()).filter((runner) => runner.owner === owner).length;
    if (ownerCount >= ARTIFACT_RUNNER_LIMITS.perWindow) throw new Error('Artifact Runner window limit reached');

    const id = crypto.randomUUID();
    const partitionSession = session.fromPartition(`ocix-artifact-${id}`, { cache: false });
    partitionSession.setPermissionCheckHandler(() => false);
    partitionSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    partitionSession.webRequest.onBeforeRequest((details, callback) => {
      const allowed = details.url === url || details.url.startsWith('data:') || details.url.startsWith('blob:');
      callback({ cancel: !allowed });
    });

    const view = new WebContentsView({
      webPreferences: {
        preload: preloadPath,
        partition: `ocix-artifact-${id}`,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        webviewTag: false,
        spellcheck: false,
        backgroundThrottling: false,
      },
    });
    const runner = {
      id,
      owner,
      view,
      webContents: view.webContents,
      partitionSession,
      url,
      state: 'starting',
      reason: null,
      expiresAt: now() + ARTIFACT_RUNNER_LIMITS.leaseMs,
      highCpuSamples: 0,
      userActiveUntil: 0,
      requestedBounds: bounds,
      requestedClipBounds: clipBounds,
      requestedVisible: visible === true,
      layoutRevision: 0,
      pendingGeometry: null,
      committedGeometry: null,
      loadedNotified: false,
    };
    runners.set(id, runner);
    runnerByWebContentsId.set(runner.webContents.id, id);
    owner.contentView.addChildView(view);
    const geometry = resolveGeometry(owner, bounds, clipBounds);
    view.setBounds(geometry.viewBounds);
    view.setVisible(false);
    runner.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    runner.webContents.on('will-navigate', (event, nextUrl) => {
      if (nextUrl === url) return;
      event.preventDefault();
      stop(id, 'navigation-blocked');
    });
    runner.webContents.on('will-attach-webview', (event) => event.preventDefault());
    runner.webContents.on('before-input-event', () => { runner.userActiveUntil = now() + 1_500; });
    runner.webContents.on('before-mouse-event', () => { runner.userActiveUntil = now() + 1_500; });
    runner.webContents.on('render-process-gone', (_event, details) => stop(id, details?.reason === 'killed' ? 'stopped' : 'crashed'));
    runner.webContents.on('did-finish-load', () => {
      if (!runners.has(id)) return;
      runner.state = 'running';
      stageGeometry(runner, resolveGeometry(runner.owner, runner.requestedBounds, runner.requestedClipBounds));
    });
    runner.webContents.on('did-fail-load', (_event, _code, _description, failedUrl, isMainFrame) => {
      if (isMainFrame && failedUrl === url) stop(id, 'load-failed');
    });
    void runner.webContents.loadURL(url).catch((error) => {
      logger.warn?.('[ArtifactRunner] document load failed', error?.message || error);
      stop(id, 'load-failed');
    });
    return publicState(runner);
  };

  const update = (id, { bounds, clipBounds, visible } = {}) => {
    const runner = runners.get(id);
    if (!runner) return null;
    if (bounds) runner.requestedBounds = bounds;
    if (clipBounds) runner.requestedClipBounds = clipBounds;
    if (typeof visible === 'boolean') runner.requestedVisible = visible;
    const geometry = resolveGeometry(runner.owner, runner.requestedBounds, runner.requestedClipBounds);
    if (runner.state === 'running') {
      stageGeometry(runner, geometry);
    } else {
      runner.view.setBounds(geometry.viewBounds);
      runner.view.setVisible(false);
    }
    return publicState(runner);
  };

  const post = (id, message) => {
    const runner = runners.get(id);
    if (!runner || serializedBytes(message) > 2_200_000) return false;
    runner.webContents.send('openchamber:artifact-runner-host-message', message);
    return true;
  };

  const handleRendererMessage = (sender, message) => {
    const id = runnerByWebContentsId.get(sender?.id);
    const runner = id ? runners.get(id) : null;
    if (!runner || sender !== runner.webContents || serializedBytes(message) > ARTIFACT_RUNNER_LIMITS.messageBytes) return false;
    const geometry = runner.committedGeometry;
    const resizeHeight = Math.trunc(Number(message?.payload?.height));
    if (message?.type === 'artifact.resize' && geometry?.visible
      && geometry.viewBounds.height < geometry.contentLayout.height
      && resizeHeight === geometry.viewBounds.height) {
      return false;
    }
    notify(runner, 'message', { message, userActivated: now() <= runner.userActiveUntil });
    return true;
  };

  const stopForOwner = (owner, reason = 'owner-closed') => {
    for (const runner of Array.from(runners.values())) {
      if (runner.owner === owner) stop(runner.id, reason);
    }
  };

  const monitor = () => {
    const metrics = app.getAppMetrics();
    const byPid = new Map(metrics.map((metric) => [metric.pid, metric]));
    for (const runner of Array.from(runners.values())) {
      if (now() >= runner.expiresAt) {
        stop(runner.id, 'lease-expired');
        continue;
      }
      const pid = runner.webContents.getOSProcessId?.();
      const metric = byPid.get(pid);
      const workingSetSize = Number(metric?.memory?.workingSetSize) || 0;
      if (workingSetSize > ARTIFACT_RUNNER_LIMITS.memoryWorkingSetKb) {
        stop(runner.id, 'memory-limit');
        continue;
      }
      const cpu = Number(metric?.cpu?.percentCPUUsage) || 0;
      runner.highCpuSamples = cpu > ARTIFACT_RUNNER_LIMITS.cpuPercent ? runner.highCpuSamples + 1 : 0;
      if (runner.highCpuSamples >= ARTIFACT_RUNNER_LIMITS.cpuSamples) stop(runner.id, 'cpu-limit');
    }
  };
  const monitorTimer = setIntervalImpl(monitor, 1_000);
  monitorTimer.unref?.();

  const dispose = () => {
    clearIntervalImpl(monitorTimer);
    for (const runner of Array.from(runners.values())) stop(runner.id, 'runtime-stopped');
  };

  return { start, update, post, stop, stopForOwner, handleRendererMessage, handleLayoutApplied, monitor, dispose, get: (id) => runners.has(id) ? publicState(runners.get(id)) : null };
};
