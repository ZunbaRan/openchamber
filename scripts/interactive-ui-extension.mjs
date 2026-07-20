#!/usr/bin/env node

import crypto from 'node:crypto';
import * as fsPromises from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInteractiveUIRuntime } from '../packages/web/server/lib/interactive-ui/runtime.js';
import {
  createExtensionPackage,
  createSignedExtensionCatalog,
  generatePublisherKeyPair,
  inspectPackagedAgentRuntime,
  publicKeyFingerprint,
  verifyExtensionPackage,
  verifySignedExtensionCatalog,
} from '../packages/web/server/lib/interactive-ui/package-format.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..');
const TEMPLATE_ROOT = path.join(REPO_ROOT, 'templates', 'interactive-ui-extension');
const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const TOOL_PREFIX_PATTERN = /^[a-z][a-z0-9_]*$/;
const ENV_REFERENCE_PATTERN = /^\$\{([A-Z][A-Z0-9_]*)\}$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;
const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const DECLARATIVE_BINDING_ROOTS = new Set(['data', 'context', 'query', 'host']);
const SUPPORTED_NODE_TYPES = new Set([
  'generated-layout', 'stack', 'section', 'row', 'grid', 'metric-grid', 'metric',
  'text', 'markdown', 'progress', 'status', 'badge', 'key-value', 'flow', 'chart',
  'list', 'callout', 'data-table',
]);
const BANNED_DECLARATIVE_KEYS = new Set(['dangerouslySetInnerHTML', 'html', 'script', 'srcDoc', 'srcdoc']);
const REPOSITORY_PROVIDED_TOOL_NAMES = new Set(['interactive_ui', 'crm_open_dashboard']);

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const replaceTokens = (value, replacements) => Object.entries(replacements)
  .reduce((result, [token, replacement]) => result.replaceAll(token, replacement), value);

const ensureMissingTarget = async (target) => {
  try {
    await fsPromises.stat(target);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`Target already exists; refusing to overwrite: ${target}`);
};

const copyTemplate = async (source, target, replacements) => {
  await fsPromises.mkdir(target, { recursive: true });
  for (const entry of await fsPromises.readdir(source, { withFileTypes: true })) {
    const nextTarget = path.join(target, replaceTokens(entry.name, replacements));
    const nextSource = path.join(source, entry.name);
    if (entry.isDirectory()) {
      await copyTemplate(nextSource, nextTarget, replacements);
      continue;
    }
    if (!entry.isFile()) continue;
    const content = replaceTokens(await fsPromises.readFile(nextSource, 'utf8'), replacements);
    await fsPromises.writeFile(nextTarget, content, { encoding: 'utf8', flag: 'wx' });
  }
};

export const scaffoldExtension = async ({ targetDirectory, extensionId, name, toolPrefix }) => {
  if (!EXTENSION_ID_PATTERN.test(extensionId ?? '')) {
    throw new Error('Extension id must be a namespaced identifier such as com.acme.operations');
  }
  if (typeof name !== 'string' || !name.trim()) throw new Error('Extension name is required');
  const normalizedToolPrefix = toolPrefix ?? extensionId.split(/[._-]/).at(-1)?.toLowerCase();
  if (!TOOL_PREFIX_PATTERN.test(normalizedToolPrefix ?? '')) {
    throw new Error('Tool prefix must start with a lowercase letter and contain only lowercase letters, digits, or underscores');
  }
  if (typeof targetDirectory !== 'string' || !targetDirectory.trim()) throw new Error('Target directory is required');

  const target = path.resolve(targetDirectory);
  if (target === REPO_ROOT || target === TEMPLATE_ROOT || target.startsWith(`${TEMPLATE_ROOT}${path.sep}`)) {
    throw new Error('Target must be a new extension directory outside the bundled template');
  }
  await ensureMissingTarget(target);

  const replacements = {
    __EXTENSION_ID__: extensionId,
    __EXTENSION_NAME__: name.trim(),
    __TOOL_PREFIX__: normalizedToolPrefix,
    __SKILL_NAME__: `${normalizedToolPrefix.replaceAll('_', '-')}-interactive-ui`,
  };

  try {
    await copyTemplate(TEMPLATE_ROOT, target, replacements);
  } catch (error) {
    await fsPromises.rm(target, { recursive: true, force: true }).catch(() => {});
    throw error;
  }

  return { target, extensionId, toolPrefix: normalizedToolPrefix };
};

