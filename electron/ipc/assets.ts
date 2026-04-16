import { ipcMain } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { getActiveProject } from '../project/state';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

export interface AssetNode {
  name: string;
  path: string;        // relative to project root, e.g. "public/assets/images/ball.png"
  type: 'file' | 'directory';
  size?: number;       // bytes, files only
  children?: AssetNode[];
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg']);
const AUDIO_EXTS = new Set(['.mp3', '.ogg', '.wav', '.aac']);

type AssetCategory = 'image' | 'audio' | 'other';

function getAssetCategory(filename: string): AssetCategory {
  const ext = path.extname(filename).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (AUDIO_EXTS.has(ext)) return 'audio';
  return 'other';
}

/** Check what category a directory expects based on its path segments */
function getDirCategory(dirPath: string): AssetCategory | null {
  const normalised = dirPath.replace(/\\/g, '/').toLowerCase();
  // Match the deepest relevant segment
  if (/\/images(\/|$)/.test(normalised)) return 'image';
  if (/\/audio(\/|$)/.test(normalised)) return 'audio';
  return null; // generic directory — anything goes
}

/** Validate that a file's category matches the target directory */
function validateCategoryMatch(fileName: string, targetDir: string): string | null {
  const fileCat = getAssetCategory(fileName);
  const dirCat = getDirCategory(targetDir);

  // If directory is category-specific and file doesn't match → error
  if (dirCat === 'image' && fileCat !== 'image') {
    return `Only image files are allowed in images/ directory`;
  }
  if (dirCat === 'audio' && fileCat !== 'audio') {
    return `Only audio files are allowed in audio/ directory`;
  }
  // If file is image/audio but target dir doesn't match
  if (fileCat === 'image' && dirCat !== null && dirCat !== 'image') {
    return `Image files should be placed in images/ directory`;
  }
  if (fileCat === 'audio' && dirCat !== null && dirCat !== 'audio') {
    return `Audio files should be placed in audio/ directory`;
  }
  return null;
}

/** Recursively build an AssetNode tree for a directory */
function buildTree(absDir: string, relDir: string): AssetNode[] {
  if (!fs.existsSync(absDir)) return [];

  const entries = fs.readdirSync(absDir, { withFileTypes: true });
  const nodes: AssetNode[] = [];

  for (const entry of entries) {
    // Skip hidden files/directories
    if (entry.name.startsWith('.')) continue;

    const relPath = path.join(relDir, entry.name).replace(/\\/g, '/');
    const absPath = path.join(absDir, entry.name);

    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'directory',
        children: buildTree(absPath, relPath),
      });
    } else if (entry.isFile()) {
      const stat = fs.statSync(absPath);
      nodes.push({
        name: entry.name,
        path: relPath,
        type: 'file',
        size: stat.size,
      });
    }
  }

  // Sort: directories first, then files, alphabetically
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

/**
 * Read PNG/JPEG/GIF dimensions from a file buffer.
 * Returns { width, height } or null if not parseable.
 */
function getImageDimensions(filePath: string): { width: number; height: number } | null {
  try {
    const buf = fs.readFileSync(filePath);
    return parseDimensionsFromBuffer(buf);
  } catch {
    return null;
  }
}

