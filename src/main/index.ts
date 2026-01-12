import {
  app,
  BrowserWindow,
  Event,
  Menu,
  MenuItemConstructorOptions,
  Rectangle,
  screen,
  shell,
} from 'electron';
import { autoUpdater } from 'electron-updater';
import * as pkg from '../../package.json';
import Store from 'electron-store';

let mainWindow: BrowserWindow | null = null;

// Config store for storing some settings
const conf = new Store({
  name: pkg.name,
  schema: {
    zoomFactor: {
      type: 'number',
      default: 1.0,
    },
    windowX: {
      type: 'number',
      default: 0,
    },
    windowY: {
      type: 'number',
      default: 0,
    },
    windowWidth: {
      type: 'number',
      default: 1440,
    },
    windowHeight: {
      type: 'number',
      default: 900,
    },
    windowMaximized: {
      type: 'boolean',
      default: false,
    },
  },
});

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
  let posX: number | undefined = conf.get('windowX') as number;
  let posY: number | undefined = conf.get('windowY') as number;
  const width = conf.get('windowWidth') as number;
  const height = conf.get('windowHeight') as number;

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
  // restore some settings
  const zFactor = conf.get('zoomFactor') as number | undefined;

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

  // if it was previously maximized, we do that now
  if (conf.get('windowMaximized')) {
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

    conf.set('zoomFactor', mainWindow.webContents.zoomFactor);

    // Window positions and size
    const windowBounds = mainWindow.getBounds();
    conf.set('windowX', windowBounds.x);
    conf.set('windowY', windowBounds.y);
    conf.set('windowWidth', windowBounds.width);
    conf.set('windowHeight', windowBounds.height);

    // Is it maximized?
    conf.set('windowMaximized', mainWindow.isMaximized());
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

app.on('ready', () => {
  createWindow();

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
