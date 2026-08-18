import net from 'node:net';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockBusinessServer } from '../examples/interactive-ui/mock-business-server.mjs';
import { configureDemoOpenCodeBinary } from './lib/interactive-ui-demo-lifecycle.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoProjectId = `path_${Buffer.from(projectRoot, 'utf8').toString('base64url')}`;
const extensionDirectory = path.join(projectRoot, 'examples', 'interactive-ui');
const agentRuntimeDirectory = path.join(extensionDirectory, 'agent-runtime');
const defaultDemoRuntimeDirectory = path.join(projectRoot, '.tmp', 'interactive-ui-demo');
const requestedDemoRuntimeDirectory = process.env.OPENCHAMBER_INTERACTIVE_UI_DEMO_RUNTIME_DIR?.trim();
const demoRuntimeDirectory = requestedDemoRuntimeDirectory
  ? path.resolve(requestedDemoRuntimeDirectory)
  : defaultDemoRuntimeDirectory;
if (requestedDemoRuntimeDirectory) {
  const allowedParents = [path.join(projectRoot, '.tmp'), os.tmpdir()].map((directory) => path.resolve(directory));
  const isWithinAllowedParent = allowedParents.some((parent) => {
    const relative = path.relative(parent, demoRuntimeDirectory);
    return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
  });
  if (!isWithinAllowedParent) {
    throw new Error('OPENCHAMBER_INTERACTIVE_UI_DEMO_RUNTIME_DIR must be a child of the project .tmp directory or the platform temporary directory');
  }
}
const demoDataDirectory = path.join(demoRuntimeDirectory, 'data');
const demoOpenCodeConfigDirectory = path.join(demoRuntimeDirectory, 'opencode-config');
const demoXdgConfigDirectory = path.join(demoRuntimeDirectory, 'xdg-config');
const demoExtensionDirectories = [
  path.join(extensionDirectory, 'acme-crm'),
  path.join(extensionDirectory, 'acme-sales'),
];
const demoSalesRuntimeDirectory = path.join(extensionDirectory, 'acme-sales', 'agent-runtime');
const tldrawMcpUrl = process.env.OPENCHAMBER_TLDRAW_MCP_URL?.trim();
const requestedPort = Number.parseInt(process.env.OPENCHAMBER_INTERACTIVE_UI_DEMO_PORT || '', 10);
const hasRequestedPort = Number.isFinite(requestedPort) && requestedPort > 0;

const isPortAvailable = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.unref();
  server.once('error', () => resolve(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolve(true)));
});

const resolveDemoPort = async () => {
  if (hasRequestedPort) return requestedPort;
  for (let candidate = 47832; candidate <= 47842; candidate += 1) {
    if (await isPortAvailable(candidate)) return candidate;
  }
  throw new Error('No Interactive UI demo port is available in the 47832–47842 range');
};

