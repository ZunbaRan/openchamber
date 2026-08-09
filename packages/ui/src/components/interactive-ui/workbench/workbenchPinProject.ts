/**
 * Pure project-resolution logic for the Workbench pin button.
 *
 * Kept outside the component module so the component file only exports the
 * component (fast-refresh contract) while the resolution rules stay fully
 * unit-testable.
 */

type PinProject = { id: string; path: string };

const normalizeProjectDirectory = (value: string | undefined): string => {
  const normalized = (value ?? '').trim().replace(/\\/g, '/');
  if (!normalized || normalized === '/') return normalized;
  return normalized.replace(/\/+$/, '');
};

export const resolveWorkbenchPinProject = (
  projects: PinProject[],
  activeProjectId: string | null,
  projectDirectory?: string,
): PinProject | null => {
  const requestedDirectory = normalizeProjectDirectory(projectDirectory);
  if (requestedDirectory) {
    const directoryProject = projects
      .filter((project) => {
        const projectPath = normalizeProjectDirectory(project.path);
        return Boolean(projectPath) && (
          projectPath === requestedDirectory
          || requestedDirectory.startsWith(`${projectPath}/`)
        );
      })
      .sort((left, right) => (
        normalizeProjectDirectory(right.path).length
        - normalizeProjectDirectory(left.path).length
      ))[0];
    if (directoryProject) return directoryProject;
    // An authoritative message directory must never silently pin into an
    // unrelated active project. The caller can register that project or show
    // the existing no-project diagnostic instead of corrupting another board.
    return null;
  }
  return projects.find((project) => project.id === activeProjectId)
    ?? projects[0]
    ?? null;
};
