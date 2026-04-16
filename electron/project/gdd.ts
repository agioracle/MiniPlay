import * as fs from 'fs';
import * as path from 'path';

/**
 * GDD file I/O utilities.
 * The GDD lives at {projectPath}/docs/GDD.md
 */

export function getGddPath(projectPath: string): string {
  return path.join(projectPath, 'docs', 'GDD.md');
}

/**
 * Read the current GDD content. Returns empty string if not exists.
 */
export function readGdd(projectPath: string): string {
  const gddPath = getGddPath(projectPath);
  if (!fs.existsSync(gddPath)) return '';
  return fs.readFileSync(gddPath, 'utf-8');
}

/**
 * Write the full GDD content (used for initial creation).
 */
export function writeGdd(projectPath: string, content: string): void {
  const gddPath = getGddPath(projectPath);
  fs.mkdirSync(path.dirname(gddPath), { recursive: true });
  fs.writeFileSync(gddPath, content, 'utf-8');
}

/**
 * Update a specific section of the GDD.
 * If the section exists, replace it. If not, append before Latest Patch.
 */
export function updateGddSection(
  projectPath: string,
  section: string,
  content: string,
): void {
  const current = readGdd(projectPath);

  if (!current) {
    // No GDD exists — write as new
    writeGdd(projectPath, content);
    return;
  }

  if (section === 'full') {
    writeGdd(projectPath, content);
    return;
  }

  if (section === 'Latest Patch') {
    // Append to Latest Patch section
    const patchHeader = '## Latest Patch';
    if (current.includes(patchHeader)) {
      const updated = current + '\n' + content + '\n';
      writeGdd(projectPath, updated);
    } else {
      writeGdd(projectPath, current + '\n\n' + patchHeader + '\n' + content + '\n');
    }
    return;
  }

  // Replace existing section
  const sectionHeader = `## ${section}`;
  const regex = new RegExp(
    `(${escapeRegex(sectionHeader)}\\n)([\\s\\S]*?)(?=\\n## |$)`,
  );

  if (regex.test(current)) {
    const updated = current.replace(regex, `$1${content}\n`);
    writeGdd(projectPath, updated);
  } else {
    // Section doesn't exist — insert before Latest Patch or at end
    const patchIdx = current.indexOf('## Latest Patch');
    if (patchIdx > 0) {
      const before = current.substring(0, patchIdx);
      const after = current.substring(patchIdx);
      writeGdd(projectPath, `${before}\n${sectionHeader}\n${content}\n\n${after}`);
    } else {
      writeGdd(projectPath, `${current}\n\n${sectionHeader}\n${content}\n`);
    }
  }
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
