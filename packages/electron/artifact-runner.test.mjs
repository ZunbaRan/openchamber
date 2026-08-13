import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { ARTIFACT_RUNNER_LIMITS, createArtifactRunnerManager, validateArtifactRunnerUrl } from './artifact-runner.mjs';

test('accepts only exact generated or installed Artifact document routes', () => {
  assert.ok(validateArtifactRunnerUrl(`http://127.0.0.1:47832/api/interactive-ui/artifacts/${'a'.repeat(64)}/document?oc_url_token=redacted`));
  assert.ok(validateArtifactRunnerUrl('https://host.example/api/interactive-ui/extensions/com.acme.crm/artifacts/com.acme.crm.explorer'));
  assert.equal(validateArtifactRunnerUrl('https://host.example/api/interactive-ui/extensions/com.acme.crm/native/workspace'), null);
  assert.equal(validateArtifactRunnerUrl('file:///tmp/artifact.html'), null);
});

const createHarness = () => {
  let nextWebContentsId = 1;
  let now = 1_000;
  let metrics = [];
  let failNextLoad = false;
  const emitted = [];
  const order = [];
  const partitionSessions = [];
  const browserWindows = [];
  class MockWebContents extends EventEmitter {
    constructor() {
      super();
      this.id = nextWebContentsId++;
      this.sent = [];
      this.closed = false;
      this.osPid = 100 + this.id;
    }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
    loadURL(url) {
      this.url = url;
      order.push({ type: 'loadURL', webContents: this });
      if (failNextLoad) {
        this.emit('did-fail-load', {}, -3, 'ERR_ABORTED', url, true);
        return Promise.reject(new Error('net::ERR_ABORTED'));
      }
      return Promise.resolve();
    }
    send(channel, message) { this.sent.push({ channel, message }); }
    close() { this.closed = true; }
    forcefullyCrashRenderer() { this.closed = true; }
    getOSProcessId() { return this.osPid; }
  }
  class MockWebContentsView {
    constructor(options) { this.options = options; this.webContents = new MockWebContents(); this.visible = false; }
    setBounds(bounds) { this.bounds = bounds; }
    setVisible(value) { this.visible = value; }
  }
  class MockBrowserWindow extends EventEmitter {
    constructor(options) {
      super();
      browserWindows.push(this);
      this.options = options;
      this.destroyed = false;
      this.shown = false;
      this.contentView = {
        children: [],
        addChildView: (view) => { this.contentView.children.push(view); },
        removeChildView: (view) => {
          this.contentView.children = this.contentView.children.filter((entry) => entry !== view);
        },
      };
      this.contentBounds = { x: 0, y: 0, width: options.width, height: options.height };
    }
    getContentBounds() { return this.contentBounds; }
    loadURL(url) { this.url = url; return Promise.resolve(); }
    setMenuBarVisibility() {}
    show() { this.shown = true; }
    isDestroyed() { return this.destroyed; }
    destroy() { this.destroyed = true; this.emit('closed'); }
  }
  const session = {
    fromPartition(partition, options) {
      const value = {
        partition,
        options,
        webRequest: { onBeforeRequest(handler) { value.requestHandler = handler; } },
        setPermissionCheckHandler(handler) { value.permissionCheck = handler; },
        setPermissionRequestHandler(handler) { value.permissionRequest = handler; },
        clearStorageData() { value.cleared = true; return Promise.resolve(); },
      };
      partitionSessions.push(value);
      return value;
    },
  };
  const owner = {
    webContents: {
      sentInputEvents: [],
      sendInputEvent(event) { this.sentInputEvents.push(event); },
    },
    contentView: {
      children: [],
      addChildView(view) {
        this.children.push(view);
        order.push({ type: 'addChildView', view });
      },
      removeChildView(view) {
        this.children = this.children.filter((entry) => entry !== view);
        order.push({ type: 'removeChildView', view });
      },
    },
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1_200, height: 800 }),
  };
  const manager = createArtifactRunnerManager({
    BrowserWindow: MockBrowserWindow,
    WebContentsView: MockWebContentsView,
    session,
    app: { getAppMetrics: () => metrics },
    preloadPath: '/app/artifact-runner-preload.cjs',
    emit: (_window, detail) => emitted.push(detail),
    logger: { warn() {} },
    now: () => now,
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl() {},
  });
  return {
    manager,
    owner,
    emitted,
    order,
    browserWindows,
    partitionSessions,
    setNow(value) { now = value; },
    setMetrics(value) { metrics = value; },
    setFailNextLoad(value) { failNextLoad = value; },
  };
};

