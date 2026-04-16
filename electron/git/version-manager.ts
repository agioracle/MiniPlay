import * as fs from 'fs';
import * as path from 'path';
import { ensureDir } from '../storage/paths';

export interface VersionEntry {
  version: string;
  commitHash: string;
  summary: string;
  gddSectionsChanged: string[];
  filesChanged: string[];
  triggerMessageId: string | null;
  ts: string;
}

export interface VersionsIndex {
  versions: VersionEntry[];
}

function getVersionsPath(projectPath: string): string {
  return path.join(projectPath, '.miniplay', 'versions.json');
}

/**
 * Read the versions index for a project.
 */
export function readVersions(projectPath: string): VersionsIndex {
  const filePath = getVersionsPath(projectPath);
  if (!fs.existsSync(filePath)) return { versions: [] };
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  } catch {
    return { versions: [] };
  }
}

/**
 * Append a new version entry.
 */
export function addVersion(projectPath: string, entry: VersionEntry): void {
  const index = readVersions(projectPath);
  index.versions.push(entry);

  const filePath = getVersionsPath(projectPath);
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(index, null, 2), 'utf-8');
}

/**
 * Get the next version label (v1, v2, v3...).
 */
export function getNextVersionLabel(projectPath: string): string {
  const index = readVersions(projectPath);
  return `v${index.versions.length + 1}`;
}
