import crypto from 'node:crypto';
import fsPromises from 'node:fs/promises';
import nodePath from 'node:path';
import AdmZip from 'adm-zip';

const EXTENSION_PACKAGE_SCHEMA = 'openchamber://extension-package/v1';
const EXTENSION_CATALOG_SCHEMA = 'openchamber://extension-catalog/v1';
const EXTENSION_PACKAGE_INDEX = 'openchamber.package.json';

const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PACKAGE_INDEX_BYTES = 1024 * 1024;
const MAX_FILES = 512;
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const KEY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHA256_PATTERN = /^sha256-[A-Za-z0-9+/]{43}=$/;
const BLOCKED_KEY_IDS = new Set(['__proto__', 'prototype', 'constructor']);
const TOOL_FILE_PATTERN = /^agent-runtime\/tools\/([a-z][a-z0-9_]*)(\.(?:ts|js|mjs|cjs))$/;
const SKILL_FILE_PATTERN = /^agent-runtime\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)\/(.+)$/;
const RESERVED_TOOL_NAMES = new Set([
  'apply_patch', 'bash', 'edit', 'glob', 'grep', 'interactive_ui', 'list', 'read', 'skill', 'task', 'todo', 'webfetch', 'write',
]);

export class InteractiveUIPackageError extends Error {
  constructor(message, code = 'invalid_package', status = 400, details = undefined) {
    super(message);
    this.name = 'InteractiveUIPackageError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const normalizeCanonicalValue = (value) => {
  if (Array.isArray(value)) return value.map(normalizeCanonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().flatMap((key) => value[key] === undefined
      ? []
      : [[key, normalizeCanonicalValue(value[key])]]),
  );
};

const canonicalStringify = (value) => JSON.stringify(normalizeCanonicalValue(value));

const sha256 = (cryptoImpl, value) => `sha256-${cryptoImpl.createHash('sha256').update(value).digest('base64')}`;

const decodeBase64 = (value, label, expectedBytes) => {
  if (typeof value !== 'string' || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
    throw new InteractiveUIPackageError(`${label} encoding is invalid`, 'invalid_signature');
  }
  const bytes = Buffer.from(value, 'base64');
  if (bytes.toString('base64') !== value || (expectedBytes !== undefined && bytes.length !== expectedBytes)) {
    throw new InteractiveUIPackageError(`${label} encoding is invalid`, 'invalid_signature');
  }
  return bytes;
};

const normalizePackagePath = (value) => {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0')) {
    throw new InteractiveUIPackageError('Package file path is invalid', 'invalid_package_path');
  }
  const normalized = nodePath.posix.normalize(value);
  if (normalized !== value || normalized.startsWith('/') || normalized === '..' || normalized.startsWith('../')) {
    throw new InteractiveUIPackageError(`Package file path escapes the extension: ${value}`, 'invalid_package_path');
  }
  return normalized;
};

const assertEd25519PrivateKey = (cryptoImpl, value) => {
  let key;
  try {
    key = cryptoImpl.createPrivateKey(value);
  } catch {
    throw new InteractiveUIPackageError('Publisher private key is invalid', 'invalid_private_key');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new InteractiveUIPackageError('Publisher private key must use Ed25519', 'invalid_private_key');
  }
  return key;
};

export const normalizeEd25519PublicKey = (value, cryptoImpl = crypto) => {
  let key;
  try {
    key = cryptoImpl.createPublicKey(value);
  } catch {
    throw new InteractiveUIPackageError('Publisher public key is invalid', 'invalid_public_key');
  }
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new InteractiveUIPackageError('Publisher public key must use Ed25519', 'invalid_public_key');
  }
  return key.export({ type: 'spki', format: 'pem' }).toString();
};

export const publicKeyFingerprint = (value, cryptoImpl = crypto) => {
  const pem = normalizeEd25519PublicKey(value, cryptoImpl);
  const der = cryptoImpl.createPublicKey(pem).export({ type: 'spki', format: 'der' });
  return sha256(cryptoImpl, der);
};

