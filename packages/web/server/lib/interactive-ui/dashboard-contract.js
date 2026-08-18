import nodePath from 'node:path';

const EXTENSION_ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)+$/i;
const EVENT_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)+$/;
const LINK_ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/;
const SAFE_PATH_SEGMENT_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const HOST_CONTEXT_SOURCES = new Set([
  'project.id',
  'project.path',
  'session.id',
  'theme',
  'locale',
  'timezone',
]);
const SCHEMA_TYPES = new Set(['object', 'array', 'string', 'number', 'integer', 'boolean']);
const SCHEMA_FORMATS = new Set(['date', 'date-time', 'email', 'uuid']);
const MAX_SCHEMA_DEPTH = 8;
const MAX_SCHEMA_NODES = 256;
const MAX_SCHEMA_PROPERTIES = 128;
const MAX_SCHEMA_ENUM_VALUES = 64;
const MAX_CONTEXT_DEPTH = 12;
const MAX_CONTEXT_NODES = 512;
const MAX_CONTEXT_BYTES = 64 * 1024;
const MAX_EVENTS = 32;
const MAX_LINKS = 64;
const MAX_MAPPING_FIELDS = 64;
const MAX_MIGRATIONS = 16;
const MAX_MIGRATION_OPERATIONS = 32;
const MAX_ICON_BYTES = 256 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export class InteractiveUIDashboardContractError extends Error {
  constructor(message, code = 'invalid_dashboard_contract') {
    super(message);
    this.name = 'InteractiveUIDashboardContractError';
    this.code = code;
  }
}

const fail = (message, code) => {
  throw new InteractiveUIDashboardContractError(message, code);
};

const isRecord = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const assertAllowedKeys = (value, allowed, label) => {
  const unexpected = Object.keys(value).find((key) => !allowed.has(key));
  if (unexpected) fail(`${label} contains unsupported field ${unexpected}`);
};

