import type React from 'react';

export const INTERACTIVE_RESULT_SCHEMA = 'openchamber://interactive-result/v1' as const;
export const DECLARATIVE_VIEW_SCHEMA = 'openchamber://declarative-view/v1' as const;

export type InteractiveDisplayMode = 'inline' | 'workspace' | 'fullscreen';
export type InteractiveResultMode = 'snapshot' | 'live';

export interface InteractiveDataRef {
  connector: string;
  resource: string;
  revision?: string;
}

export interface InteractiveResultEnvelope {
  $schema: typeof INTERACTIVE_RESULT_SCHEMA;
  view: string;
  schemaVersion: 1;
  mode: InteractiveResultMode;
  summary?: string;
  context?: unknown;
  data?: unknown;
  dataRef?: InteractiveDataRef;
  updatedAt?: string;
}

export interface InteractiveViewDescriptor {
  extension: {
    id: string;
    name: string;
    version: string;
  };
  view: {
    id: string;
    runtime: 'declarative' | 'native';
    displayModes: InteractiveDisplayMode[];
  };
  declarative?: DeclarativeViewDefinition;
  native?: {
    assetPath: string;
    exportName: string;
    integrity: string;
  };
}

export interface InstalledHTMLArtifactDescriptor {
  extension: {
    id: string;
    name: string;
    version: string;
  };
  artifact: {
    id: string;
    title: string;
    displayModes: InteractiveDisplayMode[];
    inlineHeight: number;
    scripts: true;
    business: boolean;
  };
  documentPath: string;
  integrity: string;
}

export interface InteractiveToolContext {
  id: string;
  name: string;
  input?: unknown;
  output?: unknown;
  error?: string;
}

interface InteractiveActionRequestBase {
  extensionId: string;
  instanceId: string;
  action: string;
  input: unknown;
  tool?: Pick<InteractiveToolContext, 'id' | 'name'>;
  workbench?: {
    projectId: string;
    tileId: string;
  };
  confirmationToken?: string;
}

export type InteractiveActionRequest = InteractiveActionRequestBase & (
  | { viewId: string; artifactId?: never }
  | { artifactId: string; viewId?: never }
);

export interface InteractiveConfirmation {
  title?: string;
  description?: string;
}

export interface InteractiveActionErrorPayload {
  error?: string;
  code?: string;
  confirmationRequired?: boolean;
  confirmation?: InteractiveConfirmation;
  confirmationToken?: string;
  confirmationExpiresAt?: number;
}

export interface InteractiveBusinessHost {
  query<TOutput = unknown>(action: string, input: unknown): Promise<TOutput>;
  execute<TOutput = unknown>(action: string, input: unknown): Promise<TOutput>;
}

export interface InteractiveViewHost {
  apiVersion: 1;
  business: InteractiveBusinessHost;
  dialog: {
    confirm(options: InteractiveConfirmation): Promise<boolean>;
  };
  notifications: {
    show(input: { message: string; tone?: 'success' | 'error' | 'info' }): void;
  };
  dashboard: {
    emit(eventId: string, payload: Record<string, unknown>): Promise<void>;
  };
  context: {
    runtime: 'web' | 'desktop' | 'vscode';
    locale: string;
  };
}

export interface NativeViewProps {
  instanceId: string;
  extensionId: string;
  viewId: string;
  status: 'completed';
  context: unknown;
  snapshot?: unknown;
  dataRef?: InteractiveDataRef;
  tool: InteractiveToolContext;
  display: {
    mode: InteractiveDisplayMode;
    mobile: boolean;
  };
  host: InteractiveViewHost;
}

export type NativeViewComponent = React.ComponentType<NativeViewProps>;

