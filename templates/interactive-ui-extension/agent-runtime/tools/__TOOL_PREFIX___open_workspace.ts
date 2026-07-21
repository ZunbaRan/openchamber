import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the installed __EXTENSION_NAME__ Trusted Native workspace for authoritative enterprise interaction and confirmed writes. Prefer this connected-business-system Tool over generic interactive_ui for the declared business domain, including when connector setup must be reported. After it returns, its OCIX View is already rendered; do not call another visualization Tool for the same business data.',
  args: {
    scope: tool.schema.string().optional().describe('Optional enterprise scope, team, region, or tenant key'),
  },
  async execute(args) {
    return JSON.stringify({
      $schema: 'openchamber://interactive-result/v1',
      view: '__EXTENSION_ID__.workspace',
      schemaVersion: 1,
      mode: 'live',
      summary: '__EXTENSION_NAME__ workspace opened',
      context: { scope: args.scope || 'default' },
      updatedAt: new Date().toISOString(),
    });
  },
});
