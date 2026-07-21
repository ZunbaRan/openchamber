import React from 'react';
import { createRoot } from 'react-dom/client';
import { createConfiguredWebAPIs } from './runtimeConfig';
import { RuntimeAPIProvider } from '@openchamber/ui/contexts/RuntimeAPIProvider';
import { ThemeSystemProvider } from '@openchamber/ui/contexts/ThemeSystemContext';
import { ThemeProvider } from '@openchamber/ui/components/providers/ThemeProvider';
import { InteractiveUIView } from '@openchamber/ui/components/interactive-ui/InteractiveUIView';
import { HTMLArtifactView } from '@openchamber/ui/components/interactive-ui/HTMLArtifactView';
import { I18nProvider, initializeLocale, useI18nStore } from '@openchamber/ui/lib/i18n';
import type { RuntimeAPIs } from '@openchamber/ui/lib/api/types';
import type { HTMLArtifactResultEnvelope } from '@openchamber/ui/lib/interactive-ui/artifactResult';
import type { InteractiveResultEnvelope } from '@openchamber/ui/lib/interactive-ui/types';
import {
  learningRateSimulatorArtifact,
  staticNeuralNetworkArtifact,
} from '../../../examples/interactive-ui/artifact-fixtures.mjs';
import { generatedVisualFixtureEnvelope } from './interactive-ui-visual-fixtures';
import '@openchamber/ui/index.css';
import '@openchamber/ui/styles/fonts';

declare global {
  interface Window {
    __OPENCHAMBER_RUNTIME_APIS__?: RuntimeAPIs;
  }
}

const runtimeAPIs = createConfiguredWebAPIs();
window.__OPENCHAMBER_RUNTIME_APIS__ = runtimeAPIs;
initializeLocale();

const params = new URLSearchParams(window.location.search);
const requestedRuntime = params.get('runtime');
const runtime = requestedRuntime === 'generated'
  || requestedRuntime === 'declarative'
  || requestedRuntime === 'crm'
  || requestedRuntime === 'artifact-static'
  || requestedRuntime === 'artifact-interactive'
  || requestedRuntime === 'artifact-blocked'
  || requestedRuntime === 'artifact-crashed'
  ? requestedRuntime
  : 'native';
const theme = params.get('theme') === 'dark' ? 'dark' : 'light';
const requestedLocale = params.get('locale');
if (requestedLocale === 'en' || requestedLocale === 'zh-CN') useI18nStore.getState().setLocale(requestedLocale);
const isGenerated = runtime === 'generated';
const isDeclarative = runtime === 'declarative';
const isCrm = runtime === 'crm';
const isStaticArtifact = runtime === 'artifact-static';
const isInteractiveArtifact = runtime === 'artifact-interactive';
const isBlockedArtifact = runtime === 'artifact-blocked';
const isCrashedArtifact = runtime === 'artifact-crashed';
const isArtifact = isStaticArtifact || isInteractiveArtifact || isBlockedArtifact || isCrashedArtifact;
const fixedUpdatedAt = '2026-07-21T09:30:00.000Z';
const installedEnvelope: InteractiveResultEnvelope = {
  $schema: 'openchamber://interactive-result/v1',
  view: isCrm
    ? 'com.openchamber.demo.crm.dashboard'
    : isDeclarative
      ? 'com.openchamber.demo.sales.summary'
      : 'com.openchamber.demo.sales.dashboard',
  schemaVersion: 1,
  mode: 'live',
  summary: isCrm ? '企业 CRM 客户、商机与管道概览' : '华东区 2026 年 7 月销售额 182 万元',
  context: isCrm ? { focus: 'overview' } : { region: 'east', period: '2026-07' },
  data: isCrm ? undefined : {
    region: 'east',
    period: '2026-07',
    revenue: 1820000,
    orderCount: 48,
    completionRate: 0.875,
    trend: [],
    anomalies: [],
    updatedAt: fixedUpdatedAt,
  },
  dataRef: isCrm
    ? { connector: 'crm-api', resource: 'crm.dashboard', revision: 'demo-page' }
    : { connector: 'sales-api', resource: 'sales.dashboard', revision: 'demo-page' },
  updatedAt: fixedUpdatedAt,
};
const envelope = isGenerated ? generatedVisualFixtureEnvelope : installedEnvelope;
const toolName = isGenerated
  ? 'interactive_ui'
  : isCrm
    ? 'crm_open_dashboard'
    : isDeclarative
      ? 'sales_get_summary'
      : 'sales_get_dashboard';
const output = JSON.stringify(envelope, null, 2);
const blockedArtifactEnvelope: HTMLArtifactResultEnvelope = {
  ...learningRateSimulatorArtifact,
  title: '已阻止的 Artifact',
  summary: '确定性的安全拒绝 fixture；页面请求网络能力，必须在 materialize 阶段被阻止。',
  html: learningRateSimulatorArtifact.html.replace('</body>', '<script>fetch("https://example.invalid")</script></body>'),
};
const crashedArtifactEnvelope: HTMLArtifactResultEnvelope = {
  ...learningRateSimulatorArtifact,
  title: '崩溃的 Artifact',
  summary: '确定性的运行时失败 fixture；错误必须移除 iframe 并显示安全状态。',
  html: learningRateSimulatorArtifact.html.replace('</body>', '<script>addEventListener("openchamber:host-init", () => setTimeout(() => { throw new Error("deterministic fixture crash") }, 0), { once: true })</script></body>'),
};
const artifactEnvelope = isStaticArtifact
  ? staticNeuralNetworkArtifact
  : isBlockedArtifact
    ? blockedArtifactEnvelope
    : isCrashedArtifact
      ? crashedArtifactEnvelope
      : learningRateSimulatorArtifact;
const artifactOutput = JSON.stringify(artifactEnvelope, null, 2);

// This file is a standalone Vite entry rather than a reusable component module.
// eslint-disable-next-line react-refresh/only-export-components
const DemoContent = () => {
  if (isArtifact) {
    return (
      <HTMLArtifactView
        envelope={artifactEnvelope}
        toolPartId={`interactive-ui-demo-${runtime}`}
        fallback={<pre className="overflow-auto whitespace-pre-wrap typography-code text-muted-foreground">{artifactOutput}</pre>}
      />
    );
  }

  return (
    <InteractiveUIView
      envelope={envelope}
      tool={{
        id: 'interactive-ui-demo-tool',
        name: toolName,
        input: envelope.context,
        output,
      }}
      fallback={<pre className="overflow-auto whitespace-pre-wrap typography-code text-muted-foreground">{output}</pre>}
      isMobile={params.get('mobile') === 'true'}
    />
  );
};

// eslint-disable-next-line react-refresh/only-export-components
const Demo = () => (
  <main className={`${theme === 'dark' ? 'dark ' : ''}min-h-screen bg-background p-4 text-foreground sm:p-8`} data-visual-theme={theme}>
    <div className="mx-auto w-full max-w-5xl rounded-2xl border border-border bg-[var(--surface-muted)] p-3 shadow-sm sm:p-5">
      <DemoContent />
    </div>
  </main>
);

const root = document.getElementById('root');
if (!root) throw new Error('Root element not found');

createRoot(root).render(
  <React.StrictMode>
    <I18nProvider>
      <ThemeSystemProvider>
        <ThemeProvider>
          <RuntimeAPIProvider apis={runtimeAPIs}>
            <Demo />
          </RuntimeAPIProvider>
        </ThemeProvider>
      </ThemeSystemProvider>
    </I18nProvider>
  </React.StrictMode>,
);
