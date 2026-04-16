import { app, BrowserWindow } from 'electron';
import * as path from 'path';
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
import { initHydrationPath } from './hydration/index';
import { runEnvDetection } from './hydration/env-cache';

let mainWindow: BrowserWindow | null = null;

const isDev = !app.isPackaged;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 680,
    title: 'MiniPlay',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#f8fafc',
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

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  teardownPreview();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