export interface NativeActivationHost {
  apiVersion: 1;
  uiVersion: 1;
  react: typeof React;
  ui: {
    Button: React.ComponentType<Record<string, unknown>>;
    Card: React.ComponentType<Record<string, unknown>>;
    CardHeader: React.ComponentType<Record<string, unknown>>;
    CardTitle: React.ComponentType<Record<string, unknown>>;
    CardContent: React.ComponentType<Record<string, unknown>>;
    Badge: React.ComponentType<Record<string, unknown>>;
    Notice: React.ComponentType<Record<string, unknown>>;
    Skeleton: React.ComponentType<Record<string, unknown>>;
    Separator: React.ComponentType<Record<string, unknown>>;
    Progress: React.ComponentType<Record<string, unknown>>;
    Table: React.ComponentType<Record<string, unknown>>;
    TableHeader: React.ComponentType<Record<string, unknown>>;
    TableBody: React.ComponentType<Record<string, unknown>>;
    TableRow: React.ComponentType<Record<string, unknown>>;
    TableHead: React.ComponentType<Record<string, unknown>>;
    TableCell: React.ComponentType<Record<string, unknown>>;
    Tabs: React.ComponentType<Record<string, unknown>>;
    TabsList: React.ComponentType<Record<string, unknown>>;
    TabsTrigger: React.ComponentType<Record<string, unknown>>;
    TabsContent: React.ComponentType<Record<string, unknown>>;
    Input: React.ComponentType<Record<string, unknown>>;
    Textarea: React.ComponentType<Record<string, unknown>>;
    EmptyState: React.ComponentType<Record<string, unknown>>;
    Select: React.ComponentType<Record<string, unknown>>;
    Checkbox: React.ComponentType<Record<string, unknown>>;
    RadioGroup: React.ComponentType<Record<string, unknown>>;
    Switch: React.ComponentType<Record<string, unknown>>;
    Dialog: React.ComponentType<Record<string, unknown>>;
    DialogContent: React.ComponentType<Record<string, unknown>>;
    DialogHeader: React.ComponentType<Record<string, unknown>>;
    DialogTitle: React.ComponentType<Record<string, unknown>>;
    DialogDescription: React.ComponentType<Record<string, unknown>>;
    DialogFooter: React.ComponentType<Record<string, unknown>>;
    DialogTrigger: React.ComponentType<Record<string, unknown>>;
    Tooltip: React.ComponentType<Record<string, unknown>>;
    TooltipTrigger: React.ComponentType<Record<string, unknown>>;
    TooltipContent: React.ComponentType<Record<string, unknown>>;
    TooltipProvider: React.ComponentType<Record<string, unknown>>;
    Stat: React.ComponentType<Record<string, unknown>>;
    DescriptionList: React.ComponentType<Record<string, unknown>>;
    Avatar: React.ComponentType<Record<string, unknown>>;
    Pagination: React.ComponentType<Record<string, unknown>>;
    Stack: React.ComponentType<Record<string, unknown>>;
    Grid: React.ComponentType<Record<string, unknown>>;
    Split: React.ComponentType<Record<string, unknown>>;
  };
  views: {
    register(definition: {
      id: string;
      component: NativeViewComponent;
      displayModes?: InteractiveDisplayMode[];
    }): () => void;
  };
}

export interface InteractiveNativeExtension {
  id: string;
  apiVersion: 1;
  activate(host: NativeActivationHost): void | (() => void);
}

export interface DeclarativeBinding {
  $path?: string;
  $row?: string;
  fallback?: unknown;
  format?: string;
}

export interface DeclarativeQueryDefinition {
  action: string;
  input?: unknown;
}

export interface DeclarativeActionDefinition {
  id?: string;
  label: string;
  type?: 'business' | 'emit';
  action?: string;
  event?: string;
  payload?: unknown;
  input?: unknown;
  confirm?: InteractiveConfirmation;
  when?: {
    value: unknown;
    equals?: unknown;
  };
}

export interface DeclarativeViewNode {
  type: string;
  title?: string;
  label?: string;
  value?: unknown;
  data?: unknown;
  items?: unknown[];
  columns?: unknown;
  children?: DeclarativeViewNode[];
  rowKey?: string;
  rowActions?: DeclarativeActionDefinition[];
  [key: string]: unknown;
}

export interface DeclarativeViewDefinition {
  $schema: typeof DECLARATIVE_VIEW_SCHEMA;
  id: string;
  title?: string;
  queries?: Record<string, DeclarativeQueryDefinition>;
  layout: DeclarativeViewNode;
}

export interface DeclarativeBindingScope {
  data?: unknown;
  context?: unknown;
  query?: Record<string, unknown>;
  row?: unknown;
  host?: Record<string, unknown>;
}