export const generatePublisherKeyPair = (cryptoImpl = crypto) => {
  const { publicKey, privateKey } = cryptoImpl.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  };
};

const assertPublisherMetadata = ({ publisherId, publisherName, keyId }) => {
  if (!ID_PATTERN.test(publisherId ?? '')) {
    throw new InteractiveUIPackageError('Publisher id must be a namespaced identifier', 'invalid_publisher');
  }
  if (typeof publisherName !== 'string' || !publisherName.trim()) {
    throw new InteractiveUIPackageError('Publisher name is required', 'invalid_publisher');
  }
  if (!KEY_ID_PATTERN.test(keyId ?? '') || BLOCKED_KEY_IDS.has(keyId)) {
    throw new InteractiveUIPackageError('Publisher key id is invalid', 'invalid_publisher');
  }
};

const assertNoLikelySecret = (relativePath, content) => {
  const basename = nodePath.posix.basename(relativePath);
  if (basename === '.env' || basename.startsWith('.env.')) {
    throw new InteractiveUIPackageError(`Refusing to package environment file ${relativePath}`, 'secret_file_detected');
  }
  const prefix = content.subarray(0, Math.min(content.length, 4096)).toString('utf8');
  if (/-----BEGIN (?:OPENSSH |RSA |EC )?PRIVATE KEY-----/.test(prefix)) {
    throw new InteractiveUIPackageError(`Refusing to package private key ${relativePath}`, 'secret_file_detected');
  }
};

const collectExtensionFiles = async ({ directory, current = '', fsImpl, pathImpl, files }) => {
  const absoluteDirectory = current ? pathImpl.join(directory, ...current.split('/')) : directory;
  const entries = await fsImpl.readdir(absoluteDirectory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = normalizePackagePath(current ? `${current}/${entry.name}` : entry.name);
    const absolutePath = pathImpl.join(directory, ...relativePath.split('/'));
    if (entry.isSymbolicLink()) {
      throw new InteractiveUIPackageError(`Symbolic links are not allowed in extension packages: ${relativePath}`, 'symlink_not_allowed');
    }
    if (entry.isDirectory()) {
      await collectExtensionFiles({ directory, current: relativePath, fsImpl, pathImpl, files });
      continue;
    }
    if (!entry.isFile()) {
      throw new InteractiveUIPackageError(`Unsupported filesystem entry in extension package: ${relativePath}`, 'unsupported_file_type');
    }
    if (relativePath === EXTENSION_PACKAGE_INDEX) continue;
    const stat = await fsImpl.stat(absolutePath);
    if (stat.size > MAX_FILE_BYTES) {
      throw new InteractiveUIPackageError(`Extension file exceeds ${MAX_FILE_BYTES} bytes: ${relativePath}`, 'package_file_too_large', 413);
    }
    const content = await fsImpl.readFile(absolutePath);
    assertNoLikelySecret(relativePath, content);
    files.push({ path: relativePath, content });
  }
};

const parseManifest = (content) => {
  let manifest;
  try {
    manifest = JSON.parse(content.toString('utf8'));
  } catch {
    throw new InteractiveUIPackageError('Extension manifest is not valid JSON', 'invalid_manifest');
  }
  if (!isRecord(manifest) || manifest.$schema !== 'openchamber://extension/v1' || !ID_PATTERN.test(manifest.id ?? '') || typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new InteractiveUIPackageError('Extension manifest has an invalid schema or id', 'invalid_manifest');
  }
  if (typeof manifest.version !== 'string' || !SEMVER_PATTERN.test(manifest.version)) {
    throw new InteractiveUIPackageError('Extension manifest version must use semantic versioning', 'invalid_manifest');
  }
  return manifest;
};

const readSkillFrontmatter = (content, name) => {
  const text = content.toString('utf8');
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1] ?? '';
  const declaredName = frontmatter.match(/^name:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim();
  const description = frontmatter.match(/^description:\s*["']?([^"'\r\n]+)["']?\s*$/m)?.[1]?.trim();
  if (declaredName !== name || !description) {
    throw new InteractiveUIPackageError(
      `Agent Skill ${name} must declare matching name and description frontmatter`,
      'invalid_agent_skill',
    );
  }
};

