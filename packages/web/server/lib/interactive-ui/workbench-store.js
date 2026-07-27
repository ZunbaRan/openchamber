import { areWorkbenchVersionRangesCompatible } from './workbench-version.js';

const BOARD_SCHEMA = 'openchamber://extension-board/v1';
const BOARD_SCHEMA_VERSION = 1;
const MAX_BOARDS = 8;
const MAX_TILES = 200;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_SNAPSHOT_BYTES = 512 * 1024;
const MAX_STRING_LENGTH = 512;
const TILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
const SNAPSHOT_REF_PATTERN = /^snapshot_[a-f0-9]{64}$/;
const BLOCKED_CONTEXT_KEYS = new Set([
  'accesskey',
  'accesstoken',
  'authorization',
  'bearer',
  'confirmationtoken',
  'cookie',
  'credential',
  'password',
  'refreshtoken',
  'secret',
  'setcookie',
  'token',
]);

export class InteractiveUIWorkbenchStoreError extends Error {
  constructor(message, code = 'invalid_workbench_board', status = 400, details = undefined) {
    super(message);
    this.name = 'InteractiveUIWorkbenchStoreError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

const fail = (message, code, status, details) => {
  throw new InteractiveUIWorkbenchStoreError(message, code, status, details);
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const boundedString = (value, label, {
  required = true,
  max = MAX_STRING_LENGTH,
  pattern,
} = {}) => {
  if (value === undefined || value === null) {
    if (!required) return null;
    fail(`${label} is required`);
  }
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const trimmed = value.trim();
  if ((!trimmed && required) || trimmed.length > max || (pattern && !pattern.test(trimmed))) {
    fail(`${label} is invalid`);
  }
  return trimmed || null;
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

const assertContextSafe = (value, label = 'tile.context', state = { nodes: 0 }, depth = 0) => {
  state.nodes += 1;
  if (state.nodes > 512 || depth > 12) fail(`${label} is too complex`);
  if (Array.isArray(value)) {
    return value.map((entry, index) => assertContextSafe(entry, `${label}[${index}]`, state, depth + 1));
  }
  if (isRecord(value)) {
    const result = {};
    for (const [key, entry] of Object.entries(value)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/g, '');
      if (BLOCKED_CONTEXT_KEYS.has(normalizedKey)) {
        fail(`${label} contains prohibited sensitive field ${key}`, 'workbench_sensitive_context', 400);
      }
      if (key === '__proto__' || key === 'prototype' || key === 'constructor') {
        fail(`${label} contains an unsafe property`);
      }
      result[key] = assertContextSafe(entry, `${label}.${key}`, state, depth + 1);
    }
    return result;
  }
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.length <= 10_000) return value;
  fail(`${label} contains a non-JSON or oversized value`);
};

const normalizeContext = (value) => {
  if (!isRecord(value)) fail('tile.context must be an object');
  const context = canonicalize(assertContextSafe(value));
  if (Buffer.byteLength(JSON.stringify(context), 'utf8') > MAX_CONTEXT_BYTES) {
    fail(`tile.context exceeds ${MAX_CONTEXT_BYTES} bytes`, 'workbench_context_too_large', 413);
  }
  return context;
};

const normalizeLayout = (value) => {
  if (!isRecord(value)) fail('tile.layout must be an object');
  const read = (field, min, max) => {
    const candidate = value[field];
    if (!Number.isInteger(candidate) || candidate < min || candidate > max) {
      fail(`tile.layout.${field} must be an integer from ${min} to ${max}`);
    }
    return candidate;
  };
  const layout = {
    column: read('column', 0, 11),
    row: read('row', 0, 100_000),
    columns: read('columns', 1, 12),
    rows: read('rows', 1, 24),
  };
  if (layout.column + layout.columns > 12) fail('tile.layout exceeds the 12-column board');
  return layout;
};

const normalizeSource = (value) => {
  if (!isRecord(value)) fail('tile.source must be an object');
  if (value.kind === 'third-party-extension') {
    return {
      kind: 'third-party-extension',
      extensionId: boundedString(value.extensionId, 'tile.source.extensionId', { max: 160 }),
      surfaceId: boundedString(value.surfaceId, 'tile.source.surfaceId', { max: 180 }),
      compatibleVersion: boundedString(value.compatibleVersion, 'tile.source.compatibleVersion', { max: 80 }),
    };
  }
  if (value.kind === 'agent-generated') {
    return {
      kind: 'agent-generated',
      snapshotRef: boundedString(value.snapshotRef, 'tile.source.snapshotRef', { max: 256 }),
    };
  }
  fail('tile.source.kind is unsupported');
};

const normalizeRelationship = (value) => {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail('tile.relationship must be an object');
  return {
    groupId: boundedString(value.groupId, 'tile.relationship.groupId', { max: 128, pattern: SAFE_ID_PATTERN }),
    kind: boundedString(value.kind, 'tile.relationship.kind', { max: 80, pattern: SAFE_ID_PATTERN }),
    parentTileId: boundedString(value.parentTileId, 'tile.relationship.parentTileId', {
      required: false,
      max: 128,
      pattern: TILE_ID_PATTERN,
    }),
  };
};

const normalizeOrigin = (value) => {
  if (value === undefined || value === null) return null;
  if (!isRecord(value)) fail('tile.origin must be an object');
  const result = {};
  for (const field of ['sessionId', 'messageId', 'toolCallId']) {
    const normalized = boundedString(value[field], `tile.origin.${field}`, {
      required: false,
      max: 160,
      pattern: SAFE_ID_PATTERN,
    });
    if (normalized) result[field] = normalized;
  }
  return Object.keys(result).length > 0 ? result : null;
};

const normalizeTile = (value, { now, createId, preserveTimestamps = false } = {}) => {
  if (!isRecord(value)) fail('tile must be an object');
  const source = normalizeSource(value.source);
  const form = value.form;
  if (!['interactive-ui', 'html-artifact'].includes(form)) fail('tile.form is unsupported');
  const displayMode = value.displayMode === undefined ? 'tile' : value.displayMode;
  if (!['tile', 'focus', 'popout'].includes(displayMode)) fail('tile.displayMode is unsupported');
  const tileId = value.tileId === undefined
    ? `tile_${createId()}`
    : boundedString(value.tileId, 'tile.tileId', { max: 128, pattern: TILE_ID_PATTERN });
  const timestamp = new Date(now).toISOString();
  const createdAt = preserveTimestamps && typeof value.createdAt === 'string' && !Number.isNaN(Date.parse(value.createdAt))
    ? value.createdAt
    : timestamp;
  const updatedAt = preserveTimestamps && typeof value.updatedAt === 'string' && !Number.isNaN(Date.parse(value.updatedAt))
    ? value.updatedAt
    : timestamp;
  return {
    tileId,
    source,
    form,
    context: normalizeContext(value.context ?? {}),
    contextDigest: boundedString(value.contextDigest, 'tile.contextDigest', { max: 96 }),
    layout: normalizeLayout(value.layout),
    displayMode,
    relationship: normalizeRelationship(value.relationship),
    origin: normalizeOrigin(value.origin),
    createdAt,
    updatedAt,
  };
};

const createEmptyDocument = (projectId) => ({
  $schema: BOARD_SCHEMA,
  schemaVersion: BOARD_SCHEMA_VERSION,
  projectId,
  activeBoardId: 'default',
  boards: [{
    id: 'default',
    name: 'Default',
    revision: 0,
    tiles: [],
  }],
});

const normalizeDocument = (value, projectId, dependencies) => {
  if (!isRecord(value) || value.$schema !== BOARD_SCHEMA || value.schemaVersion !== BOARD_SCHEMA_VERSION) {
    fail('Workbench board file schema is unsupported', 'workbench_board_schema_unsupported', 409);
  }
  if (value.projectId !== projectId) fail('Workbench board project identity does not match', 'workbench_project_mismatch', 409);
  if (!Array.isArray(value.boards) || value.boards.length === 0 || value.boards.length > MAX_BOARDS) {
    fail(`Workbench board file must contain 1-${MAX_BOARDS} boards`);
  }
  const seenBoards = new Set();
  const boards = value.boards.map((board) => {
    if (!isRecord(board)) fail('Workbench board entry must be an object');
    const id = boundedString(board.id, 'board.id', { max: 80, pattern: SAFE_ID_PATTERN });
    if (seenBoards.has(id)) fail(`Workbench board file contains duplicate board ${id}`);
    seenBoards.add(id);
    const name = boundedString(board.name, 'board.name', { max: 120 });
    if (!Number.isInteger(board.revision) || board.revision < 0) fail(`Board ${id} revision is invalid`);
    if (!Array.isArray(board.tiles) || board.tiles.length > MAX_TILES) fail(`Board ${id} contains too many tiles`);
    const seenTiles = new Set();
    const tiles = board.tiles.map((tile) => {
      const normalized = normalizeTile(tile, {
        now: dependencies.now(),
        createId: dependencies.createId,
        preserveTimestamps: true,
      });
      if (seenTiles.has(normalized.tileId)) fail(`Board ${id} contains duplicate tile ${normalized.tileId}`);
      seenTiles.add(normalized.tileId);
      return normalized;
    });
    return { id, name, revision: board.revision, tiles };
  });
  const activeBoardId = boundedString(value.activeBoardId, 'activeBoardId', { max: 80, pattern: SAFE_ID_PATTERN });
  if (!seenBoards.has(activeBoardId)) fail('activeBoardId does not reference a stored board');
  return {
    $schema: BOARD_SCHEMA,
    schemaVersion: BOARD_SCHEMA_VERSION,
    projectId,
    activeBoardId,
    boards,
  };
};

export const createInteractiveUIWorkbenchStore = ({
  dataDirectory,
  fsImpl,
  pathImpl,
  cryptoImpl,
  now = () => Date.now(),
} = {}) => {
  if (typeof dataDirectory !== 'string' || !dataDirectory.trim() || !fsImpl || !pathImpl || !cryptoImpl) {
    throw new Error('Workbench store dependencies are required');
  }
  const workbenchRoot = pathImpl.join(pathImpl.resolve(dataDirectory), 'extension-workbench');
  const root = pathImpl.join(workbenchRoot, 'boards');
  const snapshotRoot = pathImpl.join(workbenchRoot, 'snapshots');
  const locks = new Map();
  const dependencies = {
    now,
    createId: () => cryptoImpl.randomUUID(),
  };

  const normalizeProjectId = (value) => boundedString(value, 'projectId', { max: 512 });
  const projectFile = (projectId) => {
    const digest = cryptoImpl.createHash('sha256').update(projectId).digest('base64url');
    return pathImpl.join(root, `${digest}.json`);
  };

  const read = async (projectIdValue) => {
    const projectId = normalizeProjectId(projectIdValue);
    const filePath = projectFile(projectId);
    let raw;
    try {
      const stat = await fsImpl.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        fail('Workbench board file is invalid or too large', 'workbench_board_malformed', 409);
      }
      raw = await fsImpl.readFile(filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') return createEmptyDocument(projectId);
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail('Workbench board file is malformed', 'workbench_board_malformed', 409);
    }
    return normalizeDocument(parsed, projectId, dependencies);
  };

  const write = async (projectId, document) => {
    const normalized = normalizeDocument(document, projectId, dependencies);
    const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
    if (Buffer.byteLength(serialized, 'utf8') > MAX_FILE_BYTES) {
      fail('Workbench board file exceeds its size limit', 'workbench_board_too_large', 413);
    }
    await fsImpl.mkdir(root, { recursive: true, mode: 0o700 });
    const filePath = projectFile(projectId);
    const temporaryPath = `${filePath}.tmp-${process.pid}-${dependencies.createId()}`;
    try {
      await fsImpl.writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600 });
      await fsImpl.rename(temporaryPath, filePath);
    } catch (error) {
      await fsImpl.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return normalized;
  };

  const withLock = async (projectIdValue, operation) => {
    const projectId = normalizeProjectId(projectIdValue);
    const previous = locks.get(projectId) ?? Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const current = previous.finally(() => gate);
    locks.set(projectId, current);
    await previous;
    try {
      return await operation(projectId);
    } finally {
      release();
      if (locks.get(projectId) === current) locks.delete(projectId);
    }
  };

  const activeBoard = (document) => document.boards.find((board) => board.id === document.activeBoardId);
  const assertRevision = (board, expectedRevision) => {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      fail('expectedRevision is required', 'workbench_revision_required', 400);
    }
    if (board.revision !== expectedRevision) {
      fail('Workbench board changed since it was loaded', 'workbench_revision_conflict', 409, {
        expectedRevision,
        actualRevision: board.revision,
      });
    }
  };