const normalizeBoundedString = (value, label, { min = 1, max = 240, pattern } = {}) => {
  if (typeof value !== 'string') fail(`${label} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min || trimmed.length > max || (pattern && !pattern.test(trimmed))) {
    fail(`${label} is invalid`);
  }
  return trimmed;
};

const normalizeSafePath = (value, label) => {
  const path = normalizeBoundedString(value, label, { max: 256 });
  const segments = path.split('.');
  if (segments.length === 0 || segments.length > 12
    || segments.some((segment) => !SAFE_PATH_SEGMENT_PATTERN.test(segment) || BLOCKED_PATH_SEGMENTS.has(segment))) {
    fail(`${label} must use safe property segments`);
  }
  return path;
};

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
};

const canonicalEqual = (left, right) => JSON.stringify(canonicalize(left)) === JSON.stringify(canonicalize(right));

const normalizeFiniteInteger = (value, label, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(`${label} must be an integer from ${min} to ${max}`);
  }
  return value;
};

const normalizeFiniteNumber = (value, label) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(`${label} must be a finite number`);
  }
  return value;
};

const normalizeJSONSchema = (value, label = 'dashboard.inputSchema') => {
  const state = { nodes: 0 };

  const visit = (schema, path, depth) => {
    state.nodes += 1;
    if (state.nodes > MAX_SCHEMA_NODES) fail(`${label} exceeds ${MAX_SCHEMA_NODES} schema nodes`);
    if (depth > MAX_SCHEMA_DEPTH) fail(`${label} exceeds depth ${MAX_SCHEMA_DEPTH}`);
    if (!isRecord(schema)) fail(`${path} must be an object`);
    assertAllowedKeys(schema, new Set([
      'type',
      'properties',
      'items',
      'required',
      'enum',
      'format',
      'minLength',
      'maxLength',
      'minimum',
      'maximum',
      'minItems',
      'maxItems',
    ]), path);

    if (!SCHEMA_TYPES.has(schema.type)) fail(`${path}.type is unsupported`);
    const normalized = { type: schema.type };

    if (schema.enum !== undefined) {
      if (!Array.isArray(schema.enum) || schema.enum.length === 0 || schema.enum.length > MAX_SCHEMA_ENUM_VALUES) {
        fail(`${path}.enum must contain 1-${MAX_SCHEMA_ENUM_VALUES} values`);
      }
      const seen = new Set();
      normalized.enum = schema.enum.map((entry, index) => {
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') {
          fail(`${path}.enum[${index}] is not JSON-safe`);
        }
        const serialized = JSON.stringify(canonicalize(entry));
        if (serialized === undefined || seen.has(serialized)) fail(`${path}.enum contains duplicate or invalid values`);
        seen.add(serialized);
        return canonicalize(entry);
      });
    }

    if (schema.type === 'object') {
      if (schema.items !== undefined
        || schema.format !== undefined
        || schema.minLength !== undefined
        || schema.maxLength !== undefined
        || schema.minimum !== undefined
        || schema.maximum !== undefined
        || schema.minItems !== undefined
        || schema.maxItems !== undefined) {
        fail(`${path} contains constraints that do not apply to object`);
      }
      const properties = schema.properties === undefined ? {} : schema.properties;
      if (!isRecord(properties) || Object.keys(properties).length > MAX_SCHEMA_PROPERTIES) {
        fail(`${path}.properties must be an object with at most ${MAX_SCHEMA_PROPERTIES} entries`);
      }
      normalized.properties = {};
      for (const [property, propertySchema] of Object.entries(properties)) {
        if (!SAFE_PATH_SEGMENT_PATTERN.test(property) || BLOCKED_PATH_SEGMENTS.has(property)) {
          fail(`${path}.properties contains unsafe property ${property}`);
        }
        normalized.properties[property] = visit(propertySchema, `${path}.properties.${property}`, depth + 1);
      }
      const required = schema.required === undefined ? [] : schema.required;
      if (!Array.isArray(required)
        || required.some((property) => typeof property !== 'string' || !Object.hasOwn(normalized.properties, property))
        || new Set(required).size !== required.length) {
        fail(`${path}.required must contain unique declared properties`);
      }
      normalized.required = [...required];
    } else if (schema.type === 'array') {
      if (schema.properties !== undefined
        || schema.required !== undefined
        || schema.format !== undefined
        || schema.minLength !== undefined
        || schema.maxLength !== undefined
        || schema.minimum !== undefined
        || schema.maximum !== undefined) {
        fail(`${path} contains constraints that do not apply to array`);
      }
      if (!isRecord(schema.items)) fail(`${path}.items is required`);
      normalized.items = visit(schema.items, `${path}.items`, depth + 1);
      const minItems = schema.minItems === undefined ? 0 : normalizeFiniteInteger(schema.minItems, `${path}.minItems`, 0, 256);
      const maxItems = schema.maxItems === undefined ? 256 : normalizeFiniteInteger(schema.maxItems, `${path}.maxItems`, 0, 256);
      if (minItems > maxItems) fail(`${path}.minItems cannot exceed maxItems`);
      normalized.minItems = minItems;
      normalized.maxItems = maxItems;
    } else if (schema.type === 'string') {
      if (schema.properties !== undefined
        || schema.required !== undefined
        || schema.items !== undefined
        || schema.minimum !== undefined
        || schema.maximum !== undefined
        || schema.minItems !== undefined
        || schema.maxItems !== undefined) {
        fail(`${path} contains constraints that do not apply to string`);
      }
      const minLength = schema.minLength === undefined ? 0 : normalizeFiniteInteger(schema.minLength, `${path}.minLength`, 0, 10_000);
      const maxLength = schema.maxLength === undefined ? 10_000 : normalizeFiniteInteger(schema.maxLength, `${path}.maxLength`, 0, 10_000);
      if (minLength > maxLength) fail(`${path}.minLength cannot exceed maxLength`);
      normalized.minLength = minLength;
      normalized.maxLength = maxLength;
      if (schema.format !== undefined) {
        if (typeof schema.format !== 'string' || !SCHEMA_FORMATS.has(schema.format)) {
          fail(`${path}.format is unsupported`);
        }
        normalized.format = schema.format;
      }
    } else if (schema.type === 'number' || schema.type === 'integer') {
      if (schema.properties !== undefined
        || schema.required !== undefined
        || schema.items !== undefined
        || schema.format !== undefined
        || schema.minLength !== undefined
        || schema.maxLength !== undefined
        || schema.minItems !== undefined
        || schema.maxItems !== undefined) {
        fail(`${path} contains constraints that do not apply to ${schema.type}`);
      }
      if (schema.minimum !== undefined) normalized.minimum = normalizeFiniteNumber(schema.minimum, `${path}.minimum`);
      if (schema.maximum !== undefined) normalized.maximum = normalizeFiniteNumber(schema.maximum, `${path}.maximum`);
      if (normalized.minimum !== undefined && normalized.maximum !== undefined && normalized.minimum > normalized.maximum) {
        fail(`${path}.minimum cannot exceed maximum`);
      }
    } else {
      if (schema.properties !== undefined
        || schema.required !== undefined
        || schema.items !== undefined
        || schema.format !== undefined
        || schema.minLength !== undefined
        || schema.maxLength !== undefined
        || schema.minimum !== undefined
        || schema.maximum !== undefined
        || schema.minItems !== undefined
        || schema.maxItems !== undefined) {
        fail(`${path} contains constraints that do not apply to boolean`);
      }
    }

    if (normalized.enum) {
      for (const entry of normalized.enum) {
        validateValueAgainstSchema(normalized, entry, `${path}.enum`, { requireComplete: true, checkEnum: false });
      }
    }
    return normalized;
  };

  return visit(value, label, 0);
};

const matchesFormat = (format, value) => {
  if (format === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
  if (format === 'date-time') return !Number.isNaN(Date.parse(value));
  if (format === 'email') return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  if (format === 'uuid') return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  return true;
};

function validateValueAgainstSchema(schema, value, label, {
  requireComplete = true,
  checkEnum = true,
  state = { nodes: 0 },
  depth = 0,
} = {}) {
  state.nodes += 1;
  if (state.nodes > MAX_CONTEXT_NODES || depth > MAX_CONTEXT_DEPTH) fail(`${label} is too complex`);
  if (checkEnum && schema.enum && !schema.enum.some((entry) => canonicalEqual(entry, value))) {
    fail(`${label} is not one of the allowed values`);
  }

  if (schema.type === 'object') {
    if (!isRecord(value)) fail(`${label} must be an object`);
    const result = {};
    for (const [property, propertySchema] of Object.entries(schema.properties)) {
      if (!Object.hasOwn(value, property) || value[property] === undefined) {
        if (requireComplete && schema.required.includes(property)) fail(`${label}.${property} is required`);
        continue;
      }
      result[property] = validateValueAgainstSchema(propertySchema, value[property], `${label}.${property}`, {
        requireComplete,
        checkEnum: true,
        state,
        depth: depth + 1,
      });
    }
    return result;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) fail(`${label} must be an array`);
    if (value.length < schema.minItems || value.length > schema.maxItems) fail(`${label} has an invalid item count`);
    return value.map((entry, index) => validateValueAgainstSchema(schema.items, entry, `${label}[${index}]`, {
      requireComplete,
      checkEnum: true,
      state,
      depth: depth + 1,
    }));
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') fail(`${label} must be a string`);
    if (value.length < schema.minLength || value.length > schema.maxLength) fail(`${label} has an invalid length`);
    if (schema.format && !matchesFormat(schema.format, value)) fail(`${label} does not match format ${schema.format}`);
    return value;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value) || (schema.type === 'integer' && !Number.isInteger(value))) {
      fail(`${label} must be a ${schema.type}`);
    }
    if (schema.minimum !== undefined && value < schema.minimum) fail(`${label} is below minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) fail(`${label} is above maximum`);
    return value;
  }
  if (typeof value !== 'boolean') fail(`${label} must be a boolean`);
  return value;
}

