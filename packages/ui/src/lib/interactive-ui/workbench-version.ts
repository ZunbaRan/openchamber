const SEMVER_MAJOR_PATTERN = /^(?:\^|~|>=)?\s*(\d+)(?:\.\d+){0,2}/;

export const getWorkbenchVersionMajor = (value: string): number | null => {
  const match = value.trim().match(SEMVER_MAJOR_PATTERN);
  if (!match) return null;
  const major = Number.parseInt(match[1], 10);
  return Number.isSafeInteger(major) && major >= 0 ? major : null;
};

export const isWorkbenchVersionCompatible = (
  compatibleVersion: string,
  currentVersion: string,
): boolean => {
  const compatibleMajor = getWorkbenchVersionMajor(compatibleVersion);
  const currentMajor = getWorkbenchVersionMajor(currentVersion);
  if (compatibleMajor === null || currentMajor === null) {
    return compatibleVersion.trim() === currentVersion.trim();
  }
  return compatibleMajor === currentMajor;
};