  const upsertTile = async (projectId, expectedRevision, tileInput) => withLock(projectId, async (normalizedProjectId) => {
    const document = await read(normalizedProjectId);
    const board = activeBoard(document);
    assertRevision(board, expectedRevision);
    const normalized = normalizeTile(tileInput, {
      now: dependencies.now(),
      createId: dependencies.createId,
    });
    const dedupeIndex = board.tiles.findIndex((tile) => (
      tile.source.kind === normalized.source.kind
      && tile.form === normalized.form
      && tile.contextDigest === normalized.contextDigest
      && (
        normalized.source.kind === 'third-party-extension'
          ? tile.source.extensionId === normalized.source.extensionId
            && tile.source.surfaceId === normalized.source.surfaceId
            && areWorkbenchVersionRangesCompatible(
              tile.source.compatibleVersion,
              normalized.source.compatibleVersion,
            )
          : tile.source.snapshotRef === normalized.source.snapshotRef
      )
    ));
    let tile;
    let created;
    if (dedupeIndex >= 0) {
      const existing = board.tiles[dedupeIndex];
      tile = { ...existing, updatedAt: new Date(dependencies.now()).toISOString() };
      board.tiles[dedupeIndex] = tile;
      created = false;
    } else {
      if (board.tiles.length >= MAX_TILES) fail(`Board contains the maximum ${MAX_TILES} tiles`, 'workbench_tile_limit', 409);
      tile = normalized;
      board.tiles.push(tile);
      created = true;
    }
    board.revision += 1;
    const snapshot = await write(normalizedProjectId, document);
    return { snapshot, tile, created };
  });

