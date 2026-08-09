const artifactEnvelope = ({ title, summary, html, scripts, inlineHeight }) => ({
  $schema: 'openchamber://html-artifact-result/v1',
  schemaVersion: 1,
  title,
  summary,
  html,
  capabilities: { scripts },
  display: { preferred: 'inline', allowExpand: true, inlineHeight },
});

export const staticNeuralNetworkArtifact = artifactEnvelope({
  title: '神经网络结构',
  summary: '确定性的静态 SVG Artifact，用于主题、响应式和历史重建验收。',
  scripts: false,
  inlineHeight: 360,
  html: String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root{color-scheme:light dark;--ocix-surface:#fff;--ocix-surface-subtle:#f7f7f8;--ocix-foreground:#171717;--ocix-muted-foreground:#737373;--ocix-border:#d4d4d4;--ocix-primary:#7c3aed;--ocix-primary-foreground:#fff;--ocix-info:#0284c7;--ocix-info-background:#e0f2fe;--ocix-success:#16a34a;--ocix-success-background:#dcfce7}@media(prefers-color-scheme:dark){:root{--ocix-surface:#1c1b1b;--ocix-surface-subtle:#242222;--ocix-foreground:#f3f1ef;--ocix-muted-foreground:#aaa5a1;--ocix-border:#45413e;--ocix-primary:#f97316;--ocix-primary-foreground:#1c1917;--ocix-info:#38bdf8;--ocix-info-background:#172b36;--ocix-success:#4ade80;--ocix-success-background:#182c20}}*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--ocix-foreground);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}.frame{padding:16px;background:transparent}h1{margin:0 0 4px;font-size:16px}.hint{margin:0 0 14px;color:var(--ocix-muted-foreground)}svg{display:block;width:100%;height:240px}.edge{stroke:var(--ocix-border);stroke-width:2}.node{stroke-width:2}.input{fill:var(--ocix-info-background);stroke:var(--ocix-info)}.hidden{fill:var(--ocix-primary);stroke:var(--ocix-primary)}.output{fill:var(--ocix-success-background);stroke:var(--ocix-success)}text{fill:var(--ocix-foreground);font-size:12px;text-anchor:middle}.hidden-label{fill:var(--ocix-primary-foreground)}@media(max-width:480px){.frame{padding:12px}svg{height:200px}}
  </style>
</head>
<body>
  <main class="frame">
    <h1>三层分类网络</h1>
    <p class="hint">输入层 → 特征层 → 分类输出</p>
    <svg viewBox="0 0 720 240" role="img" aria-labelledby="network-title network-desc">
      <title id="network-title">三层神经网络结构</title>
      <desc id="network-desc">三个输入节点连接四个特征节点，再连接两个输出节点。</desc>
      <g class="edge">
        <path d="M120 55L360 35M120 55L360 90M120 55L360 145M120 55L360 200M120 120L360 35M120 120L360 90M120 120L360 145M120 120L360 200M120 185L360 35M120 185L360 90M120 185L360 145M120 185L360 200M360 35L600 85M360 90L600 85M360 145L600 155M360 200L600 155"/>
      </g>
      <g><circle class="node input" cx="120" cy="55" r="27"/><circle class="node input" cx="120" cy="120" r="27"/><circle class="node input" cx="120" cy="185" r="27"/><text x="120" y="59">特征 A</text><text x="120" y="124">特征 B</text><text x="120" y="189">特征 C</text></g>
      <g><circle class="node hidden" cx="360" cy="35" r="25"/><circle class="node hidden" cx="360" cy="90" r="25"/><circle class="node hidden" cx="360" cy="145" r="25"/><circle class="node hidden" cx="360" cy="200" r="25"/><text class="hidden-label" x="360" y="39">H1</text><text class="hidden-label" x="360" y="94">H2</text><text class="hidden-label" x="360" y="149">H3</text><text class="hidden-label" x="360" y="204">H4</text></g>
      <g><circle class="node output" cx="600" cy="85" r="31"/><circle class="node output" cx="600" cy="155" r="31"/><text x="600" y="89">类别 1</text><text x="600" y="159">类别 2</text></g>
    </svg>
  </main>
</body>
</html>`,
});

export const learningRateSimulatorArtifact = artifactEnvelope({
  title: '学习率模拟器',
  summary: '确定性的 scripts Artifact；滑块必须同时更新数值与 SVG 曲线。',
  scripts: true,
  inlineHeight: 420,
  html: String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root{color-scheme:light dark;--ocix-surface:#fff;--ocix-surface-subtle:#f7f7f8;--ocix-foreground:#171717;--ocix-muted-foreground:#737373;--ocix-border:#d4d4d4;--ocix-primary:#7c3aed;--ocix-primary-foreground:#fff}@media(prefers-color-scheme:dark){:root{--ocix-surface:#1c1b1b;--ocix-surface-subtle:#242222;--ocix-foreground:#f3f1ef;--ocix-muted-foreground:#aaa5a1;--ocix-border:#45413e;--ocix-primary:#f97316;--ocix-primary-foreground:#1c1917}}*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--ocix-foreground);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}.panel{padding:16px;background:transparent}.header{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.eyebrow{color:var(--ocix-muted-foreground);font-size:12px}h1{margin:2px 0 0;font-size:16px}.value{min-width:76px;padding:7px 10px;border-radius:999px;background:var(--ocix-primary);color:var(--ocix-primary-foreground);font-weight:700;text-align:center}.controls{display:grid;grid-template-columns:auto 1fr;align-items:center;gap:10px;margin:18px 0}input{width:100%;accent-color:var(--ocix-primary)}svg{display:block;width:100%;height:auto;border-radius:10px;background:var(--ocix-surface-subtle)}.axis{fill:none;stroke:var(--ocix-border);stroke-width:1.5}.curve{fill:none;stroke:var(--ocix-primary);stroke-width:4;stroke-linecap:round}.caption{margin:9px 0 0;color:var(--ocix-muted-foreground);font-size:12px}@media(max-width:480px){.panel{padding:12px}.header{align-items:center}.controls{grid-template-columns:1fr}.controls label{font-weight:600}}
  </style>
</head>
<body>
  <main class="panel">
    <div class="header"><div><div class="eyebrow">交互式参数探索</div><h1>学习率与收敛曲线</h1></div><output id="rate-value" class="value" for="rate">0.0016</output></div>
    <div class="controls"><label for="rate">学习率</label><input id="rate" type="range" min="0" max="100" value="30" aria-describedby="curve-description"></div>
    <svg viewBox="0 0 640 220" role="img" aria-labelledby="curve-title curve-description"><title id="curve-title">训练损失收敛曲线</title><desc id="curve-description">拖动学习率后，数值与曲线路径会同时更新。</desc><path class="axis" d="M45 20V185H615"/><path id="curve" class="curve" d="" data-render-value="30"/></svg>
    <p class="caption">较大的学习率会更快下降，但可能引入更明显的振荡。</p>
  </main>
  <script>
    (() => {
      const slider = document.getElementById('rate');
      const output = document.getElementById('rate-value');
      const curve = document.getElementById('curve');
      const render = () => {
        const position = Number(slider.value);
        const learningRate = Math.pow(10, -4 + position / 25);
        const speed = 1.2 + position / 22;
        const wobble = position / 100 * 12;
        const points = [];
        for (let step = 0; step <= 40; step += 1) {
          const x = 45 + step * 14.25;
          const progress = step / 40;
          const loss = 1 - (1 - Math.exp(-progress * speed));
          const oscillation = Math.sin(progress * 22) * wobble * progress;
          const y = 30 + loss * 140 + oscillation;
          points.push((step === 0 ? 'M' : 'L') + x.toFixed(2) + ' ' + y.toFixed(2));
        }
        output.value = learningRate.toFixed(4);
        output.textContent = learningRate.toFixed(4);
        curve.setAttribute('d', points.join(' '));
        curve.dataset.renderValue = String(position);
      };
      slider.addEventListener('input', render);
      render();
    })();
  </script>
</body>
</html>`,
});

export const topologyExplorerArtifact = artifactEnvelope({
  title: '服务拓扑探索器',
  summary: '确定性的关系探索 fixture，用于 focus、Bridge resize 和窄屏验收。',
  scripts: true,
  inlineHeight: 430,
  html: String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <style>
    :root{color-scheme:light dark;--ocix-surface:#fff;--ocix-surface-subtle:#f7f7f8;--ocix-foreground:#171717;--ocix-muted-foreground:#737373;--ocix-border:#d4d4d4;--ocix-primary:#7c3aed;--ocix-selection:#ede9fe;--ocix-selection-foreground:#4c1d95;--ocix-focus-ring:#8b5cf6;--ocix-info-border:#7dd3fc;--ocix-success-border:#86efac}@media(prefers-color-scheme:dark){:root{--ocix-surface:#1c1b1b;--ocix-surface-subtle:#242222;--ocix-foreground:#f3f1ef;--ocix-muted-foreground:#aaa5a1;--ocix-border:#45413e;--ocix-primary:#f97316;--ocix-selection:#3b281b;--ocix-selection-foreground:#fed7aa;--ocix-focus-ring:#fb923c;--ocix-info-border:#075985;--ocix-success-border:#166534}}*{box-sizing:border-box}body{margin:0;background:transparent;color:var(--ocix-foreground);font:14px/1.5 ui-sans-serif,system-ui,sans-serif}.shell{padding:16px;background:transparent}h1{margin:0;font-size:16px}.toolbar{display:flex;flex-wrap:wrap;gap:8px;margin:14px 0}.toolbar button{min-height:36px;padding:7px 12px;border:1px solid var(--ocix-border);border-radius:9px;background:var(--ocix-surface-subtle);color:inherit;font:inherit;cursor:pointer}.toolbar button[aria-pressed=true]{border-color:var(--ocix-primary);background:var(--ocix-selection);color:var(--ocix-selection-foreground)}.toolbar button:focus-visible{outline:3px solid var(--ocix-focus-ring);outline-offset:2px}.map{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:12px}.service{position:relative;min-height:92px;padding:12px;border:1px solid var(--ocix-border);border-radius:12px;background:var(--ocix-surface-subtle)}.service strong{display:block}.service span{color:var(--ocix-muted-foreground);font-size:12px}.service[data-tier=api]{border-color:var(--ocix-info-border)}.service[data-tier=data]{border-color:var(--ocix-success-border)}.service[hidden]{display:none}@media(max-width:560px){.shell{padding:12px}.map{grid-template-columns:1fr}}
  </style>
</head>
<body>
  <main class="shell">
    <h1>订单域服务拓扑</h1>
    <div class="toolbar" role="group" aria-label="筛选服务层级"><button type="button" data-filter="all" aria-pressed="true">全部</button><button type="button" data-filter="api" aria-pressed="false">API</button><button type="button" data-filter="data" aria-pressed="false">数据层</button></div>
    <section class="map" aria-live="polite"><article class="service" data-tier="api"><strong>订单 API</strong><span>REST · 12 个端点</span></article><article class="service" data-tier="api"><strong>库存 API</strong><span>gRPC · 健康</span></article><article class="service" data-tier="api"><strong>支付 API</strong><span>REST · 99.98%</span></article><article class="service" data-tier="data"><strong>订单数据库</strong><span>PostgreSQL · 主从</span></article><article class="service" data-tier="data"><strong>事件流</strong><span>Kafka · 3 个分区</span></article><article class="service" data-tier="data"><strong>分析仓库</strong><span>ClickHouse · 只读</span></article></section>
  </main>
  <script>
    (() => {
      const buttons = Array.from(document.querySelectorAll('[data-filter]'));
      const services = Array.from(document.querySelectorAll('[data-tier]'));
      for (const button of buttons) button.addEventListener('click', () => {
        const filter = button.dataset.filter;
        for (const item of buttons) item.setAttribute('aria-pressed', String(item === button));
        for (const service of services) service.hidden = filter !== 'all' && service.dataset.tier !== filter;
      });
    })();
  </script>
</body>
</html>`,
});

export const htmlArtifactFixtures = Object.freeze({
  staticNeuralNetwork: staticNeuralNetworkArtifact,
  learningRateSimulator: learningRateSimulatorArtifact,
  topologyExplorer: topologyExplorerArtifact,
});
