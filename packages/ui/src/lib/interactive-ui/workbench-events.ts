import type {
  WorkbenchExtensionDescriptor,
  WorkbenchJSONSchema,
  WorkbenchLinkDescriptor,
  WorkbenchSurfaceDescriptor,
} from './workbench';

export class WorkbenchEventError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.name = 'WorkbenchEventError';
    this.code = code;
  }
}

export interface WorkbenchEventTrace {
  traceId: string;
  hop: number;
  visitedLinkIds: string[];
  expiresAt: number;
}

export const createWorkbenchEventTrace = (
  now = Date.now(),
  traceId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? `trace_${crypto.randomUUID()}`
    : `trace_${now.toString(36)}`,
): WorkbenchEventTrace => ({
  traceId,
  hop: 0,
  visitedLinkIds: [],
  expiresAt: now + 30_000,
});

export const advanceWorkbenchEventTrace = (
  trace: WorkbenchEventTrace,
  linkId: string,
  now = Date.now(),
): WorkbenchEventTrace => {
  if (now >= trace.expiresAt) {
    throw new WorkbenchEventError('Dashboard event trace expired', 'workbench_event_trace_expired');
  }
  if (trace.visitedLinkIds.includes(linkId)) {
    throw new WorkbenchEventError('Dashboard link cycle was rejected', 'workbench_event_link_cycle');
  }
  if (trace.hop >= 8) {
    throw new WorkbenchEventError('Dashboard event hop limit was reached', 'workbench_event_hop_limit');
  }
  return {
    ...trace,
    hop: trace.hop + 1,
    visitedLinkIds: [...trace.visitedLinkIds, linkId],
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readPath = (value: unknown, path: string): unknown => {
  if (!path) return value;
  let current = value;
  for (const segment of path.split('.')) {
    if (!isRecord(current) || !Object.prototype.hasOwnProperty.call(current, segment)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
};

const setPath = (target: Record<string, unknown>, path: string, value: unknown) => {
  const segments = path.split('.');
  let current = target;
  segments.forEach((segment, index) => {
    if (!segment || segment === '__proto__' || segment === 'prototype' || segment === 'constructor') {
      throw new WorkbenchEventError('Link mapping target is unsafe', 'workbench_mapping_unsafe');
    }
    if (index === segments.length - 1) {
      current[segment] = value;
      return;
    }
    const next = current[segment];
    if (next !== undefined && !isRecord(next)) {
      throw new WorkbenchEventError('Link mapping target conflicts with another value', 'workbench_mapping_conflict');
    }
    current[segment] = isRecord(next) ? next : {};
    current = current[segment] as Record<string, unknown>;
  });
};

const equals = (left: unknown, right: unknown): boolean => (
  JSON.stringify(left) === JSON.stringify(right)
);

export const validateWorkbenchSchemaValue = (
  schema: WorkbenchJSONSchema,
  value: unknown,
  path = '$',
): void => {
  if (schema.enum && !schema.enum.some((candidate) => equals(candidate, value))) {
    throw new WorkbenchEventError(`${path} is not an allowed value`, 'workbench_event_payload_invalid');
  }
  if (schema.type === 'object') {
    if (!isRecord(value)) {
      throw new WorkbenchEventError(`${path} must be an object`, 'workbench_event_payload_invalid');
    }
    for (const required of schema.required ?? []) {
      if (!Object.prototype.hasOwnProperty.call(value, required)) {
        throw new WorkbenchEventError(`${path}.${required} is required`, 'workbench_event_payload_invalid');
      }
    }
    for (const [key, entry] of Object.entries(value)) {
      const child = schema.properties?.[key];
      if (!child) {
        throw new WorkbenchEventError(`${path}.${key} is not declared`, 'workbench_event_payload_invalid');
      }
      validateWorkbenchSchemaValue(child, entry, `${path}.${key}`);
    }
    return;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      throw new WorkbenchEventError(`${path} must be an array`, 'workbench_event_payload_invalid');
    }
    if (schema.minItems !== undefined && value.length < schema.minItems) {
      throw new WorkbenchEventError(`${path} is too short`, 'workbench_event_payload_invalid');
    }
    if (schema.maxItems !== undefined && value.length > schema.maxItems) {
      throw new WorkbenchEventError(`${path} is too long`, 'workbench_event_payload_invalid');
    }
    if (schema.items) {
      value.forEach((entry, index) => validateWorkbenchSchemaValue(schema.items!, entry, `${path}[${index}]`));
    }
    return;
  }
  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      throw new WorkbenchEventError(`${path} must be a string`, 'workbench_event_payload_invalid');
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new WorkbenchEventError(`${path} is too short`, 'workbench_event_payload_invalid');
    }
    if (schema.maxLength !== undefined && value.length > schema.maxLength) {
      throw new WorkbenchEventError(`${path} is too long`, 'workbench_event_payload_invalid');
    }
    return;
  }
  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new WorkbenchEventError(`${path} must be a boolean`, 'workbench_event_payload_invalid');
    }
    return;
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (typeof value !== 'number'
      || !Number.isFinite(value)
      || (schema.type === 'integer' && !Number.isInteger(value))) {
      throw new WorkbenchEventError(`${path} must be ${schema.type}`, 'workbench_event_payload_invalid');
    }
    if (schema.minimum !== undefined && value < schema.minimum) {
      throw new WorkbenchEventError(`${path} is below its minimum`, 'workbench_event_payload_invalid');
    }
    if (schema.maximum !== undefined && value > schema.maximum) {
      throw new WorkbenchEventError(`${path} exceeds its maximum`, 'workbench_event_payload_invalid');
    }
  }
};

