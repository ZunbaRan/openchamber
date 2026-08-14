import assert from 'node:assert/strict';
import test from 'node:test';

import {
  evaluateLaunchpadEligibility,
  parseCodeSigningIdentity,
} from './macos-launchpad-eligibility.mjs';

const validInput = (overrides = {}) => ({
  info: {
    CFBundleIdentifier: 'dev.openchamber.desktop',
    CFBundleDisplayName: 'OpenLoop',
    CFBundleName: 'OpenLoop',
    CFBundlePackageType: 'APPL',
    CFBundleExecutable: 'OpenLoop',
    CFBundleIconFile: 'icon.icns',
  },
  expectedAppId: 'dev.openchamber.desktop',
  expectedProductName: 'OpenLoop',
  executableExists: true,
  executableIsExecutable: true,
  legacyIconExists: true,
  metadataContentType: 'com.apple.application-bundle',
  ...overrides,
});

test('accepts a foreground APPL bundle with executable and an icns icon', () => {
  assert.deepEqual(evaluateLaunchpadEligibility(validInput()), []);
});

test('rejects background-only and UI-element bundles', () => {
  const hidden = evaluateLaunchpadEligibility(validInput({
    info: {
      ...validInput().info,
      LSUIElement: true,
      LSBackgroundOnly: true,
    },
  }));

  assert(hidden.includes('LSUIElement must not be true'));
  assert(hidden.includes('LSBackgroundOnly must not be true'));
});

test('rejects identity, package type, executable, icon, and metadata drift', () => {
  const failures = evaluateLaunchpadEligibility(validInput({
    info: {
      ...validInput().info,
      CFBundleIdentifier: 'dev.openchamber.wrong',
      CFBundleDisplayName: 'Wrong Name',
      CFBundlePackageType: 'BNDL',
      CFBundleExecutable: '',
      CFBundleIconFile: '',
    },
    executableExists: false,
    executableIsExecutable: false,
    legacyIconExists: false,
    metadataContentType: 'public.folder',
  }));

  assert(failures.some((failure) => failure.includes('CFBundleIdentifier')));
  assert(failures.some((failure) => failure.includes('display name')));
  assert(failures.some((failure) => failure.includes('CFBundlePackageType')));
  assert(failures.some((failure) => failure.includes('CFBundleExecutable')));
  assert(failures.some((failure) => failure.includes('executable is missing')));
  assert(failures.some((failure) => failure.includes('icon.icns')));
  assert(failures.some((failure) => failure.includes('Spotlight content type')));
});

test('classifies Developer ID and ad-hoc signatures without treating ad-hoc as unsigned', () => {
  assert.deepEqual(parseCodeSigningIdentity(`Authority=Developer ID Application: Example (TEAM123)\nTeamIdentifier=TEAM123\n`), {
    kind: 'developer-id',
    teamIdentifier: 'TEAM123',
  });
  assert.deepEqual(parseCodeSigningIdentity('Signature=adhoc\nTeamIdentifier=not set\n'), {
    kind: 'ad-hoc',
    teamIdentifier: null,
  });
  assert.deepEqual(parseCodeSigningIdentity('code object is not signed at all'), {
    kind: 'unsigned',
    teamIdentifier: null,
  });
});
