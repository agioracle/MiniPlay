import { ipcMain } from 'electron';

export function registerEchoHandler() {
  ipcMain.handle('echo', async (_event, message: string) => {
    return `Echo: ${message}`;
  });
}
