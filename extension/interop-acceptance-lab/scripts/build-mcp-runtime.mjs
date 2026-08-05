#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const runtimeRoot = join(labRoot, ".runtime");
const targetArgument = process.argv.find((argument) =>
  argument.startsWith("--target="),
);
const target = targetArgument?.slice("--target=".length) || "all";
if (!new Set(["all", "legacy"]).has(target)) {
  throw new Error(
    "--target must be all or legacy; tldraw-mcp-app now owns its server build",
  );
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      stdio: "inherit",
    });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${String(code)}`));
    });
  });
}

async function prepareWorkspace(name, sourceDirectory) {
  const directory = join(runtimeRoot, "build", name);
  await rm(directory, { recursive: true, force: true });
  await mkdir(directory, { recursive: true });
  await copyFile(join(sourceDirectory, "build-package.json"), join(directory, "package.json"));
  await copyFile(
    join(sourceDirectory, "build-package-lock.json"),
    join(directory, "package-lock.json"),
  );
  await run(
    "npm",
    ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
    { cwd: directory },
  );
  return directory;
}

const metadataPath = join(runtimeRoot, "images", "mcp-build-metadata.json");
let metadata = {};
try {
  metadata = JSON.parse(await readFile(metadataPath, "utf8"));
} catch {
  metadata = {};
}
delete metadata.modern;
delete metadata.tldraw;

if (target === "all" || target === "legacy") {
  const legacySource = join(labRoot, "services", "legacy-mcp");
  const legacyBuild = await prepareWorkspace("legacy-mcp", legacySource);
  await copyFile(
    join(legacySource, "source", "server.mjs"),
    join(legacyBuild, "server.mjs"),
  );
  const legacyOutput = join(runtimeRoot, "images", "legacy-mcp");
  await rm(legacyOutput, { recursive: true, force: true });
  await mkdir(legacyOutput, { recursive: true });
  await run(
    "bun",
    [
      "build",
      join(legacyBuild, "server.mjs"),
      "--target=node",
      "--format=esm",
      "--minify",
      `--outfile=${join(legacyOutput, "server.mjs")}`,
    ],
    { cwd: legacyBuild },
  );
  await copyFile(
    join(
      legacyBuild,
      "node_modules",
      "@modelcontextprotocol",
      "server-everything",
      "dist",
      "instructions.md",
    ),
    join(legacyOutput, "instructions.md"),
  );
  const legacyPackage = JSON.parse(
    await readFile(
      join(
        legacyBuild,
        "node_modules",
        "@modelcontextprotocol",
        "server-everything",
        "package.json",
      ),
      "utf8",
    ),
  );
  metadata.legacy = {
    package: `${legacyPackage.name}@${legacyPackage.version}`,
    gitHead: legacyPackage.gitHead,
  };
}

await mkdir(join(runtimeRoot, "images"), { recursive: true });
await writeFile(
  metadataPath,
  `${JSON.stringify(metadata, null, 2)}\n`,
);
console.log(`Prepared ${target} MCP runtime bundle${target === "all" ? "s" : ""}`);
