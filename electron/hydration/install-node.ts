import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { MANAGED_NODE_DIR, ensureDir } from '../storage/paths';

const NODE_VERSION = '22.15.0';

function getNodeDownloadUrl(): { url: string; isZip: boolean } {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64';

  if (process.platform === 'win32') {
    return {
      url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-${arch}.zip`,
      isZip: true,
    };
  }

  const platform = process.platform === 'darwin' ? 'darwin' : 'linux';
  return {
    url: `https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-${platform}-${arch}.tar.gz`,
    isZip: false,
  };
}

function download(url: string, dest: string, onProgress?: (percent: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (res) => {
      // Follow redirects
      if (res.statusCode === 301 || res.statusCode === 302) {
        const redirectUrl = res.headers.location;
        if (!redirectUrl) {
          reject(new Error('Redirect without Location header'));
          return;
        }
        download(redirectUrl, dest, onProgress).then(resolve, reject);
        return;
      }

      if (res.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
        return;
      }

      const totalBytes = parseInt(res.headers['content-length'] || '0', 10);
      let downloadedBytes = 0;

      const file = fs.createWriteStream(dest);
      res.on('data', (chunk: Buffer) => {
        downloadedBytes += chunk.length;
        if (totalBytes > 0 && onProgress) {
          onProgress(Math.round((downloadedBytes / totalBytes) * 100));
        }
      });
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
      file.on('error', (err) => {
        fs.unlink(dest, () => {}); // cleanup
        reject(err);
      });
    });

    request.on('error', (err) => {
      fs.unlink(dest, () => {}); // cleanup
      reject(err);
    });

    // 60s timeout for the download itself
    request.setTimeout(60000, () => {
      request.destroy();
      fs.unlink(dest, () => {});
      reject(new Error('Download timed out'));
    });
  });
}

/**
 * Download and install Node.js into the managed directory.
 * Returns the path to the installed node binary.
 */
export async function installNode(onProgress?: (detail: string) => void): Promise<string> {
  ensureDir(MANAGED_NODE_DIR);

  const { url, isZip } = getNodeDownloadUrl();
  const ext = isZip ? '.zip' : '.tar.gz';
  const tarball = path.join(os.tmpdir(), `miniplay-node-v${NODE_VERSION}${ext}`);

  onProgress?.(`Downloading Node.js v${NODE_VERSION}...`);

  await download(url, tarball, (percent) => {
    onProgress?.(`Downloading Node.js v${NODE_VERSION}... ${percent}%`);
  });

  onProgress?.('Extracting Node.js...');

  if (isZip) {
    // Windows: use PowerShell to extract
    execSync(
      `powershell -Command "Expand-Archive -Force '${tarball}' '${MANAGED_NODE_DIR}'"`,
      { timeout: 60000, stdio: 'pipe' },
    );
    // Move contents from nested dir to MANAGED_NODE_DIR
    const innerDir = fs.readdirSync(MANAGED_NODE_DIR).find(d => d.startsWith('node-'));
    if (innerDir) {
      const innerPath = path.join(MANAGED_NODE_DIR, innerDir);
      for (const item of fs.readdirSync(innerPath)) {
        fs.renameSync(path.join(innerPath, item), path.join(MANAGED_NODE_DIR, item));
      }
      fs.rmdirSync(innerPath);
    }
  } else {
    // macOS/Linux: tar extract
    execSync(`tar -xzf "${tarball}" -C "${MANAGED_NODE_DIR}" --strip-components=1`, {
      timeout: 60000,
      stdio: 'pipe',
    });
  }

  // Cleanup tarball
  try { fs.unlinkSync(tarball); } catch {}

  const nodeBin = process.platform === 'win32'
    ? path.join(MANAGED_NODE_DIR, 'node.exe')
    : path.join(MANAGED_NODE_DIR, 'bin', 'node');

  if (!fs.existsSync(nodeBin)) {
    throw new Error(`Node.js installation failed — binary not found at ${nodeBin}`);
  }

  onProgress?.(`Node.js v${NODE_VERSION} installed`);
  return nodeBin;
}

/**
 * Get the managed Node.js bin directory (for prepending to PATH).
 */
export function getManagedNodeBinDir(): string | null {
  if (process.platform === 'win32') {
    if (fs.existsSync(path.join(MANAGED_NODE_DIR, 'node.exe'))) {
      return MANAGED_NODE_DIR;
    }
  } else {
    const binDir = path.join(MANAGED_NODE_DIR, 'bin');
    if (fs.existsSync(path.join(binDir, 'node'))) {
      return binDir;
    }
  }
  return null;
}