test('starts a sandboxed runner with denied permissions and destroys it on stop', async () => {
  const harness = createHarness();
  const url = `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'b'.repeat(64)}/document`;
  const state = await harness.manager.start(harness.owner, { url, bounds: { x: 12.9, y: 4, width: 640, height: 360 } });
  const view = harness.owner.contentView.children[0];
  assert.equal(view.options.webPreferences.sandbox, true);
  assert.equal(view.options.webPreferences.contextIsolation, true);
  assert.equal(view.options.webPreferences.nodeIntegration, false);
  assert.deepEqual(view.bounds, { x: 12, y: 4, width: 640, height: 360 });
  assert.equal(harness.partitionSessions[0].permissionCheck(), false);
  assert.deepEqual(view.webContents.windowOpenHandler(), { action: 'deny' });
  const messagesBeforePost = view.webContents.sent.length;
  assert.equal(harness.manager.post(state.id, { source: 'openchamber-host' }), true);
  assert.equal(view.webContents.sent.length, messagesBeforePost + 1);
  assert.equal(harness.manager.stop(state.id).stopped, true);
  assert.equal(view.webContents.closed, true);
  assert.equal(harness.owner.contentView.children.length, 0);
});

test('attaches the empty invisible view before loading the artifact document', async () => {
  const harness = createHarness();
  const url = `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'a'.repeat(64)}/document`;
  await harness.manager.start(harness.owner, { url, bounds: { x: 0, y: 0, width: 640, height: 360 } });
  const view = harness.owner.contentView.children[0];
  const attachAt = harness.order.findIndex((entry) => entry.type === 'addChildView' && entry.view === view);
  const loadAt = harness.order.findIndex((entry) => entry.type === 'loadURL' && entry.webContents === view.webContents);
  assert.notEqual(attachAt, -1);
  assert.notEqual(loadAt, -1);
  assert.ok(attachAt < loadAt, 'the empty view must attach before loadURL');
  assert.equal(view.visible, false);
});

test('detaches the view and clears runner state when the document load fails', async () => {
  const harness = createHarness();
  harness.setFailNextLoad(true);
  const url = `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'f'.repeat(64)}/document`;
  await assert.rejects(
    harness.manager.start(harness.owner, { url, bounds: { x: 0, y: 0, width: 640, height: 360 } }),
    /Artifact Runner document could not be loaded/,
  );
  const attachEvent = harness.order.find((entry) => entry.type === 'addChildView');
  assert.ok(attachEvent, 'start must attach the view before loading');
  const view = attachEvent.view;
  const attachAt = harness.order.indexOf(attachEvent);
  const loadAt = harness.order.findIndex((entry) => entry.type === 'loadURL' && entry.webContents === view.webContents);
  const detachAt = harness.order.findIndex((entry) => entry.type === 'removeChildView' && entry.view === view);
  assert.ok(attachAt < loadAt, 'the view must attach before loadURL');
  assert.notEqual(detachAt, -1, 'a failed load must detach the view');
  assert.ok(loadAt < detachAt, 'the detach must follow the failed load');
  assert.equal(harness.owner.contentView.children.length, 0);
  assert.equal(view.webContents.closed, true);
  assert.equal(harness.partitionSessions[0].cleared, true);
  const terminated = harness.emitted.at(-1);
  assert.equal(terminated.type, 'terminated');
  assert.equal(terminated.reason, 'load-failed');
  assert.equal(harness.manager.get(terminated.runnerId), null);
});

test('stops every native runner owned by a window when that owner navigates', async () => {
  const harness = createHarness();
  const otherOwner = {
    ...harness.owner,
    contentView: {
      children: [],
      addChildView(view) { this.children.push(view); },
      removeChildView(view) { this.children = this.children.filter((entry) => entry !== view); },
    },
  };
  const first = await harness.manager.start(harness.owner, {
    url: `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'1'.repeat(64)}/document`,
    bounds: { x: 0, y: 0, width: 640, height: 360 },
  });
  const second = await harness.manager.start(harness.owner, {
    url: `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'2'.repeat(64)}/document`,
    bounds: { x: 0, y: 0, width: 640, height: 360 },
  });
  const unrelated = await harness.manager.start(otherOwner, {
    url: `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'3'.repeat(64)}/document`,
    bounds: { x: 0, y: 0, width: 640, height: 360 },
  });

  harness.manager.stopForOwner(harness.owner, 'owner-navigated');

  assert.equal(harness.manager.get(first.id), null);
  assert.equal(harness.manager.get(second.id), null);
  assert.notEqual(harness.manager.get(unrelated.id), null);
  assert.equal(harness.owner.contentView.children.length, 0);
  assert.equal(otherOwner.contentView.children.length, 1);
  assert.deepEqual(
    harness.emitted.slice(-2).map((event) => event.reason),
    ['owner-navigated', 'owner-navigated'],
  );
});

