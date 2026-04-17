import { ipcMain, BrowserWindow } from 'electron';
import { refreshPreview, teardownPreview } from '../process/preview-bridge';
import { getPreviewState } from '../process/vite-manager';
import { parseRuntimeError, type ParsedError } from '../process/error-parser';
import { selfHeal } from '../process/self-heal';
import { getActiveProject } from '../project/state';

/**
 * Error batching — collect runtime errors over a short window
 * then trigger a single selfHeal with all of them.
 */
let pendingErrors: ParsedError[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
let healingInProgress = false;
const BATCH_WINDOW_MS = 2000;

async function flushErrors(win?: BrowserWindow) {
  if (pendingErrors.length === 0) return;
  if (healingInProgress) return; // selfHeal is serial; wait for current to finish

  const projectPath = getActiveProject();
  if (!projectPath) {
    pendingErrors = [];
    return;
  }

  // Deduplicate by message
  const seen = new Set<string>();
  const unique: ParsedError[] = [];
  for (const err of pendingErrors) {
    const key = `${err.message}:${err.file || ''}:${err.line || ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(err);
    }
  }
  pendingErrors = [];

  console.log('[Preview] Flushing %d batched errors (%d unique) to selfHeal', seen.size, unique.length);

  healingInProgress = true;
  try {
    await selfHeal({
      errors: unique,
      projectPath,
      win: win || undefined,
    });
  } finally {
    healingInProgress = false;
    // If more errors arrived while healing, flush them
    if (pendingErrors.length > 0) {
      flushErrors(win);
    }
  }
}

export function registerPreviewHandlers() {
  /** Trigger a build + preview refresh */
  ipcMain.handle('preview:refresh', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || undefined;
    return refreshPreview(win);
  });

  /** Get current preview state */
  ipcMain.handle('preview:state', async () => {
    return getPreviewState();
  });

  /** Stop the preview server */
  ipcMain.handle('preview:stop', async () => {
    await teardownPreview();
    return { success: true };
  });

  /** Toggle DevTools for the preview window */
  ipcMain.handle('preview:toggle-devtools', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return { success: false };
    if (win.webContents.isDevToolsOpened()) {
      win.webContents.closeDevTools();
    } else {
      win.webContents.openDevTools({ mode: 'detach' });
    }
    return { success: true };
  });

  /**
   * Handle runtime errors reported from the preview iframe.
   * Errors are batched over a 2-second window, then sent as a
   * single selfHeal invocation to avoid multiple fix attempts.
   */
  ipcMain.handle(
    'preview:runtime-error',
    async (event, errorData: { message?: string; source?: string; line?: number; stack?: string }) => {
      const error = parseRuntimeError(errorData);
      const win = BrowserWindow.fromWebContents(event.sender) || undefined;

      pendingErrors.push(error);

      // Reset the batch timer
      if (batchTimer) clearTimeout(batchTimer);
      batchTimer = setTimeout(() => {
        batchTimer = null;
        flushErrors(win);
      }, BATCH_WINDOW_MS);

      return { handled: true, batched: true };
    },
  );
}
