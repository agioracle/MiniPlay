import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';

/**
 * Zip the dist-wx/ directory into a .zip file.
 * Returns the path to the created zip.
 */
export function zipDistWx(projectPath: string, outputName?: string): {
  success: boolean;
  zipPath?: string;
  size?: number;
  error?: string;
} {
  const distWxDir = path.join(projectPath, 'dist-wx');
  if (!fs.existsSync(distWxDir)) {
    return { success: false, error: 'dist-wx/ directory not found. Run build first.' };
  }

  const name = outputName || path.basename(projectPath);
  const zipPath = path.join(projectPath, `${name}-wx.zip`);

  try {
    // Remove existing zip if present
    if (fs.existsSync(zipPath)) {
      fs.unlinkSync(zipPath);
    }

    // Use system zip command
    execSync(`cd "${distWxDir}" && zip -r "${zipPath}" .`, {
      timeout: 30000,
      stdio: 'pipe',
    });

    const stats = fs.statSync(zipPath);

    return {
      success: true,
      zipPath,
      size: stats.size,
    };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
