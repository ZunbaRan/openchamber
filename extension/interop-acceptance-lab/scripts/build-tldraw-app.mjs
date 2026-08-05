#!/usr/bin/env node
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const repository = process.env.INTEROP_TLDRAW_MCP_REPO_DIR?.trim();

if (!repository) {
  throw new Error(
    [
      "The tldraw MCP App build is owned by its independent repository.",
      "Set INTEROP_TLDRAW_MCP_REPO_DIR to that checkout, then run this compatibility shim again,",
      'or run "npm run build:app" directly in tldraw-mcp-app.',
    ].join(" "),
  );
}

const repositoryRoot = resolve(repository);
const packagePath = join(repositoryRoot, "package.json");
await stat(packagePath).catch(() => {
  throw new Error(`No tldraw-mcp-app package found at ${repositoryRoot}`);
});

const script =
  process.argv.includes("--bootstrap") ||
  process.env.ALLOW_FULL_TLDRAW_INSTALL === "1"
    ? "bootstrap:app"
    : "build:app";

const child = spawn("npm", ["run", script], {
  cwd: repositoryRoot,
  env: process.env,
  stdio: "inherit",
});

const result = await new Promise((resolveChild, rejectChild) => {
  child.once("error", rejectChild);
  child.once("exit", (code, signal) => resolveChild({ code, signal }));
});

if (result.signal) process.kill(process.pid, result.signal);
process.exitCode = result.code ?? 1;
