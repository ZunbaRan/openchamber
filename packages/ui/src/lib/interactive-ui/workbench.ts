import { runtimeFetch } from '@/lib/runtime-fetch';
import type { InteractiveResultEnvelope } from './types';
import type { HTMLArtifactResultEnvelope } from './artifactResult';
import type { McpAppResultEnvelope } from './mcpApp';

export type WorkbenchSurfaceForm = 'interactive-ui' | 'html-artifact' | 'mcp-app';
export type WorkbenchSurfaceRuntime = 'declarative' | 'native' | 'artifact';
export type WorkbenchDisplayMode = 'tile' | 'focus' | 'popout';

export interface WorkbenchJSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean';
  properties?: Record<string, WorkbenchJSONSchema>;
  items?: WorkbenchJSONSchema;
  required?: string[];
  enum?: unknown[];
  format?: 'date' | 'date-time' | 'email' | 'uuid';
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  minItems?: number;
  maxItems?: number;
}

export interface WorkbenchLayoutContract {
  columns: number;
  rows: number;
  minColumns: number;
  maxColumns: number;
  minRows: number;
  maxRows: number;
  overflow: 'auto';
}

export interface WorkbenchEventDefinition {
  id: string;
  payloadSchema: WorkbenchJSONSchema;
}

export interface WorkbenchDashboardContract {
  description?: string;
  inputSchema: WorkbenchJSONSchema;
  defaultContext: Record<string, unknown>;
  hostContext: Array<{ source: string; to: string }>;
  requiredPaths: string[];
  manualLaunch: {
    enabled: boolean;
    missingRequiredPaths: string[];
    reason?: string;
  };
  layout: WorkbenchLayoutContract;
  instances: 'byContext' | 'single';
  refresh: {
    mode: 'manual' | 'onFocus' | 'interval';
    minimumIntervalSeconds: number;
    intervalSeconds?: number;
  };
  events: {
    emits: WorkbenchEventDefinition[];
    accepts: string[];
  };
  popout: { supported: boolean };
  migrations?: Array<{
    fromVersion: string;
    operations: Array<
      | { op: 'rename' | 'move'; from: string; to: string }
      | { op: 'setDefault'; path: string; value: unknown }
    >;
  }>;
}

export interface WorkbenchSurfaceDescriptor {
  extensionId: string;
  extensionVersion: string;
  surfaceId: string;
  surfaceKind: 'view' | 'artifact';
  form: WorkbenchSurfaceForm;
  runtime: WorkbenchSurfaceRuntime;
  title: string;
  description: string | null;
  manualLaunch: {
    enabled: boolean;
    missingRequiredPaths: string[];
    reason?: string;
  };
  dashboard: WorkbenchDashboardContract | null;
}

export interface WorkbenchLinkDescriptor {
  id: string;
  from: string;
  event: string;
  to: string;
  map: Record<string, string | number | boolean | null>;
  relationship: string;
  placement: 'adjacent' | 'below';
}

export interface WorkbenchExtensionDescriptor {
  id: string;
  name: string;
  shortName: string;
  version: string;
  iconPath: string | null;
  // Phase R3 safe Remote lifecycle summary (present for manager-owned Remote
  // extensions): used to show blocked/warning states at extension level.
  lifecycle?: {
    status: 'none' | 'available' | 'required';
    health: {
      status: 'unknown' | 'reachable' | 'unreachable' | 'trust_invalid';
      checkedAt: string | null;
      code?: string;
    };
    blocked?: { code: string };
    requiresUserConfirmation?: boolean;
  };
  surfaces: WorkbenchSurfaceDescriptor[];
  links: WorkbenchLinkDescriptor[];
}

export interface WorkbenchCatalog {
  apiVersion: 1;
  extensions: WorkbenchExtensionDescriptor[];
  errors: Array<{ path?: string; error?: string; code?: string }>;
}

export interface WorkbenchTileLayout {
  column: number;
  row: number;
  columns: number;
  rows: number;
}

export type WorkbenchTileSource =
  | {
      kind: 'third-party-extension';
      extensionId: string;
      surfaceId: string;
      compatibleVersion: string;
    }
  | {
      kind: 'agent-generated';
      snapshotRef: string;
    };

export interface WorkbenchTileRelationship {
  groupId: string;
  kind: string;
  parentTileId: string | null;
}

