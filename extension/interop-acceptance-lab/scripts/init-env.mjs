#!/usr/bin/env node
import crypto from "node:crypto";
import {
  access,
  mkdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const envPath = join(labRoot, ".env");
const secretRoot = join(labRoot, ".runtime", "secrets");
const token = () => crypto.randomBytes(24).toString("base64url");
const secretNames = [
  "LOCAL_CRM_API_KEY",
  "LOCAL_CRM_READ_ONLY_KEY",
  "HOSTED_OPS_API_KEY",
  "HOSTED_OPS_READ_ONLY_KEY",
];
const rotatePublicEndpoint = process.argv.includes("--rotate-public-endpoint");

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

let document;
try {
  await access(envPath, constants.F_OK);
  document = await readFile(envPath, "utf8");
} catch {
  document = [
    ...secretNames.map((name) => `${name}=${token()}`),
    "PUBLIC_BASE_URL=http://127.0.0.1:9510",
    `PUBLIC_GATE_PATH=interop-${crypto.randomBytes(12).toString("hex")}`,
    "",
  ].join("\n");
  await writeFile(envPath, document, { mode: 0o600, flag: "wx" });
}

let values = parseEnv(document);
if (rotatePublicEndpoint) {
  const publicGatePath = `interop-${crypto.randomBytes(12).toString("hex")}`;
  document = /^PUBLIC_GATE_PATH=/m.test(document)
    ? document.replace(/^PUBLIC_GATE_PATH=.*$/m, `PUBLIC_GATE_PATH=${publicGatePath}`)
    : `${document.trimEnd()}\nPUBLIC_GATE_PATH=${publicGatePath}\n`;
  document = /^PUBLIC_BASE_URL=/m.test(document)
    ? document.replace(/^PUBLIC_BASE_URL=.*$/m, "PUBLIC_BASE_URL=http://127.0.0.1:9510")
    : `${document.trimEnd()}\nPUBLIC_BASE_URL=http://127.0.0.1:9510\n`;
  await writeFile(envPath, document, { mode: 0o600 });
  values = parseEnv(document);
} else if (!values.PUBLIC_GATE_PATH) {
  values.PUBLIC_GATE_PATH = `interop-${crypto.randomBytes(12).toString("hex")}`;
  document = `${document.trimEnd()}\nPUBLIC_GATE_PATH=${values.PUBLIC_GATE_PATH}\n`;
  await writeFile(envPath, document, { mode: 0o600 });
}
for (const name of secretNames) {
  if (!values[name]) {
    throw new Error(`${name} is missing from ${envPath}`);
  }
}

await mkdir(secretRoot, { recursive: true });
for (const name of secretNames) {
  await writeFile(
    join(secretRoot, name.toLowerCase()),
    `${values[name]}\n`,
    { mode: 0o600 },
  );
}
console.log(
  rotatePublicEndpoint
    ? `Rotated the private public endpoint and refreshed Docker secret files under ${labRoot}`
    : `Prepared local-only environment and Docker secret files under ${labRoot}`,
);
