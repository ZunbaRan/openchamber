#!/usr/bin/env node
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceRoot = join(labRoot, "local-crm");
const stageRoot = join(labRoot, ".runtime", "build", "local-crm-package");
const metadataPath = join(
  labRoot,
  ".runtime",
  "generated",
  "local-crm-build-metadata.json",
);
const publicBaseUrl = (
  process.env.PUBLIC_BASE_URL || "http://127.0.0.1:9510"
).replace(/\/+$/, "");
const publicUrl = new URL(publicBaseUrl);
const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(
  publicUrl.hostname,
);
const publicGatePath = process.env.PUBLIC_GATE_PATH?.trim();
if (
  !["http:", "https:"].includes(publicUrl.protocol) ||
  publicUrl.username ||
  publicUrl.password ||
  publicUrl.search ||
  publicUrl.hash ||
  publicUrl.pathname.includes("..")
) {
  throw new Error(
    "PUBLIC_BASE_URL must be an http(s) URL without credentials, query, fragment, or traversal",
  );
}
if (publicUrl.protocol !== "https:" && !loopback) {
  throw new Error(
    "Non-loopback PUBLIC_BASE_URL must use HTTPS; use the quick-tunnel URL and repackage",
  );
}
if (
  !loopback &&
  (!publicGatePath ||
    !/^interop-[a-f0-9]{24}$/.test(publicGatePath) ||
    publicUrl.pathname !== `/${publicGatePath}`)
) {
  throw new Error(
    "Remote PUBLIC_BASE_URL must end with the generated /<PUBLIC_GATE_PATH>",
  );
}

await rm(stageRoot, { recursive: true, force: true });
await mkdir(stageRoot, { recursive: true });
await cp(sourceRoot, stageRoot, { recursive: true });

const manifestPath = join(stageRoot, "openchamber.extension.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const connector = manifest.connectors?.find((item) => item.id === "crm-api");
if (!connector) throw new Error("Local CRM manifest is missing crm-api");
connector.baseUrl = publicBaseUrl;
connector.test = { method: "GET", path: "/health/local-crm" };
manifest.permissions = {
  ...(manifest.permissions || {}),
  network: [publicUrl.origin],
};
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

await mkdir(join(labRoot, ".runtime", "generated"), { recursive: true });
await writeFile(
  metadataPath,
  `${JSON.stringify(
    {
      extensionId: manifest.id,
      version: manifest.version,
      publicBaseUrl,
      connectorBaseUrl: connector.baseUrl,
      deploymentMode: loopback ? "loopback-development" : "remote-https",
      sourceDirectory: "local-crm",
      stagedDirectory: ".runtime/build/local-crm-package",
    },
    null,
    2,
  )}\n`,
);
console.log(
  `Prepared Local CRM ${loopback ? "loopback development" : "remote HTTPS"} package source at ${stageRoot}`,
);