test('clips the native view and offsets the full-size broker iframe without reflowing its document', async () => {
  const harness = createHarness();
  const url = `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'d'.repeat(64)}/document`;
  const state = await harness.manager.start(harness.owner, {
    url,
    bounds: { x: 240, y: -120, width: 900, height: 900 },
    clipBounds: { x: 240, y: 64, width: 900, height: 620 },
  });
  const view = harness.owner.contentView.children[0];
  assert.deepEqual(view.bounds, { x: 240, y: 64, width: 900, height: 620 });
  assert.equal(view.visible, false);
  view.webContents.emit('did-finish-load');
  assert.deepEqual(view.webContents.sent.at(-1), {
    channel: 'openchamber:artifact-runner-layout',
    message: { width: 900, height: 900, offsetX: 0, offsetY: 184, revision: 1 },
  });
  assert.equal(harness.manager.handleLayoutApplied(view.webContents, { revision: 1 }), true);
  assert.equal(view.visible, true);
  assert.equal(harness.emitted.at(-1).type, 'loaded');
  const emittedBeforeClipEcho = harness.emitted.length;
  assert.equal(harness.manager.handleRendererMessage(view.webContents, {
    type: 'artifact.resize',
    payload: { height: 620 },
  }), false);
  assert.equal(harness.emitted.length, emittedBeforeClipEcho);
  assert.equal(harness.manager.handleRendererMessage(view.webContents, {
    type: 'artifact.resize',
    payload: { height: 500 },
  }), true);

  harness.manager.update(state.id, {
    bounds: { x: 240, y: -950, width: 900, height: 900 },
    clipBounds: { x: 240, y: 64, width: 900, height: 0 },
    visible: true,
  });
  assert.equal(view.visible, false);
  assert.equal(harness.manager.handleLayoutApplied(view.webContents, { revision: 2 }), true);
  assert.equal(view.visible, false);
});

test('hands a boundary wheel reported by the Artifact broker back to the owner renderer at the native view coordinates', async () => {
  const harness = createHarness();
  const url = `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'9'.repeat(64)}/document`;
  await harness.manager.start(harness.owner, {
    url,
    bounds: { x: 240, y: 100, width: 900, height: 900 },
    clipBounds: { x: 240, y: 180, width: 900, height: 620 },
  });
  const view = harness.owner.contentView.children[0];
  harness.manager.handleLayoutApplied(view.webContents, { revision: 1 });
  view.webContents.emit('before-mouse-event', {}, {
    type: 'mouseWheel',
    x: 14,
    y: 22,
  });
  assert.equal(harness.manager.handleWheelBoundary(view.webContents, {
    deltaX: 0,
    deltaY: 48,
    deltaMode: 0,
    shiftKey: true,
  }), true);

  assert.deepEqual(harness.owner.webContents.sentInputEvents, [{
    type: 'mouseWheel',
    x: 254,
    y: 202,
    deltaX: 0,
    deltaY: 48,
    hasPreciseScrollingDeltas: true,
    modifiers: ['shift'],
  }]);
});

test('requires a recent native wheel and keeps boundary handoff out of Artifact popouts', async () => {
  const harness = createHarness();
  const url = `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'8'.repeat(64)}/document`;
  const state = await harness.manager.start(harness.owner, {
    url,
    bounds: { x: 20, y: 40, width: 640, height: 360 },
  });
  const view = harness.owner.contentView.children[0];
  harness.manager.handleLayoutApplied(view.webContents, { revision: 1 });
  assert.equal(harness.manager.handleWheelBoundary(view.webContents, { deltaY: 30, deltaMode: 0 }), false);
  assert.equal(harness.owner.webContents.sentInputEvents.length, 0);

  await harness.manager.popout(state.id);
  view.webContents.emit('before-mouse-event', {}, {
    type: 'mouseWheel', x: 10, y: 10,
  });
  assert.equal(harness.manager.handleWheelBoundary(view.webContents, { deltaY: 30, deltaMode: 0 }), false);
  assert.equal(harness.owner.webContents.sentInputEvents.length, 0);
});