export interface WorkbenchTile {
  tileId: string;
  source: WorkbenchTileSource;
  form: WorkbenchSurfaceForm;
  context: Record<string, unknown>;
  contextDigest: string;
  layout: WorkbenchTileLayout;
  displayMode: WorkbenchDisplayMode;
  relationship: WorkbenchTileRelationship | null;
  origin: {
    sessionId?: string;
    messageId?: string;
    toolCallId?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchBoard {
  id: string;
  name: string;
  revision: number;
  tiles: WorkbenchTile[];
}

export interface WorkbenchSnapshot {
  $schema: 'openchamber://extension-board/v1';
  schemaVersion: 1;
  projectId: string;
  activeBoardId: string;
  boards: WorkbenchBoard[];
}

export interface WorkbenchGeneratedSnapshot {
  $schema: 'openchamber://extension-workbench-snapshot/v1';
  schemaVersion: 1;
  snapshotRef: string;
  form: WorkbenchSurfaceForm;
  envelope: InteractiveResultEnvelope | HTMLArtifactResultEnvelope | McpAppResultEnvelope;
  createdAt: string;
}

export type WorkbenchTileDraft = {
  tileId?: string;
  source:
    | {
        kind: 'third-party-extension';
        extensionId: string;
        surfaceId: string;
      }
    | {
        kind: 'agent-generated';
        snapshotRef: string;
      };
  form: WorkbenchSurfaceForm;
  context?: Record<string, unknown>;
  layout?: Partial<WorkbenchTileLayout>;
  displayMode?: WorkbenchDisplayMode;
  relationship?: WorkbenchTileRelationship | null;
  origin?: WorkbenchTile['origin'];
};

export class WorkbenchRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: Record<string, unknown>;

  constructor(message: string, status: number, code: string, payload: Record<string, unknown>) {
    super(message);
    this.name = 'WorkbenchRequestError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const requestJSON = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await runtimeFetch(path, init);
  const payload = await response.json().catch(() => ({})) as unknown;
  if (!response.ok) {
    const record = isRecord(payload) ? payload : {};
    throw new WorkbenchRequestError(
      typeof record.error === 'string' ? record.error : `Extension Workbench request failed (${response.status})`,
      response.status,
      typeof record.code === 'string' ? record.code : 'workbench_request_failed',
      record,
    );
  }
  return payload as T;
};

export const fetchWorkbenchCatalog = (): Promise<WorkbenchCatalog> => (
  requestJSON<WorkbenchCatalog>('/api/interactive-ui/workbench/catalog', { cache: 'no-store' })
);

export const fetchWorkbenchSnapshot = (projectId: string): Promise<WorkbenchSnapshot> => (
  requestJSON<WorkbenchSnapshot>(
    `/api/interactive-ui/workbench/boards/${encodeURIComponent(projectId)}`,
    { cache: 'no-store' },
  )
);

export const createWorkbenchGeneratedSnapshot = (
  form: WorkbenchSurfaceForm,
  envelope: InteractiveResultEnvelope | HTMLArtifactResultEnvelope | McpAppResultEnvelope,
): Promise<WorkbenchGeneratedSnapshot> => (
  requestJSON('/api/interactive-ui/workbench/snapshots', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ form, envelope }),
  })
);

export const fetchWorkbenchGeneratedSnapshot = (
  snapshotRef: string,
): Promise<WorkbenchGeneratedSnapshot> => (
  requestJSON(
    `/api/interactive-ui/workbench/snapshots/${encodeURIComponent(snapshotRef)}`,
    { cache: 'no-store' },
  )
);

export const createWorkbenchTile = (
  projectId: string,
  expectedRevision: number,
  tile: WorkbenchTileDraft,
): Promise<{ snapshot: WorkbenchSnapshot; tile: WorkbenchTile; created: boolean }> => (
  requestJSON(`/api/interactive-ui/workbench/boards/${encodeURIComponent(projectId)}/tiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision, tile }),
  })
);

export const patchWorkbenchTile = (
  projectId: string,
  tileId: string,
  expectedRevision: number,
  patch: {
    layout?: WorkbenchTileLayout;
    displayMode?: WorkbenchDisplayMode;
    relationship?: WorkbenchTileRelationship | null;
  },
): Promise<{ snapshot: WorkbenchSnapshot; tile: WorkbenchTile }> => (
  requestJSON(
    `/api/interactive-ui/workbench/boards/${encodeURIComponent(projectId)}/tiles/${encodeURIComponent(tileId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision, patch }),
    },
  )
);

export const replaceWorkbenchGeneratedTileSnapshot = (
  projectId: string,
  tileId: string,
  expectedRevision: number,
  expectedSnapshotRef: string,
  form: WorkbenchSurfaceForm,
  envelope: InteractiveResultEnvelope | HTMLArtifactResultEnvelope | McpAppResultEnvelope,
): Promise<{
  snapshot: WorkbenchSnapshot;
  tile: WorkbenchTile;
  generatedSnapshot: WorkbenchGeneratedSnapshot;
}> => (
  requestJSON(
    `/api/interactive-ui/workbench/boards/${encodeURIComponent(projectId)}/tiles/${encodeURIComponent(tileId)}/replace-generated-snapshot`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision, expectedSnapshotRef, form, envelope }),
    },
  )
);

export const patchWorkbenchTileLayouts = (
  projectId: string,
  expectedRevision: number,
  layouts: Array<{ tileId: string; layout: WorkbenchTileLayout }>,
): Promise<{ snapshot: WorkbenchSnapshot; tiles: WorkbenchTile[] }> => (
  requestJSON(
    `/api/interactive-ui/workbench/boards/${encodeURIComponent(projectId)}/layouts`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision, layouts }),
    },
  )
);

export const migrateWorkbenchTile = (
  projectId: string,
  tileId: string,
  expectedRevision: number,
): Promise<{ snapshot: WorkbenchSnapshot; tile: WorkbenchTile }> => (
  requestJSON(
    `/api/interactive-ui/workbench/boards/${encodeURIComponent(projectId)}/tiles/${encodeURIComponent(tileId)}/migrate`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision }),
    },
  )
);

export const deleteWorkbenchTile = (
  projectId: string,
  tileId: string,
  expectedRevision: number,
): Promise<{ snapshot: WorkbenchSnapshot; removed: WorkbenchTile }> => (
  requestJSON(
    `/api/interactive-ui/workbench/boards/${encodeURIComponent(projectId)}/tiles/${encodeURIComponent(tileId)}`,
    {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ expectedRevision }),
    },
  )
);

export const getActiveWorkbenchBoard = (snapshot: WorkbenchSnapshot | null): WorkbenchBoard | null => {
  if (!snapshot) return null;
  return snapshot.boards.find((board) => board.id === snapshot.activeBoardId) ?? null;
};
