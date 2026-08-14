import nodePath from 'node:path';
import { fileURLToPath } from 'node:url';

export const BUILT_IN_INTERACTIVE_UI_EXTENSION_ID = 'com.openchamber.builtin.interactive-ui';
export const BUILT_IN_INTERACTIVE_UI_VERSION = '1.4.0';

// Exact hashes of previously shipped OpenChamber built-ins. These permit a
// one-time ownership migration without ever adopting an arbitrary user Tool.
const LEGACY_BUILT_IN_ASSETS = Object.freeze({
  'tools/interactive_ui.ts': [
    'sha256-OVpVCjBXc07o+1jmasgEcCDv6dO2g/u5qbq3wvYh60I=',
    'sha256-HFJwueb/YNiaG3r3t7SDxH2VybeEncdGMUVH76eZqVE=',
  ],
  'tools/html_artifact.ts': [
    'sha256-qYjbXXuIuKnaEnVacSjJW/UMWbbVQmu7I8GylkZKfF8=',
    'sha256-lJzup0d7/3QS35dl3bCqAGi98njIKPMlooFMR2C8NUw=',
  ],
  'skills/interactive-ui-visualization/SKILL.md': [
    'sha256-CkOULVhwq+zP4EUVRS0tuAKg0qJBXBWlOrJuHp08vGo=',
    'sha256-1M6V0sYIEawsTqyOwAmrqZDeLl54BsOArq/GQ248xpg=',
  ],
});

export const createBuiltInInteractiveUIRuntime = ({ pathImpl = nodePath } = {}) => {
  const rootDirectory = pathImpl.join(pathImpl.dirname(fileURLToPath(import.meta.url)), 'builtin');
  return {
    extensionId: BUILT_IN_INTERACTIVE_UI_EXTENSION_ID,
    version: BUILT_IN_INTERACTIVE_UI_VERSION,
    rootDirectory,
    legacyAssets: LEGACY_BUILT_IN_ASSETS,
    agentRuntime: {
      tools: [
        { name: 'interactive_ui', entry: 'agent-runtime/tools/interactive_ui.ts' },
        { name: 'interactive_ui_gallery', entry: 'agent-runtime/tools/interactive_ui_gallery.ts' },
        { name: 'html_artifact', entry: 'agent-runtime/tools/html_artifact.ts' },
      ],
      skills: [{
        name: 'interactive-ui-visualization',
        files: ['agent-runtime/skills/interactive-ui-visualization/SKILL.md'],
      }, {
        name: 'html-artifact-design',
        files: ['agent-runtime/skills/html-artifact-design/SKILL.md'],
      }],
    },
  };
};