  const updateTile = async (projectId, tileIdValue, expectedRevision, patch) => withLock(projectId, async (normalizedProjectId) => {
    const tileId = boundedString(tileIdValue, 'tileId', { max: 128, pattern: TILE_ID_PATTERN });
    if (!isRecord(patch)) fail('tile patch must be an object');
    const document = await read(normalizedProjectId);
    const board = activeBoard(document);
    assertRevision(board, expectedRevision);
    const index = board.tiles.findIndex((tile) => tile.tileId === tileId);
    if (index < 0) fail('Workbench tile was not found', 'workbench_tile_not_found', 404);
    const current = board.tiles[index];
    const next = {
      ...current,
      ...(patch.layout === undefined ? {} : { layout: normalizeLayout(patch.layout) }),
      ...(patch.displayMode === undefined ? {} : {
        displayMode: ['tile', 'focus', 'popout'].includes(patch.displayMode)
          ? patch.displayMode
          : fail('tile.displayMode is unsupported'),
      }),
      ...(patch.relationship === undefined ? {} : { relationship: normalizeRelationship(patch.relationship) }),
      updatedAt: new Date(dependencies.now()).toISOString(),
    };
    board.tiles[index] = next;
    board.revision += 1;
    const snapshot = await write(normalizedProjectId, document);
    return { snapshot, tile: next };
  });

