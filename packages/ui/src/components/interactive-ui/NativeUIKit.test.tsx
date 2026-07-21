import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'bun:test';
import { nativeUIKit } from './nativeUIKitRegistry';

describe('nativeUIKit', () => {
  test('renders host-owned data components with OCIX semantic tokens', () => {
    const html = renderToStaticMarkup(
      <nativeUIKit.Card>
        <nativeUIKit.CardHeader><nativeUIKit.CardTitle>Pipeline</nativeUIKit.CardTitle></nativeUIKit.CardHeader>
        <nativeUIKit.CardContent>
          <nativeUIKit.Badge tone="success">Ready</nativeUIKit.Badge>
          <nativeUIKit.Progress value={0.75} />
        </nativeUIKit.CardContent>
      </nativeUIKit.Card>,
    );

    expect(html).toContain('Pipeline');
    expect(html).toContain('Ready');
    expect(html).toContain('--ocix-success');
    expect(html).toContain('aria-valuenow="75"');
  });

  test('renders a semantic notice whose meaning is not color-only', () => {
    const html = renderToStaticMarkup(
      <nativeUIKit.Notice tone="warning" heading="Showing saved data">
        The business system could not be reached.
      </nativeUIKit.Notice>,
    );

    expect(html).toContain('Showing saved data');
    expect(html).toContain('The business system could not be reached.');
    expect(html).toContain('role="status"');
    expect(html).toContain('--ocix-warning');
  });

  test('renders only the selected native tab content', () => {
    const html = renderToStaticMarkup(
      <nativeUIKit.Tabs defaultValue="summary">
        <nativeUIKit.TabsList>
          <nativeUIKit.TabsTrigger value="summary">Summary</nativeUIKit.TabsTrigger>
          <nativeUIKit.TabsTrigger value="detail">Detail</nativeUIKit.TabsTrigger>
        </nativeUIKit.TabsList>
        <nativeUIKit.TabsContent value="summary">Visible panel</nativeUIKit.TabsContent>
        <nativeUIKit.TabsContent value="detail">Hidden panel</nativeUIKit.TabsContent>
      </nativeUIKit.Tabs>,
    );

    expect(html).toContain('Visible panel');
    expect(html).not.toContain('Hidden panel');
    expect(html).toContain('aria-controls=');
    expect(html).toContain('aria-labelledby=');
    expect(html).toContain('tabindex="0"');
  });

  test('keeps native table headers visible inside a scrolling data region', () => {
    const html = renderToStaticMarkup(
      <nativeUIKit.Table containerClassName="rounded-none border-x-0 border-b-0">
        <nativeUIKit.TableHeader>
          <nativeUIKit.TableRow><nativeUIKit.TableHead>Account</nativeUIKit.TableHead></nativeUIKit.TableRow>
        </nativeUIKit.TableHeader>
        <nativeUIKit.TableBody>
          <nativeUIKit.TableRow><nativeUIKit.TableCell>Acme</nativeUIKit.TableCell></nativeUIKit.TableRow>
        </nativeUIKit.TableBody>
      </nativeUIKit.Table>,
    );

    expect(html).toContain('sticky top-0');
    expect(html).toContain('rounded-none border-x-0 border-b-0');
    expect(html).toContain('Account');
    expect(html).toContain('Acme');
  });
});
