import { describe, expect, test } from 'bun:test';
import {
  areWorkbenchVersionRangesCompatible,
  getWorkbenchVersionMajor,
  isWorkbenchVersionCompatible,
  toWorkbenchCompatibleVersion,
} from './workbench-version.js';

describe('Extension Workbench compatible versions', () => {
  test('stores a stable major-compatible range across patch and minor releases', () => {
    expect(toWorkbenchCompatibleVersion('1.2.3')).toBe('^1.0.0');
    expect(toWorkbenchCompatibleVersion('0.9.4')).toBe('^0.0.0');
    expect(areWorkbenchVersionRangesCompatible('^1.2.0', '^1.0.0')).toBe(true);
    expect(isWorkbenchVersionCompatible('^1.0.0', '1.9.8')).toBe(true);
  });

  test('requires migration across major versions or opaque incompatible labels', () => {
    expect(getWorkbenchVersionMajor('^2.0.0')).toBe(2);
    expect(isWorkbenchVersionCompatible('^1.0.0', '2.0.0')).toBe(false);
    expect(areWorkbenchVersionRangesCompatible('contract-a', 'contract-b')).toBe(false);
    expect(areWorkbenchVersionRangesCompatible('contract-a', 'contract-a')).toBe(true);
  });
});