  const updateTileLayouts = async (
    projectId,
    expectedRevision,
    layoutUpdates,
  ) => withLock(projectId, async (normalizedProjectId) => {
    if (!Array.isArray(layoutUpdates) || layoutUpdates.length < 1 || layoutUpdates.length > MAX_TILES) {
      fail('layout updates must contain between 1 and the maximum number of tiles');
    }
    const document = await read(normalizedProjectId);
    const board = activeBoard(document);
    assertRevision(board, expectedRevision);
    const updates = new Map();
    for (const entry of layoutUpdates) {
      if (!isRecord(entry)) fail('layout update must be an object');
      const tileId = boundedString(entry.tileId, 'tileId', { max: 128, pattern: TILE_ID_PATTERN });
      if (updates.has(tileId)) fail('layout updates cannot contain duplicate tile IDs');
      updates.set(tileId, normalizeLayout(entry.layout));
    }
    const missing = Array.from(updates.keys()).filter(
      (tileId) => !board.tiles.some((tile) => tile.tileId === tileId),
    );
    if (missing.length > 0) {
      fail('Workbench tile was not found', 'workbench_tile_not_found', 404);
    }
    const updatedAt = new Date(dependencies.now()).toISOString();
    const tiles = [];
    board.tiles = board.tiles.map((tile) => {
      const layout = updates.get(tile.tileId);
      if (!layout) return tile;
      const next = { ...tile, layout, updatedAt };
      tiles.push(next);
      return next;
    });
    board.revision += 1;
    const snapshot = await write(normalizedProjectId, document);
    return { snapshot, tiles };
  });