export const inspectPackagedAgentRuntime = (files, manifest = undefined) => {
  const tools = [];
  const skillsByName = new Map();
  for (const [relativePath, content] of files) {
    const toolMatch = relativePath.match(TOOL_FILE_PATTERN);
    if (toolMatch) {
      const name = toolMatch[1];
      if (RESERVED_TOOL_NAMES.has(name)) {
        throw new InteractiveUIPackageError(`Agent Tool ${name} cannot replace an OpenCode built-in tool`, 'reserved_agent_tool');
      }
      if (!/\bexport\s+default\b/.test(content.toString('utf8'))) {
        throw new InteractiveUIPackageError(`Agent Tool ${relativePath} must use a default export`, 'invalid_agent_tool');
      }
      tools.push({ name, entry: relativePath });
      continue;
    }
    if (relativePath.startsWith('agent-runtime/tools/')) {
      throw new InteractiveUIPackageError(
        `Agent Tool files must be direct .ts, .js, .mjs, or .cjs children of agent-runtime/tools: ${relativePath}`,
        'invalid_agent_tool',
      );
    }
    const skillMatch = relativePath.match(SKILL_FILE_PATTERN);
    if (!skillMatch) {
      if (relativePath.startsWith('agent-runtime/skills/')) {
        throw new InteractiveUIPackageError(`Agent Skill path is invalid: ${relativePath}`, 'invalid_agent_skill');
      }
      continue;
    }
    const [, name, skillRelativePath] = skillMatch;
    const skill = skillsByName.get(name) ?? {
      name,
      entry: `agent-runtime/skills/${name}/SKILL.md`,
      files: [],
    };
    skill.files.push(relativePath);
    skillsByName.set(name, skill);
    if (skillRelativePath === 'SKILL.md') readSkillFrontmatter(content, name);
  }

  const duplicateTool = tools.find((tool, index) => tools.findIndex((candidate) => candidate.name === tool.name) !== index);
  if (duplicateTool) throw new InteractiveUIPackageError(`Duplicate Agent Tool ${duplicateTool.name}`, 'duplicate_agent_tool');
  const skills = Array.from(skillsByName.values()).sort((left, right) => left.name.localeCompare(right.name));
  for (const skill of skills) {
    if (!skill.files.includes(skill.entry)) {
      throw new InteractiveUIPackageError(`Agent Skill ${skill.name} is missing SKILL.md`, 'invalid_agent_skill');
    }
    skill.files.sort();
  }
  tools.sort((left, right) => left.name.localeCompare(right.name));

  const packagedToolNames = new Set(tools.map((tool) => tool.name));
  const boundToolNames = Array.isArray(manifest?.views)
    ? manifest.views.flatMap((view) => Array.isArray(view?.tools) ? view.tools : []).filter((name) => typeof name === 'string')
    : [];
  return {
    tools,
    skills,
    unresolvedViewTools: Array.from(new Set(boundToolNames.filter((name) => !packagedToolNames.has(name)))).sort(),
  };
};

