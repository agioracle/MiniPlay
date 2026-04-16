import { execSync } from 'child_process';
import { getActiveProject } from '../project/state';

export interface WxBuildResult {
  success: boolean;
  duration: number;
  output: string;
  error?: string;
}

/**
 * Run `phaser-wx build` (WeChat target) in the active project.
 * Produces dist-wx/ directory.
 */
export async function runWxBuild(projectPath?: string): Promise<WxBuildResult> {
  const dir = projectPath || getActiveProject();
  if (!dir) {
    return { success: false, duration: 0, output: '', error: 'No active project' };
  }

  const start = Date.now();

  try {
    const output = execSync('npx phaser-wx build', {
      cwd: dir,
      encoding: 'utf-8',
      timeout: 120000,
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
