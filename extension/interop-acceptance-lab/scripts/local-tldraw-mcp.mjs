#!/usr/bin/env node
import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

const repository = process.env.INTEROP_TLDRAW_MCP_REPO_DIR?.trim();

if (!repository) {
  throw new Error(
    [
      "The tldraw MCP App lifecycle is owned by its independent repository.",
      "Set INTEROP_TLDRAW_MCP_REPO_DIR to that checkout, then run this compatibility shim again,",
      'or run "npm run start|stop|status" directly in tldraw-mcp-app.',
    ].join(" "),
  );
}

const command = process.argv[2] || "status";
if (!new Set(["start", "stop", "status"]).has(command)) {
  throw new Error(
    "Usage: INTEROP_TLDRAW_MCP_REPO_DIR=/path/to/tldraw-mcp-app node scripts/local-tldraw-mcp.mjs start|stop|status",
  );
}

const repositoryRoot = resolve(repository);
const managerPath = join(repositoryRoot, "scripts", "service.mjs");
await stat(managerPath).catch(() => {
  throw new Error(`No tldraw-mcp-app service manager found at ${managerPath}`);
});

const child = spawn(process.execPath, [managerPath, command], {
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
