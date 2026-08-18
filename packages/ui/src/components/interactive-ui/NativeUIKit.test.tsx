import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createRuntimeUrlResolver, setRuntimeUrlResolver } from '@/lib/runtime-url';
import { setRuntimeUrlAuthToken } from '@/lib/runtime-auth';
import type { InteractiveNativeExtension, NativeActivationHost } from '@/lib/interactive-ui/types';
import {
  getRegisteredNativeView,
  loadNativeExtension,
  _setNativeAssetImporterForTest,
  _setNativeAuthRefresherForTest,
} from './nativeRegistry';
import {
  ActivityFeedPrimitive,
  HeatmapPrimitive,
  KanbanPrimitive,
  NetworkPrimitive,
  TimelinePrimitive,
} from './DeclarativeAdvancedPrimitives';
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

describe('nativeRegistry', () => {
  let restoreImporter: (() => void) | null = null;
  let restoreAuthRefresher: (() => void) | null = null;

  const replaceImporter = (importer: Parameters<typeof _setNativeAssetImporterForTest>[0]): void => {
    restoreImporter?.();
    restoreImporter = _setNativeAssetImporterForTest(importer);
  };

  const replaceAuthRefresher = (refresher: Parameters<typeof _setNativeAuthRefresherForTest>[0]): void => {
    restoreAuthRefresher?.();
    restoreAuthRefresher = _setNativeAuthRefresherForTest(refresher);
  };

  const dummyView = () => React.createElement('div', null, 'native view');
  const otherView = () => React.createElement('span', null, 'other view');

  // Build a minimal InteractiveNativeExtension whose activate registers views
  // through the host with a simplified register(id, component) shape and may
  // return an optional disposer.
  const makeExtension = (activate: (register: (id: string, component: () => React.ReactNode) => void | undefined | (() => void)) => void | (() => void)): InteractiveNativeExtension => ({
    id: 'ext',
    apiVersion: 1,
    activate: ((host: NativeActivationHost) => {
      const register = (id: string, component: () => React.ReactNode) => host.views.register({ id, component: component as never });
      return activate(register);
    }) as unknown as InteractiveNativeExtension['activate'],
  });

  beforeEach(() => {
    restoreImporter?.();
    restoreImporter = null;
    restoreAuthRefresher?.();
    restoreAuthRefresher = null;
    // Avoid real network minting during refreshRuntimeUrlAuthToken.
    setRuntimeUrlAuthToken('test-token', Date.now() + 60_000);
    setRuntimeUrlResolver(createRuntimeUrlResolver({ apiBaseUrl: 'http://resolver-native' }));
  });

  afterEach(() => {
    restoreImporter?.();
    restoreImporter = null;
    restoreAuthRefresher?.();
    restoreAuthRefresher = null;
  });

  test('rolls back staged registrations when activation throws', async () => {
    replaceImporter(async () => ({
      default: makeExtension((register) => {
        register('ext.partial', dummyView);
        throw new Error('activation failed');
      }),
    }));
    await expect(loadNativeExtension('ext', '1', '/a.js', 'default')).rejects.toThrow('activation failed');
    expect(getRegisteredNativeView('ext.partial')).toBe(undefined);
  });

  test('fails closed on extension ID mismatch without leaving views', async () => {
    replaceImporter(async () => ({
      default: { id: 'other', apiVersion: 1, activate: () => undefined } as unknown as InteractiveNativeExtension,
    }));
    await expect(loadNativeExtension('ext', '1', '/a.js', 'default')).rejects.toThrow('ID mismatch');
    expect(getRegisteredNativeView('ext.a')).toBe(undefined);
  });

  test('fails closed on out-of-namespace view registration', async () => {
    replaceImporter(async () => ({
      default: makeExtension((register) => register('outside.view', dummyView)),
    }));
    await expect(loadNativeExtension('ext', '1', '/a.js', 'default')).rejects.toThrow('outside extension namespace');
    expect(getRegisteredNativeView('outside.view')).toBe(undefined);
  });

  test('honors the activation disposer and removes exact views on runtime change', async () => {
    let disposed = false;
    replaceImporter(async () => ({
      default: makeExtension((register) => {
        register('ext.a', dummyView);
        return () => { disposed = true; };
      }),
    }));
    await loadNativeExtension('ext', '1', '/a.js', 'default');
    expect(getRegisteredNativeView('ext.a')).toBeDefined();

    // A runtime switch to a new authority hides previous-resolver views.
    setRuntimeUrlResolver(createRuntimeUrlResolver({ apiBaseUrl: 'http://resolver-b' }));
    expect(getRegisteredNativeView('ext.a')).toBe(undefined);

    // Loading on the new authority disposes the previous scope (disposer runs).
    replaceImporter(async () => ({
      default: makeExtension(() => undefined),
    }));
    await loadNativeExtension('ext', '1', '/b.js', 'default');
    expect(disposed).toBe(true);
  });

  test('caches loads per exportName so repeat loads are not re-fetched', async () => {
    let calls = 0;
    replaceImporter(async () => {
      calls += 1;
      return { default: makeExtension((register) => register('ext.v', dummyView)) };
    });
    await loadNativeExtension('ext', '1', '/a.js', 'one');
    await loadNativeExtension('ext', '1', '/a.js', 'two');
    expect(calls).toBe(2); // distinct exportName => distinct cache entries
    await loadNativeExtension('ext', '1', '/a.js', 'one');
    expect(calls).toBe(2); // cached => importer not invoked again
  });

  test('rejects a load whose runtime authority changes mid-load without committing', async () => {
    let resolveImporter!: (value: Record<string, unknown>) => void;
    let importerReady!: () => void;
    const importerReadyPromise = new Promise<void>((resolve) => { importerReady = resolve; });
    replaceImporter(() => {
      importerReady();
      return new Promise((resolve) => { resolveImporter = resolve; });
    });

    const loadPromise = loadNativeExtension('ext', '1', '/a.js', 'default');
    await importerReadyPromise;
    setRuntimeUrlResolver(createRuntimeUrlResolver({ apiBaseUrl: 'http://resolver-b' }));
    resolveImporter({ default: makeExtension((register) => register('ext.a', dummyView)) });

    await expect(loadPromise).rejects.toThrow('runtime changed during load');
    expect(getRegisteredNativeView('ext.a')).toBe(undefined);
  });

  test('rejects a load whose runtime authority switches during token refresh before URL construction', async () => {
    let releaseRefresh!: () => void;
    let refreshEntered!: () => void;
    const entered = new Promise<void>((resolve) => { refreshEntered = resolve; });
    const gate = new Promise<void>((resolve) => { releaseRefresh = resolve; });
    let importerCalls = 0;
    replaceAuthRefresher(async () => {
      refreshEntered();
      await gate;
    });
    replaceImporter(async () => {
      importerCalls += 1;
      return { default: makeExtension((register) => register('ext.a', dummyView)) };
    });

    const loadPromise = loadNativeExtension('ext', '1', '/a.js', 'default');
    await entered;
    setRuntimeUrlResolver(createRuntimeUrlResolver({ apiBaseUrl: 'http://resolver-b' }));
    releaseRefresh();

    await expect(loadPromise).rejects.toThrow('runtime changed during load');
    expect(importerCalls).toBe(0);
    expect(getRegisteredNativeView('ext.a')).toBe(undefined);
  });

  test('keeps a re-entrant load during dispose on the newly installed scope', async () => {
    let firstDisposed = 0;
    let nestedLoad: Promise<void> | null = null;
    replaceImporter(async (assetUrl) => {
      if (String(assetUrl).includes('/nested.js')) {
        return {
          default: makeExtension((register) => {
            register('ext.nested', otherView);
          }),
        };
      }
      if (String(assetUrl).includes('/b.js')) {
        return {
          default: makeExtension((register) => {
            register('ext.b', dummyView);
          }),
        };
      }
      return {
        default: makeExtension((register) => {
          register('ext.a', dummyView);
          return () => {
            firstDisposed += 1;
            // Re-enter after A→B: the new current scope must already be B so
            // this nested load is not overwritten by the outer scopeFor.
            nestedLoad = loadNativeExtension('ext', '1', '/nested.js', 'default');
          };
        }),
      };
    });

    await loadNativeExtension('ext', '1', '/a.js', 'default');
    expect(getRegisteredNativeView('ext.a')).toBe(dummyView);

    setRuntimeUrlResolver(createRuntimeUrlResolver({ apiBaseUrl: 'http://resolver-b' }));
    // Trigger dispose of A while installing B.
    await loadNativeExtension('ext', '1', '/b.js', 'default');
    expect(firstDisposed).toBe(1);
    expect(nestedLoad).not.toBeNull();
    await nestedLoad;
    // Nested load must still be visible on the live B authority together with B.
    expect(getRegisteredNativeView('ext.b')).toBe(dummyView);
    expect(getRegisteredNativeView('ext.nested')).toBe(otherView);
  });

  test('retries a failed load (cache evicted) and commits on success', async () => {
    let attempts = 0;
    replaceImporter(async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('asset unavailable');
      return { default: makeExtension((register) => register('ext.ok', dummyView)) };
    });
    await expect(loadNativeExtension('ext', '1', '/a.js', 'default')).rejects.toThrow('asset unavailable');
    expect(getRegisteredNativeView('ext.ok')).toBe(undefined);

    await loadNativeExtension('ext', '1', '/a.js', 'default');
    expect(attempts).toBe(2);
    expect(getRegisteredNativeView('ext.ok')).toBeDefined();
  });

  test('dedupes identical logical loads within a scope by a deterministic key', async () => {
    let calls = 0;
    replaceImporter(async () => {
      calls += 1;
      return { default: makeExtension((register) => register('ext.v', dummyView)) };
    });
    await loadNativeExtension('ext', '1', '/a.js', 'same');
    await loadNativeExtension('ext', '1', '/a.js', 'same');
    expect(calls).toBe(1); // identical logical key reuses the same promise/import
  });

  test('disposes exactly once for every successfully loaded extension on scope switch', async () => {
    let firstDisposed = 0;
    let secondDisposed = 0;
    replaceImporter(async () => ({
      default: makeExtension((register) => {
        register('ext.a', dummyView);
        return () => { firstDisposed += 1; };
      }),
    }));
    await loadNativeExtension('ext', '1', '/a.js', 'one');
    replaceImporter(async () => ({
      default: makeExtension((register) => {
        register('ext.b', otherView);
        return () => { secondDisposed += 1; };
      }),
    }));
    await loadNativeExtension('ext', '1', '/a.js', 'two');
    expect(getRegisteredNativeView('ext.a')).toBeDefined();
    expect(getRegisteredNativeView('ext.b')).toBeDefined();

    // Runtime switch, then a load on the new authority disposes the old scope.
    setRuntimeUrlResolver(createRuntimeUrlResolver({ apiBaseUrl: 'http://resolver-b' }));
    replaceImporter(async () => ({
      default: makeExtension(() => undefined),
    }));
    await loadNativeExtension('ext', '1', '/b.js', 'default');
    expect(firstDisposed).toBe(1);
    expect(secondDisposed).toBe(1);
  });

  test('invokes the returned disposer when a commit conflict rolls back the load', async () => {
    let firstDisposed = 0;
    let conflictingDisposed = 0;
    replaceImporter(async () => ({
      default: makeExtension((register) => {
        register('ext.a', dummyView);
        return () => { firstDisposed += 1; };
      }),
    }));
    await loadNativeExtension('ext', '1', '/a.js', 'one');
    expect(getRegisteredNativeView('ext.a')).toBe(dummyView);

    // Distinct exportName registers the same id with a different component and
    // returns a disposer; the commit must conflict, run the disposer, and leave
    // the already-committed view intact.
    replaceImporter(async () => ({
      default: makeExtension((register) => {
        register('ext.a', otherView);
        return () => { conflictingDisposed += 1; };
      }),
    }));
    await expect(loadNativeExtension('ext', '1', '/a.js', 'two')).rejects.toThrow('already registered');
    expect(getRegisteredNativeView('ext.a')).toBe(dummyView);
    expect(conflictingDisposed).toBe(1);
    expect(firstDisposed).toBe(0);
  });

  test('does not revive stale views when a previously used resolver object is reinstalled', async () => {
    const resolverA = createRuntimeUrlResolver({ apiBaseUrl: 'http://resolver-a' });
    const resolverB = createRuntimeUrlResolver({ apiBaseUrl: 'http://resolver-b' });
    let calls = 0;
    setRuntimeUrlResolver(resolverA);
    replaceImporter(async () => {
      calls += 1;
      const component = calls === 1 ? dummyView : otherView;
      return { default: makeExtension((register) => register('ext.a', component)) };
    });

    await loadNativeExtension('ext', '1', '/a.js', 'default');
    expect(getRegisteredNativeView('ext.a')).toBe(dummyView);
    setRuntimeUrlResolver(resolverB);
    expect(getRegisteredNativeView('ext.a')).toBe(undefined);
    setRuntimeUrlResolver(resolverA);
    expect(getRegisteredNativeView('ext.a')).toBe(undefined);

    await loadNativeExtension('ext', '1', '/a.js', 'default');
    expect(calls).toBe(2);
    expect(getRegisteredNativeView('ext.a')).toBe(otherView);
  });

  test('keeps cache identities distinct when fields contain delimiter characters', async () => {
    const extensionIds = ['a\u0000b', 'a'];
    let calls = 0;
    replaceImporter(async () => {
      const id = extensionIds[calls++];
      return {
        default: {
          id,
          apiVersion: 1,
          activate: (host: NativeActivationHost) => {
            host.views.register({ id: `${id}.view`, component: dummyView as never });
          },
        } satisfies InteractiveNativeExtension,
      };
    });

    await loadNativeExtension(extensionIds[0], 'c', '/d', 'e');
    await loadNativeExtension(extensionIds[1], 'b\u0000c', '/d', 'e');
    expect(calls).toBe(2);
    expect(getRegisteredNativeView(`${extensionIds[0]}.view`)).toBe(dummyView);
    expect(getRegisteredNativeView(`${extensionIds[1]}.view`)).toBe(dummyView);
  });

  test('does not deduplicate identical disposer functions from separate activations', async () => {
    let calls = 0;
    let disposed = 0;
    const sharedDisposer = () => { disposed += 1; };
    replaceImporter(async () => {
      calls += 1;
      const id = calls === 1 ? 'ext.a' : calls === 2 ? 'ext.b' : 'ext.c';
      return { default: makeExtension((register) => {
        register(id, dummyView);
        return sharedDisposer;
      }) };
    });

    await loadNativeExtension('ext', '1', '/a.js', 'one');
    await loadNativeExtension('ext', '1', '/a.js', 'two');
    setRuntimeUrlResolver(createRuntimeUrlResolver({ apiBaseUrl: 'http://resolver-b' }));
    await loadNativeExtension('ext', '1', '/b.js', 'three');
    expect(disposed).toBe(2);
  });

  test('clears staged registrations before invoking a throwing conflict disposer', async () => {
    replaceImporter(async () => ({
      default: makeExtension((register) => register('ext.a', dummyView)),
    }));
    await loadNativeExtension('ext', '1', '/a.js', 'one');

    replaceImporter(async () => ({
      default: makeExtension((register) => {
        register('ext.a', otherView);
        return () => { throw new Error('cleanup failed'); };
      }),
    }));
    await expect(loadNativeExtension('ext', '1', '/a.js', 'two')).rejects.toThrow('already registered');

    replaceImporter(async () => ({
      default: makeExtension((register) => register('ext.b', otherView)),
    }));
    await loadNativeExtension('ext', '1', '/a.js', 'three');
    expect(getRegisteredNativeView('ext.a')).toBe(dummyView);
    expect(getRegisteredNativeView('ext.b')).toBe(otherView);
  });

  test('rejects non-component native view registrations', async () => {
    replaceImporter(async () => ({
      default: {
        id: 'ext',
        apiVersion: 1,
        activate(host: NativeActivationHost) {
          host.views.register({ id: 'ext.invalid', component: 42 as never });
        },
      } satisfies InteractiveNativeExtension,
    }));

    await expect(loadNativeExtension('ext', '1', '/a.js', 'default')).rejects.toThrow('compatible component');
    expect(getRegisteredNativeView('ext.invalid')).toBe(undefined);
  });

  test('rejects async activation and blocks late registration from poisoning the next load', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    replaceImporter(async () => ({
      default: {
        id: 'ext',
        apiVersion: 1,
        activate(host: NativeActivationHost) {
          return (async () => {
            await gate;
            host.views.register({ id: 'ext.late', component: dummyView as never });
          })() as never;
        },
      } satisfies InteractiveNativeExtension,
    }));

    await expect(loadNativeExtension('ext', '1', '/a.js', 'async')).rejects.toThrow('incompatible activation result');
    release();
    await Promise.resolve();
    await Promise.resolve();
    expect(getRegisteredNativeView('ext.late')).toBe(undefined);

    replaceImporter(async () => ({
      default: makeExtension((register) => register('ext.next', dummyView)),
    }));
    await loadNativeExtension('ext', '1', '/a.js', 'next');
    expect(getRegisteredNativeView('ext.next')).toBe(dummyView);
  });
});

