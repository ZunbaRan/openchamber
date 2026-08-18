import { randomUUID as defaultRandomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";

export const DESKTOP_BINARY_SAVE_COMMAND = "desktop_save_binary_file";
export const DESKTOP_BINARY_SAVE_CANCEL_COMMAND =
  "desktop_cancel_binary_file_save";

const SAFE_EXPORT_EXTENSIONS = new Set([
  "csv",
  "excalidraw",
  "gif",
  "jpeg",
  "jpg",
  "json",
  "log",
  "md",
  "markdown",
  "pdf",
  "png",
  "svg",
  "tldr",
  "tldraw",
  "tsv",
  "txt",
  "webp",
  "xml",
  "yaml",
  "yml",
]);

const MAX_BINARY_BYTES = 20 * 1024 * 1024;
const MAX_REQUEST_ID_LENGTH = 128;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]+$/;

const cancelledResult = () => ({ saved: false, cancelled: true });

const isSafeRequestId = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= MAX_REQUEST_ID_LENGTH &&
  REQUEST_ID_PATTERN.test(value);

const addOnceListener = (target, event, listener) => {
  if (!target || typeof target.once !== "function") return () => {};
  target.once(event, listener);
  return () => {
    if (typeof target.removeListener === "function") {
      target.removeListener(event, listener);
    } else if (typeof target.off === "function") {
      target.off(event, listener);
    }
  };
};

const isDestroyed = (target) => {
  try {
    return typeof target?.isDestroyed === "function" && target.isDestroyed();
  } catch {
    return true;
  }
};

export const isDesktopBinarySaveCommand = (command) =>
  command === DESKTOP_BINARY_SAVE_COMMAND ||
  command === DESKTOP_BINARY_SAVE_CANCEL_COMMAND;

/**
 * Owns the complete native MCP App binary-save transaction. Dependencies are
 * injectable so the IPC trust boundary, dialog races, and filesystem publish
 * ordering can be executed directly without booting Electron in unit tests.
 */
