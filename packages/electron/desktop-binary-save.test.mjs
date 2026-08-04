import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { describe, test } from "node:test";

import {
  DESKTOP_BINARY_SAVE_CANCEL_COMMAND,
  DESKTOP_BINARY_SAVE_COMMAND,
  createDesktopBinarySaveController,
} from "./desktop-binary-save.mjs";

class LifecycleTarget extends EventEmitter {
  destroyed = false;

  isDestroyed() {
    return this.destroyed;
  }

  close() {
    this.destroyed = true;
    this.emit("closed");
  }
}

const requestArgs = (requestId) => ({
  requestId,
  defaultFileName: "canvas.svg",
  mimeType: "image/svg+xml",
  contentBase64: Buffer.from("<svg/>").toString("base64"),
});

const createHarness = ({ showSaveDialog } = {}) => {
  const calls = [];
  const sender = new LifecycleTarget();
  const browserWindow = new LifecycleTarget();
  const handle = {
    writeFile: async () => calls.push("write"),
    sync: async () => calls.push("sync"),
    close: async () => calls.push("close"),
  };
  const controller = createDesktopBinarySaveController({
    showSaveDialog:
      showSaveDialog ||
      (async () => ({ canceled: false, filePath: "/tmp/canvas.svg" })),
    openFile: async (filePath, flags, mode) => {
      calls.push(["open", filePath, flags, mode]);
      return handle;
    },
    renameFile: async (source, destination) => {
      calls.push(["rename", source, destination]);
    },
    unlinkFile: async (filePath) => {
      calls.push(["unlink", filePath]);
    },
    randomUUID: () => "test-uuid",
    processId: 123,
  });

  const invoke = (command, args, local = true, overrides = {}) =>
    controller.handleIpc({
      local,
      sender,
      browserWindow,
      command,
      args,
      ...overrides,
    });

  return { browserWindow, calls, controller, handle, invoke, sender };
};

