import * as fs from 'fs';
import * as path from 'path';
import { execSync } from 'child_process';
import { PROJECTS_DIR, TOOLCHAIN_DIR, ensureDir } from '../storage/paths';

export interface ScaffoldOptions {
  name: string;
  appid?: string;
  orientation?: 'landscape' | 'portrait';
  cdn?: string;
}

/**
 * Copy filter — excludes node_modules, dist-wx, .DS_Store, package-lock.json
 */
function copyFilter(src: string): boolean {
  const basename = path.basename(src);
  return !['node_modules', 'dist-wx', 'dist-h5', '.DS_Store', 'package-lock.json'].includes(basename);
}

/**
 * Recursively rewrite `remote-assets/` → `assets/` in JS files
 */
function rewriteRemoteAssetPaths(dir: string): void {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rewriteRemoteAssetPaths(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const updated = content.replace(/remote-assets\//g, 'assets/');
      if (updated !== content) {
        fs.writeFileSync(fullPath, updated);
      }
    }
  }
}

/**
 * Find the example-portrait template directory.
 * Looks in the managed toolchain dir first, then the sibling workspace.
 */
function findTemplateDir(orientation: string): string {
  const templateName = orientation === 'landscape' ? 'example-landscape' : 'example-portrait';

  // Check managed toolchain
  const managedDir = path.join(TOOLCHAIN_DIR, 'phaserjs-webgl-transform', templateName);
  if (fs.existsSync(managedDir)) return managedDir;

  // Check sibling workspace (development mode)
  const workspaceDir = path.resolve(__dirname, '..', '..', '..', 'phaserjs-webgl-transform', templateName);
  if (fs.existsSync(workspaceDir)) return workspaceDir;

  throw new Error(`Template directory not found for "${templateName}". Run Auto-Hydration first.`);
}

/**
 * Non-interactive project scaffold — equivalent to `phaser-wx new`
 * but accepts parameters directly (no inquirer prompts).
 *
 * Returns the created project path.
 */
export function scaffoldProject(options: ScaffoldOptions): string {
  const {
    name,
    appid = 'wx0000000000000000',
    orientation = 'portrait',
    cdn = '',
  } = options;

  const targetDir = path.join(PROJECTS_DIR, name);

  // Guard: directory already exists
  if (fs.existsSync(targetDir)) {
    throw new Error(`Project directory already exists: ${targetDir}`);
  }

  // Find template
  const templateDir = findTemplateDir(orientation);

  // Copy template to target
  fs.cpSync(templateDir, targetDir, { recursive: true, filter: copyFilter });

  // Customize package.json
  const pkgPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    pkg.name = name;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  }

  // Customize phaser-wx.config.json
  const configPath = path.join(targetDir, 'phaser-wx.config.json');
  if (fs.existsSync(configPath)) {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.appid = appid;
    config.orientation = orientation;
    config.cdn = cdn;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  }

  // Customize README.md
  const readmePath = path.join(targetDir, 'README.md');
  if (fs.existsSync(readmePath)) {
    const content = fs.readFileSync(readmePath, 'utf-8');
    fs.writeFileSync(readmePath, content.replace(/^# .+/, `# ${name}`));
  }

  // If no CDN, move remote-assets to assets for local dev
  if (!cdn) {
    const remoteAssetsDir = path.join(targetDir, 'public', 'remote-assets');
    const assetsDir = path.join(targetDir, 'public', 'assets');
    if (fs.existsSync(remoteAssetsDir)) {
      for (const subDir of fs.readdirSync(remoteAssetsDir, { withFileTypes: true })) {
        if (!subDir.isDirectory()) continue;
        const srcSub = path.join(remoteAssetsDir, subDir.name);
        const destSub = path.join(assetsDir, subDir.name);
        fs.mkdirSync(destSub, { recursive: true });
        for (const file of fs.readdirSync(srcSub, { withFileTypes: true })) {
          if (!file.isFile() || file.name === '.gitkeep') continue;
          fs.copyFileSync(path.join(srcSub, file.name), path.join(destSub, file.name));
          fs.unlinkSync(path.join(srcSub, file.name));
        }
      }
    }
    rewriteRemoteAssetPaths(path.join(targetDir, 'src'));
  }

  // Create .miniplay metadata directory
  const miniplayDir = path.join(targetDir, '.miniplay');
  ensureDir(miniplayDir);
  fs.writeFileSync(path.join(miniplayDir, 'conversations.jsonl'), '', 'utf-8');
  fs.writeFileSync(
    path.join(miniplayDir, 'versions.json'),
    JSON.stringify({ versions: [] }, null, 2),
    'utf-8'
  );

  // Create docs directory for GDD
  ensureDir(path.join(targetDir, 'docs'));

  // Install npm dependencies (must succeed — phaser-wx build needs node_modules/phaser)
  const MAX_INSTALL_RETRIES = 2;
  for (let attempt = 1; attempt <= MAX_INSTALL_RETRIES; attempt++) {
    try {
      execSync('npm install', {
        cwd: targetDir,
        timeout: 180000,
        stdio: 'pipe',
        env: { ...process.env },
      });
      break; // success
    } catch (err: any) {
      console.error(`npm install attempt ${attempt}/${MAX_INSTALL_RETRIES} failed:`, err.message);
      if (attempt === MAX_INSTALL_RETRIES) {
        throw new Error(
          `npm install failed after ${MAX_INSTALL_RETRIES} attempts. ` +
          `Please check your network and run "npm install" manually in ${targetDir}.\n` +
          (err.stderr || err.message),
        );
      }
    }
  }

  // Git init + initial commit
  try {
    execSync('git init && git add -A && git commit -m "v0: Initial scaffold"', {
      cwd: targetDir,
      timeout: 15000,
      stdio: 'pipe',
      env: { ...process.env },
    });
  } catch (err) {
    console.error('Warning: git init failed:', err);
  }

  return targetDir;
}
