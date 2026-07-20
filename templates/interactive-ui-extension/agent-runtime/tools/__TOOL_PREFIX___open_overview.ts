import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the installed __EXTENSION_NAME__ Declarative overview when the user asks about its metrics, status, or pending items.',
  args: {
    scope: tool.schema.string().optional().describe('Optional enterprise scope, team, region, or tenant key'),
  },
  async execute(args) {
    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: '__EXTENSION_ID__.overview',
      schemaVersion: 1,
      mode: 'live',
      summary: '__EXTENSION_NAME__ overview opened',
      context: { scope: args.scope || 'default' },
      updatedAt: new Date().toISOString(),
    });
  },
});
