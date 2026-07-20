import React from 'react';
import { createRoot } from 'react-dom/client';
import { createConfiguredWebAPIs } from './runtimeConfig';
import { RuntimeAPIProvider } from '@openchamber/ui/contexts/RuntimeAPIProvider';
import { ThemeSystemProvider } from '@openchamber/ui/contexts/ThemeSystemContext';
import { ThemeProvider } from '@openchamber/ui/components/providers/ThemeProvider';
import { InteractiveUIView } from '@openchamber/ui/components/interactive-ui/InteractiveUIView';
import { I18nProvider, initializeLocale } from '@openchamber/ui/lib/i18n';
import type { RuntimeAPIs } from '@openchamber/ui/lib/api/types';
import type { InteractiveResultEnvelope } from '@openchamber/ui/lib/interactive-ui/types';
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
const runtime = params.get('runtime') === 'declarative' ? 'declarative' : 'native';
const isDeclarative = runtime === 'declarative';
const envelope: InteractiveResultEnvelope = {
  $schema: 'openchamber://interactive-result/v1',
  view: isDeclarative
    ? 'com.openchamber.demo.sales.summary'
    : 'com.openchamber.demo.sales.dashboard',
  schemaVersion: 1,
  mode: 'live',
  summary: '华东区 2026 年 7 月销售额 182 万元',
  context: { region: 'east', period: '2026-07' },
  data: {
    region: 'east',
    period: '2026-07',
    revenue: 1820000,
    orderCount: 48,
    completionRate: 0.875,
    trend: [],
    anomalies: [],
    updatedAt: new Date().toISOString(),
  },
  dataRef: { connector: 'sales-api', resource: 'sales.dashboard', revision: 'demo-page' },
  updatedAt: new Date().toISOString(),
};
const output = JSON.stringify(envelope, null, 2);

// This file is a standalone Vite entry rather than a reusable component module.
// eslint-disable-next-line react-refresh/only-export-components
const Demo = () => (
  <main className="min-h-screen bg-background p-4 text-foreground sm:p-8">
    <div className="mx-auto w-full max-w-5xl rounded-2xl border border-border bg-[var(--surface-muted)] p-3 shadow-sm sm:p-5">
      <InteractiveUIView
        envelope={envelope}
        tool={{
          id: 'interactive-ui-demo-tool',
          name: isDeclarative ? 'sales_get_summary' : 'sales_get_dashboard',
          input: envelope.context,
          output,
        }}
        fallback={<pre className="overflow-auto whitespace-pre-wrap typography-code text-muted-foreground">{output}</pre>}
        isMobile={false}
      />
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