test('enforces memory and sustained CPU limits in the main process', async () => {
  const memoryHarness = createHarness();
  const url = `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'c'.repeat(64)}/document`;
  const memoryState = await memoryHarness.manager.start(memoryHarness.owner, { url, bounds: {} });
  const memoryView = memoryHarness.owner.contentView.children[0];
  memoryHarness.setMetrics([{ pid: memoryView.webContents.osPid, cpu: { percentCPUUsage: 1 }, memory: { workingSetSize: ARTIFACT_RUNNER_LIMITS.memoryWorkingSetKb + 1 } }]);
  memoryHarness.manager.monitor();
  assert.equal(memoryHarness.manager.get(memoryState.id), null);
  assert.equal(memoryHarness.emitted.at(-1).reason, 'memory-limit');

  const cpuHarness = createHarness();
  const cpuState = await cpuHarness.manager.start(cpuHarness.owner, { url, bounds: {} });
  const cpuView = cpuHarness.owner.contentView.children[0];
  cpuHarness.setMetrics([{ pid: cpuView.webContents.osPid, cpu: { percentCPUUsage: ARTIFACT_RUNNER_LIMITS.cpuPercent + 1 }, memory: { workingSetSize: 1 } }]);
  for (let index = 0; index < ARTIFACT_RUNNER_LIMITS.cpuSamples; index += 1) cpuHarness.manager.monitor();
  assert.equal(cpuHarness.manager.get(cpuState.id), null);
  assert.equal(cpuHarness.emitted.at(-1).reason, 'cpu-limit');
});

test('migrates the same runner view into a system popout and restores it', async () => {
  const harness = createHarness();
  const url = `http://127.0.0.1:47832/api/interactive-ui/artifacts/${'e'.repeat(64)}/document`;
  const state = await harness.manager.start(harness.owner, {
    url,
    bounds: { x: 20, y: 40, width: 640, height: 360 },
    visible: true,
  });
  const view = harness.owner.contentView.children[0];
  view.webContents.emit('did-finish-load');
  harness.manager.handleLayoutApplied(view.webContents, { revision: 1 });

  const opened = await harness.manager.popout(state.id, {
    title: 'Artifact popout',
    width: 900,
    height: 600,
  });
  assert.equal(opened.opened, true);
  assert.equal(opened.poppedOut, true);
  const popoutWindow = harness.browserWindows[0];
  assert.equal(popoutWindow.options.parent, undefined);
  assert.match(popoutWindow.url, /^http:\/\/127\.0\.0\.1:47832\/artifact-popout-host\.html/);
  assert.equal(harness.owner.contentView.children.length, 0);
  assert.equal(view.webContents.closed, false);
  assert.equal(harness.emitted.at(-1).type, 'popout-opened');

  const restored = harness.manager.restore(state.id);
  assert.equal(restored.restored, true);
  assert.equal(restored.poppedOut, false);
  assert.deepEqual(harness.owner.contentView.children, [view]);
  assert.equal(view.webContents.closed, false);
  assert.equal(harness.emitted.at(-1).type, 'popout-closed');
  harness.manager.handleLayoutApplied(view.webContents, { revision: 3 });
  assert.deepEqual(view.bounds, { x: 20, y: 40, width: 640, height: 360 });
});

test('enforces three popout windows per owner without replacing existing runners', async () => {
  const harness = createHarness();
  const states = [];
  for (let index = 0; index < 4; index += 1) {
    states.push(await harness.manager.start(harness.owner, {
      url: `http://127.0.0.1:47832/api/interactive-ui/artifacts/${String(index + 1).repeat(64)}/document`,
      bounds: { x: 0, y: 0, width: 640, height: 360 },
    }));
  }
  for (const state of states.slice(0, 3)) await harness.manager.popout(state.id);
  await assert.rejects(harness.manager.popout(states[3].id), /popout limit/);
  assert.equal(harness.manager.get(states[0].id)?.poppedOut, true);
  assert.equal(harness.manager.get(states[3].id)?.poppedOut, false);
});
