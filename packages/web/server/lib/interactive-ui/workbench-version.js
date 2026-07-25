const SEMVER_MAJOR_PATTERN = /^(?:\^|~|>=)?\s*(\d+)(?:\.\d+){0,2}/;

export const getWorkbenchVersionMajor = (value) => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(SEMVER_MAJOR_PATTERN);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(major) && major >= 0 ? major : null;
};

export const toWorkbenchCompatibleVersion = (version) => {
  const major = getWorkbenchVersionMajor(version);
  if (major === null) return String(version || '').trim();
  return `^${major}.0.0`;
};

export const areWorkbenchVersionRangesCompatible = (left, right) => {
  const leftMajor = getWorkbenchVersionMajor(left);
  const rightMajor = getWorkbenchVersionMajor(right);
  if (leftMajor === null || rightMajor === null) {
    return String(left || '').trim() === String(right || '').trim();
  }
  return leftMajor === rightMajor;
};

export const isWorkbenchVersionCompatible = (compatibleVersion, currentVersion) => (
  areWorkbenchVersionRangesCompatible(compatibleVersion, currentVersion)
);
