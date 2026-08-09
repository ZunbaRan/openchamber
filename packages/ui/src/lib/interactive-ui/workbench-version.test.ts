import { describe, expect, test } from 'bun:test';
import { getWorkbenchVersionMajor, isWorkbenchVersionCompatible } from './workbench-version';

describe('Workbench version compatibility', () => {
  test('keeps tiles across compatible patch/minor upgrades', () => {
    expect(getWorkbenchVersionMajor('^1.2.0')).toBe(1);
    expect(isWorkbenchVersionCompatible('^1.0.0', '1.8.4')).toBe(true);
  });

  test('requires migration for major or opaque contract changes', () => {
    expect(isWorkbenchVersionCompatible('^1.0.0', '2.0.0')).toBe(false);
    expect(isWorkbenchVersionCompatible('contract-a', 'contract-b')).toBe(false);
    expect(isWorkbenchVersionCompatible('contract-a', 'contract-a')).toBe(true);
  });
});
