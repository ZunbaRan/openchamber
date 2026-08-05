#!/usr/bin/env node
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOSTED_RELEASE_SLOTS,
  assertHostedReleaseAssets,
  readHostedReleaseState,
  writeHostedReleaseState,
} from "./release-state.mjs";

const defaultAssetRoot =
  process.env.HOSTED_ASSET_ROOT ||
  resolve(fileURLToPath(new URL("./hosted-ops", import.meta.url)));
const stateFile =
  process.env.HOSTED_RELEASE_STATE_FILE || "/data/active-release.json";
const command = process.argv[2] || "status";

async function status() {
  const state = await readHostedReleaseState({ stateFile });
  const assets = await assertHostedReleaseAssets({
    assetRoot: defaultAssetRoot,
    slot: state.slot,
  });
  process.stdout.write(
    `${JSON.stringify(
      {
        activeSlot: state.slot,
        version: state.version,
        persisted: state.persisted,
        updatedAt: state.updatedAt || null,
        resourceCount: assets.resourceCount,
      },
      null,
      2,
    )}\n`,
  );
}

if (command === "status") {
  await status();
} else if (command === "set") {
  const slot = process.argv[3];
  if (!HOSTED_RELEASE_SLOTS.includes(slot)) {
    throw new Error(
      `Usage: release-admin.mjs set <${HOSTED_RELEASE_SLOTS.join("|")}>`,
    );
  }
  await assertHostedReleaseAssets({
    assetRoot: defaultAssetRoot,
    slot,
  });
  await writeHostedReleaseState({ stateFile, slot });
  await status();
} else {
  throw new Error(
    `Usage: release-admin.mjs <status|set <${HOSTED_RELEASE_SLOTS.join("|")}>>`,
  );
}
