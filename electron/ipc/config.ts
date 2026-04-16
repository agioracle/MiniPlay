import { ipcMain } from 'electron';
import { readConfig, writeConfig, type AppConfig } from '../storage/config';

export function registerConfigHandlers() {
  ipcMain.handle('config:get', async () => {
    return readConfig();
  });

  ipcMain.handle('config:set', async (_event, partial: Partial<AppConfig>) => {
    writeConfig(partial);
    return readConfig();
  });
}