export const sanitizeDashboardContext = (schema, value, { requireComplete = true } = {}) => {
  const normalizedSchema = normalizeJSONSchema(schema);
  const context = validateValueAgainstSchema(normalizedSchema, value, 'context', { requireComplete });
  const serialized = JSON.stringify(context);
  if (Buffer.byteLength(serialized, 'utf8') > MAX_CONTEXT_BYTES) {
    fail(`context exceeds ${MAX_CONTEXT_BYTES} bytes`, 'dashboard_context_too_large');
  }
  return canonicalize(context);
};

const getPath = (value, path) => {
  let current = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.hasOwn(current, segment)) return undefined;
    current = current[segment];
  }
  return current;
};

const schemaHasPath = (schema, path) => {
  let current = schema;
  for (const segment of path.split('.')) {
    if (current.type !== 'object' || !Object.hasOwn(current.properties, segment)) return false;
    current = current.properties[segment];
  }
  return true;
};

const schemaAtPath = (schema, path) => {
  let current = schema;
  for (const segment of path.split('.')) {
    if (current.type !== 'object' || !Object.hasOwn(current.properties, segment)) return null;
    current = current.properties[segment];
  }
  return current;
};

const setPath = (value, path, nextValue) => {
  const segments = path.split('.');
  let current = value;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(current[segment])) current[segment] = {};
    current = current[segment];
  }
  current[segments.at(-1)] = nextValue;
};

const deletePath = (value, path) => {
  const segments = path.split('.');
  let current = value;
  for (const segment of segments.slice(0, -1)) {
    if (!isRecord(current[segment])) return;
    current = current[segment];
  }
  delete current[segments.at(-1)];
};