  const migrateTile = async (
    projectId,
    tileIdValue,
    expectedRevision,
    migratedInput,
  ) => withLock(projectId, async (normalizedProjectId) => {
    const tileId = boundedString(tileIdValue, 'tileId', { max: 128, pattern: TILE_ID_PATTERN });
    const document = await read(normalizedProjectId);
    const board = activeBoard(document);
    assertRevision(board, expectedRevision);
    const index = board.tiles.findIndex((tile) => tile.tileId === tileId);
    if (index < 0) fail('Workbench tile was not found', 'workbench_tile_not_found', 404);
    const current = board.tiles[index];
    if (current.source.kind !== 'third-party-extension') {
      fail('Generated Workbench tiles do not support extension migration', 'workbench_migration_unsupported', 409);
    }
    const normalized = normalizeTile({
      ...migratedInput,
      tileId,
      relationship: current.relationship,
      origin: current.origin,
      displayMode: current.displayMode,
      createdAt: current.createdAt,
      updatedAt: new Date(dependencies.now()).toISOString(),
    }, {
      now: dependencies.now(),
      createId: dependencies.createId,
      preserveTimestamps: true,
    });
    if (normalized.source.kind !== 'third-party-extension'
      || normalized.source.extensionId !== current.source.extensionId
      || normalized.source.surfaceId !== current.source.surfaceId
      || normalized.form !== current.form) {
      fail('Workbench migration cannot change Tile ownership or form', 'workbench_migration_identity_mismatch', 409);
    }
    board.tiles[index] = normalized;
    board.revision += 1;
    const snapshot = await write(normalizedProjectId, document);
    return { snapshot, tile: normalized };
  });

