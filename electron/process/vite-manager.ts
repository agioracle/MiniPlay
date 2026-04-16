import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as net from 'net';

let viteProcess: ChildProcess | null = null;
let currentPort: number = 5173;
let currentProjectPath: string | null = null;

/**
 * Check if a port is available.
 */
function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close();
      resolve(true);
    });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Find an available port starting from the given port.
 */
async function findAvailablePort(startPort: number): Promise<number> {
  for (let port = startPort; port < startPort + 100; port++) {
    if (await isPortAvailable(port)) return port;
  }
  throw new Error('No available port found');
}

/**
 * Error capture script injected into the preview HTML.
 * Catches runtime errors and unhandled promise rejections,
 * posts them to the parent window (LiveView iframe listener).
 *
 * Only active when running inside an iframe (MiniPlay preview).
 * Has no effect when the game runs standalone in a browser.
 */
const ERROR_CAPTURE_SCRIPT = `<script data-miniplay-preview>
(function() {
  if (window.parent === window) return; // Not in iframe — skip
  window.onerror = function(message, source, line, column, error) {
    try {
      window.parent.postMessage({
        type: 'miniplay:error',
        payload: {
          message: String(message),
          source: source || '',
          line: line || 0,
          stack: error && error.stack ? error.stack : ''
        }
      }, '*');
    } catch(e) {}
  };
  window.addEventListener('unhandledrejection', function(event) {
    try {
      var reason = event.reason;
      var message = reason instanceof Error ? reason.message : String(reason);
      var stack = reason instanceof Error ? reason.stack : '';
      window.parent.postMessage({
        type: 'miniplay:error',
        payload: { message: message, source: '', line: 0, stack: stack || '' }
      }, '*');
    } catch(e) {}
  });
})();
</script>`;

/**
 * Inject the error capture script into dist-h5/index.html.
 * Inserts it as the FIRST script (before game.js) so it catches all errors.
 * Safe to call multiple times — checks if already injected.
 */
function injectErrorCapture(projectPath: string): void {
  const indexPath = path.join(projectPath, 'dist-h5', 'index.html');
  if (!fs.existsSync(indexPath)) return;

  let html = fs.readFileSync(indexPath, 'utf-8');

  // Skip if already injected
  if (html.includes('data-miniplay-preview')) return;

  // Insert before the first <script> tag (so it loads before game code)
  const firstScriptIdx = html.indexOf('<script');
  if (firstScriptIdx >= 0) {
    html = html.slice(0, firstScriptIdx) + ERROR_CAPTURE_SCRIPT + '\n  ' + html.slice(firstScriptIdx);
  } else {
    // No script tag found — append before </body>
    html = html.replace('</body>', ERROR_CAPTURE_SCRIPT + '\n</body>');
  }

  fs.writeFileSync(indexPath, html, 'utf-8');
}

/**
 * Ensure dist-h5/index.html exists for Vite preview.
 * If phaser-wx build doesn't produce one, create a minimal one.
 */
function ensureIndexHtml(projectPath: string): void {
  const distH5 = path.join(projectPath, 'dist-h5');
  const indexPath = path.join(distH5, 'index.html');

  if (!fs.existsSync(distH5)) {
    fs.mkdirSync(distH5, { recursive: true });
  }

  if (!fs.existsSync(indexPath)) {
    // Create minimal index.html that loads the game bundle
    const bundleFiles = fs.existsSync(distH5)
      ? fs.readdirSync(distH5).filter(f => f.endsWith('.js'))
      : [];
    const mainBundle = bundleFiles.find(f => f.includes('game')) || bundleFiles[0] || 'game.js';

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
  <title>MiniPlay Preview</title>
  <style>
    * { margin: 0; padding: 0; }
    body { background: #000; overflow: hidden; }
    canvas { display: block; }
  </style>
</head>
<body>
  <script src="${mainBundle}"></script>
</body>
</html>`;

    fs.writeFileSync(indexPath, html, 'utf-8');
  }
}

/**
 * Remove the injected error capture script from dist-h5/index.html.
 * Called before exporting to ensure clean build output.
 */
export function stripErrorCapture(projectPath: string): void {
  const indexPath = path.join(projectPath, 'dist-h5', 'index.html');
  if (!fs.existsSync(indexPath)) return;

  let html = fs.readFileSync(indexPath, 'utf-8');
  // Remove the injected script block (identified by data attribute)
  html = html.replace(/<script data-miniplay-preview>[\s\S]*?<\/script>\s*/g, '');
  fs.writeFileSync(indexPath, html, 'utf-8');
}

/**
 * Start or restart the Vite preview server for the active project.
 * Serves the dist-h5/ directory.
 *
 * Returns the URL where the preview is available.
 */
export async function startVitePreview(projectPath: string): Promise<string> {
  // Kill existing server if running for a different project or same project (restart)
  await stopVitePreview();

  ensureIndexHtml(projectPath);
  injectErrorCapture(projectPath);

  const port = await findAvailablePort(5173);
  currentPort = port;
  currentProjectPath = projectPath;

  const distH5 = path.join(projectPath, 'dist-h5');

  return new Promise<string>((resolve, reject) => {
    // Use npx serve as a simple static server (more reliable than vite preview
    // since vite preview requires a vite.config.js)
    viteProcess = spawn('npx', ['serve', distH5, '-l', String(port), '-s', '--no-clipboard'], {
      cwd: projectPath,
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const url = `http://localhost:${port}`;
    let resolved = false;

    // Wait for server to be ready
    const checkReady = setInterval(async () => {
      if (resolved) return;
      if (await isPortAvailable(port) === false) {
        // Port is now taken = server started
        clearInterval(checkReady);
        resolved = true;
        resolve(url);
      }
    }, 200);

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!resolved) {
        clearInterval(checkReady);
        resolved = true;
        // Resolve with URL anyway — server might still be starting
        resolve(url);
      }
    }, 10000);

    viteProcess.on('error', (err) => {
      if (!resolved) {
        clearInterval(checkReady);
        resolved = true;
        reject(err);
      }
    });

    viteProcess.on('exit', (code) => {
      if (code !== null && code !== 0 && !resolved) {
        clearInterval(checkReady);
        resolved = true;
        reject(new Error(`Preview server exited with code ${code}`));
      }
      viteProcess = null;
    });
  });
}

/**
 * Stop the current Vite preview server.
 */
export async function stopVitePreview(): Promise<void> {
  if (viteProcess) {
    viteProcess.kill('SIGTERM');
    // Wait briefly for clean shutdown
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (viteProcess) {
          viteProcess.kill('SIGKILL');
        }
        resolve();
      }, 2000);

      if (viteProcess) {
        viteProcess.once('exit', () => {
          clearTimeout(timer);
          resolve();
        });
      } else {
        clearTimeout(timer);
        resolve();
      }
    });
    viteProcess = null;
    currentProjectPath = null;
  }
}

/**
 * Get the current preview URL if the server is running.
 */
export function getPreviewUrl(): string | null {
  if (!viteProcess || !currentProjectPath) return null;
  return `http://localhost:${currentPort}`;
}

/**
 * Get current preview server state.
 */
export function getPreviewState() {
  return {
    running: viteProcess !== null,
    port: currentPort,
    projectPath: currentProjectPath,
    url: getPreviewUrl(),
  };
}

// Cleanup on process exit
process.on('exit', () => {
  if (viteProcess) {
    try { viteProcess.kill('SIGKILL'); } catch {}
  }
});