export const createDesktopBinarySaveController = ({
  showSaveDialog,
  openFile = (...args) => fsp.open(...args),
  renameFile = (...args) => fsp.rename(...args),
  unlinkFile = (...args) => fsp.unlink(...args),
  dirname = path.dirname,
  extname = path.extname,
  basename = path.basename,
  join = path.join,
  randomUUID = defaultRandomUUID,
  processId = process.pid,
} = {}) => {
  if (typeof showSaveDialog !== "function") {
    throw new TypeError("showSaveDialog is required");
  }

  const operationsByRequestId = new Map();
  const activeOperationByOwner = new WeakMap();

  const releaseOperation = (operation) => {
    if (operationsByRequestId.get(operation.requestId) === operation) {
      operationsByRequestId.delete(operation.requestId);
    }
    if (activeOperationByOwner.get(operation.owner) === operation) {
      activeOperationByOwner.delete(operation.owner);
    }
    for (const removeListener of operation.removeLifecycleListeners.splice(0)) {
      removeListener();
    }
  };

  const cancelOperation = (operation, { release = false } = {}) => {
    operation.cancelled = true;
    if (operationsByRequestId.get(operation.requestId) === operation) {
      operationsByRequestId.delete(operation.requestId);
    }
    if (release) releaseOperation(operation);
  };

  const operationIsCancelled = (operation) =>
    operation.cancelled ||
    isDestroyed(operation.sender) ||
    isDestroyed(operation.browserWindow);

  const registerOperation = ({ requestId, sender, browserWindow }) => {
    if (!isSafeRequestId(requestId)) {
      throw new Error("A valid binary save request ID is required");
    }
    if (!sender || (typeof sender !== "object" && typeof sender !== "function")) {
      throw new Error("Binary save sender is required");
    }
    if (operationsByRequestId.has(requestId)) {
      throw new Error("Binary save request ID is already active");
    }

    const owner = browserWindow || sender;
    if (activeOperationByOwner.has(owner)) {
      throw new Error("Another MCP App export is already awaiting confirmation");
    }

    const operation = {
      requestId,
      sender,
      browserWindow,
      owner,
      cancelled: false,
      removeLifecycleListeners: [],
    };
    operationsByRequestId.set(requestId, operation);
    activeOperationByOwner.set(owner, operation);

    const cancelForClosedOwner = () => cancelOperation(operation, { release: true });
    operation.removeLifecycleListeners.push(
      addOnceListener(sender, "destroyed", cancelForClosedOwner),
    );
    if (browserWindow && browserWindow !== sender) {
      operation.removeLifecycleListeners.push(
        addOnceListener(browserWindow, "closed", cancelForClosedOwner),
      );
    }
    return operation;
  };

  const cancel = ({ requestId, sender, browserWindow }) => {
    if (!isSafeRequestId(requestId)) return { cancelled: false };
    const operation = operationsByRequestId.get(requestId);
    if (!operation) return { cancelled: false };

    // A request ID is not an authorization token. Cancellation must come from
    // the exact renderer/window that owns the native dialog.
    if (
      operation.sender !== sender ||
      operation.browserWindow !== browserWindow
    ) {
      return { cancelled: false };
    }
    cancelOperation(operation);
    return { cancelled: true };
  };

  const save = async ({ sender, browserWindow, args = {} }) => {
    const operation = registerOperation({
      requestId: args.requestId,
      sender,
      browserWindow,
    });
    let temporaryPath = null;
    let temporaryHandle = null;
    try {
      const defaultFileName =
        typeof args.defaultFileName === "string"
          ? args.defaultFileName.trim()
          : "";
      if (
        !defaultFileName ||
        defaultFileName.length > 160 ||
        Buffer.byteLength(defaultFileName, "utf8") > 240 ||
        basename(defaultFileName) !== defaultFileName ||
        defaultFileName.normalize("NFKC") !== defaultFileName ||
        /[\p{Cf}\x00-\x1f\x7f\\/:*?"<>|]/u.test(defaultFileName) ||
        /[. ]$/.test(defaultFileName) ||
        /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(
          defaultFileName,
        )
      ) {
        throw new Error("A safe default file name is required");
      }

      const requestedExtension = extname(defaultFileName)
        .slice(1)
        .toLowerCase();
      if (!SAFE_EXPORT_EXTENSIONS.has(requestedExtension)) {
        throw new Error("This MCP App file type is not allowed");
      }

      // The per-window operation was registered before inspecting or decoding
      // the untrusted payload. This bounds both dialogs and validation copies.
      const rawEncoded =
        typeof args.contentBase64 === "string" ? args.contentBase64 : "";
      if (
        rawEncoded.length > Math.ceil((MAX_BINARY_BYTES * 4) / 3) + 4
      ) {
        throw new Error("Binary file content is invalid or too large");
      }
      const encoded = rawEncoded.replace(/\s+/g, "");
      if (
        encoded.length % 4 !== 0 ||
        encoded.length > Math.ceil((MAX_BINARY_BYTES * 4) / 3) + 4 ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)
      ) {
        throw new Error("Binary file content is invalid or too large");
      }

      const mimeType =
        typeof args.mimeType === "string" && args.mimeType.trim()
          ? args.mimeType.trim().slice(0, 120)
          : "application/octet-stream";
      if (
        !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]{0,63}$/.test(
          mimeType,
        )
      ) {
        throw new Error("Binary file MIME type is invalid");
      }

      const result = await showSaveDialog(browserWindow || undefined, {
        title: "Save untrusted MCP App export",
        message:
          "OpenLoop will save this MCP App file but will not open or execute it.",
        defaultPath: defaultFileName,
        filters: [
          { name: `MCP App ${mimeType}`, extensions: [requestedExtension] },
        ],
      });

      // Abort can arrive while the native dialog is waiting. Never trust a
      // subsequently confirmed path until the owning request is still live.
      if (
        operationIsCancelled(operation) ||
        result?.canceled ||
        !result?.filePath
      ) {
        return cancelledResult();
      }

      const selectedExtension = extname(result.filePath)
        .slice(1)
        .toLowerCase();
      if (!SAFE_EXPORT_EXTENSIONS.has(selectedExtension)) {
        throw new Error("The selected MCP App export file type is not allowed");
      }

      const bytes = Buffer.from(encoded, "base64");
      if (bytes.length > MAX_BINARY_BYTES) {
        throw new Error("Binary file content is invalid or too large");
      }

      if (operationIsCancelled(operation)) return cancelledResult();
      const destinationDirectory = dirname(result.filePath);
      temporaryPath = join(
        destinationDirectory,
        `.openchamber-export-${processId}-${randomUUID()}.tmp`,
      );

      // Re-check after every awaited filesystem boundary. A cancellation that
      // loses a race with a temporary write may create no destination entry;
      // the finally block removes the unpublished temporary file.
      if (operationIsCancelled(operation)) return cancelledResult();
      temporaryHandle = await openFile(temporaryPath, "wx", 0o600);
      if (operationIsCancelled(operation)) return cancelledResult();
      await temporaryHandle.writeFile(bytes);
      if (operationIsCancelled(operation)) return cancelledResult();
      await temporaryHandle.sync();
      if (operationIsCancelled(operation)) return cancelledResult();
      await temporaryHandle.close();
      temporaryHandle = null;
      if (operationIsCancelled(operation)) return cancelledResult();
      await renameFile(temporaryPath, result.filePath);
      temporaryPath = null;
      return { saved: true, cancelled: false };
    } finally {
      if (temporaryHandle) {
        await temporaryHandle.close().catch(() => {});
      }
      if (temporaryPath) {
        await unlinkFile(temporaryPath).catch(() => {});
      }
      releaseOperation(operation);
    }
  };

  const handleIpc = async ({
    local,
    sender,
    browserWindow,
    command,
    args = {},
  }) => {
    if (local !== true) {
      throw new Error("IPC not available for this origin");
    }
    if (command === DESKTOP_BINARY_SAVE_CANCEL_COMMAND) {
      return cancel({ requestId: args.requestId, sender, browserWindow });
    }
    if (command === DESKTOP_BINARY_SAVE_COMMAND) {
      return save({ sender, browserWindow, args });
    }
    throw new Error("Unsupported desktop binary save command");
  };

  return {
    cancel,
    handleIpc,
    pendingCount: () => operationsByRequestId.size,
  };
};
