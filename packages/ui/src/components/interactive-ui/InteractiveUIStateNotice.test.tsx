import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { I18nProvider } from '@/lib/i18n';
import { InteractiveUIRequestError } from '@/lib/interactive-ui/client';
import { classifyInteractiveUIError } from '@/lib/interactive-ui/state';
import { InteractiveUIStateNotice } from './InteractiveUIStateNotice';

describe('InteractiveUIStateNotice', () => {
  test('classifies stable gateway failures without exposing upstream messages', () => {
    expect(classifyInteractiveUIError(new InteractiveUIRequestError(503, { code: 'connector_unconfigured', error: 'secret upstream detail' }))).toBe('unconfigured');
    expect(classifyInteractiveUIError(new InteractiveUIRequestError(401, { code: 'connector_unauthorized' }))).toBe('unauthorized');
    expect(classifyInteractiveUIError(new InteractiveUIRequestError(403, { code: 'connector_forbidden' }))).toBe('forbidden');
    expect(classifyInteractiveUIError(new InteractiveUIRequestError(502, { code: 'upstream_error' }))).toBe('unreachable');
    expect(classifyInteractiveUIError(new Error('unexpected'))).toBe('error');
  });

  test('renders every failure state with localized semantic copy and no upstream detail', () => {
    const cases = [
      ['unconfigured', 'Connection setup required', 'role="status"'],
      ['unreachable', 'Business system unavailable', 'role="alert"'],
      ['unauthorized', 'Connection expired', 'role="alert"'],
      ['forbidden', 'Access denied', 'role="alert"'],
      ['stale', 'Showing saved data', 'role="status"'],
      ['error', 'Interactive UI unavailable', 'role="alert"'],
    ] as const;

    for (const [state, title, role] of cases) {
      const html = renderToStaticMarkup(
        <I18nProvider>
          <InteractiveUIStateNotice state={state} onRetry={() => {}} />
        </I18nProvider>,
      );

      expect(html).toContain(title);
      expect(html).toContain('Retry');
      expect(html).toContain(role);
      expect(html).not.toContain('secret upstream detail');
    }
  });
});
