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

  test('exposes the Style v2 form, overlay, display, and layout additions', () => {
    for (const key of [
      'Select', 'Checkbox', 'RadioGroup', 'Switch',
      'Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter', 'DialogTrigger',
      'Tooltip', 'TooltipTrigger', 'TooltipContent', 'TooltipProvider',
      'Stat', 'DescriptionList', 'Avatar', 'Pagination',
      'Stack', 'Grid', 'Split',
    ] as const) {
      expect(nativeUIKit[key]).toBeDefined();
    }
  });

  test('renders Stat with delta tone tokens and description lists', () => {
    const html = renderToStaticMarkup(
      <nativeUIKit.Stack gap={2}>
        <nativeUIKit.Stat label="MRR" value="¥42,000" delta="+12.4%" trend="up" detail="vs last month" />
        <nativeUIKit.DescriptionList columns={2} items={[{ label: 'Plan', value: 'Enterprise' }, { label: 'Owner', value: 'Lin' }]} />
      </nativeUIKit.Stack>,
    );

    expect(html).toContain('MRR');
    expect(html).toContain('¥42,000');
    expect(html).toContain('--ocix-delta-up');
    expect(html).toContain('ocix-type-display');
    expect(html).toContain('Enterprise');
    expect(html).toContain('sm:grid-cols-2');
  });

  test('renders radio groups, checkboxes, and pagination with bounded pages', () => {
    const html = renderToStaticMarkup(
      <nativeUIKit.Stack>
        <nativeUIKit.RadioGroup value="annual" onValueChange={() => {}} options={[{ value: 'monthly', label: 'Monthly' }, { value: 'annual', label: 'Annual' }]} />
        <nativeUIKit.Checkbox checked onChange={() => {}} label="Auto-renew" description="Bills yearly" />
        <nativeUIKit.Pagination page={7} pageCount={3} onPageChange={() => {}} />
      </nativeUIKit.Stack>,
    );

    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('Monthly');
    expect(html).toContain('Auto-renew');
    expect(html).toContain('Bills yearly');
    expect(html).toContain('3 / 3');
  });

  test('renders layout primitives with responsive grid classes', () => {
    const html = renderToStaticMarkup(
      <nativeUIKit.Split ratio="1:2">
        <nativeUIKit.Grid columns={3}><span>cell</span></nativeUIKit.Grid>
        <nativeUIKit.Avatar name="Lin Zheng" />
      </nativeUIKit.Split>,
    );

    expect(html).toContain('lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]');
    expect(html).toContain('lg:grid-cols-3');
    expect(html).toContain('LZ');
    expect(html).toContain('role="img"');
  });
});