const readManifest = async (extensionDirectory) => {
  const directory = path.resolve(extensionDirectory);
  const manifestPath = path.join(directory, 'openchamber.extension.json');
  let raw;
  try {
    raw = JSON.parse(await fsPromises.readFile(manifestPath, 'utf8'));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error(`${manifestPath}: invalid JSON`);
    throw error;
  }
  if (!isRecord(raw)) throw new Error(`${manifestPath}: manifest must be an object`);
  return { directory, manifestPath, raw };
};

const collectAgentRuntimeFiles = async (directory, relative = 'agent-runtime', files = new Map()) => {
  const target = path.join(directory, ...relative.split('/'));
  const entries = await fsPromises.readdir(target, { withFileTypes: true }).catch((error) => {
    if (error?.code === 'ENOENT') return [];
    throw error;
  });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const nextRelative = `${relative}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error(`${nextRelative}: symbolic links are not allowed`);
    if (entry.isDirectory()) await collectAgentRuntimeFiles(directory, nextRelative, files);
    else if (entry.isFile()) files.set(nextRelative, await fsPromises.readFile(path.join(directory, ...nextRelative.split('/'))));
  }
  return files;
};

const createValidationEnvironment = (manifest) => {
  const environment = {};
  const connectorVariables = new Set();
  for (const connector of Array.isArray(manifest.connectors) ? manifest.connectors : []) {
    if (!isRecord(connector)) continue;
    const baseMatch = typeof connector.baseUrl === 'string' ? connector.baseUrl.match(ENV_REFERENCE_PATTERN) : null;
    if (baseMatch) connectorVariables.add(baseMatch[1]);
    if (isRecord(connector.auth) && connector.auth.type === 'env-bearer' && typeof connector.auth.env === 'string') {
      environment[connector.auth.env] = 'ocix-validation-token';
    }
  }
  for (const variable of connectorVariables) environment[variable] = 'https://ocix-validator.invalid';
  for (const permission of Array.isArray(manifest.permissions?.network) ? manifest.permissions.network : []) {
    const match = typeof permission === 'string' ? permission.match(ENV_REFERENCE_PATTERN) : null;
    if (match) environment[match[1]] = 'https://ocix-validator.invalid';
  }
  return environment;
};

const validateBindingPath = (value, location, errors, allowedRoots) => {
  if (typeof value !== 'string' || !value.trim()) {
    errors.push(`${location}: binding path must be a non-empty string`);
    return;
  }
  const segments = value.split('.');
  if (segments.some((segment) => !segment || !SAFE_PATH_SEGMENT.test(segment) || BLOCKED_PATH_SEGMENTS.has(segment))) {
    errors.push(`${location}: binding path contains an unsafe segment`);
  } else if (allowedRoots && !allowedRoots.has(segments[0])) {
    errors.push(`${location}: binding root must be one of ${Array.from(allowedRoots).join(', ')}`);
  }
};

const validateDeclarativeDefinition = (definition, declaredActions) => {
  const errors = [];
  let nodeCount = 0;

  const visit = (value, location, depth) => {
    if (depth > 64) {
      errors.push(`${location}: declarative structure exceeds 64 levels`);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, `${location}[${index}]`, depth + 1));
      return;
    }
    if (!isRecord(value)) return;

    const isNodeLocation = location === 'layout' || /\.children\[\d+\]$/.test(location);
    if (isNodeLocation) {
      nodeCount += 1;
      if (typeof value.type !== 'string') errors.push(`${location}.type: primitive type is required`);
      else if (!SUPPORTED_NODE_TYPES.has(value.type)) errors.push(`${location}.type: unsupported primitive ${value.type}`);
      if (['stack', 'section', 'row', 'grid'].includes(value.type) && !Array.isArray(value.children)) {
        errors.push(`${location}.children: ${value.type} requires a children array`);
      }
      if (value.type === 'metric-grid' && !Array.isArray(value.items)) {
        errors.push(`${location}.items: metric-grid requires an items array`);
      }
      if (value.type === 'data-table' && !Array.isArray(value.columns)) {
        errors.push(`${location}.columns: data-table requires a columns array`);
      }
      if (value.type === 'chart') {
        if (!Array.isArray(value.series)) errors.push(`${location}.series: chart requires a series array`);
        if (value.variant !== undefined && !['bar', 'line', 'area', 'donut'].includes(value.variant)) {
          errors.push(`${location}.variant: chart supports bar, line, area, or donut`);
        }
      }
    }
    if ('$path' in value) validateBindingPath(value.$path, `${location}.$path`, errors, DECLARATIVE_BINDING_ROOTS);
    if ('$row' in value) validateBindingPath(value.$row, `${location}.$row`, errors);
    if (typeof value.action === 'string' && !declaredActions.has(value.action)) {
      errors.push(`${location}.action: ${value.action} is not declared in the extension manifest`);
    }
    for (const [key, entry] of Object.entries(value)) {
      if (isNodeLocation && BANNED_DECLARATIVE_KEYS.has(key)) errors.push(`${location}.${key}: executable or raw HTML fields are not allowed`);
      visit(entry, `${location}.${key}`, depth + 1);
    }
  };

  for (const [name, query] of Object.entries(isRecord(definition.queries) ? definition.queries : {})) {
    if (!isRecord(query) || typeof query.action !== 'string') {
      errors.push(`queries.${name}.action: action is required`);
    } else if (!declaredActions.has(query.action)) {
      errors.push(`queries.${name}.action: ${query.action} is not declared in the extension manifest`);
    }
    visit(query, `queries.${name}`, 0);
  }
  visit(definition.layout, 'layout', 0);
  if (nodeCount === 0) errors.push('layout: at least one supported node is required');
  if (nodeCount > 1000) errors.push('layout: more than 1000 nodes are not allowed');
  return errors;
};

export const validateExtension = async (extensionDirectory) => {
  const { directory, manifestPath, raw } = await readManifest(extensionDirectory);
  const errors = [];
  const warnings = [];
  let agentRuntime = { tools: [], skills: [], unresolvedViewTools: [] };

  if (raw.$schema !== 'openchamber://extension/v1') errors.push(`${manifestPath}: $schema must be openchamber://extension/v1`);
  if (typeof raw.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(raw.version)) {
    errors.push(`${manifestPath}: version must be semantic versioning compatible`);
  }
  try {
    const agentRuntimeFiles = await collectAgentRuntimeFiles(directory, 'agent-runtime/tools');
    await collectAgentRuntimeFiles(directory, 'agent-runtime/skills', agentRuntimeFiles);
    agentRuntime = inspectPackagedAgentRuntime(agentRuntimeFiles, raw);
    const externallyProvidedTools = agentRuntime.unresolvedViewTools.filter((name) => !REPOSITORY_PROVIDED_TOOL_NAMES.has(name));
    if (externallyProvidedTools.length > 0) {
      warnings.push(`View tools are not packaged in agent-runtime/tools and must be supplied by a separately governed MCP server: ${externallyProvidedTools.join(', ')}`);
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }

  const runtime = createInteractiveUIRuntime({
    fsPromises,
    path,
    crypto,
    extensionRoots: [directory],
    environment: createValidationEnvironment(raw),
    logger: { info() {}, warn() {} },
  });
  let registry;
  try {
    registry = await runtime.listExtensions();
  } catch (error) {
    errors.push(error instanceof Error ? error.message : String(error));
  }
  if (registry?.errors?.length) errors.push(...registry.errors.map((entry) => `${entry.manifest}: ${entry.error}`));
  const extension = registry?.extensions?.find((entry) => entry.id === raw.id);
  if (!extension && errors.length === 0) errors.push(`${manifestPath}: extension was not discovered`);

  const nativeViews = [];
  const declarativeViews = [];
  if (extension) {
    const declaredActions = new Set(extension.actions.map((action) => action.id));
    for (const view of extension.views) {
      if (view.tools.length === 0) warnings.push(`${view.id}: no Agent tool is bound to this view`);
      const toolName = view.tools[0] ?? '';
      try {
        const descriptor = await runtime.getViewDescriptor(view.id, toolName);
        if (view.runtime === 'declarative') {
          declarativeViews.push(view.id);
          errors.push(...validateDeclarativeDefinition(descriptor.declarative, declaredActions).map((message) => `${view.id}: ${message}`));
        } else {
          nativeViews.push(view.id);
          const bundle = await runtime.getNativeBundle(extension.id, view.id);
          if (!bundle.source.includes(extension.id)) warnings.push(`${view.id}: Native bundle does not contain its extension id as a literal`);
          if (!/apiVersion\s*:\s*1/.test(bundle.source) || !/activate\s*\(/.test(bundle.source)) {
            warnings.push(`${view.id}: Native activation contract could not be recognized statically; verify it in the real host`);
          }
        }
      } catch (error) {
        errors.push(`${view.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    if (nativeViews.length > 0) {
      if (!isRecord(raw.trust) || raw.trust.mode !== 'native-code') {
        errors.push(`${manifestPath}: Native views require trust.mode = native-code`);
      } else if (typeof raw.trust.signature !== 'string' || !raw.trust.signature.trim()) {
        errors.push(`${manifestPath}: Native views require non-empty trust.signature metadata`);
      }
    }
  }

  if (errors.length > 0) {
    const error = new Error(`Interactive UI extension validation failed:\n- ${errors.join('\n- ')}`);
    error.validation = { errors, warnings };
    throw error;
  }
  return {
    extensionId: extension.id,
    version: extension.version,
    declarativeViews,
    nativeViews,
    actions: extension.actions.map((action) => action.id),
    agentRuntime,
    warnings,
  };
};

export const generateSigningKeys = async ({ outputDirectory }) => {
  if (typeof outputDirectory !== 'string' || !outputDirectory.trim()) throw new Error('Signing key output directory is required');
  const directory = path.resolve(outputDirectory);
  await ensureMissingTarget(directory);
  const keys = generatePublisherKeyPair();
  try {
    await fsPromises.mkdir(directory, { recursive: true, mode: 0o700 });
    await fsPromises.writeFile(path.join(directory, 'publisher.private.pem'), keys.privateKey, { flag: 'wx', mode: 0o600 });
    await fsPromises.writeFile(path.join(directory, 'publisher.public.pem'), keys.publicKey, { flag: 'wx', mode: 0o644 });
  } catch (error) {
    await fsPromises.rm(directory, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  return {
    directory,
    privateKeyPath: path.join(directory, 'publisher.private.pem'),
    publicKeyPath: path.join(directory, 'publisher.public.pem'),
  };
};

export const packExtension = async ({ extensionDirectory, outputPath, privateKeyPath, publisherId, publisherName, keyId }) => {
  if (typeof outputPath !== 'string' || !outputPath.trim()) throw new Error('Package output path is required');
  if (typeof privateKeyPath !== 'string' || !privateKeyPath.trim()) throw new Error('Publisher private key path is required');
  const validation = await validateExtension(extensionDirectory);
  const target = path.resolve(outputPath);
  await ensureMissingTarget(target);
  const privateKey = await fsPromises.readFile(path.resolve(privateKeyPath), 'utf8');
  const packed = await createExtensionPackage({
    extensionDirectory,
    privateKey,
    publisherId,
    publisherName,
    keyId,
  });
  await fsPromises.mkdir(path.dirname(target), { recursive: true });
  await fsPromises.writeFile(target, packed.buffer, { flag: 'wx', mode: 0o644 });
  return {
    outputPath: target,
    extensionId: packed.manifest.id,
    version: packed.manifest.version,
    packageHash: packed.packageHash,
    publisherFingerprint: publicKeyFingerprint(packed.packageIndex.publisher.publicKey),
    agentRuntime: packed.agentRuntime ?? validation.agentRuntime,
  };
};

export const verifyPackageFile = async ({ packagePath, publicKeyPath, publisherId, keyId }) => {
  if (typeof packagePath !== 'string' || !packagePath.trim()) throw new Error('Package path is required');
  const buffer = await fsPromises.readFile(path.resolve(packagePath));
  const publicKey = typeof publicKeyPath === 'string' && publicKeyPath.trim()
    ? await fsPromises.readFile(path.resolve(publicKeyPath), 'utf8')
    : null;
  if (publicKey && (!publisherId || !keyId)) {
    throw new Error('--publisher-id and --key-id are required when --public-key is supplied');
  }
  const verified = await verifyExtensionPackage({
    buffer,
    allowEmbeddedPublisherKey: true,
    resolveTrustedPublisherKey: async (candidatePublisherId, candidateKeyId) => (
      publicKey && candidatePublisherId === publisherId && candidateKeyId === keyId ? publicKey : null
    ),
  });
  return {
    extensionId: verified.manifest.id,
    version: verified.manifest.version,
    packageHash: verified.packageHash,
    publisherFingerprint: verified.publisherFingerprint,
    publisherTrusted: verified.publisherTrusted,
    agentRuntime: verified.agentRuntime,
  };
};

export const buildMarketplaceCatalog = async ({
  entriesPath,
  outputPath,
  privateKeyPath,
  marketplaceId,
  marketplaceName,
  keyId,
}) => {
  if (typeof entriesPath !== 'string' || !entriesPath.trim()) throw new Error('Marketplace entries JSON path is required');
  if (typeof outputPath !== 'string' || !outputPath.trim()) throw new Error('Catalog output path is required');
  const [entriesText, privateKey] = await Promise.all([
    fsPromises.readFile(path.resolve(entriesPath), 'utf8'),
    fsPromises.readFile(path.resolve(privateKeyPath), 'utf8'),
  ]);
  let entries;
  try {
    entries = JSON.parse(entriesText);
  } catch {
    throw new Error('Marketplace entries file is not valid JSON');
  }
  if (!Array.isArray(entries)) throw new Error('Marketplace entries JSON must be an array');
  const catalog = createSignedExtensionCatalog({
    marketplaceId,
    marketplaceName,
    keyId,
    privateKey,
    entries,
  });
  const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString();
  verifySignedExtensionCatalog({ catalog, publicKey });
  const target = path.resolve(outputPath);
  await ensureMissingTarget(target);
  await fsPromises.mkdir(path.dirname(target), { recursive: true });
  await fsPromises.writeFile(target, `${JSON.stringify(catalog, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  return { outputPath: target, marketplaceId, entries: catalog.entries.length };
};

const parseCommandLine = (argv) => {
  const args = argv[0] === '--' ? argv.slice(1) : argv;
  const [command, positional, ...rest] = args;
  const options = {};
  for (let index = 0; index < rest.length; index += 1) {
    const key = rest[index];
    if (!key?.startsWith('--')) throw new Error(`Unexpected argument: ${key}`);
    const value = rest[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
    options[key.slice(2)] = value;
    index += 1;
  }
  return { command, positional, options };
};

const usage = `OpenChamber Interactive UI extension CLI

Create a Declarative + Trusted Native starter:
  node scripts/interactive-ui-extension.mjs create <target> --id com.acme.operations --name "Acme Operations" [--tool-prefix operations]

Validate an extension without making network requests or executing Native code:
  node scripts/interactive-ui-extension.mjs validate <extension-directory>

Generate an offline Ed25519 publisher or marketplace signing key pair:
  node scripts/interactive-ui-extension.mjs keygen <new-output-directory>

Validate, sign, and package an extension:
  node scripts/interactive-ui-extension.mjs pack <extension-directory> --out extension.ocix --private-key keys/publisher.private.pem --publisher-id com.acme.publisher --publisher-name "Acme" --key-id release-2026

Verify a signed package using its embedded public key (optionally pin a separately obtained key with the shown flags):
  node scripts/interactive-ui-extension.mjs verify <extension.ocix> [--public-key keys/publisher.public.pem --publisher-id com.acme.publisher --key-id release-2026]

Build a signed static marketplace catalog from an entries array:
  node scripts/interactive-ui-extension.mjs catalog <entries.json> --out catalog.json --private-key keys/publisher.private.pem --marketplace-id com.acme.marketplace --marketplace-name "Acme Marketplace" --key-id catalog-2026`;

const main = async () => {
  const { command, positional, options } = parseCommandLine(process.argv.slice(2));
  if (command === 'create') {
    const result = await scaffoldExtension({
      targetDirectory: positional,
      extensionId: options.id,
      name: options.name,
      toolPrefix: options['tool-prefix'],
    });
    console.log(`Created ${result.extensionId} at ${result.target}`);
    console.log(`Next: edit the API contract, then run node scripts/interactive-ui-extension.mjs validate ${result.target}`);
    return;
  }
  if (command === 'validate') {
    if (!positional) throw new Error('Extension directory is required');
    const result = await validateExtension(positional);
    console.log(`Valid OCIX extension ${result.extensionId}@${result.version}`);
    console.log(`Declarative views: ${result.declarativeViews.length}; Native views: ${result.nativeViews.length}; actions: ${result.actions.length}`);
    console.log(`Agent Runtime: ${result.agentRuntime.tools.length} tools; ${result.agentRuntime.skills.length} skills`);
    for (const warning of result.warnings) console.warn(`Warning: ${warning}`);
    return;
  }
  if (command === 'keygen') {
    const result = await generateSigningKeys({ outputDirectory: positional });
    console.log(`Created offline signing keys in ${result.directory}`);
    console.log(`Keep ${result.privateKeyPath} offline; distribute only ${result.publicKeyPath}`);
    return;
  }
  if (command === 'pack') {
    const result = await packExtension({
      extensionDirectory: positional,
      outputPath: options.out,
      privateKeyPath: options['private-key'],
      publisherId: options['publisher-id'],
      publisherName: options['publisher-name'],
      keyId: options['key-id'],
    });
    console.log(`Created ${result.extensionId}@${result.version}: ${result.outputPath}`);
    console.log(`Package hash: ${result.packageHash}`);
    console.log(`Publisher fingerprint: ${result.publisherFingerprint}`);
    return;
  }
  if (command === 'verify') {
    const result = await verifyPackageFile({
      packagePath: positional,
      publicKeyPath: options['public-key'],
      publisherId: options['publisher-id'],
      keyId: options['key-id'],
    });
    console.log(`Valid signed package ${result.extensionId}@${result.version}`);
    console.log(`Package hash: ${result.packageHash}`);
    console.log(`Publisher fingerprint: ${result.publisherFingerprint}`);
    console.log(`Agent Runtime: ${result.agentRuntime.tools.length} tools; ${result.agentRuntime.skills.length} skills`);
    return;
  }
  if (command === 'catalog') {
    const result = await buildMarketplaceCatalog({
      entriesPath: positional,
      outputPath: options.out,
      privateKeyPath: options['private-key'],
      marketplaceId: options['marketplace-id'],
      marketplaceName: options['marketplace-name'],
      keyId: options['key-id'],
    });
    console.log(`Created signed marketplace catalog with ${result.entries} entries: ${result.outputPath}`);
    return;
  }
  console.log(usage);
  if (command && command !== 'help' && command !== '--help') process.exitCode = 1;
};

const isMain = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
