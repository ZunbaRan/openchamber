import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const MARKER_SCHEMA_VERSION = 1;
const MARKER_FILE_NAME = 'macos-launchservices-registration-v1.json';
const LSREGISTER_PATH = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';

export const resolveContainingAppBundle = (executablePath) => {
  if (typeof executablePath !== 'string' || !executablePath.trim()) return null;
  let candidate = path.resolve(executablePath);
  while (true) {
    if (path.extname(candidate).toLowerCase() === '.app') return candidate;
    const parent = path.dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
};

const isWithinRoot = (candidate, root) => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative);
};

const isInstalledApplication = (appPath, homeDirectory) => {
  if (!appPath || path.extname(appPath).toLowerCase() !== '.app') return false;
  return isWithinRoot(appPath, '/Applications')
    || isWithinRoot(appPath, path.join(homeDirectory, 'Applications'));
};

const readRegistrationMarker = async (markerPath) => {
  try {
    const parsed = JSON.parse(await fs.readFile(markerPath, 'utf8'));
    if (
      parsed?.schemaVersion !== MARKER_SCHEMA_VERSION
      || typeof parsed.appPath !== 'string'
      || typeof parsed.version !== 'string'
    ) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeRegistrationMarker = async (markerPath, marker) => {
  await fs.mkdir(path.dirname(markerPath), { recursive: true });
  const temporaryPath = `${markerPath}.${process.pid}.tmp`;
  try {
    await fs.writeFile(temporaryPath, `${JSON.stringify(marker)}\n`, { mode: 0o600 });
    await fs.rename(temporaryPath, markerPath);
  } finally {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
  }
};

const runLaunchServicesRegistration = async (appPath) => {
  try {
    await execFileAsync(LSREGISTER_PATH, ['-f', appPath], {
      timeout: 10_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      exitCode: typeof error?.code === 'number' ? error.code : null,
    };
  }
};

export const ensureMacosLaunchServicesRegistration = async ({
  platform,
  isPackaged,
  execPath,
  version,
  userDataPath,
  homeDirectory,
  readMarker,
  writeMarker,
  runRegistration,
}) => {
  if (platform !== 'darwin' || !isPackaged) return { status: 'skipped' };
  const appPath = resolveContainingAppBundle(execPath);
  if (!isInstalledApplication(appPath, homeDirectory)) return { status: 'skipped' };

  const expectedMarker = {
    schemaVersion: MARKER_SCHEMA_VERSION,
    appPath,
    version,
  };
  const markerPath = path.join(userDataPath, MARKER_FILE_NAME);
  const marker = await (readMarker ?? readRegistrationMarker)(markerPath);
  if (
    marker?.schemaVersion === expectedMarker.schemaVersion
    && marker.appPath === expectedMarker.appPath
    && marker.version === expectedMarker.version
  ) return { status: 'already-registered' };

  const registration = await (runRegistration ?? runLaunchServicesRegistration)(appPath);
  if (!registration?.ok) {
    return {
      status: 'failed',
      exitCode: registration?.exitCode ?? null,
      error: registration?.error ?? 'LaunchServices registration failed',
    };
  }

  await (writeMarker ?? ((value) => writeRegistrationMarker(markerPath, value)))(expectedMarker, markerPath);
  return { status: 'registered' };
};
