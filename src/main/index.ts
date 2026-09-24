import {
  app,
  BrowserWindow,
  dialog,
  Event,
  Menu,
  MenuItemConstructorOptions,
  net,
  Rectangle,
  screen,
  shell,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import * as fs from 'fs';
import * as path from 'path';

let mainWindow: BrowserWindow | null = null;

interface AppConfig {
  zoomFactor: number;
  windowX: number;
  windowY: number;
  windowWidth: number;
  windowHeight: number;
  windowMaximized: boolean;
}

const defaults: AppConfig = {
  zoomFactor: 1.0,
  windowX: 0,
  windowY: 0,
  windowWidth: 1440,
  windowHeight: 900,
  windowMaximized: false,
};

function getConfigPath(): string {
  return path.join(app.getPath('userData'), 'config.json');
}

function loadConfig(): AppConfig {
  try {
    const data = fs.readFileSync(getConfigPath(), 'utf-8');
    return { ...defaults, ...(JSON.parse(data) as Partial<AppConfig>) };
  } catch {
    return { ...defaults };
  }
}

function saveConfig(config: AppConfig): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

let conf = defaults;

function rectContains(bigRect: Rectangle, smallRect: Rectangle): boolean {
  return (
    bigRect.x <= smallRect.x &&
    bigRect.y <= smallRect.y &&
    bigRect.x + bigRect.width >= smallRect.x + smallRect.width &&
    bigRect.y + bigRect.height >= smallRect.y + smallRect.height
  );
}

interface WindowConfig {
  x: number | undefined;
  y: number | undefined;
  width: number;
  height: number;
}

function getWindowConfig(): WindowConfig {
  let posX: number | undefined = conf.windowX;
  let posY: number | undefined = conf.windowY;
  const width = conf.windowWidth;
  const height = conf.windowHeight;

  // check if window is on a screen
  const displays = screen.getAllDisplays();
  const displayContainingWindow = displays.filter((display) => {
    return rectContains(display.bounds, { x: posX ?? 0, y: posY ?? 0, width, height });
  });

  if (displayContainingWindow.length === 0) {
    posX = undefined;
    posY = undefined;
  }

  return {
    x: posX,
    y: posY,
    width: width,
    height: height,
  };
}

function handleLinkClick(e: Event | undefined, reqUrl: string): void {
  if (!mainWindow) return;

  const getHost = (urlString: string): string => new URL(urlString).host;
  const reqHost = getHost(reqUrl);

  // is external, eg. not kanbanflow?
  if (reqHost && reqHost != getHost(mainWindow.webContents.getURL())) {
    if (e !== undefined) e.preventDefault();
    void shell.openExternal(reqUrl);
  }
}

function createWindow(): void {
  const zFactor = conf.zoomFactor;

  // get window config
  const windowConfig = getWindowConfig();

  // Create the browser window.
  mainWindow = new BrowserWindow({
    x: windowConfig.x,
    y: windowConfig.y,
    width: windowConfig.width,
    height: windowConfig.height,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      zoomFactor: zFactor,
    },
  });

  // Simple Menu for Exit and View-Zoom
  const menuTemplate: MenuItemConstructorOptions[] = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Reload Webapp',
          role: 'reload',
        },
        {
          label: 'Quit',
          role: 'close',
        },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Zoom In',
          role: 'zoomIn',
          accelerator: 'CmdOrCtrl+Shift+3',
        },
        {
          label: 'Zoom Out',
          role: 'zoomOut',
          accelerator: 'CmdOrCtrl+Shift+2',
        },
        {
          type: 'separator',
        },
        {
          label: 'Reset Zoom',
          role: 'resetZoom',
          accelerator: 'CmdOrCtrl+Shift+1',
        },
      ],
    },
    {
      label: 'Help',
      submenu: [
        {
          label: 'About',
          click(): void {
            void shell.openExternal('https://github.com/metawave/kanbanflow-app');
          },
        },
      ],
    },
  ];

  // MacOS has a slightly different menu
  if (process.platform === 'darwin') {
    // Remove quit from File menu since this will be in the AppMenu
    (menuTemplate[0].submenu as MenuItemConstructorOptions[]).pop();

    const osxMenu: MenuItemConstructorOptions = {
      label: app.getName(),
      submenu: [
        {
          label: 'Quit',
          accelerator: 'CmdOrCtrl+Q',
          click(): void {
            app.quit();
          },
        },
      ],
    };
    menuTemplate.unshift(osxMenu);
  }

  // open devtools
  //mainWindow.webContents.openDevTools();

  if (conf.windowMaximized) {
    mainWindow.maximize();
  }

  const menu = Menu.buildFromTemplate(menuTemplate);
  mainWindow.setMenu(menu);
  if (process.platform === 'darwin') {
    Menu.setApplicationMenu(menu);
  }

  // and load the index.html of the app.
  void mainWindow.loadURL('https://kanbanflow.com');

  mainWindow.on('close', function () {
    if (!mainWindow) return;

    const windowBounds = mainWindow.getBounds();
    saveConfig({
      zoomFactor: mainWindow.webContents.zoomFactor,
      windowX: windowBounds.x,
      windowY: windowBounds.y,
      windowWidth: windowBounds.width,
      windowHeight: windowBounds.height,
      windowMaximized: mainWindow.isMaximized(),
    });
  });

  // open external links always in system browser instead of kanban app
  mainWindow.webContents.on('will-navigate', handleLinkClick);
  mainWindow.webContents.setWindowOpenHandler((details) => {
    handleLinkClick(undefined, details.url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', function () {
    mainWindow = null;
  });

  // At last, check for app updates
  void autoUpdater.checkForUpdatesAndNotify();
}

// This is the last Electron version: the app moved to Tauri, which can't be installed via
// electron-updater. Only Tauri releases ship a latest.json, so its presence tells us to point the
// user to the new download.
const TAURI_UPDATE_MANIFEST_URL =
  'https://github.com/metawave/kanbanflow-app/releases/latest/download/latest.json';
const DOWNLOAD_URL = 'https://github.com/metawave/kanbanflow-app/releases/latest';

async function notifyAboutNewApp(): Promise<void> {
  try {
    const response = await net.fetch(TAURI_UPDATE_MANIFEST_URL);
    if (!response.ok) return;
  } catch {
    return;
  }
  if (!mainWindow) return;

  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: 'New KanbanFlow App available',
    message: 'A new version of KanbanFlow App is available.',
    detail:
      'The app has been rebuilt: it is much smaller and uses less memory. ' +
      'It cannot be updated automatically, please download and install the new version. ' +
      'You will need to log in to KanbanFlow once again.',
    buttons: ['Download', 'Later'],
    defaultId: 0,
    cancelId: 1,
  });
  if (response === 0) {
    await shell.openExternal(DOWNLOAD_URL);
  }
}

app.on('ready', () => {
  conf = loadConfig();
  createWindow();
  void notifyAboutNewApp();

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
