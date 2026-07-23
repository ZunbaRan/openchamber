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
import type { InstalledHTMLArtifactResultEnvelope } from '@openchamber/ui/lib/interactive-ui/installedArtifactResult';
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
const artifactSessionId = params.get('session') || undefined;
const artifactClipTest = params.get('clipTest') === 'true';
const requestedRuntime = params.get('runtime');
const runtime = requestedRuntime === 'generated'
  || requestedRuntime === 'declarative'
  || requestedRuntime === 'crm'
  || requestedRuntime === 'artifact-static'
  || requestedRuntime === 'artifact-interactive'
  || requestedRuntime === 'artifact-installed'
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
const isInstalledArtifact = runtime === 'artifact-installed';
const isBlockedArtifact = runtime === 'artifact-blocked';
const isCrashedArtifact = runtime === 'artifact-crashed';
const isArtifact = isStaticArtifact || isInteractiveArtifact || isInstalledArtifact || isBlockedArtifact || isCrashedArtifact;
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
const clippingArtifactEnvelope: HTMLArtifactResultEnvelope = {
  $schema: 'openchamber://html-artifact-result/v1',
  schemaVersion: 1,
  title: 'Runner 裁剪验收',
  summary: '紫色区域只能出现在滚动容器内部，不能覆盖下方绿色保护区。',
  capabilities: { scripts: true },
  display: { preferred: 'inline', allowExpand: false, inlineHeight: 420 },
  html: String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0}body{display:grid;place-items:center;background:#ff00cc;color:#160014;font:700 24px/1.4 ui-sans-serif,system-ui,sans-serif}.panel{text-align:center}.panel button{margin-top:18px;padding:10px 18px;border:2px solid #160014;border-radius:10px;background:#fff;color:#160014;font:inherit;cursor:pointer}
  </style>
</head>
<body>
  <main class="panel"><div>ARTIFACT CLIP TEST</div><button id="counter" type="button">count 0</button></main>
  <script>(()=>{let count=0;const button=document.getElementById('counter');button.addEventListener('click',()=>{count+=1;button.textContent='count '+count})})()</script>
</body>
</html>`,
};
const artifactEnvelope = isStaticArtifact
  ? staticNeuralNetworkArtifact
  : artifactClipTest
    ? clippingArtifactEnvelope
  : isBlockedArtifact
    ? blockedArtifactEnvelope
    : isCrashedArtifact
      ? crashedArtifactEnvelope
      : learningRateSimulatorArtifact;
const artifactOutput = JSON.stringify(artifactEnvelope, null, 2);
const installedArtifactEnvelope: InstalledHTMLArtifactResultEnvelope = {
  $schema: 'openchamber://installed-html-artifact-result/v1',
  schemaVersion: 1,
  artifact: params.get('artifact') || 'com.demo.simple.crm.explorer',
  mode: 'live',
  summary: 'Simple CRM explorer opened',
  context: { scope: 'packaged-acceptance' },
  updatedAt: fixedUpdatedAt,
};
const installedArtifactOutput = JSON.stringify(installedArtifactEnvelope, null, 2);

// This file is a standalone Vite entry rather than a reusable component module.
// eslint-disable-next-line react-refresh/only-export-components
const DemoContent = () => {
  if (isArtifact) {
    const artifactViewEnvelope = isInstalledArtifact ? installedArtifactEnvelope : artifactEnvelope;
    const artifactViewOutput = isInstalledArtifact ? installedArtifactOutput : artifactOutput;
    return (
      <HTMLArtifactView
        envelope={artifactViewEnvelope}
        sessionId={artifactSessionId}
        toolPartId={`interactive-ui-demo-${runtime}`}
        tool={isInstalledArtifact ? {
          id: 'interactive-ui-demo-installed-artifact-tool',
          name: params.get('tool') || 'simple_crm_open_explorer',
        } : undefined}
        fallback={<pre className="overflow-auto whitespace-pre-wrap typography-code text-muted-foreground">{artifactViewOutput}</pre>}
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

// This fixture deliberately resembles the chat topology: the Artifact is
// inside an overflow scroller while a sibling surface remains below it. Native
// Runner pixels must never escape into the green guard.
// eslint-disable-next-line react-refresh/only-export-components
const ClipTestDemo = () => (
  <main className="min-h-screen bg-[#101014] p-8 text-white" data-ocix-clip-test>
    <section
      className="mx-auto h-[520px] w-full max-w-5xl overflow-y-auto rounded-2xl border-4 border-white bg-[#24242b] p-5"
      data-ocix-clip-test-scroller
    >
      <div className="mb-5 flex h-44 items-center justify-center rounded-xl bg-[#353541] text-xl font-semibold">
        Scroll spacer
      </div>
      <DemoContent />
      <div className="mt-5 h-[520px] rounded-xl bg-[#353541]" />
    </section>
    <section
      className="mx-auto mt-4 flex h-32 w-full max-w-5xl items-center justify-center rounded-2xl bg-[#39ff14] text-2xl font-black text-black"
      data-ocix-clip-test-guard
    >
      NATIVE RUNNER MUST NOT COVER THIS AREA
    </section>
  </main>
);

// eslint-disable-next-line react-refresh/only-export-components
const Demo = () => (
  artifactClipTest ? <ClipTestDemo /> :
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
