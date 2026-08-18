import React from 'react';
import { toast } from '@/components/ui';
import { Button } from '@/components/ui/button';
import {
  SETTINGS_FIELD_LABEL_CLASS,
  SETTINGS_HELPER_CLASS,
  SettingsSection,
} from '@/components/sections/shared/SettingsSection';
import { copyTextToClipboard } from '@/lib/clipboard';
import { useI18n } from '@/lib/i18n';
import {
  buildRoutingDiagnosticsReport,
  clearRoutingInspectionTraces,
  getRoutingInspectionSnapshot,
  subscribeRoutingInspection,
  type RoutingInspectionTrace,
  type RoutingSelectionReason,
  type RoutingTraceStatus,
} from '@/lib/interactive-ui/routingInspector';

const shortRef = (value: string): string => value.length <= 12 ? value : value.slice(-12);

const statusKey = (status: RoutingTraceStatus) => {
  switch (status) {
    case 'send-failed': return 'settings.interactiveUI.routingInspector.status.sendFailed' as const;
    case 'tool-running': return 'settings.interactiveUI.routingInspector.status.toolRunning' as const;
    case 'tool-completed': return 'settings.interactiveUI.routingInspector.status.toolCompleted' as const;
    case 'tool-failed': return 'settings.interactiveUI.routingInspector.status.toolFailed' as const;
    case 'view-loading': return 'settings.interactiveUI.routingInspector.status.viewLoading' as const;
    case 'view-rendered': return 'settings.interactiveUI.routingInspector.status.viewRendered' as const;
    case 'view-failed': return 'settings.interactiveUI.routingInspector.status.viewFailed' as const;
    case 'artifact-materializing': return 'settings.interactiveUI.routingInspector.status.artifactMaterializing' as const;
    case 'artifact-rendered': return 'settings.interactiveUI.routingInspector.status.artifactRendered' as const;
    case 'artifact-failed': return 'settings.interactiveUI.routingInspector.status.artifactFailed' as const;
    default: return 'settings.interactiveUI.routingInspector.status.awaitingTool' as const;
  }
};

const reasonKey = (reason: RoutingSelectionReason) => {
  switch (reason) {
    case 'explicit-tool': return 'settings.interactiveUI.routingInspector.reason.explicitTool' as const;
    case 'installed-business-tool': return 'settings.interactiveUI.routingInspector.reason.businessTool' as const;
    case 'generic-interactive-ui': return 'settings.interactiveUI.routingInspector.reason.genericTool' as const;
    case 'generic-html-artifact': return 'settings.interactiveUI.routingInspector.reason.genericArtifact' as const;
    default: return 'settings.interactiveUI.routingInspector.reason.specializedTool' as const;
  }
};

const statusClass = (status: RoutingTraceStatus): string => {
  if (status === 'send-failed' || status === 'tool-failed' || status === 'view-failed' || status === 'artifact-failed') {
    return 'text-[var(--status-error)]';
  }
  if (status === 'view-rendered' || status === 'artifact-rendered') return 'text-[var(--status-success)]';
  return 'text-muted-foreground';
};

const TraceRow: React.FC<{ trace: RoutingInspectionTrace }> = ({ trace }) => {
  const { t, locale } = useI18n();
  return (
    <div className="space-y-2 py-4 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className={SETTINGS_FIELD_LABEL_CLASS}>
          {trace.selection?.tool ?? t('settings.interactiveUI.routingInspector.noSelection')}
        </div>
        <div className={`${SETTINGS_HELPER_CLASS} ${statusClass(trace.status)}`}>
          {t(statusKey(trace.status))}
        </div>
      </div>
      <div className={SETTINGS_HELPER_CLASS}>
        {t('settings.interactiveUI.routingInspector.traceIdentity', {
          session: shortRef(trace.sessionId),
          message: shortRef(trace.messageId),
          time: new Date(trace.createdAt).toLocaleTimeString(locale),
        })}
      </div>
      <div className={SETTINGS_HELPER_CLASS}>
        {t('settings.interactiveUI.routingInspector.contextSummary', {
          injected: trace.systemInjected
            ? t('settings.interactiveUI.routingInspector.injectedYes')
            : t('settings.interactiveUI.routingInspector.injectedNo'),
          count: trace.candidates.length,
          revision: trace.revision ? shortRef(trace.revision) : '—',
        })}
      </div>
      {trace.selection ? (
        <div className={SETTINGS_HELPER_CLASS}>
          {t('settings.interactiveUI.routingInspector.selectionSummary', {
            tool: trace.selection.tool,
            reason: t(reasonKey(trace.selection.reason)),
          })}
          {trace.selection.viewId
            ? ` · ${t('settings.interactiveUI.routingInspector.viewSummary', { view: trace.selection.viewId })}`
            : ''}
        </div>
      ) : null}
      <details className={SETTINGS_HELPER_CLASS}>
        <summary className="cursor-pointer select-none text-foreground">
          {t('settings.interactiveUI.routingInspector.candidates', { count: trace.candidates.length })}
        </summary>
        {trace.candidates.length === 0 ? (
          <div className="mt-2">{t('settings.interactiveUI.routingInspector.noCandidates')}</div>
        ) : (
          <div className="mt-2 max-h-52 space-y-2 overflow-auto">
            {trace.candidates.map((candidate) => (
              <div key={`${trace.id}:${candidate.extensionId}:${candidate.tool}`}>
                <div className="font-mono text-foreground">{candidate.tool}</div>
                <div>
                  {t('settings.interactiveUI.routingInspector.candidateSummary', {
                    domain: candidate.domain,
                    priority: candidate.priority,
                    operation: candidate.operation,
                    connection: candidate.connection,
                  })}
                </div>
                <div className="break-words">{candidate.intents.join(', ')}</div>
              </div>
            ))}
          </div>
        )}
      </details>
    </div>
  );
};

export const RoutingInspectorSection: React.FC = () => {
  const { t } = useI18n();
  const traces = React.useSyncExternalStore(
    subscribeRoutingInspection,
    getRoutingInspectionSnapshot,
    getRoutingInspectionSnapshot,
  );
  const [copied, setCopied] = React.useState(false);

  const copyReport = React.useCallback(async () => {
    const result = await copyTextToClipboard(buildRoutingDiagnosticsReport());
    if (!result.ok) {
      toast.error(t('settings.interactiveUI.routingInspector.copyFailed'));
      return;
    }
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }, [t]);

  return (
    <SettingsSection
      settingsItem="interactive-ui.routing-inspector"
      title={t('settings.interactiveUI.routingInspector.title')}
      description={t('settings.interactiveUI.routingInspector.description')}
      headerAction={(
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="outline" size="sm" disabled={traces.length === 0} onClick={() => void copyReport()}>
            {copied
              ? t('settings.interactiveUI.routingInspector.copied')
              : t('settings.interactiveUI.routingInspector.copy')}
          </Button>
          <Button variant="ghost" size="sm" disabled={traces.length === 0} onClick={clearRoutingInspectionTraces}>
            {t('settings.interactiveUI.routingInspector.clear')}
          </Button>
        </div>
      )}
    >
      {traces.length === 0 ? (
        <p className={SETTINGS_HELPER_CLASS}>{t('settings.interactiveUI.routingInspector.empty')}</p>
      ) : (
        <div className="divide-y divide-border/60">
          {traces.slice(0, 20).map((trace) => <TraceRow key={trace.id} trace={trace} />)}
        </div>
      )}
    </SettingsSection>
  );
};