describe('DeclarativeAdvancedPrimitives collection bounds', () => {
  const identity = (value: unknown): unknown => value;

  test('Timeline does not render oversized item arrays beyond its cap', () => {
    const node = { type: 'timeline', items: Array.from({ length: 5000 }, (_, i) => ({ title: `t-${i}`, description: 'd' })) };
    const html = renderToStaticMarkup(<TimelinePrimitive node={node} resolveValue={identity} emptyLabel="empty" />);
    expect(html).toContain('t-0');
    expect(html).toContain('t-99');
    expect(html).not.toContain('t-100');
  });

  test('ActivityFeed does not render oversized item arrays beyond its cap', () => {
    const node = { type: 'activity-feed', items: Array.from({ length: 5000 }, (_, i) => ({ actor: `a-${i}`, description: 'd' })) };
    const html = renderToStaticMarkup(<ActivityFeedPrimitive node={node} resolveValue={identity} emptyLabel="empty" />);
    expect(html).toContain('a-0');
    expect(html).not.toContain('a-100');
  });

  test('Network does not render nodes/edges beyond its caps', () => {
    const nodes = Array.from({ length: 5000 }, (_, i) => ({ id: `n-${i}`, label: `n-${i}` }));
    const edges = Array.from({ length: 5000 }, (_, i) => ({ source: 'n-0', target: `n-${i + 1}` }));
    const node = { type: 'network', nodes, edges };
    const html = renderToStaticMarkup(<NetworkPrimitive node={node} resolveValue={identity} emptyLabel="empty" />);
    expect(html).toContain('n-0');
    expect(html).toContain('n-29');
    expect(html).not.toContain('n-30');
  });

  test('Kanban bounds columns and cards', () => {
    const columns = Array.from({ length: 1000 }, (_, i) => ({ id: `col-${i}`, title: `col-${i}` }));
    const cards = Array.from({ length: 5000 }, (_, i) => ({ id: `card-${i}`, column: 'col-0', title: `card-${i}` }));
    const node = { type: 'kanban', columns, cards };
    const html = renderToStaticMarkup(<KanbanPrimitive node={node} resolveValue={identity} emptyLabel="empty" />);
    expect(html).toContain('col-0');
    expect(html).not.toContain('col-24');
    expect(html).not.toContain('card-200');
  });

  test('Heatmap never throws on oversized valid cells and bounds rows/columns', () => {
    const cells = Array.from({ length: 5000 }, (_, i) => ({ row: `r-${i % 70}`, column: `c-${i % 70}`, value: i }));
    const node = { type: 'heatmap', cells };
    const html = renderToStaticMarkup(<HeatmapPrimitive node={node} resolveValue={identity} emptyLabel="empty" />);
    expect(html).toContain('r-0');
    expect(html).not.toContain('r-60');
  });

  test('Heatmap never throws on oversized malformed cells', () => {
    const cells = Array.from({ length: 5000 }, (_, i) => ({ row: i % 2 === 0 ? 'r' : 'row', value: 'nope' }));
    const node = { type: 'heatmap', cells };
    const html = renderToStaticMarkup(<HeatmapPrimitive node={node} resolveValue={identity} emptyLabel="empty" />);
    expect(html).toContain('empty');
  });
});
