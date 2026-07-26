import React from 'react';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/icon/Icon';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { SettingsPageLayout } from '@/components/sections/shared/SettingsPageLayout';
import {
  SETTINGS_FIELD_LABEL_CLASS,
  SETTINGS_HELPER_CLASS,
  SettingsSection,
  SettingsStackedField,
} from '@/components/sections/shared/SettingsSection';
import { useI18n } from '@/lib/i18n';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { clearInteractiveUIRoutingCache } from '@/lib/interactive-ui/routing';
import {
  EMPTY_MANAGER_SNAPSHOT,
  EMPTY_CONNECTION_SNAPSHOT,
  classifyCatalogInstallState,
  normalizeCatalogEntries,
  normalizeConnectionSnapshot,
  normalizeManagerSnapshot,
  normalizeMarketplaceInspection,
  normalizePackageInspection,
  type CatalogEntry,
  type ConnectionSnapshot,
  type InstalledExtension,
  type ManagerSnapshot,
  type MarketplaceInspection,
  type PackageInspection,
} from '@/lib/interactive-ui/extensionManager';
import { RoutingInspectorSection } from './RoutingInspectorSection';

const requestJson = async <T,>(url: string, init?: RequestInit): Promise<T> => {
  const response = await runtimeFetch(url, init);
  const body = await response.json().catch(() => ({})) as { error?: string } & T;
  if (!response.ok) throw new Error(body.error || String(response.status));
  return body;
};

const fileToBase64 = (file: File): Promise<string> => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onerror = () => reject(reader.error ?? new Error('File read failed'));
  reader.onload = () => {
    const value = typeof reader.result === 'string' ? reader.result : '';
    const separator = value.indexOf(',');
    if (separator < 0) reject(new Error('File encoding failed'));
    else resolve(value.slice(separator + 1));
  };
  reader.readAsDataURL(file);
});

