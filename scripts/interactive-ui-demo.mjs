import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startMockBusinessServer } from '../examples/interactive-ui/mock-business-server.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionDirectory = path.join(projectRoot, 'examples', 'interactive-ui');
const agentRuntimeDirectory = path.join(extensionDirectory, 'agent-runtime');
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
        if (Array.isArray(ids) && ids.includes('interactive_ui') && ids.includes('crm_open_dashboard')) return ids;
      }
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`OpenCode did not discover the Interactive UI demo tools${lastError ? `: ${lastError.message}` : ''}`);
};

const port = await resolveDemoPort();
const mock = await startMockBusinessServer({ port: 0, token: 'demo-secret' });

process.env.OCIX_DEMO_API_URL = mock.url;
process.env.OCIX_DEMO_TOKEN = 'demo-secret';
process.env.OPENCHAMBER_INTERACTIVE_UI_EXTENSIONS_DIR = extensionDirectory;
process.env.OPENCODE_CONFIG_DIR = agentRuntimeDirectory;
process.env.OPENCHAMBER_OPENCODE_CWD = projectRoot;
delete process.env.OPENCODE_SKIP_START;
delete process.env.OPENCHAMBER_SKIP_OPENCODE_START;
delete process.env.OPENCODE_HOST;
delete process.env.OPENCODE_PORT;

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
console.log(`Developer-only Native harness: http://127.0.0.1:${openchamber.getPort()}/interactive-ui-demo.html?runtime=native`);
console.log(`Developer-only Declarative harness: http://127.0.0.1:${openchamber.getPort()}/interactive-ui-demo.html?runtime=declarative`);
console.log(`Mock business system: ${mock.url}`);