const collectRequiredPaths = (schema, prefix = '') => {
  if (schema.type !== 'object') return [];
  const result = [];
  for (const property of schema.required) {
    const path = prefix ? `${prefix}.${property}` : property;
    result.push(path);
    const child = schema.properties[property];
    if (child?.type === 'object') result.push(...collectRequiredPaths(child, path));
  }
  return result;
};

const normalizeHostContext = (value, schema, surfaceId) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 16) fail(`Surface ${surfaceId} dashboard.hostContext must contain at most 16 mappings`);
  const seenTargets = new Set();
  return value.map((entry, index) => {
    if (!isRecord(entry)) fail(`Surface ${surfaceId} dashboard.hostContext[${index}] must be an object`);
    assertAllowedKeys(entry, new Set(['source', 'to']), `Surface ${surfaceId} dashboard.hostContext[${index}]`);
    if (typeof entry.source !== 'string' || !HOST_CONTEXT_SOURCES.has(entry.source)) {
      fail(`Surface ${surfaceId} dashboard.hostContext[${index}].source is unsupported`);
    }
    const to = normalizeSafePath(entry.to, `Surface ${surfaceId} dashboard.hostContext[${index}].to`);
    if (!schemaHasPath(schema, to)) fail(`Surface ${surfaceId} dashboard.hostContext target ${to} is not declared in inputSchema`);
    if (seenTargets.has(to)) fail(`Surface ${surfaceId} dashboard.hostContext contains duplicate target ${to}`);
    seenTargets.add(to);
    return { source: entry.source, to };
  });
};

const normalizeLayout = (value, surfaceId) => {
  if (value === undefined) {
    return {
      columns: 6,
      rows: 4,
      minColumns: 4,
      maxColumns: 12,
      minRows: 3,
      maxRows: 12,
      overflow: 'auto',
    };
  }
  if (!isRecord(value)) fail(`Surface ${surfaceId} dashboard.layout must be an object`);
  assertAllowedKeys(value, new Set([
    'columns',
    'rows',
    'minColumns',
    'maxColumns',
    'minRows',
    'maxRows',
    'overflow',
  ]), `Surface ${surfaceId} dashboard.layout`);
  const layout = {
    columns: value.columns === undefined ? 6 : normalizeFiniteInteger(value.columns, `Surface ${surfaceId} dashboard.layout.columns`, 1, 12),
    rows: value.rows === undefined ? 4 : normalizeFiniteInteger(value.rows, `Surface ${surfaceId} dashboard.layout.rows`, 1, 24),
    minColumns: value.minColumns === undefined ? 4 : normalizeFiniteInteger(value.minColumns, `Surface ${surfaceId} dashboard.layout.minColumns`, 1, 12),
    maxColumns: value.maxColumns === undefined ? 12 : normalizeFiniteInteger(value.maxColumns, `Surface ${surfaceId} dashboard.layout.maxColumns`, 1, 12),
    minRows: value.minRows === undefined ? 3 : normalizeFiniteInteger(value.minRows, `Surface ${surfaceId} dashboard.layout.minRows`, 1, 24),
    maxRows: value.maxRows === undefined ? 12 : normalizeFiniteInteger(value.maxRows, `Surface ${surfaceId} dashboard.layout.maxRows`, 1, 24),
    overflow: value.overflow === undefined ? 'auto' : value.overflow,
  };
  if (layout.overflow !== 'auto') fail(`Surface ${surfaceId} dashboard.layout.overflow must be auto`);
  if (layout.minColumns > layout.maxColumns || layout.columns < layout.minColumns || layout.columns > layout.maxColumns) {
    fail(`Surface ${surfaceId} dashboard.layout column bounds are inconsistent`);
  }
  if (layout.minRows > layout.maxRows || layout.rows < layout.minRows || layout.rows > layout.maxRows) {
    fail(`Surface ${surfaceId} dashboard.layout row bounds are inconsistent`);
  }
  return layout;
};

