import crypto from 'node:crypto';

export const ARTIFACT_RUNNER_LIMITS = Object.freeze({
  global: 8,
  perWindow: 4,
  popoutsPerWindow: 3,
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
  BrowserWindow,
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
  if (!BrowserWindow || !WebContentsView || !session || !app
    || typeof preloadPath !== 'string' || typeof emit !== 'function') {
    throw new Error('Artifact Runner dependencies are incomplete');
  }
  const runners = new Map();
  const runnerByWebContentsId = new Map();

  const publicState = (runner) => ({
    id: runner.id,
    state: runner.state,
    reason: runner.reason ?? null,
    expiresAt: runner.expiresAt,
    poppedOut: Boolean(runner.popoutWindow),
  });

  const notify = (runner, type, detail = {}) => {
    emit(runner.eventOwner, {
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
    if (runner.attached) {
      try { runner.container.contentView.removeChildView(runner.view); } catch {}
      runner.attached = false;
    }
    if (runner.popoutWindow && !runner.popoutWindow.isDestroyed?.()) {
      runner.closingPopout = true;
      try { runner.popoutWindow.destroy(); } catch {}
    }
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
    const ownerCount = Array.from(runners.values()).filter((runner) => runner.eventOwner === owner).length;
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
      eventOwner: owner,
      container: owner,
      view,
      webContents: view.webContents,
      partitionSession,
      url,
      state: 'starting',
      reason: null,
      expiresAt: now() + ARTIFACT_RUNNER_LIMITS.leaseMs,
      highCpuSamples: 0,
      userActiveUntil: 0,
      inlineRequest: {
        bounds,
        clipBounds,
        visible: visible === true,
      },
      requestedBounds: bounds,
      requestedClipBounds: clipBounds,
      requestedVisible: visible === true,
      popoutWindow: null,
      closingPopout: false,
      attached: false,
      layoutRevision: 0,
      pendingGeometry: null,
      committedGeometry: null,
      loadedNotified: false,
    };
    runners.set(id, runner);
    runnerByWebContentsId.set(runner.webContents.id, id);
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
    runner.webContents.on('did-fail-load', (_event, _code, _description, failedUrl, isMainFrame) => {
      if (isMainFrame && failedUrl === url) stop(id, 'load-failed');
    });
    try {
      await runner.webContents.loadURL(url);
    } catch (error) {
      logger.warn?.('[ArtifactRunner] document load failed', error?.message || error);
      stop(id, 'load-failed');
      throw new Error('Artifact Runner document could not be loaded');
    }
    if (!runners.has(id)) throw new Error('Artifact Runner document could not be loaded');
    owner.contentView.addChildView(view);
    runner.attached = true;
    runner.state = 'running';
    stageGeometry(runner, resolveGeometry(runner.container, runner.requestedBounds, runner.requestedClipBounds));
    return publicState(runner);
  };

  const update = (id, { bounds, clipBounds, visible } = {}) => {
    const runner = runners.get(id);
    if (!runner) return null;
    if (runner.popoutWindow) {
      if (bounds) runner.inlineRequest.bounds = bounds;
      if (clipBounds) runner.inlineRequest.clipBounds = clipBounds;
      if (typeof visible === 'boolean') runner.inlineRequest.visible = visible;
      return publicState(runner);
    }
    if (bounds) runner.requestedBounds = bounds;
    if (clipBounds) runner.requestedClipBounds = clipBounds;
    if (typeof visible === 'boolean') runner.requestedVisible = visible;
    runner.inlineRequest = {
      bounds: runner.requestedBounds,
      clipBounds: runner.requestedClipBounds,
      visible: runner.requestedVisible,
    };
    const geometry = resolveGeometry(runner.container, runner.requestedBounds, runner.requestedClipBounds);
    if (runner.state === 'running') {
      stageGeometry(runner, geometry);
    } else {
      runner.view.setBounds(geometry.viewBounds);
      runner.view.setVisible(false);
    }
    return publicState(runner);
  };

  const resizePopout = (runner) => {
    const bounds = runner.popoutWindow?.getContentBounds?.();
    if (!bounds) return;
    runner.requestedBounds = { x: 0, y: 0, width: bounds.width, height: bounds.height };
    runner.requestedClipBounds = { x: 0, y: 0, width: bounds.width, height: bounds.height };
    runner.requestedVisible = true;
    if (runner.state === 'running') {
      stageGeometry(runner, resolveGeometry(
        runner.container,
        runner.requestedBounds,
        runner.requestedClipBounds,
      ));
    }
  };

  const restore = (id, reason = 'restored') => {
    const runner = runners.get(id);
    if (!runner) return { restored: false };
    if (!runner.popoutWindow) return { restored: false, ...publicState(runner) };
    const popoutWindow = runner.popoutWindow;
    runner.closingPopout = true;
    if (runner.attached) {
      try { runner.container.contentView.removeChildView(runner.view); } catch {}
      runner.attached = false;
    }
    runner.container = runner.eventOwner;
    runner.popoutWindow = null;
    runner.requestedBounds = runner.inlineRequest.bounds;
    runner.requestedClipBounds = runner.inlineRequest.clipBounds;
    runner.requestedVisible = runner.inlineRequest.visible;
    try {
      runner.container.contentView.addChildView(runner.view);
      runner.attached = true;
    } catch {
      stop(id, 'restore-failed');
      return { restored: false };
    }
    if (runner.state === 'running') {
      stageGeometry(runner, resolveGeometry(
        runner.container,
        runner.requestedBounds,
        runner.requestedClipBounds,
      ));
    }
    try { if (!popoutWindow.isDestroyed?.()) popoutWindow.destroy(); } catch {}
    runner.closingPopout = false;
    notify(runner, 'popout-closed', { reason });
    return { restored: true, ...publicState(runner) };
  };

  const popout = async (id, {
    title = 'OpenChamber Artifact',
    width = 960,
    height = 720,
  } = {}) => {
    const runner = runners.get(id);
    if (!runner) throw new Error('Artifact Runner was not found');
    if (runner.popoutWindow) return { opened: false, ...publicState(runner) };
    const popoutCount = Array.from(runners.values()).filter(
      (candidate) => candidate.eventOwner === runner.eventOwner && candidate.popoutWindow,
    ).length;
    if (popoutCount >= ARTIFACT_RUNNER_LIMITS.popoutsPerWindow) {
      const error = new Error('Artifact Runner popout limit reached');
      error.code = 'artifact_popout_limit';
      throw error;
    }
    const popoutWindow = new BrowserWindow({
      width: clamp(Math.trunc(Number(width) || 960), 480, 1_920),
      height: clamp(Math.trunc(Number(height) || 720), 320, 1_440),
      minWidth: 420,
      minHeight: 280,
      show: true,
      title: String(title || 'OpenChamber Artifact').slice(0, 160),
      backgroundColor: '#111111',
      autoHideMenuBar: true,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    try { popoutWindow.setMenuBarVisibility?.(false); } catch {}
    runner.popoutWindow = popoutWindow;
    const handleResize = () => {
      if (runners.has(id) && runner.popoutWindow === popoutWindow && runner.container === popoutWindow) {
        resizePopout(runner);
      }
    };
    popoutWindow.on('resize', handleResize);
    popoutWindow.on('close', (event) => {
      if (runner.closingPopout || !runners.has(id)) return;
      event.preventDefault?.();
      restore(id, 'window-closed');
    });

    // Commit a valid same-origin root document before moving the live View.
    // Attaching an HTTP View to an empty (opaque-origin) BrowserWindow first
    // causes Chromium to reject the site tuple and leaves a hidden NSWindow.
    const popoutHostUrl = new URL('/artifact-popout-host.html', runner.url);
    try {
      await popoutWindow.loadURL(popoutHostUrl.toString());
      if (!runners.has(id) || runner.popoutWindow !== popoutWindow) {
        return { opened: false, ...publicState(runner) };
      }
      runner.container.contentView.removeChildView(runner.view);
      runner.attached = false;
      runner.container = popoutWindow;
      popoutWindow.contentView.addChildView(runner.view);
      runner.attached = true;
      resizePopout(runner);
      const ownerBounds = runner.eventOwner.getBounds?.();
      if (ownerBounds) {
        const popoutBounds = popoutWindow.getBounds();
        popoutWindow.setPosition(
          Math.round(ownerBounds.x + Math.max(24, (ownerBounds.width - popoutBounds.width) / 2)),
          Math.round(ownerBounds.y + Math.max(24, (ownerBounds.height - popoutBounds.height) / 2)),
        );
      }
      try { popoutWindow.setAlwaysOnTop(true, 'floating'); } catch {}
      popoutWindow.show();
      try { popoutWindow.focus(); } catch {}
      try { popoutWindow.moveTop?.(); } catch {}
      const releaseTopmostTimer = setTimeout(() => {
        try {
          if (!popoutWindow.isDestroyed?.()) popoutWindow.setAlwaysOnTop(false);
        } catch {}
      }, 600);
      releaseTopmostTimer.unref?.();
      notify(runner, 'popout-opened');
      return { opened: true, ...publicState(runner) };
    } catch (error) {
      logger.warn?.('[ArtifactRunner] popout host load failed', error?.message || error);
      if (runners.has(id) && runner.popoutWindow === popoutWindow) {
        restore(id, 'popout-host-load-failed');
      }
      throw new Error('Artifact popout could not be opened');
    }
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
      if (runner.eventOwner === owner) stop(runner.id, reason);
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

  return {
    start,
    update,
    post,
    popout,
    restore,
    stop,
    stopForOwner,
    handleRendererMessage,
    handleLayoutApplied,
    monitor,
    dispose,
    get: (id) => runners.has(id) ? publicState(runners.get(id)) : null,
  };
};
