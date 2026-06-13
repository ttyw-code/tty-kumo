import { app, BrowserWindow, Menu, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { getLowDbWorker, type LowDbWorkerClient } from '../common/database/lowdb-client';
import { generateUuid } from '@/base/uuid';
import { createTray } from './tray';

let lowDbWorker: LowDbWorkerClient | null = null;
let mainWindow: BrowserWindow | null = null;
let trayInstance: Electron.Tray | null = null;

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
  process.exit(0);
}

app.on('second-instance', () => {
  const allWindows = BrowserWindow.getAllWindows();
  if (allWindows.length === 0) {
    return;
  }
  const mainWindow = allWindows[0];
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
});

class Main {

  start(): void {
    try {
      this.startup();

    } catch (error) {
      console.error('Application startup failed:', error);
      app.exit(1);
    }
  }

  private async startup(): Promise<void> {
    return;
  }
}

const createWindow = () => {
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 960,
    height: 800,
    // fullscreen: true,
    frame: false,
    transparent: true,
    
    resizable: false,
    webPreferences: {
      preload: getPreloadPath()!,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(() => {
    return { action: 'deny' };
  });

  const devServerUrl = process.env.VITE_DEV_SERVER_URL;
  const allowedOrigin = devServerUrl ? new URL(devServerUrl).origin : null;

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('file://')) {
      return;
    }

    if (allowedOrigin) {
      try {
        if (new URL(url).origin === allowedOrigin) {
          return;
        }
      } catch {
        event.preventDefault();
        return;
      }
    }

    event.preventDefault();
  });

  win.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });

  if (devServerUrl) {
    win.loadURL(devServerUrl);
    win.webContents.openDevTools();
  } else {
    win.loadFile('out/renderer/index.html');
  }

  mainWindow = win;
};

function showWindow() {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
}

app.whenReady().then(async () => {
  await initApp();
  createWindow();
  trayInstance = createTray(showWindow);

  app.on('activate', () => {
    if (!_isExistWindow()) {
      appMain.start();
    }
  });
});


function registerIpcHandlers(): void {
  // Add IPC handlers here

  // 退出应用
  ipcMain.handle('app:quit', () => {
    app.quit();
  });

  ipcMain.handle('app:window:minimize', () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.minimize();
    }
  });

  ipcMain.handle('app:window:close', () => {
    const focused = BrowserWindow.getFocusedWindow();
    if (focused) {
      focused.hide();
    }
  });
}


function _isExistWindow(): boolean {
  const allWindows = BrowserWindow.getAllWindows();
  return allWindows.length > 0;
}

async function initApp(): Promise<void> {
  const uuid = generateUuid();
  console.log('Generated UUID:', uuid);
  lowDbWorker = getLowDbWorker();
  const dbPath = path.join(app.getPath('userData'), 'mydb');
  fs.mkdirSync(dbPath, { recursive: true });
  try {
    await lowDbWorker?.init(dbPath);
    console.log('LowDB worker initialized');
    await lowDbWorker?.put('firstKey', 'Hello, LowDB!');
    const value = await lowDbWorker?.get('firstKey');
    console.log('Value from LowDB:', value);
  } catch (error) {
    console.error('Failed to initialize LowDB worker:', error);
  }
  registerIpcHandlers();
}


function getPreloadPath(): string | null {
  const appRoot = app.isPackaged ? app.getAppPath() : process.cwd();
  const preloadCandidates = [
    path.join(appRoot, 'out/src/main/preload.cjs'),
  ];
  const preloadPath = preloadCandidates.find((candidate) => fs.existsSync(candidate));
  if (!preloadPath) {
    console.warn('Preload file not found. Tried:', preloadCandidates);
  }
  return preloadPath || null;
}

// Entry point of the application
// Create Main instance and start the application
const appMain = new Main();
appMain.start();