const normalizeRefresh = (value, surfaceId) => {
  if (value === undefined) return { mode: 'manual', minimumIntervalSeconds: 30 };
  if (!isRecord(value)) fail(`Surface ${surfaceId} dashboard.refresh must be an object`);
  assertAllowedKeys(value, new Set(['mode', 'minimumIntervalSeconds', 'intervalSeconds']), `Surface ${surfaceId} dashboard.refresh`);
  if (!['manual', 'onFocus', 'interval'].includes(value.mode)) {
    fail(`Surface ${surfaceId} dashboard.refresh.mode is unsupported`);
  }
  const minimumIntervalSeconds = value.minimumIntervalSeconds === undefined
    ? 30
    : normalizeFiniteInteger(value.minimumIntervalSeconds, `Surface ${surfaceId} dashboard.refresh.minimumIntervalSeconds`, 5, 86_400);
  const normalized = { mode: value.mode, minimumIntervalSeconds };
  if (value.mode === 'interval') {
    const intervalSeconds = normalizeFiniteInteger(
      value.intervalSeconds,
      `Surface ${surfaceId} dashboard.refresh.intervalSeconds`,
      5,
      86_400,
    );
    if (intervalSeconds < minimumIntervalSeconds) {
      fail(`Surface ${surfaceId} dashboard.refresh.intervalSeconds cannot be below minimumIntervalSeconds`);
    }
    normalized.intervalSeconds = intervalSeconds;
  } else if (value.intervalSeconds !== undefined) {
    fail(`Surface ${surfaceId} dashboard.refresh.intervalSeconds requires interval mode`);
  }
  return normalized;
};

const normalizeEvents = (value, surfaceId) => {
  if (value === undefined) return { emits: [], accepts: [] };
  if (!isRecord(value)) fail(`Surface ${surfaceId} dashboard.events must be an object`);
  assertAllowedKeys(value, new Set(['emits', 'accepts']), `Surface ${surfaceId} dashboard.events`);
  const emits = value.emits === undefined ? [] : value.emits;
  const accepts = value.accepts === undefined ? [] : value.accepts;
  if (!Array.isArray(emits) || emits.length > MAX_EVENTS) fail(`Surface ${surfaceId} dashboard.events.emits is invalid`);
  if (!Array.isArray(accepts) || accepts.length > MAX_EVENTS) fail(`Surface ${surfaceId} dashboard.events.accepts is invalid`);
  const normalizedEmits = emits.map((event, index) => {
    if (!isRecord(event)) fail(`Surface ${surfaceId} dashboard.events.emits[${index}] must be an object`);
    assertAllowedKeys(event, new Set(['id', 'payloadSchema']), `Surface ${surfaceId} dashboard.events.emits[${index}]`);
    const id = normalizeBoundedString(event.id, `Surface ${surfaceId} emitted event id`, { max: 96, pattern: EVENT_ID_PATTERN });
    const payloadSchema = normalizeJSONSchema(
      event.payloadSchema ?? { type: 'object', properties: {}, required: [] },
      `Surface ${surfaceId} event ${id} payloadSchema`,
    );
    if (payloadSchema.type !== 'object') fail(`Surface ${surfaceId} event ${id} payloadSchema must be an object schema`);
    return { id, payloadSchema };
  });
  const normalizedAccepts = accepts.map((event, index) => (
    normalizeBoundedString(event, `Surface ${surfaceId} accepted event ${index}`, { max: 96, pattern: EVENT_ID_PATTERN })
  ));
  const emitIds = normalizedEmits.map((event) => event.id);
  if (new Set(emitIds).size !== emitIds.length || new Set(normalizedAccepts).size !== normalizedAccepts.length) {
    fail(`Surface ${surfaceId} dashboard.events contains duplicate IDs`);
  }
  return { emits: normalizedEmits, accepts: normalizedAccepts };
};

