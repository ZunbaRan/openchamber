import React from 'react';
import { getRuntimeUrlResolver } from '@/lib/runtime-url';
import { refreshRuntimeUrlAuthToken } from '@/lib/runtime-auth';
import type {
  InteractiveNativeExtension,
  NativeActivationHost,
  NativeViewComponent,
} from '@/lib/interactive-ui/types';
import { nativeUIKit } from './nativeUIKitRegistry';

const nativeViews = new Map<string, NativeViewComponent>();
const extensionLoads = new Map<string, Promise<void>>();

const isInteractiveNativeExtension = (value: unknown): value is InteractiveNativeExtension => {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<InteractiveNativeExtension>;
  return typeof candidate.id === 'string' && candidate.apiVersion === 1 && typeof candidate.activate === 'function';
};

export const getRegisteredNativeView = (viewId: string): NativeViewComponent | undefined => nativeViews.get(viewId);

const activateNativeExtension = (
  expectedExtensionId: string,
  extension: InteractiveNativeExtension,
): void => {
  if (extension.id !== expectedExtensionId) {
    throw new Error(`Native extension ID mismatch: expected ${expectedExtensionId}`);
  }

  const activationHost: NativeActivationHost = {
    apiVersion: 1,
    uiVersion: 1,
    react: React,
    ui: nativeUIKit as unknown as NativeActivationHost['ui'],
    views: {
      register(definition) {
        if (!definition.id.startsWith(`${expectedExtensionId}.`)) {
          throw new Error(`Native view ${definition.id} is outside extension namespace`);
        }
        const existing = nativeViews.get(definition.id);
        if (existing && existing !== definition.component) {
          throw new Error(`Native view ${definition.id} is already registered`);
        }
        nativeViews.set(definition.id, definition.component);
        return () => {
          if (nativeViews.get(definition.id) === definition.component) nativeViews.delete(definition.id);
        };
      },
    },
  };

  extension.activate(activationHost);
};

export const loadNativeExtension = async (
  extensionId: string,
  version: string,
  assetPath: string,
  exportName: string,
): Promise<void> => {
  const cacheKey = `${extensionId}@${version}:${assetPath}`;
  const existing = extensionLoads.get(cacheKey);
  if (existing) return existing;

  const load = (async () => {
    await refreshRuntimeUrlAuthToken().catch(() => '');
    const assetUrl = getRuntimeUrlResolver().authenticatedAsset(assetPath, { v: version });
    const imported = await import(/* @vite-ignore */ assetUrl) as Record<string, unknown>;
    const candidate = imported[exportName] ?? imported.extension ?? imported.default;
    if (!isInteractiveNativeExtension(candidate)) {
      throw new Error(`Native extension ${extensionId} does not export a compatible activation contract`);
    }
    activateNativeExtension(extensionId, candidate);
  })();

  extensionLoads.set(cacheKey, load);
  try {
    await load;
  } catch (error) {
    extensionLoads.delete(cacheKey);
    throw error;
  }
};
