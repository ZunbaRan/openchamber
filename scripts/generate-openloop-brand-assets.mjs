import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'assets/brand/openloop-app-icon.png');
const blackSource = path.join(root, 'assets/brand/openloop-app-icon-black.png');
const checkOnly = process.argv.includes('--check');
const mismatches = [];
// Keep the entire rounded tile and loop inside the macOS icon safe area. Every
// iconset representation is rendered on its final canvas so alpha padding is
// preserved instead of being added before a later crop/cover resize.
const desktopIconReferenceSize = 1024;
const desktopIconTransparentMargin = 80;

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');

const writeGenerated = async (relativePath, buffer) => {
  const outputPath = path.join(root, relativePath);
  let current;
  try {
    current = await readFile(outputPath);
  } catch {
    current = undefined;
  }

  if (current && sha256(current) === sha256(buffer)) return;
  if (checkOnly) {
    mismatches.push(relativePath);
    return;
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buffer);
  console.log(`generated ${relativePath}`);
};

const renderSquare = async (size) => sharp(source)
  .resize(size, size, { fit: 'cover' })
  .png({ compressionLevel: 9 })
  .toBuffer();

const renderDesktopIcon = async (size, inputSource = source) => {
  const inset = Math.max(1, Math.round(size * desktopIconTransparentMargin / desktopIconReferenceSize));
  const contentSize = size - inset * 2;
  const radius = Math.round(contentSize * 0.1875);
  const mask = Buffer.from(
    `<svg width="${contentSize}" height="${contentSize}" xmlns="http://www.w3.org/2000/svg">`
      + `<rect width="${contentSize}" height="${contentSize}" rx="${radius}" fill="white"/>`
      + '</svg>',
  );

  const content = await sharp(inputSource)
    .resize(contentSize, contentSize, { fit: 'cover' })
    .ensureAlpha()
    .composite([{ input: mask, blend: 'dest-in' }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: content, left: inset, top: inset }])
    .png({ compressionLevel: 9 })
    .toBuffer();
};

const desktopPngTargets = [
  ['packages/electron/resources/icons/icon.png', 1024],
  ['packages/electron/resources/icons/dev-icon.png', 1024],
  ['packages/electron/resources/icons/app-icon.png', 512],
  ['packages/electron/resources/icons/AppIcon.icon/Assets/openloop-app-icon.png', 1024],
];

for (const [relativePath, size] of desktopPngTargets) {
  await writeGenerated(relativePath, await renderDesktopIcon(size));
}

await writeGenerated(
  'packages/electron/resources/icons/dock-icon-ice.png',
  await renderDesktopIcon(1024, source),
);
await writeGenerated(
  'packages/electron/resources/icons/dock-icon-black.png',
  await renderDesktopIcon(1024, blackSource),
);

const pngTargets = [
  ['packages/vscode/assets/app-icon.png', 512],
  ['packages/mobile/assets/icon-only.png', 1024],
  ['packages/mobile/assets/icon-foreground.png', 1024],
  ['packages/mobile/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png', 1024],
  ['packages/web/public/apple-touch-icon-120x120.png', 120],
  ['packages/web/public/apple-touch-icon-152x152.png', 152],
  ['packages/web/public/apple-touch-icon-167x167.png', 167],
  ['packages/web/public/apple-touch-icon-180x180.png', 180],
  ['packages/web/public/apple-touch-icon.png', 180],
  ['packages/web/public/favicon-16.png', 16],
  ['packages/web/public/favicon-32.png', 32],
  ['packages/web/public/favicon.png', 64],
  ['packages/web/public/logo-dark-192x192.png', 192],
  ['packages/web/public/logo-light-192x192.png', 192],
  ['packages/web/public/pwa-192.png', 192],
  ['packages/web/public/pwa-512.png', 512],
  ['packages/web/public/pwa-maskable-192.png', 192],
  ['packages/web/public/pwa-maskable-512.png', 512],
];

for (const [relativePath, size] of pngTargets) {
  await writeGenerated(relativePath, await renderSquare(size));
}

await writeGenerated(
  'packages/mobile/assets/icon-background.png',
  await sharp({ create: { width: 1024, height: 1024, channels: 3, background: '#f8fafc' } })
    .png({ compressionLevel: 9 })
    .toBuffer(),
);