  const removeTile = async (projectId, tileIdValue, expectedRevision) => withLock(projectId, async (normalizedProjectId) => {
    const tileId = boundedString(tileIdValue, 'tileId', { max: 128, pattern: TILE_ID_PATTERN });
    const document = await read(normalizedProjectId);
    const board = activeBoard(document);
    assertRevision(board, expectedRevision);
    const removed = board.tiles.find((tile) => tile.tileId === tileId) ?? null;
    if (!removed) fail('Workbench tile was not found', 'workbench_tile_not_found', 404);
    board.tiles = board.tiles
      .filter((tile) => tile.tileId !== tileId)
      .map((tile) => tile.relationship?.parentTileId === tileId
        ? { ...tile, relationship: null, updatedAt: new Date(dependencies.now()).toISOString() }
        : tile);
    board.revision += 1;
    const snapshot = await write(normalizedProjectId, document);
    return { snapshot, removed };
  });

  const removeExtensionTiles = async (extensionIdValue) => {
    const extensionId = boundedString(extensionIdValue, 'extensionId', { max: 160 });
    let entries;
    try {
      entries = await fsImpl.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return { removed: 0, projects: 0 };
      throw error;
    }
    let removed = 0;
    let projects = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = pathImpl.join(root, entry.name);
      let parsed;
      try {
        parsed = JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
      } catch {
        continue;
      }
      if (!isRecord(parsed) || typeof parsed.projectId !== 'string') continue;
      await withLock(parsed.projectId, async (projectId) => {
        const document = await read(projectId);
        let changed = false;
        for (const board of document.boards) {
          const removedIds = new Set(board.tiles
            .filter((tile) => tile.source.kind === 'third-party-extension' && tile.source.extensionId === extensionId)
            .map((tile) => tile.tileId));
          if (removedIds.size === 0) continue;
          removed += removedIds.size;
          board.tiles = board.tiles
            .filter((tile) => !removedIds.has(tile.tileId))
            .map((tile) => tile.relationship?.parentTileId && removedIds.has(tile.relationship.parentTileId)
              ? { ...tile, relationship: null, updatedAt: new Date(dependencies.now()).toISOString() }
              : tile);
          board.revision += 1;
          changed = true;
        }
        if (changed) {
          projects += 1;
          await write(projectId, document);
        }
      });
    }
    return { removed, projects };
  };

  const getExtensionTileImpact = async (extensionIdValue) => {
    const extensionId = boundedString(extensionIdValue, 'extensionId', { max: 160 });
    let entries;
    try {
      entries = await fsImpl.readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') return { tiles: 0, projects: 0 };
      throw error;
    }
    let tiles = 0;
    let projects = 0;
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const filePath = pathImpl.join(root, entry.name);
      let parsed;
      try {
        parsed = JSON.parse(await fsImpl.readFile(filePath, 'utf8'));
      } catch {
        continue;
      }
      if (!isRecord(parsed) || typeof parsed.projectId !== 'string') continue;
      const document = await read(parsed.projectId);
      let projectTiles = 0;
      for (const board of document.boards) {
        projectTiles += board.tiles.filter((tile) => (
          tile.source.kind === 'third-party-extension'
          && tile.source.extensionId === extensionId
        )).length;
      }
      if (projectTiles > 0) projects += 1;
      tiles += projectTiles;
    }
    return { tiles, projects };
  };

  const normalizeGeneratedSnapshot = (form, envelope) => {
    if (!['interactive-ui', 'html-artifact'].includes(form) || !isRecord(envelope)) {
      fail('Generated Workbench snapshot is invalid', 'invalid_workbench_snapshot', 400);
    }
    const expectedSchema = form === 'interactive-ui'
      ? 'openchamber://interactive-result/v1'
      : 'openchamber://html-artifact-result/v1';
    if (envelope.$schema !== expectedSchema || envelope.schemaVersion !== 1) {
      fail('Generated Workbench snapshot schema does not match its form', 'invalid_workbench_snapshot', 400);
    }
    if (form === 'interactive-ui' && (
      typeof envelope.view !== 'string'
      || !envelope.view.trim()
      || envelope.view.length > 200
    )) {
      fail('Generated Interactive UI snapshot is missing its view', 'invalid_workbench_snapshot', 400);
    }
    if (form === 'html-artifact' && (
      typeof envelope.title !== 'string'
      || typeof envelope.html !== 'string'
      || envelope.html.length === 0
    )) {
      fail('Generated HTML Artifact snapshot is incomplete', 'invalid_workbench_snapshot', 400);
    }
    let serialized;
    try {
      serialized = JSON.stringify({ form, envelope });
    } catch {
      fail('Generated Workbench snapshot must be JSON', 'invalid_workbench_snapshot', 400);
    }
    if (Buffer.byteLength(serialized, 'utf8') > MAX_SNAPSHOT_BYTES) {
      fail('Generated Workbench snapshot is too large', 'workbench_snapshot_too_large', 413);
    }
    return { form, envelope: JSON.parse(JSON.stringify(envelope)) };
  };

  const writeSnapshot = async (form, envelope) => {
    const normalized = normalizeGeneratedSnapshot(form, envelope);
    const serializedPayload = JSON.stringify(normalized);
    const snapshotRef = `snapshot_${cryptoImpl.createHash('sha256').update(serializedPayload).digest('hex')}`;
    const record = {
      $schema: 'openchamber://extension-workbench-snapshot/v1',
      schemaVersion: 1,
      snapshotRef,
      form: normalized.form,
      envelope: normalized.envelope,
      createdAt: new Date(dependencies.now()).toISOString(),
    };
    const serialized = `${JSON.stringify(record, null, 2)}\n`;
    await fsImpl.mkdir(snapshotRoot, { recursive: true, mode: 0o700 });
    const filePath = pathImpl.join(snapshotRoot, `${snapshotRef}.json`);
    try {
      const existing = await fsImpl.stat(filePath);
      if (existing.isFile()) return record;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
    const temporaryPath = `${filePath}.tmp-${process.pid}-${dependencies.createId()}`;
    try {
      await fsImpl.writeFile(temporaryPath, serialized, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      try {
        await fsImpl.rename(temporaryPath, filePath);
      } catch (error) {
        if (error?.code !== 'EEXIST') throw error;
        await fsImpl.rm(temporaryPath, { force: true });
      }
    } catch (error) {
      await fsImpl.rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
    return record;
  };

  const readSnapshot = async (snapshotRefValue) => {
    const snapshotRef = boundedString(snapshotRefValue, 'snapshotRef', {
      max: 80,
      pattern: SNAPSHOT_REF_PATTERN,
    });
    const filePath = pathImpl.join(snapshotRoot, `${snapshotRef}.json`);
    let raw;
    try {
      const stat = await fsImpl.stat(filePath);
      if (!stat.isFile() || stat.size > MAX_SNAPSHOT_BYTES) {
        fail('Workbench snapshot is invalid or too large', 'workbench_snapshot_malformed', 409);
      }
      raw = await fsImpl.readFile(filePath, 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') {
        fail('Workbench snapshot was not found', 'workbench_snapshot_not_found', 404);
      }
      throw error;
    }
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      fail('Workbench snapshot is malformed', 'workbench_snapshot_malformed', 409);
    }
    if (!isRecord(parsed)
      || parsed.$schema !== 'openchamber://extension-workbench-snapshot/v1'
      || parsed.schemaVersion !== 1
      || parsed.snapshotRef !== snapshotRef) {
      fail('Workbench snapshot is malformed', 'workbench_snapshot_malformed', 409);
    }
    normalizeGeneratedSnapshot(parsed.form, parsed.envelope);
    return parsed;
  };

  return {
    read,
    readSnapshot,
    writeSnapshot,
    upsertTile,
    updateTile,
    updateTileLayouts,
    migrateTile,
    removeTile,
    getExtensionTileImpact,
    removeExtensionTiles,
  };
};
