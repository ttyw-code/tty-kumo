import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { generateUuid } from '@/base/uuid';
import { launchWorker } from '@/main/database/worker-launcher';
import { DBPersister } from '@/main/database/persister';
import type { IDBPersister } from '@/main/database/types';
import { createTray } from '@/main/tray';

class MainApplication {
  private mainWindow: BrowserWindow | null = null;
  private db: IDBPersister | null = null;

  start(): void {
    if (!app.requestSingleInstanceLock()) {
      app.quit();
      process.exit(0);
    }

    this.registerListeners();
    app.whenReady().then(() => this.init());
  }

  private registerListeners(): void {
    app.on('second-instance', () => {
      if (this.mainWindow) {
        if (this.mainWindow.isMinimized()) this.mainWindow.restore();
        this.mainWindow.focus();
      }
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        this.createWindow();
      }
    });
  }

  private async init(): Promise<void> {
    try {
      await this.initApp();
      this.createWindow();
      this.createTray();
    } catch (error) {
      console.error('Startup failed:', error);
      app.exit(1);
    }
  }

  private async initApp(): Promise<void> {
    const uuid = generateUuid();
    const dbPath = path.join(app.getPath('userData'), 'mydb');
    fs.mkdirSync(dbPath, { recursive: true });

    try {
      const worker = launchWorker();
      this.db = new DBPersister(worker);
      await this.db.init(dbPath);
      console.log('DB worker ready');
      await this.db.put('app_uuid', uuid);
      console.log('App UUID stored in DB:', await this.db.get('app_uuid'));
    } catch (err) {
      console.error('DB init failed:', err);
    }

    this.registerIpcHandlers();
  }

  private getPreloadPath(): string | null {
    const root = app.isPackaged ? app.getAppPath() : process.cwd();
    const preload = path.join(root, 'out/src/main/preload.cjs');
    if (!fs.existsSync(preload)) {
      console.warn('Preload not found:', preload);
      return null;
    }
    return preload;
  }

  private createWindow(): void {
    Menu.setApplicationMenu(null);

    const preloadPath = this.getPreloadPath();
    if (!preloadPath) {
      console.error('Cannot create window: preload missing');
      return;
    }

    const win = new BrowserWindow({
      width: 960,
      height: 800,
      frame: false,
      transparent: true,
      resizable: false,
      webPreferences: {
        preload: preloadPath,
        nodeIntegration: false,
        contextIsolation: true,
        sandbox: true,
      },
    });

    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-attach-webview', (e) => e.preventDefault());

    const devUrl = process.env.VITE_DEV_SERVER_URL;
    if (devUrl) {
      const allowedOrigin = new URL(devUrl).origin;
      win.webContents.on('will-navigate', (e, url) => {
        if (url.startsWith('file://')) return;
        try {
          if (new URL(url).origin === allowedOrigin) return;
        } catch { /* malformed url */ }
        e.preventDefault();
      });
      win.loadURL(devUrl);
      win.webContents.openDevTools();
    } else {
      win.loadFile('out/renderer/index.html');
    }

    this.mainWindow = win;
  }

  private createTray(): void {
    createTray(() => this.showWindow());
  }

  private showWindow(): void {
    if (!this.mainWindow) return;
    if (this.mainWindow.isMinimized()) this.mainWindow.restore();
    this.mainWindow.show();
    this.mainWindow.focus();
  }

  private registerIpcHandlers(): void {
    ipcMain.handle('app:quit', () => app.quit());
    ipcMain.handle('app:window:minimize', () => {
      BrowserWindow.getFocusedWindow()?.minimize();
    });
    ipcMain.handle('app:window:close', () => {
      BrowserWindow.getFocusedWindow()?.hide();
    });
  }
}

new MainApplication().start();
