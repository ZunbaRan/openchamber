import React from 'react';
import {
  getRuntimeUrlResolver,
  getRuntimeUrlResolverGeneration,
  type RuntimeUrlResolver,
} from '@/lib/runtime-url';
import { refreshRuntimeUrlAuthToken } from '@/lib/runtime-auth';
import type {
  InteractiveNativeExtension,
  NativeActivationHost,
  NativeViewComponent,
} from '@/lib/interactive-ui/types';
import { nativeUIKit } from './nativeUIKitRegistry';

/*
 * Trusted Native registry.
 *
 * Views, the load cache, and activation disposers are scoped to a captured
 * RuntimeUrlResolver, which identifies the runtime authority. A runtime switch
 * (new active resolver) therefore isolates this registry from stale views/code:
 * the previous scope is disposed on the next load and reads never return views
 * owned by another resolver.
 *
 * Activation is atomic: registrations made during extension.activate are staged
 * and become globally visible only after activation completes successfully. A
 * throw during activate, or a commit conflict, leaves no partial view behind.
 * Every successful activation disposer is tracked independently so it runs
 * exactly once when the scope is disposed; if a returned disposer's registration
 * commit conflicts or rolls back, that disposer is invoked before throwing.
 *
 * The load cache lives inside each scope and is keyed by a deterministic
 * primitive string covering extensionId, version, assetPath, and exportName, so
 * repeated identical logical loads reuse the same in-flight/completed promise.
 */

interface NativeScope {
  resolver: RuntimeUrlResolver;
  generation: number;
  views: Map<string, NativeViewComponent>;
  pending: Map<string, NativeViewComponent>;
  disposers: Array<() => void>;
  loads: Map<string, Promise<void>>;
}

let currentScope: NativeScope | null = null;

const disposeScope = (scope: NativeScope): void => {
  // Detach all state before invoking extension code. This makes cleanup
  // exactly-once even when a disposer throws or re-enters the registry.
  // Callers must install any replacement `currentScope` before dispose so a
  // re-entrant loadNativeExtension cannot bind to this dying scope and then
  // be overwritten by the outer scopeFor.
  const disposers = scope.disposers.splice(0);
  scope.views.clear();
  scope.pending.clear();
  scope.loads.clear();
  for (const disposer of disposers) {
    try {
      disposer();
    } catch {
      // A throwing disposer must not prevent other disposers or the switch.
    }
  }
};

const scopeFor = (resolver: RuntimeUrlResolver, generation: number): NativeScope => {
  if (
    currentScope
    && currentScope.resolver === resolver
    && currentScope.generation === generation
  ) return currentScope;
  const previous = currentScope;
  const next: NativeScope = {
    resolver,
    generation,
    views: new Map(),
    pending: new Map(),
    disposers: [],
    loads: new Map(),
  };
  // Install the new current scope before invoking previous disposers. If a
  // disposer re-enters loadNativeExtension, nested scopeFor observes `next`
  // (or a further replacement) instead of being overwritten by this call.
  currentScope = next;
  if (previous) disposeScope(previous);
  // Re-entrant loads during dispose may have replaced `next`. Prefer the live
  // matching authority over a superseded empty shell.
  if (
    currentScope
    && currentScope.resolver === resolver
    && currentScope.generation === generation
  ) {
    return currentScope;
  }
  return scopeFor(resolver, generation);
};

const isInteractiveNativeExtension = (value: unknown): value is InteractiveNativeExtension => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<InteractiveNativeExtension>;
  return typeof candidate.id === 'string' && candidate.apiVersion === 1 && typeof candidate.activate === 'function';
};

export const getRegisteredNativeView = (viewId: string): NativeViewComponent | undefined => {
  const scope = currentScope;
  // Never surface views belonging to a previous runtime authority or to an
  // earlier installation of the same resolver object.
  if (
    !scope
    || scope.resolver !== getRuntimeUrlResolver()
    || scope.generation !== getRuntimeUrlResolverGeneration()
  ) return undefined;
  return scope.views.get(viewId);
};

