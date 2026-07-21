import { InteractiveUIRequestError } from './client';

export type HTMLArtifactFailureState =
  | 'unsupported'
  | 'scripts-disabled'
  | 'blocked'
  | 'crashed'
  | 'corrupt'
  | 'error';

const BLOCKED_CODES = new Set([
  'artifact_too_large',
  'invalid_artifact',
  'invalid_artifact_capabilities',
  'invalid_artifact_contract',
  'invalid_artifact_display',
  'invalid_artifact_html',
  'invalid_artifact_title',
  'invalid_artifact_updated_at',
  'prohibited_artifact_capability',
  'prohibited_artifact_markup',
  'prohibited_artifact_navigation',
  'remote_artifact_resource',
  'static_artifact_contains_event_handler',
  'static_artifact_contains_script',
  'unsupported_artifact_schema',
]);

export const classifyHTMLArtifactError = (error: unknown): HTMLArtifactFailureState => {
  if (!(error instanceof InteractiveUIRequestError)) return 'error';
  const code = error.payload.code ?? '';
  if (code === 'artifact_runtime_unsupported') return 'unsupported';
  if (code === 'artifact_scripts_unsupported') return 'scripts-disabled';
  if (code === 'artifact_corrupt' || code === 'artifact_not_found') return 'corrupt';
  if (BLOCKED_CODES.has(code)) return 'blocked';
  return 'error';
};

export const canRetryHTMLArtifactFailure = (state: HTMLArtifactFailureState): boolean => (
  state === 'crashed' || state === 'corrupt' || state === 'error'
);
