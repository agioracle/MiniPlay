import { app, BrowserWindow, nativeImage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { registerEchoHandler } from './ipc/echo';
import { registerHydrationHandlers } from './ipc/hydration';
import { registerConfigHandlers } from './ipc/config';
import { registerAgentHandlers } from './ipc/agent';
import { registerProjectHandlers } from './ipc/project';
import { registerCoderHandlers } from './ipc/coder';
import { registerPreviewHandlers } from './ipc/preview';
import { registerGitHandlers } from './ipc/git';
import { registerExportHandlers } from './ipc/export';
import { registerAssetsHandlers } from './ipc/assets';
import { ensureMiniPlayHome } from './storage/paths';
import { teardownPreview } from './process/preview-bridge';
import { coderSessionManager } from './coder/session-manager';
import { initHydrationPath, isHydrationComplete } from './hydration/index';
import { runEnvDetection } from './hydration/env-cache';
import { checkAndUpdatePhaserWx, type UpdateProgress } from './hydration/update-phaser-wx';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;
const APP_NAME = 'MiniPlay';
const APP_VERSION = require('../package.json').version;

// Set app name for macOS menu bar
app.setName(APP_NAME);

function createWindow() {
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png');

  // Set About panel options — use nativeImage for icon on macOS
  const aboutOptions: Electron.AboutPanelOptionsOptions = {
    applicationName: APP_NAME,
    applicationVersion: APP_VERSION,
    version: '',
    copyright: 'AI-powered WeChat Mini-Game Generator\nImagine · Create · Play · Earn',
  };
  if (fs.existsSync(iconPath)) {
    aboutOptions.iconPath = iconPath;
  }
  app.setAboutPanelOptions(aboutOptions);

  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: APP_NAME,
    icon: iconPath,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#F5EDE3',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  if (isDev) {
    const port = process.env.PORT || '3000';
    mainWindow.loadURL(`http://localhost:${port}`);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'out', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// Initialize storage and PATH
ensureMiniPlayHome();
initHydrationPath();

// Detect environment (node, phaser-wx, coder agents) and cache results
runEnvDetection();

// Register IPC handlers
registerEchoHandler();
registerHydrationHandlers();
registerConfigHandlers();
registerAgentHandlers();
registerProjectHandlers();
registerCoderHandlers();
registerPreviewHandlers();
registerGitHandlers();
registerExportHandlers();
registerAssetsHandlers();

app.whenReady().then(() => {
  createWindow();
  // Kick off a non-blocking background update check for the phaser-wx
  // toolchain. First launch (no local checkout) and offline mode are both
  // silently skipped; any failure rolls back to the previous version.
  scheduleToolchainUpdateCheck();
});

/**
 * Background-check GitHub for updates to the phaser-wx toolchain.
 *
 * - Skipped on first launch (no local clone yet — setup wizard handles it).
 * - Skipped when offline / GitHub unreachable.
 * - On success: refreshes the env-detection cache and notifies the renderer.
 * - On failure: rolls back to the previous commit; the app keeps running
 *   against the cached toolchain that was detected at startup.
 */
function scheduleToolchainUpdateCheck(): void {
  // Nothing to update until first-launch hydration has produced a checkout.
  if (!isHydrationComplete()) return;

  // Delay briefly so the renderer can attach its listener and the splash
  // screen isn't competing with a git/pnpm burst.
  setTimeout(() => {
    const broadcast = (progress: UpdateProgress) => {
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('phaser-wx:update-progress', progress);
        } catch {
          /* window destroyed */
        }
      }
      console.log(
        '[phaser-wx-update] %s%s',
        progress.status,
        progress.detail ? ` — ${progress.detail}` : '',
      );
    };

    checkAndUpdatePhaserWx(broadcast)
      .then((status) => {
        if (status === 'updated') {
          // Refresh the cached env-status so `env:status` IPC returns the
          // new version string going forward.
          try { runEnvDetection(); } catch { /* non-fatal */ }
        }
      })
      .catch((err) => {
        // checkAndUpdatePhaserWx already swallows errors, but guard anyway.
        console.warn('[phaser-wx-update] Unexpected error:', err?.message || err);
      });
  }, 1500);
}

app.on('window-all-closed', () => {
  teardownPreview();
  // Kill every background Coder child process so we don't leak long-running
  // agent sessions after the UI closes.
  coderSessionManager.killAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Final-fallback cleanup in case the app exits without going through
// `window-all-closed` (e.g. hard `app.quit()` from a menu action or a
// forced SIGTERM from the OS).
app.on('before-quit', () => {
  coderSessionManager.killAll();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