const activateNativeExtension = (
  scope: NativeScope,
  expectedExtensionId: string,
  extension: InteractiveNativeExtension,
): void => {
  if (extension.id !== expectedExtensionId) {
    throw new Error(`Native extension ID mismatch: expected ${expectedExtensionId}`);
  }

  let acceptingRegistrations = true;
  const activationHost: NativeActivationHost = {
    apiVersion: 1,
    uiVersion: 1,
    react: React,
    ui: nativeUIKit as unknown as NativeActivationHost['ui'],
    views: {
      register(definition) {
        if (!acceptingRegistrations) {
          throw new Error(`Native extension ${expectedExtensionId} registered outside synchronous activation`);
        }
        if (!definition || typeof definition.id !== 'string' || typeof definition.component !== 'function') {
          throw new Error('Native view registration is not a compatible component definition');
        }
        if (!definition.id.startsWith(`${expectedExtensionId}.`)) {
          throw new Error(`Native view ${definition.id} is outside extension namespace`);
        }
        const staged = scope.pending.get(definition.id);
        if (staged && staged !== definition.component) {
          throw new Error(`Native view ${definition.id} is already registered`);
        }
        scope.pending.set(definition.id, definition.component);
        return () => {
          if (scope.views.get(definition.id) === definition.component) scope.views.delete(definition.id);
          if (scope.pending.get(definition.id) === definition.component) scope.pending.delete(definition.id);
        };
      },
    },
  };

  let activationDisposer: (() => void) | null = null;
  try {
    const result: unknown = extension.activate(activationHost);
    acceptingRegistrations = false;
    if (result !== undefined && typeof result !== 'function') {
      // Async/thenable activation is outside the v1 contract. Attach a
      // rejection sink because a late register call will now throw by design.
      if (
        result
        && typeof result === 'object'
        && 'then' in result
        && typeof (result as { then?: unknown }).then === 'function'
      ) void Promise.resolve(result).catch(() => undefined);
      throw new Error(`Native extension ${expectedExtensionId} returned an incompatible activation result`);
    }
    activationDisposer = typeof result === 'function' ? result as () => void : null;
  } catch (error) {
    acceptingRegistrations = false;
    // Atomic: never commit a partially registered extension.
    scope.pending.clear();
    throw error;
  }

  // Commit staged registrations atomically: validate every id, then apply all.
  // A conflict with an already-committed view rolls back the whole activation
  // and runs the returned disposer before throwing.
  for (const [id, component] of scope.pending) {
    const committed = scope.views.get(id);
    if (committed && committed !== component) {
      scope.pending.clear();
      try {
        activationDisposer?.();
      } catch {
        // Preserve the authoritative commit-conflict error after rollback.
      }
      throw new Error(`Native view ${id} is already registered`);
    }
  }
  for (const [id, component] of scope.pending) {
    scope.views.set(id, component);
  }
  scope.pending.clear();
  // Track every successful activation disposer so each runs exactly once.
  if (activationDisposer) {
    scope.disposers.push(activationDisposer);
  }
};

type NativeAssetImporter = (assetUrl: string) => Promise<Record<string, unknown>>;
type NativeAuthRefresher = () => Promise<void>;

let nativeAssetImporter: NativeAssetImporter = async (assetUrl) =>
  (await import(/* @vite-ignore */ assetUrl)) as unknown as Record<string, unknown>;

let nativeAuthRefresher: NativeAuthRefresher = async () => {
  await refreshRuntimeUrlAuthToken().catch(() => '');
};

// JSON tuple encoding preserves component boundaries even when an input
// contains NUL or another delimiter character.
const loadKeyString = (extensionId: string, version: string, assetPath: string, exportName: string): string =>
  JSON.stringify([extensionId, version, assetPath, exportName]);

const assertScopeAuthority = (scope: NativeScope, extensionId: string): void => {
  // Fail closed as soon as the active resolver or its monotonic generation
  // diverges from the load's captured authority — before URL construction,
  // import, or activation commit.
  if (
    getRuntimeUrlResolver() !== scope.resolver
    || getRuntimeUrlResolverGeneration() !== scope.generation
  ) {
    throw new Error(`Native extension ${extensionId} runtime changed during load`);
  }
};

const loadNativeExtensionNow = async (
  scope: NativeScope,
  extensionId: string,
  version: string,
  assetPath: string,
  exportName: string,
): Promise<void> => {
  await nativeAuthRefresher();
  // Token refresh yields: an A→B switch that landed during the await must not
  // build an authenticated URL or import under the stale captured authority.
  assertScopeAuthority(scope, extensionId);
  const assetUrl = scope.resolver.authenticatedAsset(assetPath, { v: version });
  assertScopeAuthority(scope, extensionId);
  const imported = await nativeAssetImporter(assetUrl);
  // A runtime switch during the async import must fail/rollback, never commit
  // code captured under a stale runtime authority.
  assertScopeAuthority(scope, extensionId);
  const candidate = imported[exportName] ?? imported.extension ?? imported.default;
  if (!isInteractiveNativeExtension(candidate)) {
    throw new Error(`Native extension ${extensionId} does not export a compatible activation contract`);
  }
  activateNativeExtension(scope, extensionId, candidate);
};

export const loadNativeExtension = async (
  extensionId: string,
  version: string,
  assetPath: string,
  exportName: string,
): Promise<void> => {
  const scope = scopeFor(getRuntimeUrlResolver(), getRuntimeUrlResolverGeneration());
  const key = loadKeyString(extensionId, version, assetPath, exportName);
  const existing = scope.loads.get(key);
  if (existing) return existing;

  const load = loadNativeExtensionNow(scope, extensionId, version, assetPath, exportName);
  scope.loads.set(key, load);
  try {
    await load;
  } catch (error) {
    // Failed loads remain retryable: evict the stale cache entry.
    scope.loads.delete(key);
    throw error;
  }
};

/**
 * @internal Test-only seam: replace the ESM asset importer so native loads can be
 * exercised without a real network/runtime module fetch. No production caller
 * uses this. Returns a restore function.
 */
export const _setNativeAssetImporterForTest = (importer: NativeAssetImporter): (() => void) => {
  const previous = nativeAssetImporter;
  nativeAssetImporter = importer;
  return () => {
    nativeAssetImporter = previous;
  };
};

/**
 * @internal Test-only seam: replace the auth-refresh step so generation races
 * can be injected between refresh await and URL construction. Returns restore.
 */
export const _setNativeAuthRefresherForTest = (refresher: NativeAuthRefresher): (() => void) => {
  const previous = nativeAuthRefresher;
  nativeAuthRefresher = refresher;
  return () => {
    nativeAuthRefresher = previous;
  };
};