export const ExtensionManagerPage: React.FC = () => {
  const { t, locale } = useI18n();
  const packageInputRef = React.useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = React.useState<ManagerSnapshot>(EMPTY_MANAGER_SNAPSHOT);
  const [connectionSnapshot, setConnectionSnapshot] = React.useState<ConnectionSnapshot>(EMPTY_CONNECTION_SNAPSHOT);
  const [connectionInputs, setConnectionInputs] = React.useState<Record<string, string>>({});
  const [connectionEndpointInputs, setConnectionEndpointInputs] = React.useState<Record<string, string>>({});
  const [connectionHeaderInputs, setConnectionHeaderInputs] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = React.useState<InstalledExtension | null>(null);
  const [uninstallImpact, setUninstallImpact] = React.useState<{ tiles: number; projects: number } | null>(null);
  const [pendingPackage, setPendingPackage] = React.useState<{ packageBase64: string; inspection: PackageInspection } | null>(null);
  const [marketplaceUrl, setMarketplaceUrl] = React.useState('');
  const [pendingMarketplace, setPendingMarketplace] = React.useState<MarketplaceInspection | null>(null);
  const [catalogs, setCatalogs] = React.useState<Record<string, CatalogEntry[]>>({});

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const [managerValue, connectionValue] = await Promise.all([
        requestJson<unknown>('/api/interactive-ui/manager'),
        requestJson<unknown>('/api/interactive-ui/connections'),
      ]);
      setSnapshot(normalizeManagerSnapshot(managerValue));
      setConnectionSnapshot(normalizeConnectionSnapshot(connectionValue));
    } catch (error) {
      toast.error(t('settings.interactiveUI.toast.loadFailed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setLoading(false);
    }
  }, [t]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  React.useEffect(() => {
    if (!confirmUninstall) {
      setUninstallImpact(null);
      return;
    }
    let active = true;
    setUninstallImpact(null);
    void requestJson<{ tiles: number; projects: number }>(
      `/api/interactive-ui/manager/extensions/${encodeURIComponent(confirmUninstall.id)}/uninstall-impact`,
      { cache: 'no-store' },
    ).then((impact) => {
      if (active) setUninstallImpact(impact);
    }).catch((error) => {
      if (active) {
        toast.error(t('settings.interactiveUI.toast.loadFailed'), {
          description: error instanceof Error ? error.message : undefined,
        });
        setConfirmUninstall(null);
      }
    });
    return () => {
      active = false;
    };
  }, [confirmUninstall, t]);

  const runMutation = React.useCallback(async (key: string, operation: () => Promise<unknown>, successKey: Parameters<typeof t>[0]): Promise<boolean> => {
    setBusy(key);
    try {
      await operation();
      clearInteractiveUIRoutingCache();
      toast.success(t(successKey));
      await refresh();
      return true;
    } catch (error) {
      toast.error(t('settings.interactiveUI.toast.actionFailed'), { description: error instanceof Error ? error.message : undefined });
      await refresh().catch(() => undefined);
      return false;
    } finally {
      setBusy(null);
    }
  }, [refresh, t]);

  const installFile = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setBusy('inspect-package');
    try {
      const packageBase64 = await fileToBase64(file);
      const inspection = normalizePackageInspection(await requestJson('/api/interactive-ui/manager/packages/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ packageBase64 }),
      }));
      if (!inspection) throw new Error(t('settings.interactiveUI.errors.invalidInspection'));
      setPendingPackage({ packageBase64, inspection });
    } catch (error) {
      toast.error(t('settings.interactiveUI.toast.actionFailed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  }, [t]);

  const addMarketplace = React.useCallback(async () => {
    setBusy('marketplace:inspect');
    try {
      const inspection = normalizeMarketplaceInspection(await requestJson('/api/interactive-ui/manager/marketplaces/inspect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ catalogUrl: marketplaceUrl }),
      }));
      if (!inspection) throw new Error(t('settings.interactiveUI.errors.invalidInspection'));
      setPendingMarketplace(inspection);
    } catch (error) {
      toast.error(t('settings.interactiveUI.toast.actionFailed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  }, [marketplaceUrl, t]);

  const loadCatalog = React.useCallback(async (marketplaceId: string) => {
    setBusy(`catalog:${marketplaceId}`);
    try {
      const result = await requestJson<{ catalog?: { entries?: unknown } }>(`/api/interactive-ui/manager/marketplaces/${encodeURIComponent(marketplaceId)}/catalog`);
      setCatalogs((current) => ({ ...current, [marketplaceId]: normalizeCatalogEntries(result.catalog?.entries) }));
    } catch (error) {
      toast.error(t('settings.interactiveUI.toast.catalogFailed'), { description: error instanceof Error ? error.message : undefined });
    } finally {
      setBusy(null);
    }
  }, [t]);

  const connectionKey = React.useCallback((extensionId: string, connectorId: string) => `${extensionId}:${connectorId}`, []);

  const saveConnection = React.useCallback(async (extensionId: string, connectorId: string, mode: 'configure' | 'provision') => {
    const key = connectionKey(extensionId, connectorId);
    const value = connectionInputs[key]?.trim() ?? '';
    const endpointValue = connectionEndpointInputs[key]?.trim() ?? '';
    const headerValue = connectionHeaderInputs[key]?.trim() ?? '';
    if (!value && !endpointValue && !headerValue) return;
    const endpoint = `/api/interactive-ui/connections/${encodeURIComponent(extensionId)}/${encodeURIComponent(connectorId)}${mode === 'provision' ? '/provision' : ''}`;
    let headers: Record<string, string> | undefined;
    if (headerValue) {
      try {
        const parsed = JSON.parse(headerValue) as unknown;
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)
          || Object.values(parsed).some((entry) => typeof entry !== 'string')) {
          throw new Error(t('settings.interactiveUI.errors.invalidHeaders'));
        }
        headers = parsed as Record<string, string>;
      } catch (error) {
        toast.error(t('settings.interactiveUI.toast.actionFailed'), {
          description: error instanceof Error ? error.message : t('settings.interactiveUI.errors.invalidHeaders'),
        });
        return;
      }
    }
    const succeeded = await runMutation(`connection:${key}`, async () => {
      await requestJson(endpoint, {
        method: mode === 'provision' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'provision'
          ? { setupCode: value }
          : {
              ...(value ? { accessKey: value } : {}),
              ...(endpointValue ? { endpoint: endpointValue } : {}),
              ...(headers ? { headers } : {}),
            }),
      });
      if (mode === 'configure') {
        await requestJson(`/api/interactive-ui/connections/${encodeURIComponent(extensionId)}/${encodeURIComponent(connectorId)}/test`, { method: 'POST' });
      }
    }, mode === 'provision' ? 'settings.interactiveUI.toast.connectionProvisioned' : 'settings.interactiveUI.toast.connectionSaved');
    if (succeeded) {
      setConnectionInputs((current) => ({ ...current, [key]: '' }));
      setConnectionEndpointInputs((current) => ({ ...current, [key]: '' }));
      setConnectionHeaderInputs((current) => ({ ...current, [key]: '' }));
    }
  }, [connectionEndpointInputs, connectionHeaderInputs, connectionInputs, connectionKey, runMutation, t]);

  const clearConnectionEndpoint = React.useCallback(async (extensionId: string, connectorId: string) => {
    const key = connectionKey(extensionId, connectorId);
    await runMutation(`connection-endpoint-clear:${key}`, async () => {
      await requestJson(`/api/interactive-ui/connections/${encodeURIComponent(extensionId)}/${encodeURIComponent(connectorId)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ endpoint: null }),
      });
    }, 'settings.interactiveUI.toast.connectionEndpointCleared');
  }, [connectionKey, runMutation]);

  return (
    <SettingsPageLayout
      title={t('settings.page.interactiveUI.title')}
      description={t('settings.page.interactiveUI.description')}
      showSaveStatus={false}
      headerEnd={(
        <Button variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
          <Icon name="refresh" className={loading ? 'animate-spin' : undefined} />
          {t('settings.interactiveUI.actions.refresh')}
        </Button>
      )}
    >
      <SettingsSection
        divider={false}
        settingsItem="interactive-ui.installed"
        title={t('settings.interactiveUI.installed.title')}
        description={t('settings.interactiveUI.installed.description')}
        headerAction={(
          <>
            <input ref={packageInputRef} type="file" accept=".ocix,application/zip" className="hidden" onChange={(event) => void installFile(event)} />
            <Button size="sm" onClick={() => packageInputRef.current?.click()} disabled={busy === 'inspect-package'}>
              <Icon name="download" />
              {t('settings.interactiveUI.actions.installPackage')}
            </Button>
          </>
        )}
      >
        {snapshot.extensions.length === 0 ? (
          <p className={SETTINGS_HELPER_CLASS}>{loading ? t('settings.interactiveUI.status.loading') : t('settings.interactiveUI.installed.empty')}</p>
        ) : (
          <div className="divide-y divide-border/60">
            {snapshot.extensions.map((extension) => (
              <div key={extension.id} className="grid gap-3 py-4 first:pt-0 @xl:grid-cols-[minmax(0,1fr)_auto] @xl:items-start">
                <div className="min-w-0">
                  <div className={SETTINGS_FIELD_LABEL_CLASS}>{extension.name}</div>
                  <div className={SETTINGS_HELPER_CLASS}>{extension.id} · {extension.activeVersion}</div>
                  <div className={SETTINGS_HELPER_CLASS}>
                    {t('settings.interactiveUI.installed.publisher', { publisher: extension.versions[extension.activeVersion]?.publisher.name ?? '—' })}
                  </div>
                  <div className={SETTINGS_HELPER_CLASS}>
                    {t('settings.interactiveUI.installed.agentRuntime', {
                      tools: extension.versions[extension.activeVersion]?.agentRuntime.tools.length ?? 0,
                      skills: extension.versions[extension.activeVersion]?.agentRuntime.skills.length ?? 0,
                    })}
                  </div>
                  {extension.integrity.status === 'unavailable' ? (
                    <p className="mt-2 typography-meta text-[var(--status-warning)]">
                      {t('settings.interactiveUI.installed.integrityUnavailable')}
                    </p>
                  ) : extension.integrity.status === 'failed' ? (
                    <p className="mt-2 typography-meta text-[var(--status-error)]">
                      {t('settings.interactiveUI.installed.integrityFailed')}
                    </p>
                  ) : null}
                  <details className="mt-2 max-w-[40rem]">
                    <summary className="cursor-pointer typography-meta font-medium text-[var(--surface-muted-foreground)] outline-none hover:text-[var(--surface-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--interactive-focus-ring)]">
                      {t('settings.interactiveUI.installed.diagnostics')}
                    </summary>
                    {(() => {
                      const active = extension.versions[extension.activeVersion];
                      const unresolved = active?.agentRuntime.unresolvedSurfaceTools ?? [];
                      return (
                        <dl className="mt-2 grid gap-x-4 gap-y-1 typography-meta @xl:grid-cols-[auto_minmax(0,1fr)]">
                          <dt className="text-[var(--surface-muted-foreground)]">{t('settings.interactiveUI.installed.source')}</dt>
                          <dd className="min-w-0 break-all text-[var(--surface-foreground)]">{active?.source.type ?? '—'}{active?.source.marketplaceId ? ` · ${active.source.marketplaceId}` : ''}</dd>
                          <dt className="text-[var(--surface-muted-foreground)]">{t('settings.interactiveUI.installed.tools')}</dt>
                          <dd className="min-w-0 break-all text-[var(--surface-foreground)]">{active?.agentRuntime.tools.map((item) => item.name).join(', ') || '—'}</dd>
                          <dt className="text-[var(--surface-muted-foreground)]">{t('settings.interactiveUI.installed.skills')}</dt>
                          <dd className="min-w-0 break-all text-[var(--surface-foreground)]">{active?.agentRuntime.skills.map((item) => item.name).join(', ') || '—'}</dd>
                          <dt className="text-[var(--surface-muted-foreground)]">SHA-256</dt>
                          <dd className="min-w-0 break-all font-mono text-[var(--surface-foreground)]">{active?.packageHash || '—'}</dd>
                          {unresolved.length > 0 ? <>
                            <dt className="text-[var(--status-warning)]">{t('settings.interactiveUI.installed.unresolved')}</dt>
                            <dd className="min-w-0 break-all text-[var(--status-warning)]">{unresolved.join(', ')}</dd>
                          </> : null}
                        </dl>
                      );
                    })()}
                  </details>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={extension.enabled && extension.integrity.status !== 'unavailable' && extension.integrity.status !== 'failed'}
                    aria-label={t('settings.interactiveUI.actions.enableAria', { name: extension.name })}
                    disabled={extension.integrity.status === 'unavailable' || extension.integrity.status === 'failed' || busy === `toggle:${extension.id}`}
                    onCheckedChange={(enabled) => void runMutation(`toggle:${extension.id}`, () => requestJson(`/api/interactive-ui/manager/extensions/${encodeURIComponent(extension.id)}`, {
                      method: 'PATCH',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ enabled }),
                    }), enabled ? 'settings.interactiveUI.toast.enabled' : 'settings.interactiveUI.toast.disabled')}
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={(extension.activationHistory?.length ?? 0) === 0 || busy === `rollback:${extension.id}`}
                    onClick={() => void runMutation(`rollback:${extension.id}`, () => requestJson(`/api/interactive-ui/manager/extensions/${encodeURIComponent(extension.id)}/rollback`, { method: 'POST' }), 'settings.interactiveUI.toast.rolledBack')}
                  >
                    {t('settings.interactiveUI.actions.rollback')}
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => setConfirmUninstall(extension)}>
                    {t('settings.interactiveUI.actions.uninstall')}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        settingsItem="interactive-ui.connections"
        title={t('settings.interactiveUI.connections.title')}
        description={t('settings.interactiveUI.connections.description')}
      >
        {connectionSnapshot.connections.length === 0 ? (
          <p className={SETTINGS_HELPER_CLASS}>{t('settings.interactiveUI.connections.empty')}</p>
        ) : (
          <div className="divide-y divide-border/60">
            {connectionSnapshot.connections.map((connection) => {
              const key = connectionKey(connection.extension.id, connection.connector.id);
              const statusKey = connection.credential.expired
                ? 'settings.interactiveUI.connections.statusExpired'
                : !connection.credential.configured
                  ? 'settings.interactiveUI.connections.statusNotConnected'
                  : connection.health.status === 'reachable'
                    ? 'settings.interactiveUI.connections.statusReachable'
                    : connection.health.status === 'unreachable'
                      ? 'settings.interactiveUI.connections.statusUnreachable'
                      : connection.health.status === 'unauthorized'
                        ? 'settings.interactiveUI.connections.statusUnauthorized'
                        : connection.health.status === 'forbidden'
                          ? 'settings.interactiveUI.connections.statusForbidden'
                          : 'settings.interactiveUI.connections.statusConfigured';
              const healthWarning = connection.credential.expired || ['unreachable', 'unauthorized', 'forbidden'].includes(connection.health.status);
              return (
                <div key={key} className="space-y-3 py-5 first:pt-0">
                  <div className="flex flex-col gap-2 @xl:flex-row @xl:items-start @xl:justify-between">
                    <div className="min-w-0">
                      <div className={SETTINGS_FIELD_LABEL_CLASS}>{connection.extension.name}</div>
                      <div className={SETTINGS_HELPER_CLASS}>
                        {connection.connector.id} · {connection.credential.endpoint || connection.connector.endpoint || connection.connector.origin || t('settings.interactiveUI.connections.endpointMissing')}
                      </div>
                      <div className={healthWarning ? 'text-sm text-status-warning' : SETTINGS_HELPER_CLASS}>
                        {t(statusKey)}
                        {connection.credential.displayName ? ` · ${connection.credential.displayName}` : ''}
                        {connection.health.checkedAt ? ` · ${t('settings.interactiveUI.connections.lastChecked')} ${new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(connection.health.checkedAt))}` : ''}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {connection.connector.testable && connection.credential.configured && (
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy === `connection-test:${key}`}
                          onClick={() => void runMutation(`connection-test:${key}`, () => requestJson(`/api/interactive-ui/connections/${encodeURIComponent(connection.extension.id)}/${encodeURIComponent(connection.connector.id)}/test`, { method: 'POST' }), 'settings.interactiveUI.toast.connectionTested')}
                        >
                          {t('settings.interactiveUI.actions.testConnection')}
                        </Button>
                      )}
                      {connection.credential.configured && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy === `connection-remove:${key}`}
                          onClick={() => void runMutation(`connection-remove:${key}`, () => requestJson(`/api/interactive-ui/connections/${encodeURIComponent(connection.extension.id)}/${encodeURIComponent(connection.connector.id)}`, { method: 'DELETE' }), 'settings.interactiveUI.toast.connectionRemoved')}
                        >
                          {t('settings.interactiveUI.actions.disconnect')}
                        </Button>
                      )}
                    </div>
                  </div>
                  {connection.connector.configurable && (
                    <div className="space-y-4">
                      <SettingsStackedField
                        label={t('settings.interactiveUI.fields.endpoint')}
                        info={t('settings.interactiveUI.connections.endpointInfo')}
                      >
                        <div className="flex max-w-[40rem] gap-2">
                          <Input
                            type="url"
                            className="h-8"
                            value={connectionEndpointInputs[key] ?? ''}
                            onChange={(event) => setConnectionEndpointInputs((current) => ({ ...current, [key]: event.target.value }))}
                            placeholder={connection.credential.endpoint || connection.connector.endpoint || t('settings.interactiveUI.fields.endpointPlaceholder')}
                            aria-label={t('settings.interactiveUI.fields.endpoint')}
                          />
                          {connection.credential.endpointSource === 'user' ? (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={busy === `connection-endpoint-clear:${key}`}
                              onClick={() => void clearConnectionEndpoint(connection.extension.id, connection.connector.id)}
                            >
                              {t('settings.interactiveUI.actions.useDefaultEndpoint')}
                            </Button>
                          ) : null}
                        </div>
                      </SettingsStackedField>
                      <SettingsStackedField
                        label={t('settings.interactiveUI.fields.accessKey')}
                        info={t('settings.interactiveUI.connections.accessKeyInfo')}
                      >
                        <div className="flex max-w-[40rem] gap-2">
                        <Input
                          type="password"
                          autoComplete="new-password"
                          className="h-8"
                          value={connectionInputs[key] ?? ''}
                          onChange={(event) => setConnectionInputs((current) => ({ ...current, [key]: event.target.value }))}
                          placeholder={connection.credential.configured ? t('settings.interactiveUI.fields.replaceAccessKeyPlaceholder') : t('settings.interactiveUI.fields.accessKeyPlaceholder')}
                          aria-label={t('settings.interactiveUI.fields.accessKey')}
                        />
                        </div>
                      </SettingsStackedField>
                      <SettingsStackedField
                        label={t('settings.interactiveUI.fields.headers')}
                        info={t('settings.interactiveUI.connections.headersInfo')}
                      >
                        <div className="flex max-w-[40rem] gap-2">
                          <Input
                            className="h-8 font-mono"
                            value={connectionHeaderInputs[key] ?? ''}
                            onChange={(event) => setConnectionHeaderInputs((current) => ({ ...current, [key]: event.target.value }))}
                            placeholder={connection.credential.headerNames?.length
                              ? t('settings.interactiveUI.fields.headersConfiguredPlaceholder', { count: connection.credential.headerNames.length })
                              : t('settings.interactiveUI.fields.headersPlaceholder')}
                            aria-label={t('settings.interactiveUI.fields.headers')}
                          />
                          <Button
                            size="sm"
                            disabled={(!connectionInputs[key]?.trim() && !connectionEndpointInputs[key]?.trim() && !connectionHeaderInputs[key]?.trim()) || busy === `connection:${key}`}
                            onClick={() => void saveConnection(connection.extension.id, connection.connector.id, 'configure')}
                          >
                            {t('settings.interactiveUI.actions.saveAndTestConnection')}
                          </Button>
                        </div>
                      </SettingsStackedField>
                    </div>
                  )}
                  {connection.connector.provisionable && (
                    <SettingsStackedField
                      label={t('settings.interactiveUI.fields.setupCode')}
                      info={t('settings.interactiveUI.connections.setupCodeInfo')}
                    >
                      <div className="flex max-w-[24rem] gap-2">
                        <Input
                          type="password"
                          autoComplete="one-time-code"
                          className="h-8"
                          value={connectionInputs[key] ?? ''}
                          onChange={(event) => setConnectionInputs((current) => ({ ...current, [key]: event.target.value }))}
                          placeholder={t('settings.interactiveUI.fields.setupCodePlaceholder')}
                          aria-label={t('settings.interactiveUI.fields.setupCode')}
                        />
                        <Button size="sm" disabled={!connectionInputs[key]?.trim() || busy === `connection:${key}`} onClick={() => void saveConnection(connection.extension.id, connection.connector.id, 'provision')}>
                          {t('settings.interactiveUI.actions.connect')}
                        </Button>
                      </div>
                    </SettingsStackedField>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </SettingsSection>

      <RoutingInspectorSection />

      <SettingsSection
        settingsItem="interactive-ui.publishers"
        title={t('settings.interactiveUI.publishers.title')}
        description={t('settings.interactiveUI.publishers.description')}
      >
        {snapshot.publishers.length > 0 ? (
          <div className="mb-6 divide-y divide-border/60">
            {snapshot.publishers.flatMap((publisher) => publisher.keys.map((key) => (
              <div key={`${publisher.id}:${key.keyId}`} className="flex items-center justify-between gap-4 py-3 first:pt-0">
                <div className="min-w-0">
                  <div className={SETTINGS_FIELD_LABEL_CLASS}>{publisher.name}</div>
                  <div className={`${SETTINGS_HELPER_CLASS} truncate`}>{publisher.id} · {key.keyId} · {key.fingerprint}</div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy === `publisher:${publisher.id}:${key.keyId}`}
                  onClick={() => void runMutation(`publisher:${publisher.id}:${key.keyId}`, () => requestJson(`/api/interactive-ui/manager/publishers/${encodeURIComponent(publisher.id)}/keys/${encodeURIComponent(key.keyId)}`, { method: 'DELETE' }), 'settings.interactiveUI.toast.publisherRemoved')}
                >
                  {t('settings.interactiveUI.actions.remove')}
                </Button>
              </div>
            )))}
          </div>
        ) : (
          <p className={SETTINGS_HELPER_CLASS}>{t('settings.interactiveUI.publishers.empty')}</p>
        )}
      </SettingsSection>

      <SettingsSection
        settingsItem="interactive-ui.marketplaces"
        title={t('settings.interactiveUI.marketplaces.title')}
        description={t('settings.interactiveUI.marketplaces.description')}
      >
        {snapshot.marketplaces.map((marketplace) => (
          <div key={marketplace.id} className="border-b border-border/60 py-4 first:pt-0 last:border-b-0">
            <div className="flex flex-col gap-3 @xl:flex-row @xl:items-center">
              <div className="min-w-0 flex-1">
                <div className={SETTINGS_FIELD_LABEL_CLASS}>{marketplace.name}</div>
                <div className={`${SETTINGS_HELPER_CLASS} truncate`}>{marketplace.catalogUrl}</div>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => void loadCatalog(marketplace.id)} disabled={busy === `catalog:${marketplace.id}`}>{t('settings.interactiveUI.actions.browseCatalog')}</Button>
                <Button variant="ghost" size="sm" onClick={() => void runMutation(`marketplace:${marketplace.id}`, () => requestJson(`/api/interactive-ui/manager/marketplaces/${encodeURIComponent(marketplace.id)}`, { method: 'DELETE' }), 'settings.interactiveUI.toast.marketplaceRemoved')}>{t('settings.interactiveUI.actions.remove')}</Button>
              </div>
            </div>
            {catalogs[marketplace.id]?.map((entry) => {
              const installedExtension = snapshot.extensions.find((extension) => extension.id === entry.id);
              const installedVersion = installedExtension?.activeVersion;
              const installState = classifyCatalogInstallState(entry.version, installedVersion);
              const current = installState === 'installed';
              const update = installState === 'update';
              return (
                <div key={`${entry.id}@${entry.version}`} className="ml-4 mt-3 flex items-center justify-between gap-3 border-l border-border/60 pl-4">
                  <div className="min-w-0">
                    <div className={SETTINGS_FIELD_LABEL_CLASS}>{entry.name}</div>
                    <div className={SETTINGS_HELPER_CLASS}>{entry.id} · {installedVersion && !current ? `${installedVersion} → ` : ''}{entry.version}</div>
                  </div>
                  <Button
                    size="sm"
                    variant={update ? 'default' : 'outline'}
                    disabled={current || busy === `market-install:${entry.id}:${entry.version}`}
                    onClick={() => void runMutation(`market-install:${entry.id}:${entry.version}`, () => requestJson(`/api/interactive-ui/manager/marketplaces/${encodeURIComponent(marketplace.id)}/install`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ extensionId: entry.id, version: entry.version }),
                    }), 'settings.interactiveUI.toast.installed')}
                  >
                    {current
                      ? t('settings.interactiveUI.actions.installed')
                      : update
                        ? t('settings.interactiveUI.actions.update')
                        : t('settings.interactiveUI.actions.install')}
                  </Button>
                </div>
              );
            })}
          </div>
        ))}
        <div className="mt-6">
          <SettingsStackedField label={t('settings.interactiveUI.fields.catalogUrl')} description={t('settings.interactiveUI.marketplaces.catalogHint')}>
            <Input value={marketplaceUrl} onChange={(event) => setMarketplaceUrl(event.target.value)} placeholder="https://extensions.example.com/catalog.json" />
          </SettingsStackedField>
        </div>
        <div className="mt-4 flex justify-end"><Button size="sm" onClick={() => void addMarketplace()} disabled={!marketplaceUrl.trim() || busy === 'marketplace:inspect'}>{t('settings.interactiveUI.actions.addMarketplace')}</Button></div>
      </SettingsSection>

      <Dialog open={pendingPackage !== null} onOpenChange={(open) => { if (!open) setPendingPackage(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.interactiveUI.packageReview.title')}</DialogTitle>
            <DialogDescription>
              {pendingPackage?.inspection.publisher.trusted
                ? t('settings.interactiveUI.packageReview.trustedDescription')
                : t('settings.interactiveUI.packageReview.untrustedDescription')}
            </DialogDescription>
          </DialogHeader>
          {pendingPackage && (
            <div className="space-y-3 text-sm">
              <div>
                <div className={SETTINGS_FIELD_LABEL_CLASS}>{pendingPackage.inspection.extension.name} · {pendingPackage.inspection.extension.version}</div>
                <div className={SETTINGS_HELPER_CLASS}>{pendingPackage.inspection.extension.id}</div>
              </div>
              <div>
                <div className={SETTINGS_FIELD_LABEL_CLASS}>{t('settings.interactiveUI.packageReview.publisher')}</div>
                <div className={SETTINGS_HELPER_CLASS}>{pendingPackage.inspection.publisher.name} · {pendingPackage.inspection.publisher.id} · {pendingPackage.inspection.publisher.keyId}</div>
                <div className={`${SETTINGS_HELPER_CLASS} break-all`}>{pendingPackage.inspection.publisher.fingerprint}</div>
              </div>
              <div className={SETTINGS_HELPER_CLASS}>
                {t('settings.interactiveUI.packageReview.agentRuntime', {
                  tools: pendingPackage.inspection.agentRuntime.tools.map((tool) => tool.name).join(', ') || '—',
                  skills: pendingPackage.inspection.agentRuntime.skills.map((skill) => skill.name).join(', ') || '—',
                })}
              </div>
              {pendingPackage.inspection.agentRouting && (
                <>
                  <div className={SETTINGS_HELPER_CLASS}>
                    {t('settings.interactiveUI.packageReview.agentRouting', {
                      domain: pendingPackage.inspection.agentRouting.domain,
                      authority: pendingPackage.inspection.agentRouting.dataAuthority,
                      intents: pendingPackage.inspection.agentRouting.intents.join(', ') || '—',
                    })}
                  </div>
                  <div className={SETTINGS_HELPER_CLASS}>
                    {t('settings.interactiveUI.packageReview.surfaces', {
                      interactive: pendingPackage.inspection.agentRouting.views.length,
                      artifacts: pendingPackage.inspection.agentRouting.artifacts.length,
                    })}
                  </div>
                </>
              )}
              <div className={SETTINGS_HELPER_CLASS}>
                {t('settings.interactiveUI.packageReview.permissions', {
                  network: pendingPackage.inspection.permissions.network.join(', ') || '—',
                  native: pendingPackage.inspection.permissions.nativeCode
                    ? t('settings.interactiveUI.packageReview.nativeYes')
                    : t('settings.interactiveUI.packageReview.nativeNo'),
                  artifacts: pendingPackage.inspection.permissions.sandboxedArtifacts
                    ? t('settings.interactiveUI.packageReview.nativeYes')
                    : t('settings.interactiveUI.packageReview.nativeNo'),
                })}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingPackage(null)}>{t('settings.interactiveUI.actions.cancel')}</Button>
            <Button disabled={!pendingPackage || busy === 'install'} onClick={() => {
              if (!pendingPackage) return;
              const pending = pendingPackage;
              void (async () => {
                const succeeded = await runMutation('install', () => requestJson('/api/interactive-ui/manager/packages', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    packageBase64: pending.packageBase64,
                    confirmedPublisherFingerprint: pending.inspection.publisher.fingerprint,
                  }),
                }), 'settings.interactiveUI.toast.installed');
                if (succeeded) setPendingPackage(null);
              })();
            }}>
              {pendingPackage?.inspection.publisher.trusted
                ? t('settings.interactiveUI.actions.install')
                : t('settings.interactiveUI.actions.trustAndInstall')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pendingMarketplace !== null} onOpenChange={(open) => { if (!open) setPendingMarketplace(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.interactiveUI.marketplaceReview.title')}</DialogTitle>
            <DialogDescription>{t('settings.interactiveUI.marketplaceReview.description')}</DialogDescription>
          </DialogHeader>
          {pendingMarketplace && (
            <div className="space-y-2 text-sm">
              <div className={SETTINGS_FIELD_LABEL_CLASS}>{pendingMarketplace.name}</div>
              <div className={SETTINGS_HELPER_CLASS}>{pendingMarketplace.id} · {pendingMarketplace.keyId}</div>
              <div className={`${SETTINGS_HELPER_CLASS} break-all`}>{pendingMarketplace.fingerprint}</div>
              <div className={SETTINGS_HELPER_CLASS}>{t('settings.interactiveUI.marketplaceReview.extensionCount', { count: pendingMarketplace.extensionCount })}</div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingMarketplace(null)}>{t('settings.interactiveUI.actions.cancel')}</Button>
            <Button disabled={!pendingMarketplace || busy === 'marketplace:add'} onClick={() => {
              if (!pendingMarketplace) return;
              const pending = pendingMarketplace;
              void (async () => {
                const succeeded = await runMutation('marketplace:add', () => requestJson('/api/interactive-ui/manager/marketplaces', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ catalogUrl: pending.catalogUrl, confirmedFingerprint: pending.fingerprint }),
                }), 'settings.interactiveUI.toast.marketplaceAdded');
                if (succeeded) {
                  setPendingMarketplace(null);
                  setMarketplaceUrl('');
                }
              })();
            }}>{t('settings.interactiveUI.actions.trustMarketplace')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmUninstall !== null} onOpenChange={(open) => { if (!open) setConfirmUninstall(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('settings.interactiveUI.uninstall.title')}</DialogTitle>
            <DialogDescription>{t('settings.interactiveUI.uninstall.description', { name: confirmUninstall?.name ?? '' })}</DialogDescription>
          </DialogHeader>
          <p className="typography-ui-caption text-muted-foreground">
            {uninstallImpact
              ? t('settings.interactiveUI.uninstall.impact', uninstallImpact)
              : t('settings.interactiveUI.uninstall.impactLoading')}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUninstall(null)}>{t('settings.interactiveUI.actions.cancel')}</Button>
            <Button variant="destructive" disabled={!confirmUninstall || !uninstallImpact || busy === `uninstall:${confirmUninstall.id}`} onClick={() => {
              if (!confirmUninstall) return;
              const extension = confirmUninstall;
              setConfirmUninstall(null);
              void runMutation(`uninstall:${extension.id}`, () => requestJson(`/api/interactive-ui/manager/extensions/${encodeURIComponent(extension.id)}`, { method: 'DELETE' }), 'settings.interactiveUI.toast.uninstalled');
            }}>{t('settings.interactiveUI.actions.uninstall')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsPageLayout>
  );
};