const androidSizes = new Map([
  ['ldpi', 36],
  ['mdpi', 48],
  ['hdpi', 72],
  ['xhdpi', 96],
  ['xxhdpi', 144],
  ['xxxhdpi', 192],
]);

for (const [density, size] of androidSizes) {
  const icon = await renderSquare(size);
  const background = await sharp({ create: { width: size, height: size, channels: 3, background: '#f8fafc' } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  const directory = `packages/mobile/android/app/src/main/res/mipmap-${density}`;
  for (const name of ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png']) {
    await writeGenerated(`${directory}/${name}`, icon);
  }
  await writeGenerated(`${directory}/ic_launcher_background.png`, background);
}

const splashTargets = [
  ['packages/mobile/android/app/src/main/res/drawable/splash.png', 480, 320],
  ['packages/mobile/android/app/src/main/res/drawable-land-mdpi/splash.png', 480, 320],
  ['packages/mobile/android/app/src/main/res/drawable-land-hdpi/splash.png', 800, 480],
  ['packages/mobile/android/app/src/main/res/drawable-land-xhdpi/splash.png', 1280, 720],
  ['packages/mobile/android/app/src/main/res/drawable-land-xxhdpi/splash.png', 1600, 960],
  ['packages/mobile/android/app/src/main/res/drawable-land-xxxhdpi/splash.png', 1920, 1280],
  ['packages/mobile/android/app/src/main/res/drawable-port-mdpi/splash.png', 320, 480],
  ['packages/mobile/android/app/src/main/res/drawable-port-hdpi/splash.png', 480, 800],
  ['packages/mobile/android/app/src/main/res/drawable-port-xhdpi/splash.png', 720, 1280],
  ['packages/mobile/android/app/src/main/res/drawable-port-xxhdpi/splash.png', 960, 1600],
  ['packages/mobile/android/app/src/main/res/drawable-port-xxxhdpi/splash.png', 1280, 1920],
  ['packages/mobile/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732.png', 2732, 2732],
  ['packages/mobile/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-1.png', 2732, 2732],
  ['packages/mobile/ios/App/App/Assets.xcassets/Splash.imageset/splash-2732x2732-2.png', 2732, 2732],
];

for (const [relativePath, width, height] of splashTargets) {
  const iconSize = Math.round(Math.min(width, height) * 0.28);
  const icon = await sharp(source).resize(iconSize, iconSize).png().toBuffer();
  const splash = await sharp({ create: { width, height, channels: 3, background: '#f8fafc' } })
    .composite([{ input: icon, gravity: 'centre' }])
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeGenerated(relativePath, splash);
}

if (process.platform === 'darwin') {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'openloop-brand-'));
  try {
    const iconset = path.join(temporaryDirectory, 'OpenLoop.iconset');
    await mkdir(iconset, { recursive: true });
    const iconsetSizes = [16, 32, 128, 256, 512];
    for (const size of iconsetSizes) {
      await writeFile(path.join(iconset, `icon_${size}x${size}.png`), await renderDesktopIcon(size));
      await writeFile(path.join(iconset, `icon_${size}x${size}@2x.png`), await renderDesktopIcon(size * 2));
    }

    const icnsPath = path.join(temporaryDirectory, 'OpenLoop.icns');
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', icnsPath]);
    const icns = await readFile(icnsPath);
    await writeGenerated('packages/electron/resources/icons/icon.icns', icns);
    await writeGenerated('packages/electron/resources/icons/dev-icon.icns', icns);

    const icoSource = path.join(temporaryDirectory, 'OpenLoop-256.png');
    const icoPath = path.join(temporaryDirectory, 'OpenLoop.ico');
    await writeFile(icoSource, await renderDesktopIcon(256));
    execFileSync('sips', ['-s', 'format', 'ico', icoSource, '--out', icoPath], { stdio: 'ignore' });
    await writeGenerated('packages/electron/resources/icons/icon.ico', await readFile(icoPath));
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
} else {
  console.warn('Skipping macOS .icns/.ico generation outside macOS.');
}

if (mismatches.length > 0) {
  console.error(`OpenLoop brand assets are stale:\n${mismatches.map((item) => `- ${item}`).join('\n')}`);
  process.exitCode = 1;
} else if (checkOnly) {
  console.log('OpenLoop brand assets are up to date.');
}