export const createExtensionPackage = async ({
  extensionDirectory,
  privateKey,
  publisherId,
  publisherName,
  keyId,
  createdAt = new Date().toISOString(),
  fsImpl = fsPromises,
  pathImpl = nodePath,
  cryptoImpl = crypto,
  AdmZipClass = AdmZip,
} = {}) => {
  assertPublisherMetadata({ publisherId, publisherName, keyId });
  const signingKey = assertEd25519PrivateKey(cryptoImpl, privateKey);
  const publisherPublicKey = cryptoImpl.createPublicKey(signingKey).export({ type: 'spki', format: 'pem' }).toString();
  const directory = pathImpl.resolve(extensionDirectory ?? '');
  const files = [];
  await collectExtensionFiles({ directory, fsImpl, pathImpl, files });
  if (files.length === 0 || files.length > MAX_FILES) {
    throw new InteractiveUIPackageError(`Extension package must contain 1-${MAX_FILES} files`, 'invalid_package');
  }
  const totalBytes = files.reduce((total, file) => total + file.content.length, 0);
  if (totalBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new InteractiveUIPackageError('Extension package exceeds the uncompressed size limit', 'package_too_large', 413);
  }
  const manifestFile = files.find((file) => file.path === 'openchamber.extension.json');
  if (!manifestFile) throw new InteractiveUIPackageError('Extension package is missing openchamber.extension.json', 'missing_manifest');
  const manifest = parseManifest(manifestFile.content);
  const agentRuntime = inspectPackagedAgentRuntime(new Map(files.map((file) => [file.path, file.content])), manifest);

  const unsignedIndex = {
    $schema: EXTENSION_PACKAGE_SCHEMA,
    extension: { id: manifest.id, name: manifest.name, version: manifest.version },
    publisher: { id: publisherId, name: publisherName.trim(), keyId, publicKey: publisherPublicKey },
    createdAt,
    files: files.map((file) => ({ path: file.path, size: file.content.length, sha256: sha256(cryptoImpl, file.content) })),
  };
  const signature = cryptoImpl.sign(null, Buffer.from(canonicalStringify(unsignedIndex)), signingKey).toString('base64');
  const packageIndex = {
    ...unsignedIndex,
    signature: { algorithm: 'ed25519', value: signature },
  };
  const archive = new AdmZipClass();
  for (const file of files) archive.addFile(file.path, file.content);
  archive.addFile(EXTENSION_PACKAGE_INDEX, Buffer.from(`${JSON.stringify(packageIndex, null, 2)}\n`));
  const buffer = archive.toBuffer();
  if (buffer.length > MAX_ARCHIVE_BYTES) {
    throw new InteractiveUIPackageError('Extension archive exceeds the compressed size limit', 'package_too_large', 413);
  }
  return { buffer, packageIndex, manifest, agentRuntime, packageHash: sha256(cryptoImpl, buffer) };
};

const isZipSymlink = (entry) => {
  const mode = ((entry.header?.attr ?? 0) >>> 16) & 0xffff;
  return (mode & 0o170000) === 0o120000;
};

const readPackageIndex = (archive) => {
  const entries = archive.getEntries().filter((entry) => !entry.isDirectory);
  if (entries.length === 0 || entries.length > MAX_FILES + 1) {
    throw new InteractiveUIPackageError('Extension archive contains too many files', 'invalid_archive', 413);
  }
  const indexEntry = entries.find((entry) => entry.entryName === EXTENSION_PACKAGE_INDEX);
  if (!indexEntry) throw new InteractiveUIPackageError('Extension archive is missing its signed package index', 'missing_package_index');
  if (!Number.isSafeInteger(indexEntry.header?.size) || indexEntry.header.size <= 0 || indexEntry.header.size > MAX_PACKAGE_INDEX_BYTES) {
    throw new InteractiveUIPackageError('Extension package index exceeds its size limit', 'invalid_package_index', 413);
  }
  let packageIndex;
  try {
    packageIndex = JSON.parse(indexEntry.getData().toString('utf8'));
  } catch {
    throw new InteractiveUIPackageError('Extension package index is not valid JSON', 'invalid_package_index');
  }
  return { entries, packageIndex };
};

