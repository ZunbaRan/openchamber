import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
  rm,
} from "node:fs/promises";
import { dirname, join } from "node:path";

export const HOSTED_RELEASE_STATE_SCHEMA =
  "openchamber://interop-hosted-release-state/v1";
export const DEFAULT_HOSTED_RELEASE_SLOT = "1.0.0";
export const HOSTED_RELEASE_SLOTS = Object.freeze([
  "1.0.0",
  "1.0.1",
  "1.1.0",
  "tampered",
]);

const SLOT_VERSIONS = Object.freeze({
  "1.0.0": "1.0.0",
  "1.0.1": "1.0.1",
  "1.1.0": "1.1.0",
  tampered: "1.0.0",
});
const MAX_STATE_BYTES = 4096;
const MAX_MANIFEST_BYTES = 512 * 1024;

const ROOT_MANIFEST_PATHS = new Set([
  "/hosted/ops/openchamber.hosted.json",
  "/hosted/ops/manifest.json",
  "/hosted/manifest.json",
]);
const RESOURCE_CONTENT_TYPES = new Map([
  ["overview.view.json", "application/json; charset=utf-8"],
  ["incident-detail.view.json", "application/json; charset=utf-8"],
  ["topology.html", "text/html; charset=utf-8"],
]);

export class HostedReleaseStateError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HostedReleaseStateError";
    this.code = code;
  }
}

function validateSlot(slot) {
  if (!HOSTED_RELEASE_SLOTS.includes(slot)) {
    throw new HostedReleaseStateError(
      "invalid_hosted_release_slot",
      `Unsupported Hosted OCIX release slot: ${String(slot)}`,
    );
  }
  return slot;
}

async function assertRegularFile(path, errorCode) {
  let stat;
  try {
    stat = await lstat(path);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new HostedReleaseStateError(errorCode, `Missing file: ${path}`);
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new HostedReleaseStateError(
      errorCode,
      `Expected a regular non-symlink file: ${path}`,
    );
  }
  return stat;
}

export async function readHostedReleaseState({
  stateFile,
  defaultSlot = DEFAULT_HOSTED_RELEASE_SLOT,
}) {
  validateSlot(defaultSlot);
  let stat;
  try {
    stat = await lstat(stateFile);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        slot: defaultSlot,
        version: SLOT_VERSIONS[defaultSlot],
        persisted: false,
      };
    }
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_STATE_BYTES) {
    throw new HostedReleaseStateError(
      "invalid_hosted_release_state",
      "Hosted release state must be a small regular non-symlink file",
    );
  }
  let state;
  try {
    state = JSON.parse(await readFile(stateFile, "utf8"));
  } catch {
    throw new HostedReleaseStateError(
      "invalid_hosted_release_state",
      "Hosted release state is not valid JSON",
    );
  }
  if (
    !state ||
    typeof state !== "object" ||
    Array.isArray(state) ||
    state.$schema !== HOSTED_RELEASE_STATE_SCHEMA
  ) {
    throw new HostedReleaseStateError(
      "invalid_hosted_release_state",
      "Hosted release state has an invalid schema",
    );
  }
  const slot = validateSlot(state.activeSlot);
  return {
    slot,
    version: SLOT_VERSIONS[slot],
    persisted: true,
    updatedAt:
      typeof state.updatedAt === "string" && state.updatedAt
        ? state.updatedAt
        : undefined,
  };
}

export async function writeHostedReleaseState({
  stateFile,
  slot,
  updatedAt = new Date().toISOString(),
}) {
  validateSlot(slot);
  const stateDirectory = dirname(stateFile);
  await mkdir(stateDirectory, { recursive: true, mode: 0o700 });
  const body = `${JSON.stringify(
    {
      $schema: HOSTED_RELEASE_STATE_SCHEMA,
      activeSlot: slot,
      updatedAt,
    },
    null,
    2,
  )}\n`;
  const temporaryPath = join(
    stateDirectory,
    `.active-release.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(body, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporaryPath, stateFile);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
  await chmod(stateFile, 0o600);
  const directoryHandle = await open(stateDirectory, "r");
  try {
    await directoryHandle.sync();
  } finally {
    await directoryHandle.close();
  }
  return readHostedReleaseState({ stateFile });
}

export function resolveHostedRootAsset(pathname, slot) {
  validateSlot(slot);
  if (ROOT_MANIFEST_PATHS.has(pathname)) {
    return {
      relativePath: `channels/${slot}/openchamber.hosted.json`,
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store",
    };
  }
  const resourceMatch = pathname.match(
    /^\/hosted(?:\/ops)?\/resources\/([^/]+)$/,
  );
  if (!resourceMatch) return null;
  const filename = resourceMatch[1];
  const contentType = RESOURCE_CONTENT_TYPES.get(filename);
  if (!contentType) return null;
  return {
    relativePath: `channels/${slot}/resources/${filename}`,
    contentType,
    cacheControl: "no-store",
  };
}

export async function assertHostedReleaseAssets({ assetRoot, slot }) {
  validateSlot(slot);
  const channelRoot = join(assetRoot, "channels", slot);
  const manifestPath = join(channelRoot, "openchamber.hosted.json");
  const manifestStat = await assertRegularFile(
    manifestPath,
    "hosted_release_assets_missing",
  );
  if (manifestStat.size > MAX_MANIFEST_BYTES) {
    throw new HostedReleaseStateError(
      "hosted_release_assets_invalid",
      "Hosted release manifest exceeds the lab ceiling",
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  } catch {
    throw new HostedReleaseStateError(
      "hosted_release_assets_invalid",
      "Hosted release manifest is not valid JSON",
    );
  }
  if (
    manifest?.$schema !== "openchamber://hosted-ocix-manifest/v1" ||
    manifest?.app?.version !== SLOT_VERSIONS[slot] ||
    !Array.isArray(manifest.resources) ||
    manifest.resources.length !== RESOURCE_CONTENT_TYPES.size ||
    manifest?.signature?.algorithm !== "ed25519"
  ) {
    throw new HostedReleaseStateError(
      "hosted_release_assets_invalid",
      "Hosted release manifest identity is invalid",
    );
  }
  const resourceFiles = new Set();
  for (const resource of manifest.resources) {
    let resourceUrl;
    try {
      resourceUrl = new URL(resource.url);
    } catch {
      throw new HostedReleaseStateError(
        "hosted_release_assets_invalid",
        "Hosted release resource URL is invalid",
      );
    }
    const match = resourceUrl.pathname.match(
      /\/hosted\/ops\/resources\/([^/]+)$/,
    );
    const filename = match?.[1];
    if (!filename || !RESOURCE_CONTENT_TYPES.has(filename)) {
      throw new HostedReleaseStateError(
        "hosted_release_assets_invalid",
        "Hosted release resources must use the stable root URL",
      );
    }
    if (resourceFiles.has(filename)) {
      throw new HostedReleaseStateError(
        "hosted_release_assets_invalid",
        "Hosted release manifest contains duplicate resources",
      );
    }
    resourceFiles.add(filename);
    await assertRegularFile(
      join(channelRoot, "resources", filename),
      "hosted_release_assets_missing",
    );
  }
  if (resourceFiles.size !== RESOURCE_CONTENT_TYPES.size) {
    throw new HostedReleaseStateError(
      "hosted_release_assets_invalid",
      "Hosted release manifest is missing required resources",
    );
  }
  return {
    slot,
    version: SLOT_VERSIONS[slot],
    manifestPath,
    resourceCount: manifest.resources.length,
  };
}
