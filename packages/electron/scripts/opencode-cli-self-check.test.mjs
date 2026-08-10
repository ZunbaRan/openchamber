import assert from 'node:assert/strict';
import test from 'node:test';
import { validateGenerativeWidgetManifest } from './opencode-cli-self-check.mjs';

const digest = 'a'.repeat(64);

test('accepts the OpenCode Generative Widget asset manifest', () => {
  const manifest = {
    schema: 'com.openchamber.generative-widget-assets.v1',
    promptSha256: digest,
    skill: 'generative-widget-guidelines',
    skillSha256: digest,
  };

  assert.equal(validateGenerativeWidgetManifest(manifest), manifest);
});

test('rejects incomplete or unrelated OpenCode asset manifests', () => {
  assert.throws(
    () =>
      validateGenerativeWidgetManifest({
        schema: 'other',
        promptSha256: digest,
        skillSha256: digest,
      }),
    /unsupported Generative Widget asset schema/,
  );
  assert.throws(
    () =>
      validateGenerativeWidgetManifest({
        schema: 'com.openchamber.generative-widget-assets.v1',
        promptSha256: 'short',
        skill: 'generative-widget-guidelines',
        skillSha256: digest,
      }),
    /invalid Generative Widget asset digests/,
  );
});
