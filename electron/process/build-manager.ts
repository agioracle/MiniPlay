import { execSync } from 'child_process';
import { getActiveProject } from '../project/state';

export interface BuildResult {
  success: boolean;
  duration: number;
  output: string;
  error?: string;
}

/**
 * Run `phaser-wx build --target h5` in the active project directory.
 * Produces dist-h5/ with the H5 preview build.
 */
export async function runH5Build(projectPath?: string): Promise<BuildResult> {
  const dir = projectPath || getActiveProject();
  if (!dir) {
    return { success: false, duration: 0, output: '', error: 'No active project' };
  }

  const start = Date.now();

  try {
    const output = execSync('npx phaser-wx build --target h5', {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 60000,
      stdio: 'pipe',
      env: { ...process.env },
    });

    return {
      success: true,
      duration: Date.now() - start,
      output,
    };
  } catch (err: any) {
    return {
      success: false,
      duration: Date.now() - start,
      output: err.stdout || '',
      error: err.stderr || err.message,
    };
  }
}
