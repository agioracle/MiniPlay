/**
 * Simple in-memory state for the currently active project.
 */

let activeProjectPath: string | null = null;

export function getActiveProject(): string | null {
  return activeProjectPath;
}

export function setActiveProject(projectPath: string | null): void {
  activeProjectPath = projectPath;
}