function parseDimensionsFromBuffer(buf: Buffer): { width: number; height: number } | null {
  // PNG: bytes 16-23 contain width and height as 4-byte big-endian
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  }
  // JPEG: scan for SOF0/SOF2 marker
  if (buf.length > 2 && buf[0] === 0xFF && buf[1] === 0xD8) {
    let offset = 2;
    while (offset < buf.length - 9) {
      if (buf[offset] !== 0xFF) break;
      const marker = buf[offset + 1];
      // SOF0 or SOF2
      if (marker === 0xC0 || marker === 0xC2) {
        return { height: buf.readUInt16BE(offset + 5), width: buf.readUInt16BE(offset + 7) };
      }
      const len = buf.readUInt16BE(offset + 2);
      offset += 2 + len;
    }
  }
  // GIF: bytes 6-9 are width and height as little-endian 16-bit
  if (buf.length > 10 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) {
    return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  IPC Handlers                                                      */
/* ------------------------------------------------------------------ */

export function registerAssetsHandlers() {
  /** List all files under public/ as a tree */
  ipcMain.handle('assets:list', async () => {
    const projectPath = getActiveProject();
    if (!projectPath) return { tree: [], error: 'No active project' };

    const publicDir = path.join(projectPath, 'public');
    if (!fs.existsSync(publicDir)) {
      return { tree: [], error: 'No public/ directory found' };
    }

    const tree = buildTree(publicDir, 'public');
    return { tree };
  });

  /** Move a file to another directory */
  ipcMain.handle('assets:move', async (_event, payload: { src: string; dest: string }) => {
    const projectPath = getActiveProject();
    if (!projectPath) return { success: false, error: 'No active project' };

    const { src, dest } = payload;
    const absSrc = path.join(projectPath, src);
    const absDest = path.join(projectPath, dest);

    if (!fs.existsSync(absSrc)) {
      return { success: false, error: 'Source file not found' };
    }

    // dest should be a directory
    const destDir = fs.existsSync(absDest) && fs.statSync(absDest).isDirectory()
      ? absDest
      : path.dirname(absDest);

    // Validate category match
    const fileName = path.basename(src);
    const destRel = path.relative(projectPath, destDir).replace(/\\/g, '/');
    const validationError = validateCategoryMatch(fileName, destRel);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const destFile = path.join(destDir, fileName);
    if (fs.existsSync(destFile)) {
      return { success: false, error: 'A file with the same name already exists in the target directory' };
    }

    try {
      fs.renameSync(absSrc, destFile);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /** Add a new file to a directory */
  ipcMain.handle('assets:add', async (_event, payload: { dirPath: string; fileName: string; fileBase64: string; fileMimeType: string }) => {
    const projectPath = getActiveProject();
    if (!projectPath) return { success: false, error: 'No active project' };

    const { dirPath, fileName, fileBase64 } = payload;
    const absDir = path.join(projectPath, dirPath);

    if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
      return { success: false, error: 'Target directory not found' };
    }

    // Validate category match
    const validationError = validateCategoryMatch(fileName, dirPath);
    if (validationError) {
      return { success: false, error: validationError };
    }

    const destFile = path.join(absDir, fileName);
    if (fs.existsSync(destFile)) {
      return { success: false, error: 'A file with the same name already exists' };
    }

    try {
      const buffer = Buffer.from(fileBase64, 'base64');
      fs.writeFileSync(destFile, buffer);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /** Replace a file with new content — validates format and image dimensions */
  ipcMain.handle('assets:replace', async (_event, payload: { targetPath: string; newFileBase64: string; newFileName: string; newFileMimeType: string }) => {
    const projectPath = getActiveProject();
    if (!projectPath) return { success: false, error: 'No active project' };

    const { targetPath, newFileBase64, newFileName } = payload;
    const absTarget = path.join(projectPath, targetPath);

    if (!fs.existsSync(absTarget)) {
      return { success: false, error: 'Target file not found' };
    }

    // Validate same extension
    const targetExt = path.extname(targetPath).toLowerCase();
    const newExt = path.extname(newFileName).toLowerCase();
    if (targetExt !== newExt) {
      return { success: false, error: `File format mismatch: expected ${targetExt}, got ${newExt}` };
    }

    const newBuffer = Buffer.from(newFileBase64, 'base64');

    // For images, validate dimensions
    const category = getAssetCategory(targetPath);
    if (category === 'image' && targetExt !== '.svg') {
      const originalDims = getImageDimensions(absTarget);
      const newDims = parseDimensionsFromBuffer(newBuffer);

      if (originalDims && newDims) {
        if (originalDims.width !== newDims.width || originalDims.height !== newDims.height) {
          return {
            success: false,
            error: `Image dimensions mismatch: original is ${originalDims.width}x${originalDims.height}, new file is ${newDims.width}x${newDims.height}`,
          };
        }
      }
    }

    try {
      fs.writeFileSync(absTarget, newBuffer);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });

  /** Delete a file */
  ipcMain.handle('assets:delete', async (_event, payload: { filePath: string }) => {
    const projectPath = getActiveProject();
    if (!projectPath) return { success: false, error: 'No active project' };

    const { filePath } = payload;
    const absFile = path.join(projectPath, filePath);

    if (!fs.existsSync(absFile)) {
      return { success: false, error: 'File not found' };
    }

    try {
      fs.unlinkSync(absFile);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  });
}
