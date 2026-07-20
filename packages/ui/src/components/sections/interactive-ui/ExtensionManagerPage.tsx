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
import {
  EMPTY_MANAGER_SNAPSHOT,
  EMPTY_CONNECTION_SNAPSHOT,
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
  const { t } = useI18n();
  const packageInputRef = React.useRef<HTMLInputElement>(null);
  const [snapshot, setSnapshot] = React.useState<ManagerSnapshot>(EMPTY_MANAGER_SNAPSHOT);
  const [connectionSnapshot, setConnectionSnapshot] = React.useState<ConnectionSnapshot>(EMPTY_CONNECTION_SNAPSHOT);
  const [connectionInputs, setConnectionInputs] = React.useState<Record<string, string>>({});
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [confirmUninstall, setConfirmUninstall] = React.useState<InstalledExtension | null>(null);
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

  const runMutation = React.useCallback(async (key: string, operation: () => Promise<unknown>, successKey: Parameters<typeof t>[0]): Promise<boolean> => {
    setBusy(key);
    try {
      await operation();
      toast.success(t(successKey));
      await refresh();
      return true;
    } catch (error) {
      toast.error(t('settings.interactiveUI.toast.actionFailed'), { description: error instanceof Error ? error.message : undefined });
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
    if (!value) return;
    const endpoint = `/api/interactive-ui/connections/${encodeURIComponent(extensionId)}/${encodeURIComponent(connectorId)}${mode === 'provision' ? '/provision' : ''}`;
    const succeeded = await runMutation(`connection:${key}`, () => requestJson(endpoint, {
      method: mode === 'provision' ? 'POST' : 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(mode === 'provision' ? { setupCode: value } : { accessKey: value }),
    }), mode === 'provision' ? 'settings.interactiveUI.toast.connectionProvisioned' : 'settings.interactiveUI.toast.connectionSaved');
    if (succeeded) setConnectionInputs((current) => ({ ...current, [key]: '' }));
  }, [connectionInputs, connectionKey, runMutation]);

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
              <div key={extension.id} className="flex flex-col gap-3 py-4 first:pt-0 @xl:flex-row @xl:items-center">
                <div className="min-w-0 flex-1">
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
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    checked={extension.enabled}
                    aria-label={t('settings.interactiveUI.actions.enableAria', { name: extension.name })}
                    disabled={busy === `toggle:${extension.id}`}
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
                : connection.credential.configured
                  ? 'settings.interactiveUI.connections.statusConnected'
                  : 'settings.interactiveUI.connections.statusNotConnected';
              return (
                <div key={key} className="space-y-3 py-5 first:pt-0">
                  <div className="flex flex-col gap-2 @xl:flex-row @xl:items-start @xl:justify-between">
                    <div className="min-w-0">
                      <div className={SETTINGS_FIELD_LABEL_CLASS}>{connection.extension.name}</div>
                      <div className={SETTINGS_HELPER_CLASS}>{connection.connector.id} · {connection.connector.origin}</div>
                      <div className={connection.credential.expired ? 'text-sm text-status-warning' : SETTINGS_HELPER_CLASS}>
                        {t(statusKey)}
                        {connection.credential.displayName ? ` · ${connection.credential.displayName}` : ''}
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
                      {(connection.connector.configurable || connection.connector.provisionable) && connection.credential.configured && (
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
                    <SettingsStackedField
                      label={t('settings.interactiveUI.fields.accessKey')}
                      info={t('settings.interactiveUI.connections.accessKeyInfo')}
                    >
                      <div className="flex max-w-[24rem] gap-2">
                        <Input
                          type="password"
                          autoComplete="new-password"
                          className="h-8"
                          value={connectionInputs[key] ?? ''}
                          onChange={(event) => setConnectionInputs((current) => ({ ...current, [key]: event.target.value }))}
                          placeholder={connection.credential.configured ? t('settings.interactiveUI.fields.replaceAccessKeyPlaceholder') : t('settings.interactiveUI.fields.accessKeyPlaceholder')}
                          aria-label={t('settings.interactiveUI.fields.accessKey')}
                        />
                        <Button size="sm" disabled={!connectionInputs[key]?.trim() || busy === `connection:${key}`} onClick={() => void saveConnection(connection.extension.id, connection.connector.id, 'configure')}>
                          {t('settings.interactiveUI.actions.saveConnection')}
                        </Button>
                      </div>
                    </SettingsStackedField>
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
            {catalogs[marketplace.id]?.map((entry) => (
              <div key={`${entry.id}@${entry.version}`} className="ml-4 mt-3 flex items-center justify-between gap-3 border-l border-border/60 pl-4">
                <div className="min-w-0"><div className={SETTINGS_FIELD_LABEL_CLASS}>{entry.name}</div><div className={SETTINGS_HELPER_CLASS}>{entry.id} · {entry.version}</div></div>
                <Button size="sm" onClick={() => void runMutation(`market-install:${entry.id}:${entry.version}`, () => requestJson(`/api/interactive-ui/manager/marketplaces/${encodeURIComponent(marketplace.id)}/install`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ extensionId: entry.id, version: entry.version }),
                }), 'settings.interactiveUI.toast.installed')}>{t('settings.interactiveUI.actions.install')}</Button>
              </div>
            ))}
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
              <div className={SETTINGS_HELPER_CLASS}>
                {t('settings.interactiveUI.packageReview.permissions', {
                  network: pendingPackage.inspection.permissions.network.join(', ') || '—',
                  native: pendingPackage.inspection.permissions.nativeCode
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
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmUninstall(null)}>{t('settings.interactiveUI.actions.cancel')}</Button>
            <Button variant="destructive" disabled={!confirmUninstall || busy === `uninstall:${confirmUninstall.id}`} onClick={() => {
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
