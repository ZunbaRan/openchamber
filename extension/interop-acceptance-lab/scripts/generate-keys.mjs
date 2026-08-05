#!/usr/bin/env node
import { generateKeyPairSync } from "node:crypto";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

const labRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const keyDirectory = join(labRoot, ".runtime", "keys");
const privatePath = join(keyDirectory, "publisher.private.pem");
const publicPath = join(keyDirectory, "publisher.public.pem");

async function exists(pathname) {
  try {
    await access(pathname, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const privateExists = await exists(privatePath);
const publicExists = await exists(publicPath);
if (privateExists !== publicExists) {
  throw new Error(
    "Incomplete publisher key pair. Move the remaining key out of .runtime/keys and run again.",
  );
}
if (privateExists) {
  console.log(`Publisher keys already exist under ${keyDirectory}`);
  process.exit(0);
}

await mkdir(keyDirectory, { recursive: true, mode: 0o700 });
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
await writeFile(
  privatePath,
  privateKey.export({ type: "pkcs8", format: "pem" }),
  { mode: 0o600, flag: "wx" },
);
await writeFile(
  publicPath,
  publicKey.export({ type: "spki", format: "pem" }),
  { mode: 0o644, flag: "wx" },
);
await chmod(privatePath, 0o600);
console.log(`Generated local-only publisher keys under ${keyDirectory}`);