const waitForDemoTools = async (baseUrl, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/experimental/tool/ids?directory=${encodeURIComponent(projectRoot)}`);
      if (response.ok) {
        const ids = await response.json();
        if (Array.isArray(ids)
          && [
            'html_artifact',
            'interactive_ui',
            'crm_open_dashboard',
            'sales_get_summary',
            'sales_get_dashboard',
            'sales_get_order_detail',
          ]
            .every((name) => ids.filter((candidate) => candidate === name).length === 1)) return ids;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`OpenCode did not discover the Interactive UI demo tools${lastError ? `: ${lastError.message}` : ''}`);
};

const port = await resolveDemoPort();

// Keep the demo deterministic and separate from the user's production OCIX/OpenCode
// installation. Built-in visualization assets are reconciled by OpenChamber; only
// the CRM and Sales demo Tools/Skills are seeded here.
await Promise.all([
  fs.rm(demoDataDirectory, { recursive: true, force: true }),
  fs.rm(demoOpenCodeConfigDirectory, { recursive: true, force: true }),
  fs.rm(demoXdgConfigDirectory, { recursive: true, force: true }),
]);
await fs.mkdir(path.join(demoOpenCodeConfigDirectory, 'tools'), { recursive: true });
await fs.mkdir(path.join(demoOpenCodeConfigDirectory, 'skills'), { recursive: true });
await fs.mkdir(demoXdgConfigDirectory, { recursive: true });
await fs.mkdir(demoDataDirectory, { recursive: true });
if (tldrawMcpUrl) {
  const parsedTldrawMcpUrl = new URL(tldrawMcpUrl);
  if (!['http:', 'https:'].includes(parsedTldrawMcpUrl.protocol)) {
    throw new Error('OPENCHAMBER_TLDRAW_MCP_URL must use http or https');
  }
  await fs.writeFile(path.join(demoOpenCodeConfigDirectory, 'config.json'), `${JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      'interop-tldraw-2026': {
        type: 'remote',
        url: parsedTldrawMcpUrl.toString(),
        oauth: false,
        timeout: 30_000,
        enabled: true,
      },
    },
  }, null, 2)}\n`, { mode: 0o600 });
}
await fs.writeFile(path.join(demoDataDirectory, 'settings.json'), `${JSON.stringify({
  sessionRecapEnabled: false,
  sessionSuggestionEnabled: false,
  projects: [{
    id: demoProjectId,
    path: projectRoot,
    addedAt: Date.now(),
    lastOpenedAt: Date.now(),
  }],
  activeProjectId: demoProjectId,
}, null, 2)}\n`, { mode: 0o600 });
await fs.copyFile(
  path.join(agentRuntimeDirectory, 'tools', 'crm_open_dashboard.ts'),
  path.join(demoOpenCodeConfigDirectory, 'tools', 'crm_open_dashboard.ts'),
);
await Promise.all([
  'sales_get_summary.ts',
  'sales_get_dashboard.ts',
  'sales_get_order_detail.ts',
].map((filename) => fs.copyFile(
  path.join(demoSalesRuntimeDirectory, 'tools', filename),
  path.join(demoOpenCodeConfigDirectory, 'tools', filename),
)));
await fs.cp(
  path.join(agentRuntimeDirectory, 'skills', 'acme-crm'),
  path.join(demoOpenCodeConfigDirectory, 'skills', 'acme-crm'),
  { recursive: true },
);
await fs.cp(
  path.join(demoSalesRuntimeDirectory, 'skills', 'acme-sales'),
  path.join(demoOpenCodeConfigDirectory, 'skills', 'acme-sales'),
  { recursive: true },
);
const mock = await startMockBusinessServer({ port: 0, token: 'demo-secret' });

process.env.OCIX_DEMO_API_URL = mock.url;
process.env.OCIX_DEMO_TOKEN = 'demo-secret';
process.env.OPENCHAMBER_DATA_DIR = demoDataDirectory;
process.env.OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR = demoExtensionDirectories.join(path.delimiter);
process.env.OPENCHAMBER_TEST_OPENCODE_CONFIG_DIR = demoOpenCodeConfigDirectory;
process.env.OPENCODE_CONFIG_DIR = demoOpenCodeConfigDirectory;
process.env.XDG_CONFIG_HOME = demoXdgConfigDirectory;
process.env.OPENCHAMBER_OPENCODE_CWD = projectRoot;
process.env.OPENCHAMBER_HTML_ARTIFACTS_SCRIPTS ??= 'true';
process.env.OPENCODE_DISABLE_EXTERNAL_SKILLS = 'true';
process.env.OPENCODE_DISABLE_CLAUDE_CODE = 'true';
process.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS = 'true';
process.env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true';
delete process.env.OPENCODE_SKIP_START;
delete process.env.OPENCHAMBER_SKIP_OPENCODE_START;
delete process.env.OPENCODE_HOST;
delete process.env.OPENCODE_PORT;

const demoOpenCodeBinary = configureDemoOpenCodeBinary();
console.log(`[interactive-ui-demo] OpenCode CLI: ${demoOpenCodeBinary.path} (${demoOpenCodeBinary.source})`);

const { startWebUiServer } = await import('../packages/web/server/index.js');
let openchamber;

try {
  openchamber = await startWebUiServer({
    host: '127.0.0.1',
    port,
    attachSignals: false,
    exitOnShutdown: false,
  });
  await waitForDemoTools(`http://127.0.0.1:${openchamber.getPort()}`);
} catch (error) {
  await openchamber?.stop().catch(() => {});
  await mock.close().catch(() => {});
  throw error;
}

const stop = async () => {
  await openchamber.stop().catch(() => {});
  await mock.close().catch(() => {});
};

process.once('SIGINT', () => void stop().finally(() => process.exit(0)));
process.once('SIGTERM', () => void stop().finally(() => process.exit(0)));

console.log(`OpenChamber Agent demo: http://127.0.0.1:${openchamber.getPort()}`);
console.log('Test 1: 给我看看 LLM 强化学习的流程');
console.log('Test 2 fallback: 使用 interactive_ui 画一下 LLM 强化学习的流程');
console.log('Test 3: 把最近一周的模型调用量、成功率和延迟做成一个运营看板，数据可以用示例值');
console.log('Test 4: 打开企业 CRM，看看客户和商机管道');
console.log('Test 5: 查看华东区本月销售概览（Installed Declarative）');
console.log('Test 6: 使用 html_artifact 画一个自定义 SVG 神经网络拓扑图');
console.log('Test 7: 使用 html_artifact 做一个可以拖动学习率并观察损失曲线变化的本地模拟器（模拟数据）');
console.log(`Developer-only Native harness: http://127.0.0.1:${openchamber.getPort()}/interactive-ui-demo.html?runtime=native`);
console.log(`Developer-only Declarative harness: http://127.0.0.1:${openchamber.getPort()}/interactive-ui-demo.html?runtime=declarative`);
console.log(`Mock business system: ${mock.url}`);