const normalizeMigrations = (value, inputSchema, surfaceId) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_MIGRATIONS) {
    fail(`Surface ${surfaceId} dashboard.migrations must contain at most ${MAX_MIGRATIONS} entries`);
  }
  const seenVersions = new Set();
  return value.map((migration, migrationIndex) => {
    const label = `Surface ${surfaceId} dashboard.migrations[${migrationIndex}]`;
    if (!isRecord(migration)) fail(`${label} must be an object`);
    assertAllowedKeys(migration, new Set(['fromVersion', 'operations']), label);
    const fromVersion = normalizeBoundedString(migration.fromVersion, `${label}.fromVersion`, { max: 80 });
    if (seenVersions.has(fromVersion)) fail(`${label}.fromVersion is duplicated`);
    seenVersions.add(fromVersion);
    if (!Array.isArray(migration.operations)
      || migration.operations.length === 0
      || migration.operations.length > MAX_MIGRATION_OPERATIONS) {
      fail(`${label}.operations must contain 1-${MAX_MIGRATION_OPERATIONS} entries`);
    }
    const operations = migration.operations.map((operation, operationIndex) => {
      const operationLabel = `${label}.operations[${operationIndex}]`;
      if (!isRecord(operation)) fail(`${operationLabel} must be an object`);
      const op = normalizeBoundedString(operation.op, `${operationLabel}.op`, { max: 32 });
      if (op === 'setDefault') {
        assertAllowedKeys(operation, new Set(['op', 'path', 'value']), operationLabel);
        const path = normalizeSafePath(operation.path, `${operationLabel}.path`);
        const targetSchema = schemaAtPath(inputSchema, path);
        if (!targetSchema) fail(`${operationLabel}.path is not declared in inputSchema`);
        if (!Object.hasOwn(operation, 'value')) fail(`${operationLabel}.value is required`);
        const normalizedValue = validateValueAgainstSchema(
          targetSchema,
          operation.value,
          `${operationLabel}.value`,
          { requireComplete: true },
        );
        return { op, path, value: canonicalize(normalizedValue) };
      }
      if (op !== 'rename' && op !== 'move') {
        fail(`${operationLabel}.op is unsupported`);
      }
      assertAllowedKeys(operation, new Set(['op', 'from', 'to']), operationLabel);
      const from = normalizeSafePath(operation.from, `${operationLabel}.from`);
      const to = normalizeSafePath(operation.to, `${operationLabel}.to`);
      if (from === to) fail(`${operationLabel} source and target must differ`);
      if (!schemaHasPath(inputSchema, to)) fail(`${operationLabel}.to is not declared in inputSchema`);
      if (op === 'rename') {
        const fromParent = from.split('.').slice(0, -1).join('.');
        const toParent = to.split('.').slice(0, -1).join('.');
        if (fromParent !== toParent) fail(`${operationLabel} rename must stay within one object; use move`);
      }
      return { op, from, to };
    });
    return { fromVersion, operations };
  });
};

const normalizeDashboard = (value, surfaceId, runtime) => {
  if (value === undefined) return null;
  if (!isRecord(value)) fail(`Surface ${surfaceId} dashboard must be an object`);
  assertAllowedKeys(value, new Set([
    'description',
    'inputSchema',
    'defaultContext',
    'hostContext',
    'layout',
    'instances',
    'refresh',
    'events',
    'popout',
    'migrations',
  ]), `Surface ${surfaceId} dashboard`);
  const inputSchema = normalizeJSONSchema(
    value.inputSchema ?? { type: 'object', properties: {}, required: [] },
    `Surface ${surfaceId} dashboard.inputSchema`,
  );
  if (inputSchema.type !== 'object') fail(`Surface ${surfaceId} dashboard.inputSchema must be an object schema`);
  const defaultContextValue = value.defaultContext ?? {};
  const defaultContext = validateValueAgainstSchema(
    inputSchema,
    defaultContextValue,
    `Surface ${surfaceId} dashboard.defaultContext`,
    { requireComplete: false },
  );
  if (Buffer.byteLength(JSON.stringify(defaultContext), 'utf8') > MAX_CONTEXT_BYTES) {
    fail(`Surface ${surfaceId} dashboard.defaultContext exceeds ${MAX_CONTEXT_BYTES} bytes`);
  }
  const hostContext = normalizeHostContext(value.hostContext, inputSchema, surfaceId);
  const requiredPaths = collectRequiredPaths(inputSchema);
  const hostTargets = new Set(hostContext.map((mapping) => mapping.to));
  const missingRequiredPaths = requiredPaths.filter((path) => (
    getPath(defaultContext, path) === undefined
    && !Array.from(hostTargets).some((target) => target === path || target.startsWith(`${path}.`) || path.startsWith(`${target}.`))
  ));
  const instances = value.instances === undefined ? 'byContext' : value.instances;
  if (!['byContext', 'single'].includes(instances)) fail(`Surface ${surfaceId} dashboard.instances is unsupported`);
  let popout = { supported: runtime !== 'native' };
  if (value.popout !== undefined) {
    if (!isRecord(value.popout)) fail(`Surface ${surfaceId} dashboard.popout must be an object`);
    assertAllowedKeys(value.popout, new Set(['supported']), `Surface ${surfaceId} dashboard.popout`);
    if (typeof value.popout.supported !== 'boolean') fail(`Surface ${surfaceId} dashboard.popout.supported must be boolean`);
    popout = { supported: value.popout.supported };
  }
  return {
    ...(value.description === undefined ? {} : {
      description: normalizeBoundedString(value.description, `Surface ${surfaceId} dashboard.description`, { max: 280 }),
    }),
    inputSchema,
    defaultContext: canonicalize(defaultContext),
    hostContext,
    requiredPaths,
    manualLaunch: {
      enabled: missingRequiredPaths.length === 0,
      missingRequiredPaths,
    },
    layout: normalizeLayout(value.layout, surfaceId),
    instances,
    refresh: normalizeRefresh(value.refresh, surfaceId),
    events: normalizeEvents(value.events, surfaceId),
    popout,
    migrations: normalizeMigrations(value.migrations, inputSchema, surfaceId),
  };
};

