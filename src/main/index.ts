import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { SnapshotService } from './collectors/snapshotService';
import type { WindowAction } from '@shared/models';

const snapshotService = new SnapshotService();
let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1510,
    height: 1010,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: '#050b16',
    frame: false,
    title: 'Performance Monitor',
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

ipcMain.handle('metrics:get-snapshot', async () => snapshotService.getSnapshot());

ipcMain.handle('window:action', (event, action: WindowAction) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) {
    return;
  }

  if (action === 'minimize') {
    window.minimize();
  }

  if (action === 'maximize') {
    window.isMaximized() ? window.unmaximize() : window.maximize();
  }

  if (action === 'close') {
    window.close();
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
