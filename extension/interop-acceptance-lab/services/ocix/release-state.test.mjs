import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  DEFAULT_HOSTED_RELEASE_SLOT,
  HOSTED_RELEASE_STATE_SCHEMA,
  readHostedReleaseState,
  resolveHostedRootAsset,
  writeHostedReleaseState,
} from "./release-state.mjs";

test("missing state defaults to the 1.0.0 baseline", async () => {
  const root = await mkdtemp(join(tmpdir(), "ocix-release-state-"));
  assert.deepEqual(
    await readHostedReleaseState({
      stateFile: join(root, "active-release.json"),
    }),
    {
      slot: DEFAULT_HOSTED_RELEASE_SLOT,
      version: "1.0.0",
      persisted: false,
    },
  );
});

test("release selection is atomically persisted with private permissions", async () => {
  const root = await mkdtemp(join(tmpdir(), "ocix-release-state-"));
  const stateFile = join(root, "state", "active-release.json");
  const result = await writeHostedReleaseState({
    stateFile,
    slot: "1.0.1",
    updatedAt: "2026-07-30T00:00:00.000Z",
  });
  assert.equal(result.slot, "1.0.1");
  assert.equal(result.persisted, true);
  assert.equal((await stat(stateFile)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(stateFile, "utf8")), {
    $schema: HOSTED_RELEASE_STATE_SCHEMA,
    activeSlot: "1.0.1",
    updatedAt: "2026-07-30T00:00:00.000Z",
  });
});

test("malformed or unsupported persisted state fails closed", async () => {
  const root = await mkdtemp(join(tmpdir(), "ocix-release-state-"));
  const stateFile = join(root, "active-release.json");
  await writeFile(stateFile, '{"activeSlot":"unknown"}\n', { mode: 0o600 });
  await assert.rejects(
    readHostedReleaseState({ stateFile }),
    /invalid schema/,
  );
  await writeFile(
    stateFile,
    `${JSON.stringify({
      $schema: HOSTED_RELEASE_STATE_SCHEMA,
      activeSlot: "unknown",
    })}\n`,
  );
  await assert.rejects(
    readHostedReleaseState({ stateFile }),
    /Unsupported Hosted OCIX release slot/,
  );
});

test("root manifest and resource routes resolve through the active channel", () => {
  assert.deepEqual(
    resolveHostedRootAsset(
      "/hosted/ops/openchamber.hosted.json",
      "1.1.0",
    ),
    {
      relativePath: "channels/1.1.0/openchamber.hosted.json",
      contentType: "application/json; charset=utf-8",
      cacheControl: "no-store",
    },
  );
  assert.deepEqual(
    resolveHostedRootAsset("/hosted/resources/topology.html", "tampered"),
    {
      relativePath: "channels/tampered/resources/topology.html",
      contentType: "text/html; charset=utf-8",
      cacheControl: "no-store",
    },
  );
  assert.equal(
    resolveHostedRootAsset("/hosted/resources/not-allowed.js", "1.0.0"),
    null,
  );
});