export const applyDashboardContextMigration = (dashboard, migration, context) => {
  if (!isRecord(dashboard) || !isRecord(migration) || !Array.isArray(migration.operations)) {
    fail('Dashboard migration is invalid', 'invalid_dashboard_migration');
  }
  const next = canonicalize(validateValueAgainstSchema(
    { type: 'object', properties: {}, required: [] },
    {},
    'migration context seed',
  ));
  Object.assign(next, canonicalize(context));
  for (const [index, operation] of migration.operations.entries()) {
    const label = `dashboard migration operation ${index}`;
    if (operation.op === 'setDefault') {
      if (getPath(next, operation.path) === undefined) {
        setPath(next, operation.path, canonicalize(operation.value));
      }
      continue;
    }
    if (operation.op !== 'rename' && operation.op !== 'move') {
      fail(`${label} is unsupported`, 'invalid_dashboard_migration');
    }
    const current = getPath(next, operation.from);
    if (current === undefined) {
      fail(`${label} source ${operation.from} is missing`, 'dashboard_migration_failed');
    }
    const existing = getPath(next, operation.to);
    if (existing !== undefined && !canonicalEqual(existing, current)) {
      fail(`${label} target ${operation.to} already exists`, 'dashboard_migration_failed');
    }
    setPath(next, operation.to, canonicalize(current));
    deletePath(next, operation.from);
  }
  return sanitizeDashboardContext(dashboard.inputSchema, next, { requireComplete: true });
};

const normalizeMappingExpression = (value, label) => {
  if (typeof value !== 'string') {
    if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
    fail(`${label} must be a mapping expression or JSON scalar`);
  }
  const expression = normalizeBoundedString(value, label, { max: 320 });
  const prefixes = ['$event.payload.', '$source.context.', '$host.'];
  const prefix = prefixes.find((candidate) => expression.startsWith(candidate));
  if (!prefix) fail(`${label} uses an unsupported source`);
  normalizeSafePath(expression.slice(prefix.length), label);
  return expression;
};

const normalizeLinks = (value, extensionId, surfaces) => {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_LINKS) fail(`Extension ${extensionId} links must contain at most ${MAX_LINKS} entries`);
  const seen = new Set();
  return value.map((link, index) => {
    if (!isRecord(link)) fail(`Extension ${extensionId} links[${index}] must be an object`);
    assertAllowedKeys(link, new Set(['id', 'from', 'event', 'to', 'map', 'relationship', 'placement']), `Extension ${extensionId} links[${index}]`);
    const id = normalizeBoundedString(link.id, `Extension ${extensionId} link id`, { max: 96, pattern: LINK_ID_PATTERN });
    if (seen.has(id)) fail(`Extension ${extensionId} contains duplicate link ${id}`);
    seen.add(id);
    const from = normalizeBoundedString(link.from, `Link ${id} from`, { max: 160, pattern: EXTENSION_ID_PATTERN });
    const to = normalizeBoundedString(link.to, `Link ${id} to`, { max: 160, pattern: EXTENSION_ID_PATTERN });
    if (!from.startsWith(`${extensionId}.`) || !to.startsWith(`${extensionId}.`)) {
      fail(`Link ${id} cannot target another extension`, 'cross_extension_dashboard_link');
    }
    const source = surfaces.get(from);
    const target = surfaces.get(to);
    if (!source || !target) fail(`Link ${id} references an unknown surface`);
    const event = normalizeBoundedString(link.event, `Link ${id} event`, { max: 96, pattern: EVENT_ID_PATTERN });
    if (!source.dashboard?.events.emits.some((candidate) => candidate.id === event)) {
      fail(`Link ${id} source does not emit ${event}`);
    }
    if (!target.dashboard?.events.accepts.includes(event)) {
      fail(`Link ${id} target does not accept ${event}`);
    }
    if (!isRecord(link.map) || Object.keys(link.map).length > MAX_MAPPING_FIELDS) {
      fail(`Link ${id} map must contain at most ${MAX_MAPPING_FIELDS} fields`);
    }
    const mapping = {};
    for (const [targetPathValue, expression] of Object.entries(link.map)) {
      const targetPath = normalizeSafePath(targetPathValue, `Link ${id} target path`);
      if (!schemaHasPath(target.dashboard.inputSchema, targetPath)) {
        fail(`Link ${id} target path ${targetPath} is not declared by ${to}`);
      }
      mapping[targetPath] = normalizeMappingExpression(expression, `Link ${id} map.${targetPath}`);
    }
    const relationship = normalizeBoundedString(link.relationship, `Link ${id} relationship`, { max: 80, pattern: LINK_ID_PATTERN });
    const placement = link.placement === undefined ? 'adjacent' : link.placement;
    if (!['adjacent', 'below'].includes(placement)) fail(`Link ${id} placement is unsupported`);
    return { id, from, event, to, map: mapping, relationship, placement };
  });
};