const resolveMappingValue = (
  expression: unknown,
  source: {
    payload: Record<string, unknown>;
    context: Record<string, unknown>;
    host: Record<string, unknown>;
  },
): unknown => {
  if (typeof expression !== 'string') return expression;
  if (expression.startsWith('$event.payload.')) {
    return readPath(source.payload, expression.slice('$event.payload.'.length));
  }
  if (expression.startsWith('$source.context.')) {
    return readPath(source.context, expression.slice('$source.context.'.length));
  }
  if (expression.startsWith('$host.')) {
    return readPath(source.host, expression.slice('$host.'.length));
  }
  return expression;
};

export interface ResolvedWorkbenchLink {
  link: WorkbenchLinkDescriptor;
  target: WorkbenchSurfaceDescriptor;
  context: Record<string, unknown>;
}

export const resolveWorkbenchEvent = ({
  extension,
  sourceSurfaceId,
  eventId,
  payload,
  sourceContext,
  hostContext,
}: {
  extension: WorkbenchExtensionDescriptor;
  sourceSurfaceId: string;
  eventId: string;
  payload: Record<string, unknown>;
  sourceContext: Record<string, unknown>;
  hostContext: Record<string, unknown>;
}): ResolvedWorkbenchLink[] => {
  const source = extension.surfaces.find((surface) => surface.surfaceId === sourceSurfaceId);
  const event = source?.dashboard?.events.emits.find((candidate) => candidate.id === eventId);
  if (!source || !event) {
    throw new WorkbenchEventError(
      'Surface did not declare this dashboard event',
      'workbench_event_not_declared',
    );
  }
  if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 64 * 1024) {
    throw new WorkbenchEventError('Dashboard event payload is too large', 'workbench_event_payload_too_large');
  }
  validateWorkbenchSchemaValue(event.payloadSchema, payload);

  return extension.links
    .filter((link) => link.from === sourceSurfaceId && link.event === eventId)
    .map((link) => {
      const target = extension.surfaces.find((surface) => surface.surfaceId === link.to);
      if (!target?.dashboard) {
        throw new WorkbenchEventError('Dashboard link target is unavailable', 'workbench_link_target_unavailable');
      }
      const context: Record<string, unknown> = {};
      for (const [path, expression] of Object.entries(link.map)) {
        const value = resolveMappingValue(expression, {
          payload,
          context: sourceContext,
          host: hostContext,
        });
        if (value === undefined) {
          throw new WorkbenchEventError(
            `Dashboard link ${link.id} could not resolve ${path}`,
            'workbench_mapping_unresolved',
          );
        }
        setPath(context, path, value);
      }
      validateWorkbenchSchemaValue(target.dashboard.inputSchema, context);
      return { link, target, context };
    });
};