const validatePackageIndex = (packageIndex, cryptoImpl) => {
  if (!isRecord(packageIndex) || packageIndex.$schema !== EXTENSION_PACKAGE_SCHEMA) {
    throw new InteractiveUIPackageError('Extension package index schema is unsupported', 'invalid_package_index');
  }
  if (!isRecord(packageIndex.extension) || !ID_PATTERN.test(packageIndex.extension.id ?? '') || !SEMVER_PATTERN.test(packageIndex.extension.version ?? '') || typeof packageIndex.extension.name !== 'string' || !packageIndex.extension.name.trim()) {
    throw new InteractiveUIPackageError('Extension package identity is invalid', 'invalid_package_index');
  }
  if (!isRecord(packageIndex.publisher)) throw new InteractiveUIPackageError('Extension package publisher is missing', 'invalid_package_index');
  assertPublisherMetadata({
    publisherId: packageIndex.publisher.id,
    publisherName: packageIndex.publisher.name,
    keyId: packageIndex.publisher.keyId,
  });
  if (packageIndex.publisher.publicKey !== undefined) {
    packageIndex.publisher.publicKey = normalizeEd25519PublicKey(packageIndex.publisher.publicKey, cryptoImpl);
  }
  if (!isRecord(packageIndex.signature) || packageIndex.signature.algorithm !== 'ed25519' || typeof packageIndex.signature.value !== 'string') {
    throw new InteractiveUIPackageError('Extension package signature is invalid', 'invalid_signature');
  }
  if (!Array.isArray(packageIndex.files) || packageIndex.files.length === 0 || packageIndex.files.length > MAX_FILES) {
    throw new InteractiveUIPackageError('Extension package file index is invalid', 'invalid_package_index');
  }
};

export const verifyExtensionPackage = async ({
  buffer,
  resolveTrustedPublisherKey,
  allowEmbeddedPublisherKey = false,
  cryptoImpl = crypto,
  AdmZipClass = AdmZip,
} = {}) => {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0 || buffer.length > MAX_ARCHIVE_BYTES) {
    throw new InteractiveUIPackageError('Extension archive is empty or too large', 'package_too_large', 413);
  }
  let archive;
  try {
    archive = new AdmZipClass(buffer);
  } catch {
    throw new InteractiveUIPackageError('Extension archive is not a valid ZIP file', 'invalid_archive');
  }
  const { entries, packageIndex } = readPackageIndex(archive);
  validatePackageIndex(packageIndex, cryptoImpl);
  const embeddedPublicKey = packageIndex.publisher.publicKey
    ? normalizeEd25519PublicKey(packageIndex.publisher.publicKey, cryptoImpl)
    : null;
  const trustedPublicKeyValue = await resolveTrustedPublisherKey?.(packageIndex.publisher.id, packageIndex.publisher.keyId);
  const trustedPublicKey = trustedPublicKeyValue ? normalizeEd25519PublicKey(trustedPublicKeyValue, cryptoImpl) : null;
  if (embeddedPublicKey && trustedPublicKey
    && publicKeyFingerprint(embeddedPublicKey, cryptoImpl) !== publicKeyFingerprint(trustedPublicKey, cryptoImpl)) {
    throw new InteractiveUIPackageError(
      `Publisher ${packageIndex.publisher.id} key ${packageIndex.publisher.keyId} conflicts with the trusted key`,
      'publisher_key_conflict',
      409,
    );
  }
  const publicKeyValue = trustedPublicKey ?? (allowEmbeddedPublisherKey ? embeddedPublicKey : null);
  if (!publicKeyValue) {
    throw new InteractiveUIPackageError(
      `Publisher ${packageIndex.publisher.id} key ${packageIndex.publisher.keyId} is not trusted`,
      'publisher_untrusted',
      403,
      { publisher: packageIndex.publisher },
    );
  }
  const publicKey = normalizeEd25519PublicKey(publicKeyValue, cryptoImpl);
  const { signature, ...unsignedIndex } = packageIndex;
  const signatureBytes = decodeBase64(signature.value, 'Extension package signature', 64);
  if (!cryptoImpl.verify(null, Buffer.from(canonicalStringify(unsignedIndex)), publicKey, signatureBytes)) {
    throw new InteractiveUIPackageError('Extension package signature verification failed', 'invalid_signature', 403);
  }

  const indexedFiles = new Map();
  let expectedBytes = 0;
  for (const file of packageIndex.files) {
    if (!isRecord(file)) throw new InteractiveUIPackageError('Extension package file entry is invalid', 'invalid_package_index');
    const filePath = normalizePackagePath(file.path);
    if (filePath === EXTENSION_PACKAGE_INDEX || indexedFiles.has(filePath)) {
      throw new InteractiveUIPackageError(`Duplicate or reserved package file path: ${filePath}`, 'invalid_package_index');
    }
    if (!Number.isSafeInteger(file.size) || file.size < 0 || file.size > MAX_FILE_BYTES || !SHA256_PATTERN.test(file.sha256 ?? '')) {
      throw new InteractiveUIPackageError(`Invalid package file metadata: ${filePath}`, 'invalid_package_index');
    }
    expectedBytes += file.size;
    indexedFiles.set(filePath, file);
  }
  if (expectedBytes > MAX_UNCOMPRESSED_BYTES) {
    throw new InteractiveUIPackageError('Extension package exceeds the uncompressed size limit', 'package_too_large', 413);
  }

  const archiveFiles = new Map();
  for (const entry of entries) {
    const entryPath = normalizePackagePath(entry.entryName);
    if (isZipSymlink(entry)) throw new InteractiveUIPackageError(`Package symlink is not allowed: ${entryPath}`, 'symlink_not_allowed');
    if (entryPath === EXTENSION_PACKAGE_INDEX) continue;
    if (archiveFiles.has(entryPath)) throw new InteractiveUIPackageError(`Archive contains duplicate file: ${entryPath}`, 'duplicate_package_file');
    const expected = indexedFiles.get(entryPath);
    if (!expected) throw new InteractiveUIPackageError(`Archive contains unsigned file: ${entryPath}`, 'unsigned_package_file');
    if (entry.header?.size !== expected.size) throw new InteractiveUIPackageError(`Package file size mismatch: ${entryPath}`, 'package_hash_mismatch');
    const content = entry.getData();
    if (content.length !== expected.size || sha256(cryptoImpl, content) !== expected.sha256) {
      throw new InteractiveUIPackageError(`Package file hash mismatch: ${entryPath}`, 'package_hash_mismatch', 403);
    }
    assertNoLikelySecret(entryPath, content);
    archiveFiles.set(entryPath, content);
  }
  if (archiveFiles.size !== indexedFiles.size) throw new InteractiveUIPackageError('Extension archive is missing signed files', 'missing_package_file');

  const manifest = parseManifest(archiveFiles.get('openchamber.extension.json') ?? Buffer.alloc(0));
  if (manifest.id !== packageIndex.extension.id || manifest.version !== packageIndex.extension.version || manifest.name !== packageIndex.extension.name) {
    throw new InteractiveUIPackageError('Manifest identity does not match the signed package index', 'package_identity_mismatch', 403);
  }
  const agentRuntime = inspectPackagedAgentRuntime(archiveFiles, manifest);
  return {
    packageIndex,
    manifest,
    files: archiveFiles,
    packageHash: sha256(cryptoImpl, buffer),
    publisherPublicKey: publicKey,
    publisherFingerprint: publicKeyFingerprint(publicKey, cryptoImpl),
    publisherTrusted: Boolean(trustedPublicKey),
    agentRuntime,
  };
};

