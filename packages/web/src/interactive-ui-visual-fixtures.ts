import type { InteractiveResultEnvelope } from '@openchamber/ui/lib/interactive-ui/types';

export const generatedVisualFixtureEnvelope: InteractiveResultEnvelope = {
  $schema: 'openchamber://interactive-result/v1',
  view: 'com.openchamber.builtin.interactive-ui.generated',
  schemaVersion: 1,
  mode: 'snapshot',
  summary: '模型推导示例：LLM 强化学习流程、评测指标与代码变更',
  data: {
    layout: {
      type: 'stack',
      children: [
        {
          type: 'metric-grid',
          columns: { default: 3 },
          items: [
            { label: '训练阶段', value: '4', detail: 'SFT → Reward → PPO → Eval', tone: 'info' },
            { label: '评测通过率', value: '92.4%', trend: 'up', trendValue: '+2.1%', tone: 'success' },
            { label: '高风险项', value: '2', trend: 'down', trendValue: '需人工复核', tone: 'warning' },
          ],
        },
        {
          type: 'flow',
          data: [
            { title: '监督微调', description: '使用高质量指令数据建立初始策略。', status: 'completed' },
            { title: '奖励建模', description: '从偏好对比中学习奖励信号。', status: 'completed' },
            { title: '策略优化', description: '约束更新策略并优化奖励。', status: 'active' },
            { title: '安全评测', description: '验证能力、偏差和回归风险。', status: 'pending' },
          ],
        },
        {
          type: 'chart',
          title: '评测趋势（模型推导示例）',
          variant: 'line',
          xKey: 'iteration',
          series: [
            { key: 'helpfulness', label: '有用性' },
            { key: 'safety', label: '安全性' },
          ],
          data: [
            { iteration: 'v1', helpfulness: 72, safety: 88 },
            { iteration: 'v2', helpfulness: 81, safety: 90 },
            { iteration: 'v3', helpfulness: 89, safety: 92 },
          ],
        },
        {
          type: 'row',
          columns: 2,
          children: [
            {
              type: 'timeline',
              title: '训练里程碑',
              items: [
                { title: '数据冻结', description: '训练与评测集合完成去重。', timestamp: '09:00', tone: 'success' },
                { title: '策略训练', description: '正在执行第三轮受约束优化。', timestamp: '13:30', tone: 'active' },
                { title: '红队验证', description: '等待安全策略评审。', timestamp: '待开始', tone: 'pending' },
              ],
            },
            {
              type: 'activity-feed',
              title: '最新活动',
              items: [
                { actor: 'Eval Agent', action: '完成能力评测', description: '有用性得分提高 8.0%。', timestamp: '刚刚' },
                { actor: 'Safety Agent', action: '标记两个风险案例', description: '等待人工复核，不会自动发布。', timestamp: '5 分钟前' },
              ],
            },
          ],
        },
        {
          type: 'comparison',
          title: '方案比较',
          columns: [
            { key: 'method', label: '方法' },
            { key: 'strength', label: '优势' },
            { key: 'risk', label: '风险' },
          ],
          data: [
            { method: 'SFT', strength: '稳定、易复现', risk: '受示范数据上限约束' },
            { method: 'DPO', strength: '训练流程相对简洁', risk: '偏好分布变化会影响效果' },
            { method: 'PPO', strength: '可直接优化奖励目标', risk: '训练成本和稳定性要求较高' },
          ],
        },
        {
          type: 'tabs',
          title: '工程详情',
          items: [
            {
              label: '提交图',
              children: [{
                type: 'git-graph',
                commits: [
                  { id: 'a13c9e21', message: 'Merge reward-model evaluation', branch: 'main', parents: ['bf01c842'] },
                  { id: 'bf01c842', message: 'Add long-context safety regression fixtures', branch: 'feature/safety-eval', parents: [] },
                ],
              }],
            },
            {
              label: '配置',
              children: [{ type: 'code-block', language: 'json', value: '{\n  "learningRate": 0.0001,\n  "clipRange": 0.2\n}' }],
            },
          ],
        },
        {
          type: 'accordion',
          title: '影响范围',
          items: [{
            label: '查看文件树与变更摘要',
            children: [
              {
                type: 'tree',
                items: [
                  { id: 'root', label: 'training' },
                  { id: 'config', parentId: 'root', label: 'configs/production/reinforcement-learning.yaml', status: 'active' },
                  { id: 'eval', parentId: 'root', label: 'evaluation/safety/long-context-regressions.json', status: 'pending' },
                ],
              },
              {
                type: 'diff-summary',
                items: [
                  { path: 'training/configs/production/reinforcement-learning.yaml', status: 'modified', additions: 18, deletions: 4 },
                  { path: 'evaluation/safety/long-context-regressions.json', status: 'added', additions: 64, deletions: 0 },
                ],
              },
            ],
          }],
        },
      ],
    },
  },
  updatedAt: '2026-07-21T09:30:00.000Z',
};
