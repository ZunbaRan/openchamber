export const resolveMessageProjectDirectory = (info: unknown): string | undefined => {
  if (!info || typeof info !== 'object') return undefined;
  const path = (info as { path?: unknown }).path;
  if (!path || typeof path !== 'object') return undefined;
  const { cwd, root } = path as { cwd?: unknown; root?: unknown };
  const normalizedRoot = typeof root === 'string' ? root.trim() : '';
  if (normalizedRoot && normalizedRoot !== '/') return normalizedRoot;
  return typeof cwd === 'string' && cwd.trim().length > 0 ? cwd : undefined;
};
