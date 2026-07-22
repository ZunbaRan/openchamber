import { tool } from '@opencode-ai/plugin';

export default tool({
  description: 'Open the installed __EXTENSION_NAME__ HTML Artifact explorer for rich, authoritative enterprise interaction. Use this Tool when the user asks to explore, simulate, drag, inspect, or work in a canvas-like experience. The signed Artifact calls only manifest-declared Business Gateway actions; never return API credentials or inline HTML.',
  args: {
    scope: tool.schema.string().optional().describe('Optional enterprise scope, team, region, or tenant key'),
  },
  async execute(args) {
    return JSON.stringify({
      $schema: 'openchamber://installed-html-artifact-result/v1',
      schemaVersion: 1,
      artifact: '__EXTENSION_ID__.explorer',
      mode: 'live',
      summary: '__EXTENSION_NAME__ explorer opened',
      context: { scope: args.scope || 'default' },
      updatedAt: new Date().toISOString(),
    });
  },
});