export const createSignedExtensionCatalog = ({
  marketplaceId,
  marketplaceName,
  keyId,
  privateKey,
  entries,
  generatedAt = new Date().toISOString(),
  cryptoImpl = crypto,
} = {}) => {
  assertPublisherMetadata({ publisherId: marketplaceId, publisherName: marketplaceName, keyId });
  const signingKey = assertEd25519PrivateKey(cryptoImpl, privateKey);
  const publicKey = cryptoImpl.createPublicKey(signingKey).export({ type: 'spki', format: 'pem' }).toString();
  const unsignedCatalog = {
    $schema: EXTENSION_CATALOG_SCHEMA,
    marketplace: { id: marketplaceId, name: marketplaceName.trim(), keyId, publicKey },
    generatedAt,
    entries,
  };
  const value = cryptoImpl.sign(null, Buffer.from(canonicalStringify(unsignedCatalog)), signingKey).toString('base64');
  return { ...unsignedCatalog, signature: { algorithm: 'ed25519', value } };
};

export const verifySignedExtensionCatalog = ({ catalog, publicKey, allowEmbeddedPublicKey = true, cryptoImpl = crypto } = {}) => {
  if (!isRecord(catalog) || catalog.$schema !== EXTENSION_CATALOG_SCHEMA || !isRecord(catalog.marketplace)) {
    throw new InteractiveUIPackageError('Marketplace catalog schema is invalid', 'invalid_catalog');
  }
  assertPublisherMetadata({
    publisherId: catalog.marketplace.id,
    publisherName: catalog.marketplace.name,
    keyId: catalog.marketplace.keyId,
  });
  if (!Array.isArray(catalog.entries) || catalog.entries.length > 10_000) {
    throw new InteractiveUIPackageError('Marketplace catalog entries are invalid', 'invalid_catalog');
  }
  if (!isRecord(catalog.signature) || catalog.signature.algorithm !== 'ed25519' || typeof catalog.signature.value !== 'string') {
    throw new InteractiveUIPackageError('Marketplace catalog signature is invalid', 'invalid_catalog_signature');
  }
  const embeddedPublicKey = catalog.marketplace.publicKey
    ? normalizeEd25519PublicKey(catalog.marketplace.publicKey, cryptoImpl)
    : null;
  const suppliedPublicKey = publicKey ? normalizeEd25519PublicKey(publicKey, cryptoImpl) : null;
  if (embeddedPublicKey && suppliedPublicKey
    && publicKeyFingerprint(embeddedPublicKey, cryptoImpl) !== publicKeyFingerprint(suppliedPublicKey, cryptoImpl)) {
    throw new InteractiveUIPackageError('Marketplace embedded key conflicts with the trusted key', 'marketplace_key_conflict', 409);
  }
  const normalizedKey = suppliedPublicKey ?? (allowEmbeddedPublicKey ? embeddedPublicKey : null);
  if (!normalizedKey) {
    throw new InteractiveUIPackageError('Marketplace catalog does not include a public key', 'marketplace_key_missing');
  }
  const { signature, ...unsignedCatalog } = catalog;
  if (!cryptoImpl.verify(null, Buffer.from(canonicalStringify(unsignedCatalog)), normalizedKey, decodeBase64(signature.value, 'Marketplace catalog signature', 64))) {
    throw new InteractiveUIPackageError('Marketplace catalog signature verification failed', 'invalid_catalog_signature', 403);
  }
  const seen = new Set();
  for (const entry of catalog.entries) {
    if (!isRecord(entry) || !ID_PATTERN.test(entry.id ?? '') || !SEMVER_PATTERN.test(entry.version ?? '') || typeof entry.name !== 'string') {
      throw new InteractiveUIPackageError('Marketplace catalog contains an invalid extension entry', 'invalid_catalog');
    }
    const identity = `${entry.id}@${entry.version}`;
    if (seen.has(identity)) throw new InteractiveUIPackageError(`Marketplace catalog contains duplicate ${identity}`, 'invalid_catalog');
    seen.add(identity);
    let packageUrl;
    try {
      packageUrl = new URL(entry.packageUrl);
    } catch {
      throw new InteractiveUIPackageError(`Marketplace package URL is invalid for ${identity}`, 'invalid_catalog');
    }
    if (!['http:', 'https:'].includes(packageUrl.protocol) || packageUrl.username || packageUrl.password) {
      throw new InteractiveUIPackageError(`Marketplace package URL is unsafe for ${identity}`, 'invalid_catalog');
    }
    if (!SHA256_PATTERN.test(entry.packageHash ?? '')) {
      throw new InteractiveUIPackageError(`Marketplace package hash is invalid for ${identity}`, 'invalid_catalog');
    }
    if (!isRecord(entry.publisher)) {
      throw new InteractiveUIPackageError(`Marketplace publisher is invalid for ${identity}`, 'invalid_catalog');
    }
    assertPublisherMetadata({
      publisherId: entry.publisher.id,
      publisherName: entry.publisher.name,
      keyId: entry.publisher.keyId,
    });
    normalizeEd25519PublicKey(entry.publisher.publicKey, cryptoImpl);
  }
  return { catalog, fingerprint: publicKeyFingerprint(normalizedKey, cryptoImpl) };
};
