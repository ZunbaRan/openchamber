import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILT_IN_INTERACTIVE_UI_EXTENSION_ID = 'com.openchamber.builtin.interactive-ui';
export const BUILT_IN_INTERACTIVE_UI_VERSION = '1.0.0';

export const createBuiltInInteractiveUIRuntime = ({ pathImpl = nodePath } = {}) => {
  const rootDirectory = pathImpl.join(pathImpl.dirname(fileURLToPath(import.meta.url)), 'builtin');
  return {
    extensionId: BUILT_IN_INTERACTIVE_UI_EXTENSION_ID,
    version: BUILT_IN_INTERACTIVE_UI_VERSION,
    rootDirectory,
    agentRuntime: {
      tools: [
        { name: 'interactive_ui', entry: 'agent-runtime/tools/interactive_ui.ts' },
        { name: 'html_artifact', entry: 'agent-runtime/tools/html_artifact.ts' },
      ],
      skills: [{
        name: 'interactive-ui-visualization',
        files: ['agent-runtime/skills/interactive-ui-visualization/SKILL.md'],
      }],
    },
  };
};
