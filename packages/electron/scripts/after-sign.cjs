const path = require('node:path');
const { spawnSync } = require('node:child_process');

module.exports = (context) => {
  if (context.electronPlatformName !== 'darwin') return;
  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
  );
  const verifierPath = path.join(__dirname, 'macos-launchpad-eligibility.mjs');
  const result = spawnSync(process.execPath, [verifierPath, '--app', appPath], {
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`macOS Launchpad eligibility verification exited with ${result.status ?? result.signal}`);
  }
};
