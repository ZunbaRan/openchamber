import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  HOSTED_RELEASE_STATE_SCHEMA,
  writeHostedReleaseState,
} from "./release-state.mjs";

const serverFile = fileURLToPath(new URL("./server.mjs", import.meta.url));
const slots = new Map([
  ["1.0.0", "1.0.0"],
  ["1.0.1", "1.0.1"],
  ["1.1.0", "1.1.0"],
  ["tampered", "1.0.0"],
]);
const resourceFiles = [
  "overview.view.json",
  "incident-detail.view.json",
  "topology.html",
];

async function freePort() {
  const listener = net.createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const address = listener.address();
  listener.close();
  await once(listener, "close");
  return address.port;
}

async function createAssets(assetRoot) {
  for (const [slot, version] of slots) {
    const resourcesRoot = join(assetRoot, "channels", slot, "resources");
    await mkdir(resourcesRoot, { recursive: true });
    for (const filename of resourceFiles) {
      await writeFile(
        join(resourcesRoot, filename),
        `${slot}:${filename}\n`,
      );
    }
    await writeFile(
      join(assetRoot, "channels", slot, "openchamber.hosted.json"),
      `${JSON.stringify({
        $schema: "openchamber://hosted-ocix-manifest/v1",
        app: {
          id: "com.openchamber.interop.hosted-ops",
          version,
          publishedAt: "2026-07-30T00:00:00.000Z",
        },
        permissions: {},
        extension: {},
        resources: resourceFiles.map((filename) => ({
          path: `fixture/${filename}`,
          url: `https://lab.invalid/hosted/ops/resources/${filename}`,
          mimeType: "text/plain",
          sha256: "sha256-fixture",
        })),
        signature: {
          algorithm: "ed25519",
          keyId: "fixture",
          value: "fixture",
        },
      })}\n`,
    );
  }
}

async function startServer({ assetRoot, stateFile, port }) {
  const child = spawn(process.execPath, [serverFile], {
    env: {
      ...process.env,
      HOST: "127.0.0.1",
      PORT: String(port),
      MODE: "hosted-ops",
      HOSTED_ASSET_ROOT: assetRoot,
      HOSTED_RELEASE_STATE_FILE: stateFile,
      HOSTED_OPS_API_KEY: "integration-write-key",
      HOSTED_OPS_READ_ONLY_KEY: "integration-read-key",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Fixture server exited early: ${stderr}`);
    }
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return { child, stderr: () => stderr };
    } catch {
      // The listener is not ready yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  child.kill("SIGTERM");
  throw new Error(`Fixture server did not become ready: ${stderr}`);
}

async function stopServer(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await once(child, "exit");
}

test("stable Hosted URLs follow an atomic persisted selection across restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "ocix-release-server-"));
  const assetRoot = join(root, "assets");
  const stateFile = join(root, "state", "active-release.json");
  await createAssets(assetRoot);
  const port = await freePort();
  let running = await startServer({ assetRoot, stateFile, port });
  try {
    const baselineHealth = await (
      await fetch(`http://127.0.0.1:${port}/health`)
    ).json();
    assert.deepEqual(baselineHealth.activeHostedRelease, {
      slot: "1.0.0",
      version: "1.0.0",
      persisted: false,
    });

    const baselineManifest = await (
      await fetch(
        `http://127.0.0.1:${port}/hosted/ops/openchamber.hosted.json`,
      )
    ).json();
    assert.equal(baselineManifest.app.version, "1.0.0");
    assert.equal(
      (
        await fetch(
          `http://127.0.0.1:${port}/hosted/ops/admin/release`,
          { headers: { authorization: "Bearer integration-write-key" } },
        )
      ).status,
      404,
    );

    await writeHostedReleaseState({
      stateFile,
      slot: "1.0.1",
      updatedAt: "2026-07-30T00:00:00.000Z",
    });
    const updatedManifestResponse = await fetch(
      `http://127.0.0.1:${port}/hosted/manifest.json`,
    );
    assert.equal(updatedManifestResponse.headers.get("cache-control"), "no-store");
    assert.equal(
      updatedManifestResponse.headers.get("x-ocix-active-release"),
      "1.0.1",
    );
    assert.equal((await updatedManifestResponse.json()).app.version, "1.0.1");
    assert.equal(
      await (
        await fetch(
          `http://127.0.0.1:${port}/hosted/resources/topology.html`,
        )
      ).text(),
      "1.0.1:topology.html\n",
    );
  } finally {
    await stopServer(running.child);
  }

  running = await startServer({ assetRoot, stateFile, port });
  try {
    const recoveredHealth = await (
      await fetch(`http://127.0.0.1:${port}/health`)
    ).json();
    assert.deepEqual(recoveredHealth.activeHostedRelease, {
      slot: "1.0.1",
      version: "1.0.1",
      persisted: true,
    });

    await writeFile(
      stateFile,
      `${JSON.stringify({
        $schema: HOSTED_RELEASE_STATE_SCHEMA,
        activeSlot: "unsupported",
      })}\n`,
    );
    const invalidStateResponse = await fetch(
      `http://127.0.0.1:${port}/health`,
    );
    assert.equal(invalidStateResponse.status, 503);
    assert.deepEqual(await invalidStateResponse.json(), {
      error: "hosted_release_unavailable",
    });
  } finally {
    await stopServer(running.child);
  }
});
