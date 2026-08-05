#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  copyFile,
  mkdir,
  rm,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = join(labRoot, "probes");
const buildRoot = join(labRoot, ".runtime", "build", "probes");
const outputRoot = join(labRoot, ".runtime", "probes");

function run(command, args, cwd) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd, stdio: "inherit" });
    child.once("error", rejectRun);
    child.once("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} exited with ${String(code)}`));
    });
  });
}

await rm(buildRoot, { recursive: true, force: true });
await rm(outputRoot, { recursive: true, force: true });
await mkdir(buildRoot, { recursive: true });
await mkdir(outputRoot, { recursive: true });
await copyFile(join(sourceRoot, "build-package.json"), join(buildRoot, "package.json"));
await copyFile(
  join(sourceRoot, "build-package-lock.json"),
  join(buildRoot, "package-lock.json"),
);
await copyFile(
  join(sourceRoot, "source", "probe-all.mjs"),
  join(buildRoot, "probe-all.mjs"),
);
await run(
  "npm",
  ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  buildRoot,
);
await run(
  "bun",
  [
    "build",
    join(buildRoot, "probe-all.mjs"),
    "--target=node",
    "--format=esm",
    `--outfile=${join(outputRoot, "probe-all.mjs")}`,
  ],
  buildRoot,
);
console.log(`Prepared protocol probes under ${outputRoot}`);

