#!/usr/bin/env node
import crypto from "node:crypto";
import { createReadStream } from "node:fs";
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = join(labRoot, ".runtime");
const downloadRoot = join(runtimeRoot, "downloads");
const outputRoot = join(runtimeRoot, "vendor", "excalidraw");
const assetPath = join(downloadRoot, "excalidraw-mcp-app-v0.3.2.mcpb");
const url =
  "https://github.com/excalidraw/excalidraw-mcp/releases/download/v0.3.2/excalidraw-mcp-app.mcpb";
const expected =
  "2b494012b5fee5937f9f7b86f04a76cc4a91ec843ee3339b93e4e15e415274ff";

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${String(code)}`));
    });
  });
}

async function digest(pathname) {
  const hash = crypto.createHash("sha256");
  await pipeline(createReadStream(pathname), hash);
  return hash.digest("hex");
}

await mkdir(downloadRoot, { recursive: true });
let validCachedAsset = false;
try {
  validCachedAsset = (await digest(assetPath)) === expected;
} catch {
  validCachedAsset = false;
}
if (!validCachedAsset) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Excalidraw release download failed with HTTP ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body), await import("node:fs").then((fs) => fs.createWriteStream(assetPath)));
}
const actual = await digest(assetPath);
if (actual !== expected) {
  throw new Error(`Excalidraw release SHA-256 mismatch: ${actual}`);
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
await run("unzip", ["-q", assetPath, "-d", outputRoot]);
const packageDocument = JSON.parse(
  await readFile(join(outputRoot, "package.json"), "utf8"),
);
if (packageDocument.version !== "0.3.2") {
  throw new Error(`Unexpected Excalidraw package version ${packageDocument.version}`);
}
const distIndexPath = join(outputRoot, "dist", "index.js");
const appHtmlPath = join(outputRoot, "dist", "mcp-app.html");
await readFile(distIndexPath);
await readFile(appHtmlPath);
await writeFile(
  join(outputRoot, "openchamber-provenance.json"),
  `${JSON.stringify(
    {
      repository: "https://github.com/excalidraw/excalidraw-mcp",
      release: "v0.3.2",
      commit: "a617657e56337bf195a27612b9d595e539e35c55",
      asset: "excalidraw-mcp-app.mcpb",
      sha256: actual,
      packageVersion: packageDocument.version,
      distIndexSha256: await digest(distIndexPath),
      appHtmlSha256: await digest(appHtmlPath),
      officialRemote: "https://mcp.excalidraw.com/mcp",
    },
    null,
    2,
  )}\n`,
);
console.log(`Prepared official Excalidraw MCP v0.3.2 under ${outputRoot}`);
