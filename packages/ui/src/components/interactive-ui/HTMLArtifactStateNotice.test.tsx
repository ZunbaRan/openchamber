import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { I18nProvider } from '@/lib/i18n';
import { InteractiveUIRequestError } from '@/lib/interactive-ui/client';
import { canRetryHTMLArtifactFailure, classifyHTMLArtifactError } from '@/lib/interactive-ui/artifactState';
import { HTMLArtifactStateNotice } from './HTMLArtifactStateNotice';

describe('HTMLArtifactStateNotice', () => {
  test('classifies artifact failures without exposing server error text', () => {
    expect(classifyHTMLArtifactError(new InteractiveUIRequestError(409, { code: 'artifact_runtime_unsupported', error: 'private runtime detail' }))).toBe('unsupported');
    expect(classifyHTMLArtifactError(new InteractiveUIRequestError(409, { code: 'artifact_scripts_unsupported' }))).toBe('scripts-disabled');
    expect(classifyHTMLArtifactError(new InteractiveUIRequestError(400, { code: 'prohibited_artifact_capability' }))).toBe('blocked');
    expect(classifyHTMLArtifactError(new InteractiveUIRequestError(500, { code: 'artifact_corrupt' }))).toBe('corrupt');
    expect(classifyHTMLArtifactError(new Error('unexpected'))).toBe('error');
  });

  test('only retries recoverable failures', () => {
    expect(canRetryHTMLArtifactFailure('corrupt')).toBe(true);
    expect(canRetryHTMLArtifactFailure('crashed')).toBe(true);
    expect(canRetryHTMLArtifactFailure('error')).toBe(true);
    expect(canRetryHTMLArtifactFailure('blocked')).toBe(false);
    expect(canRetryHTMLArtifactFailure('scripts-disabled')).toBe(false);
    expect(canRetryHTMLArtifactFailure('unsupported')).toBe(false);
  });

  test('renders localized semantic state instead of raw errors', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <HTMLArtifactStateNotice state="scripts-disabled" />
      </I18nProvider>,
    );

    expect(html).toContain('Interactive artifacts are disabled');
    expect(html).toContain('only allows static artifacts');
    expect(html).toContain('role="status"');
    expect(html).not.toContain('private runtime detail');
  });
});
