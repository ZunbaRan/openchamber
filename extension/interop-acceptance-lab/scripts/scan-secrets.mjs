#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const args = new Set(process.argv.slice(2));
const envDocument = await readFile(join(labRoot, ".env"), "utf8");

function parseEnv(document) {
  return Object.fromEntries(
    document
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

const env = parseEnv(envDocument);
const secretNames = [
  "LOCAL_CRM_API_KEY",
  "LOCAL_CRM_READ_ONLY_KEY",
  "HOSTED_OPS_API_KEY",
  "HOSTED_OPS_READ_ONLY_KEY",
];
const needles = secretNames.map((name) => {
  assert(env[name], `${name} is missing from .env`);
  return { name, value: env[name] };
});
const violations = [];
let scannedFiles = 0;
let scannedBytes = 0;

function scanText(label, text) {
  scannedBytes += Buffer.byteLength(text);
  for (const needle of needles) {
    if (text.includes(needle.value)) {
      violations.push({ label, credential: needle.name });
    }
  }
}

async function walk(directory, rootLabel, excluded = new Set()) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const pathname = join(directory, entry.name);
    const relativePath = relative(directory, pathname);
    if (excluded.has(entry.name)) continue;
    if (entry.isDirectory()) {
      await walk(pathname, `${rootLabel}/${entry.name}`, excluded);
      continue;
    }
    if (!entry.isFile()) continue;
    const info = await stat(pathname);
    if (info.size > 8 * 1024 * 1024) continue;
    const body = await readFile(pathname);
    scannedFiles += 1;
    scanText(`${rootLabel}/${relativePath}`, body);
  }
}

function command(command, commandArgs) {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(command, commandArgs, {
      cwd: labRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const output = [];
    const errors = [];
    child.stdout.on("data", (chunk) => output.push(chunk));
    child.stderr.on("data", (chunk) => errors.push(chunk));
    child.once("error", rejectCommand);
    child.once("exit", (code) => {
      if (code !== 0) {
        rejectCommand(
          new Error(
            `${command} ${commandArgs.join(" ")} failed with exit ${String(code)}`,
          ),
        );
        return;
      }
      resolveCommand(
        `${Buffer.concat(output).toString("utf8")}\n${Buffer.concat(errors).toString("utf8")}`,
      );
    });
  });
}

await walk(labRoot, "source", new Set([".env", ".runtime", "evidence"]));
await walk(join(labRoot, "evidence"), "evidence");
await walk(join(labRoot, ".runtime", "generated"), "runtime/generated");
await walk(join(labRoot, ".runtime", "images"), "runtime/images");
await walk(join(labRoot, ".runtime", "probes"), "runtime/probes");
scanText("docker-compose-config", await command("docker", ["compose", "config"]));

if (args.has("--running")) {
  for (const container of [
    "oc-interop-gateway",
    "oc-hosted-ocix-lab",
    "oc-local-crm-api",
    "oc-legacy-mcp-http",
    "oc-legacy-mcp-sse",
    "oc-excalidraw-mcp",
    "oc-tldraw-mcp-2026",
  ]) {
    scanText(
      `docker-inspect/${container}`,
      await command("docker", ["inspect", container]),
    );
  }
}

assert.equal(
  violations.length,
  0,
  `Unified secret scanner found credential material in ${violations
    .map((item) => item.label)
    .join(", ")}`,
);
const completedAt = new Date().toISOString();
const report = {
  schema: "openchamber://interop-secret-scan/v1",
  completedAt,
  scanner: "scripts/scan-secrets.mjs",
  scopes: [
    "lab source excluding ignored runtime",
    "acceptance evidence",
    "generated OCIX/image/probe artifacts",
    "docker compose config",
    ...(args.has("--running") ? ["running container inspect metadata"] : []),
  ],
  credentialNames: secretNames,
  scannedFiles,
  scannedBytes,
  violations: [],
  passed: true,
};
const evidenceRoot = join(labRoot, "evidence");
await mkdir(evidenceRoot, { recursive: true });
const outputPath = join(
  evidenceRoot,
  `secret-scan-${completedAt.replace(/[:.]/g, "-")}.json`,
);
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
  mode: 0o600,
});
console.log(outputPath);