export const normalizeExtensionDashboardContract = (manifest) => {
  if (!isRecord(manifest) || typeof manifest.id !== 'string' || !EXTENSION_ID_PATTERN.test(manifest.id)) {
    fail('Extension manifest has an invalid namespaced id');
  }
  const shortName = manifest.shortName === undefined
    ? null
    : normalizeBoundedString(manifest.shortName, `Extension ${manifest.id} shortName`, { max: 40 });
  let icon = null;
  if (manifest.icon !== undefined) {
    icon = normalizeBoundedString(manifest.icon, `Extension ${manifest.id} icon`, { max: 240 });
    if (icon.includes('\\') || icon.includes('\0') || nodePath.posix.isAbsolute(icon)
      || nodePath.posix.normalize(icon) !== icon || icon === '..' || icon.startsWith('../')
      || !/\.(?:svg|png)$/i.test(icon)) {
      fail(`Extension ${manifest.id} icon must be a local SVG or PNG path`, 'invalid_extension_icon');
    }
  }

  const surfaces = new Map();
  const views = Array.isArray(manifest.views) ? manifest.views : [];
  const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
  for (const surface of [...views, ...artifacts]) {
    if (!isRecord(surface) || typeof surface.id !== 'string' || !surface.id.startsWith(`${manifest.id}.`)) {
      fail(`Extension ${manifest.id} contains an invalid surface`);
    }
    if (surfaces.has(surface.id)) fail(`Extension ${manifest.id} contains duplicate surface ${surface.id}`);
    const kind = views.includes(surface) ? 'view' : 'artifact';
    const runtime = kind === 'view' ? surface.runtime : 'artifact';
    const title = surface.title === undefined
      ? surface.id.split('.').at(-1)
      : normalizeBoundedString(surface.title, `Surface ${surface.id} title`, { max: 120 });
    surfaces.set(surface.id, {
      id: surface.id,
      kind,
      runtime,
      title,
      dashboard: normalizeDashboard(surface.dashboard, surface.id, runtime),
    });
  }
  const links = normalizeLinks(manifest.links, manifest.id, surfaces);
  return {
    shortName,
    icon,
    links,
    surfaces,
  };
};

export const validateExtensionIconAsset = (iconPath, content) => {
  if (typeof iconPath !== 'string' || !Buffer.isBuffer(content) || content.length === 0 || content.length > MAX_ICON_BYTES) {
    fail('Extension icon is missing or exceeds its size limit', 'invalid_extension_icon');
  }
  if (iconPath.toLowerCase().endsWith('.png')) {
    if (content.length < 24 || !content.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      fail('Extension PNG icon has an invalid signature', 'invalid_extension_icon');
    }
    const width = content.readUInt32BE(16);
    const height = content.readUInt32BE(20);
    if (width < 1 || height < 1 || width > 1024 || height > 1024) {
      fail('Extension PNG icon dimensions must be 1-1024 pixels', 'invalid_extension_icon');
    }
    return { type: 'png', bytes: content.length, width, height };
  }
  const text = content.toString('utf8');
  if (!/^\s*(?:<\?xml[^>]*>\s*)?<svg[\s>]/i.test(text)
    || /<\s*(?:script|foreignObject|iframe|object|embed|image|use|style)\b/i.test(text)
    || /\bon[a-z]+\s*=/i.test(text)
    || /\b(?:href|src)\s*=/i.test(text)
    || /url\s*\(/i.test(text)
    || /<!ENTITY/i.test(text)) {
    fail('Extension SVG icon contains unsupported active or external content', 'invalid_extension_icon');
  }
  return { type: 'svg', bytes: content.length };
};
