import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '@/lib/i18n';
import { InstalledArtifactConfirmationHost } from './InstalledArtifactConfirmationHost';

const readSource = (name: string): string =>
  readFileSync(fileURLToPath(new URL(name, import.meta.url)), 'utf8');

describe('InstalledArtifactConfirmationHost', () => {
  test('renders no popup markup while idle', () => {
    const html = renderToStaticMarkup(
      <I18nProvider>
        <InstalledArtifactConfirmationHost consumeEscape={false} />
      </I18nProvider>,
    );
    expect(html).toBe('');
  });

  test('keeps the confirmation hook behind the installed-only dynamic import', () => {
    // The lazy boundary invariant: HTMLArtifactView must not reference the
    // confirmation hook statically (generated/static Artifacts never load the
    // chunk or instantiate the hook); the child module is the only entry that
    // statically imports it.
    const viewSource = readSource('HTMLArtifactView.tsx');
    expect(viewSource).not.toContain('useInteractiveConfirmation');
    expect(viewSource).toContain("import('./InstalledArtifactConfirmationHost')");
    expect(viewSource).toContain('consumeEscape={expanded}');
    const hostSource = readSource('InstalledArtifactConfirmationHost.tsx');
    expect(hostSource).toContain("import { useInteractiveConfirmation } from './InteractiveConfirmationDialog'");
  });

  test('targets the safe Cancel button only for expanded confirmation initial focus', () => {
    const dialogSource = readSource('InteractiveConfirmationDialog.tsx');
    expect(dialogSource).toContain('initialFocus={consumeEscape ? cancelButtonRef : undefined}');
    expect(dialogSource).not.toContain('cancelButtonRef.current?.focus');
    expect(/<Button[\s\S]*?ref=\{cancelButtonRef\}[\s\S]*?data-ocix-confirmation-action="cancel"/.test(dialogSource)).toBe(true);
  });
});
