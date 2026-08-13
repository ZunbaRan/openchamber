import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const electronRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const nonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

export const evaluateLaunchpadEligibility = ({
  info,
  expectedAppId,
  expectedProductName,
  executableExists,
  executableIsExecutable,
  legacyIconExists,
  assetCatalogExists,
  metadataContentType,
}) => {
  const failures = [];
  if (info.CFBundleIdentifier !== expectedAppId) {
    failures.push(`CFBundleIdentifier must be ${expectedAppId}, got ${String(info.CFBundleIdentifier)}`);
  }
  const displayName = nonEmptyString(info.CFBundleDisplayName)
    ? info.CFBundleDisplayName.trim()
    : nonEmptyString(info.CFBundleName)
      ? info.CFBundleName.trim()
      : '';
  if (displayName !== expectedProductName) {
    failures.push(`display name must be ${expectedProductName}, got ${displayName || '<empty>'}`);
  }
  if (info.CFBundlePackageType !== 'APPL') {
    failures.push(`CFBundlePackageType must be APPL, got ${String(info.CFBundlePackageType)}`);
  }
  if (!nonEmptyString(info.CFBundleExecutable)) {
    failures.push('CFBundleExecutable must be a non-empty string');
  }
  if (info.LSUIElement === true) failures.push('LSUIElement must not be true');
  if (info.LSBackgroundOnly === true) failures.push('LSBackgroundOnly must not be true');
  if (!executableExists) failures.push('bundle executable is missing');
  if (!executableIsExecutable) failures.push('bundle executable is not executable');
  if (!nonEmptyString(info.CFBundleIconFile) || !legacyIconExists) {
    failures.push('icon.icns must be declared and present');
  }
  if (!nonEmptyString(info.CFBundleIconName) || !assetCatalogExists) {
    failures.push('AppIcon/Assets.car must be declared and present');
  }
  if (metadataContentType !== 'com.apple.application-bundle') {
    failures.push(`Spotlight content type must be com.apple.application-bundle, got ${metadataContentType || '<empty>'}`);
  }
  return failures;
};

export const parseCodeSigningIdentity = (output) => {
  const source = String(output || '');
  const teamMatch = source.match(/^TeamIdentifier=(.+)$/m);
  const teamIdentifier = teamMatch && teamMatch[1] !== 'not set' ? teamMatch[1].trim() : null;
  if (/code object is not signed at all/i.test(source)) return { kind: 'unsigned', teamIdentifier: null };
  if (/^Signature=adhoc$/m.test(source)) return { kind: 'ad-hoc', teamIdentifier };
  if (/^Authority=Developer ID Application:/m.test(source)) return { kind: 'developer-id', teamIdentifier };
  return { kind: 'other', teamIdentifier };
};

const run = (program, args, options = {}) => {
  const result = spawnSync(program, args, { encoding: 'utf8', ...options });
  return {
    status: result.status,
    output: `${result.stdout || ''}${result.stderr || ''}`,
    error: result.error,
  };
};

const readInfoPlist = (appPath) => {
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');
  const result = run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', plistPath]);
  if (result.error || result.status !== 0) {
    throw new Error(`Unable to read ${plistPath}: ${result.error?.message || result.output.trim()}`);
  }
  return JSON.parse(result.output);
};

const metadataContentType = (appPath) => {
  const result = run('/usr/bin/mdls', ['-raw', '-name', 'kMDItemContentType', appPath]);
  if (result.error || result.status !== 0) return '';
  return result.output.trim().replace(/^"|"$/g, '');
};

const resolveAppPath = (configured) => {
  if (configured) return path.resolve(configured);
  const candidates = [
    path.join(electronRoot, 'dist', 'mac-arm64', 'OpenChamber.app'),
    path.join(electronRoot, 'dist', 'mac', 'OpenChamber.app'),
    path.join(electronRoot, 'dist', 'mac-universal', 'OpenChamber.app'),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error('Packaged OpenChamber.app not found; pass --app <path> or build macOS first');
  return found;
};

export const verifyMacosLaunchpadEligibility = ({ appPath, expectedAppId, expectedProductName }) => {
  const resolvedAppPath = resolveAppPath(appPath);
  const info = readInfoPlist(resolvedAppPath);
  const executableName = nonEmptyString(info.CFBundleExecutable) ? info.CFBundleExecutable.trim() : '';
  const executablePath = path.join(resolvedAppPath, 'Contents', 'MacOS', executableName);
  const iconName = nonEmptyString(info.CFBundleIconFile) ? info.CFBundleIconFile.trim() : '';
  const normalizedIconName = iconName && path.extname(iconName) ? iconName : `${iconName}.icns`;
  const iconPath = path.join(resolvedAppPath, 'Contents', 'Resources', normalizedIconName);
  const assetCatalogPath = path.join(resolvedAppPath, 'Contents', 'Resources', 'Assets.car');
  const executableExists = Boolean(executableName) && fs.existsSync(executablePath);

  const failures = evaluateLaunchpadEligibility({
    info,
    expectedAppId,
    expectedProductName,
    executableExists,
    executableIsExecutable: executableExists ? Boolean(fs.statSync(executablePath).mode & 0o111) : false,
    legacyIconExists: Boolean(normalizedIconName) && fs.existsSync(iconPath),
    assetCatalogExists: fs.existsSync(assetCatalogPath),
    metadataContentType: metadataContentType(resolvedAppPath),
  });

  const signatureDetails = run('/usr/bin/codesign', ['-dv', '--verbose=4', resolvedAppPath]);
  const signature = parseCodeSigningIdentity(signatureDetails.output);
  const signatureVerification = run('/usr/bin/codesign', ['--verify', '--deep', '--strict', resolvedAppPath]);
  if (signatureVerification.error || signatureVerification.status !== 0) {
    failures.push(`code signature verification failed: ${signatureVerification.error?.message || signatureVerification.output.trim()}`);
  }
  if (signature.kind === 'unsigned') failures.push('application must be code signed');

  if (failures.length > 0) {
    throw new Error(`macOS Launchpad eligibility failed for ${resolvedAppPath}:\n- ${failures.join('\n- ')}`);
  }
  return { appPath: resolvedAppPath, signature };
};

const parseArguments = (args) => {
  const appIndex = args.indexOf('--app');
  if (appIndex >= 0 && !args[appIndex + 1]) throw new Error('--app requires a path');
  return { appPath: appIndex >= 0 ? args[appIndex + 1] : undefined };
};

const isMain = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isMain) {
  if (process.platform !== 'darwin') throw new Error('macOS Launchpad eligibility verification requires macOS');
  const packageJson = JSON.parse(fs.readFileSync(path.join(electronRoot, 'package.json'), 'utf8'));
  const { appPath } = parseArguments(process.argv.slice(2));
  const result = verifyMacosLaunchpadEligibility({
    appPath,
    expectedAppId: packageJson.build.appId,
    expectedProductName: packageJson.build.productName,
  });
  const signingNote = result.signature.kind === 'ad-hoc'
    ? 'ad-hoc (local testing only; Developer ID/notarization is required for release provenance)'
    : `${result.signature.kind}${result.signature.teamIdentifier ? ` (${result.signature.teamIdentifier})` : ''}`;
  process.stdout.write(`[electron] macOS Launchpad eligibility verified: ${result.appPath}\n`);
  process.stdout.write(`[electron] signing identity: ${signingNote}\n`);
}