describe("desktop MCP App binary save controller", () => {
  test("publishes a confirmed file through an exclusive durable temporary file", async () => {
    const harness = createHarness();
    const result = await harness.invoke(
      DESKTOP_BINARY_SAVE_COMMAND,
      requestArgs("success"),
    );

    assert.deepEqual(result, { saved: true, cancelled: false });
    assert.deepEqual(harness.calls, [
      ["open", "/tmp/.openchamber-export-123-test-uuid.tmp", "wx", 0o600],
      "write",
      "sync",
      "close",
      [
        "rename",
        "/tmp/.openchamber-export-123-test-uuid.tmp",
        "/tmp/canvas.svg",
      ],
    ]);
    assert.equal(harness.controller.pendingCount(), 0);
  });

  test("Abort while the native dialog waits prevents a later confirmation from touching disk", async () => {
    let resolveDialog;
    const dialogResult = new Promise((resolve) => {
      resolveDialog = resolve;
    });
    const harness = createHarness({ showSaveDialog: () => dialogResult });
    const saving = harness.invoke(
      DESKTOP_BINARY_SAVE_COMMAND,
      requestArgs("delayed-abort"),
    );
    assert.equal(harness.controller.pendingCount(), 1);

    assert.deepEqual(
      await harness.invoke(DESKTOP_BINARY_SAVE_CANCEL_COMMAND, {
        requestId: "delayed-abort",
      }),
      { cancelled: true },
    );
    assert.equal(harness.controller.pendingCount(), 0);
    resolveDialog({ canceled: false, filePath: "/tmp/canvas.svg" });

    assert.deepEqual(await saving, { saved: false, cancelled: true });
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.controller.pendingCount(), 0);
  });

  test("a cancelled native dialog never opens or publishes a file", async () => {
    const harness = createHarness({
      showSaveDialog: async () => ({ canceled: true }),
    });

    assert.deepEqual(
      await harness.invoke(
        DESKTOP_BINARY_SAVE_COMMAND,
        requestArgs("dialog-cancel"),
      ),
      { saved: false, cancelled: true },
    );
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.controller.pendingCount(), 0);
  });

  test("closing the owner window cancels and releases a pending dialog transaction", async () => {
    let resolveDialog;
    const dialogResult = new Promise((resolve) => {
      resolveDialog = resolve;
    });
    const harness = createHarness({ showSaveDialog: () => dialogResult });
    const saving = harness.invoke(
      DESKTOP_BINARY_SAVE_COMMAND,
      requestArgs("window-close"),
    );

    assert.equal(harness.controller.pendingCount(), 1);
    harness.browserWindow.close();
    assert.equal(harness.controller.pendingCount(), 0);
    resolveDialog({ canceled: false, filePath: "/tmp/canvas.svg" });

    assert.deepEqual(await saving, { saved: false, cancelled: true });
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.controller.pendingCount(), 0);
  });

  test("a non-local sender is rejected before dialog or filesystem access", async () => {
    let dialogs = 0;
    const harness = createHarness({
      showSaveDialog: async () => {
        dialogs += 1;
        return { canceled: false, filePath: "/tmp/canvas.svg" };
      },
    });

    await assert.rejects(
      harness.invoke(
        DESKTOP_BINARY_SAVE_COMMAND,
        requestArgs("remote"),
        false,
      ),
      /IPC not available for this origin/,
    );
    assert.equal(dialogs, 0);
    assert.deepEqual(harness.calls, []);
    assert.equal(harness.controller.pendingCount(), 0);
  });

  test("validation failures release request and per-window ownership", async () => {
    const harness = createHarness();
    await assert.rejects(
      harness.invoke(DESKTOP_BINARY_SAVE_COMMAND, {
        ...requestArgs("invalid-name"),
        defaultFileName: "../escape.svg",
      }),
      /safe default file name/,
    );
    assert.equal(harness.controller.pendingCount(), 0);

    // A released owner can immediately start another transaction.
    assert.deepEqual(
      await harness.invoke(
        DESKTOP_BINARY_SAVE_COMMAND,
        requestArgs("after-validation-error"),
      ),
      { saved: true, cancelled: false },
    );
    assert.equal(harness.controller.pendingCount(), 0);
  });

  test("cancellation during a temporary write prevents rename and removes the temporary file", async () => {
    let resolveWrite;
    let notifyWriteStarted;
    const writeStarted = new Promise((resolve) => {
      notifyWriteStarted = resolve;
    });
    const harness = createHarness();
    harness.handle.writeFile = async () => {
      harness.calls.push("write");
      notifyWriteStarted();
      await new Promise((resolve) => {
        resolveWrite = resolve;
      });
    };

    const saving = harness.invoke(
      DESKTOP_BINARY_SAVE_COMMAND,
      requestArgs("write-abort"),
    );
    await writeStarted;
    assert.deepEqual(
      await harness.invoke(DESKTOP_BINARY_SAVE_CANCEL_COMMAND, {
        requestId: "write-abort",
      }),
      { cancelled: true },
    );
    resolveWrite();

    assert.deepEqual(await saving, { saved: false, cancelled: true });
    assert.equal(
      harness.calls.some((entry) => Array.isArray(entry) && entry[0] === "rename"),
      false,
    );
    assert.equal(
      harness.calls.some((entry) => Array.isArray(entry) && entry[0] === "unlink"),
      true,
    );
    assert.equal(harness.controller.pendingCount(), 0);
  });

  test("another renderer cannot cancel an active request by guessing its ID", async () => {
    let resolveDialog;
    const dialogResult = new Promise((resolve) => {
      resolveDialog = resolve;
    });
    const harness = createHarness({ showSaveDialog: () => dialogResult });
    const saving = harness.invoke(
      DESKTOP_BINARY_SAVE_COMMAND,
      requestArgs("owner-bound"),
    );
    const otherSender = new LifecycleTarget();

    assert.deepEqual(
      await harness.controller.handleIpc({
        local: true,
        sender: otherSender,
        browserWindow: harness.browserWindow,
        command: DESKTOP_BINARY_SAVE_CANCEL_COMMAND,
        args: { requestId: "owner-bound" },
      }),
      { cancelled: false },
    );
    resolveDialog({ canceled: true });
    await saving;
    assert.equal(harness.controller.pendingCount(), 0);
  });
});
