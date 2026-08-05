#!/usr/bin/env node
import { spawn } from "node:child_process";
import { chmod, readFile, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envPath = join(labRoot, ".env");
const quiet = process.argv.includes("--quiet");
const outputIndex = process.argv.indexOf("--output-file");
const outputPath = outputIndex >= 0 ? process.argv[outputIndex + 1]?.trim() : "";
const positionalOrigin = process.argv
  .slice(2)
  .find((value, index, values) => (
    !value.startsWith("--")
    && values[index - 1] !== "--output-file"
  ));

function dockerLogs() {
  return new Promise((resolveLogs, rejectLogs) => {
    const child = spawn("docker", ["logs", "oc-interop-tunnel"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks = [];
    child.stdout.on("data", (chunk) => chunks.push(chunk));
    child.stderr.on("data", (chunk) => chunks.push(chunk));
    child.once("error", rejectLogs);
    child.once("exit", (code) => {
      if (code !== 0) {
        rejectLogs(new Error(`docker logs exited with ${String(code)}`));
        return;
      }
      resolveLogs(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

const document = await readFile(envPath, "utf8");
const gatePath = document.match(/^PUBLIC_GATE_PATH=(.+)$/m)?.[1]?.trim();
if (!gatePath || !/^interop-[a-f0-9]{24}$/.test(gatePath)) {
  throw new Error("PUBLIC_GATE_PATH is missing or invalid; run scripts/init-env.mjs");
}
const suppliedOrigin = positionalOrigin?.trim();
if (
  suppliedOrigin &&
  !/^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/i.test(suppliedOrigin)
) {
  throw new Error("The supplied quick-tunnel origin is invalid");
}
const logs = suppliedOrigin || await dockerLogs();
const matches = logs.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/gi) || [];
if (!matches.length) {
  throw new Error("No current trycloudflare HTTPS URL was found in tunnel logs");
}
const publicBaseUrl = `${matches.at(-1)}/${gatePath}`;
const next = /^PUBLIC_BASE_URL=/m.test(document)
  ? document.replace(/^PUBLIC_BASE_URL=.*$/m, `PUBLIC_BASE_URL=${publicBaseUrl}`)
  : `${document.trimEnd()}\nPUBLIC_BASE_URL=${publicBaseUrl}\n`;
await writeFile(envPath, next, { mode: 0o600 });
if (outputIndex >= 0 && !outputPath) {
  throw new Error("--output-file requires a path");
}
if (outputPath) {
  const temporary = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temporary, `${publicBaseUrl}\n`, { mode: 0o600 });
  await rename(temporary, outputPath);
  await chmod(outputPath, 0o600);
}
if (!quiet) console.log(publicBaseUrl);
