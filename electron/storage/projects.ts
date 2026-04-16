import * as fs from 'fs';
import { PROJECTS_INDEX_PATH, ensureMiniPlayHome } from './paths';

export interface ProjectEntry {
  name: string;
  path: string;
  template: string;
  lastOpened: string;
  versionCount: number;
  thumbnail: string | null;
}

export interface ProjectsIndex {
  projects: ProjectEntry[];
}

export function readProjectsIndex(): ProjectsIndex {
  ensureMiniPlayHome();
  if (!fs.existsSync(PROJECTS_INDEX_PATH)) {
    const empty: ProjectsIndex = { projects: [] };
    writeProjectsIndex(empty);
    return empty;
  }
  try {
    const raw = fs.readFileSync(PROJECTS_INDEX_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { projects: [] };
  }
}

export function writeProjectsIndex(index: ProjectsIndex): void {
  ensureMiniPlayHome();
  fs.writeFileSync(PROJECTS_INDEX_PATH, JSON.stringify(index, null, 2), 'utf-8');
}

export function addProject(entry: ProjectEntry): void {
  const index = readProjectsIndex();
  // Remove existing entry with same path if any
  index.projects = index.projects.filter(p => p.path !== entry.path);
  index.projects.unshift(entry);
  writeProjectsIndex(index);
}

/**
 * Remove a project from the index and delete its directory from disk.
 */
export function removeProject(projectPath: string): void {
  // Remove from index
  const index = readProjectsIndex();
  index.projects = index.projects.filter(p => p.path !== projectPath);
  writeProjectsIndex(index);

  // Delete project directory
  if (fs.existsSync(projectPath)) {
    fs.rmSync(projectPath, { recursive: true, force: true });
  }
}
