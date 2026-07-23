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
  const emitted = [];
  const partitionSessions = [];
  class MockWebContents extends EventEmitter {
    constructor() {
      super();
      this.id = nextWebContentsId++;
      this.sent = [];
      this.closed = false;
      this.osPid = 100 + this.id;
    }
    setWindowOpenHandler(handler) { this.windowOpenHandler = handler; }
    loadURL(url) { this.url = url; return Promise.resolve(); }
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
    contentView: {
      children: [],
      addChildView(view) { this.children.push(view); },
      removeChildView(view) { this.children = this.children.filter((entry) => entry !== view); },
    },
    isDestroyed: () => false,
    getContentBounds: () => ({ x: 0, y: 0, width: 1_200, height: 800 }),
  };
  const manager = createArtifactRunnerManager({
    WebContentsView: MockWebContentsView,
    session,
    app: { getAppMetrics: () => metrics },
    preloadPath: '/app/artifact-runner-preload.cjs',
    emit: (_window, detail) => emitted.push(detail),
    now: () => now,
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl() {},
  });
  return {
    manager,
    owner,
    emitted,
    partitionSessions,
    setNow(value) { now = value; },
    setMetrics(value) { metrics = value; },
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
  assert.equal(harness.manager.post(state.id, { source: 'openchamber-host' }), true);
  assert.equal(view.webContents.sent.length, 1);
  assert.equal(harness.manager.stop(state.id).stopped, true);
  assert.equal(view.webContents.closed, true);
  assert.equal(harness.owner.contentView.children.length, 0);
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
