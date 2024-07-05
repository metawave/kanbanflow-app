import {app, BrowserWindow, Event, Menu, MenuItemConstructorOptions, Rectangle, screen, shell} from 'electron';
import {autoUpdater} from 'electron-updater';
import * as pkg from '../../package.json';
import Store, {Schema} from 'electron-store';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: BrowserWindow;

// Config store for storing some settings
const confSchema : Schema<any> = {
    zoomFactor: {
        type: 'number',
        default: 1.0
    },
    windowX: {
        type: 'number',
        default: 0
    },
    windowY: {
        type: 'number',
        default: 0
    },
    windowWidth: {
        type: 'number',
        default: 1440
    },
    windowHeight: {
        type: 'number',
        default: 900
    },
    windowMaximized: {
        type: 'boolean',
        default: false
    }
};
const conf = new Store({name: pkg.name, schema: confSchema});

function rectContains(bigRect: Rectangle, smallRect: Rectangle): boolean {
    return bigRect.x <= smallRect.x &&
        bigRect.y <= smallRect.y &&
        bigRect.x + bigRect.width >= smallRect.x + smallRect.width &&
        bigRect.y + bigRect.height >= smallRect.y + smallRect.height;
}

function getWindowConfig(): Rectangle {
    let posX = conf.get('windowX') as number|undefined;
    let posY = conf.get('windowY') as number|undefined;
    const width = conf.get('windowWith') as number|undefined;
    const height = conf.get('windowHeight') as number|undefined;

    // check if window is on a screen
    const displays = screen.getAllDisplays();
    const displayContainingWindow = displays.filter((display) => {
        return rectContains(display.bounds, {x: posX, y: posY, width, height});
    });

    if (displayContainingWindow.length === 0) {
        posX = null;
        posY = null;
    }

    return {
        x: posX,
        y: posY,
        width: width,
        height: height
    }
}

function handleLinkClick(e: Event | undefined, reqUrl: string): void {
    const getHost = (urlString: string): string => new URL(urlString).host;
    const reqHost = getHost(reqUrl);

    // is external, eg. not kanbanflow?
    if (reqHost && reqHost != getHost(mainWindow.webContents.getURL())) {
        if (e !== undefined) e.preventDefault();
        shell.openExternal(reqUrl);
    }
}

function createWindow(): void {

    // restore some settings
    const zFactor = conf.get('zoomFactor') as number|undefined;

    // get window config
    const windowConfig = getWindowConfig();

    // Create the browser window.
    mainWindow = new BrowserWindow(
        {
            icon: 'appicon.ico',
            x: windowConfig.x,
            y: windowConfig.y,
            width: windowConfig.width,
            height: windowConfig.height,
            autoHideMenuBar: true,
            webPreferences: {
                webSecurity: false,
                nodeIntegration: false,
                zoomFactor: zFactor
            }
        });

    // Simple Menu for Exit and View-Zoom
    const menuTemplate: MenuItemConstructorOptions[] = [
        {
            label: 'File',
            submenu: [
                {
                    label: 'Reload Webapp',
                    role: 'reload'
                },
                {
                    label: 'Quit',
                    role: 'close'
                }
            ]
        },
        {
            label: 'Edit',
            submenu: [
                {label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo'},
                {label: 'Redo', accelerator: 'Shift+CmdOrCtrl+Z', role: 'redo'},
                {type: 'separator'},
                {label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut'},
                {label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy'},
                {label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste'},
                {label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll'}
            ]
        },
        {
            label: 'View',
            submenu: [
                {
                    label: 'Zoom In',
                    role: 'zoomIn',
                    accelerator: 'CmdOrCtrl+Shift+3'
                },
                {
                    label: 'Zoom Out',
                    role: 'zoomOut',
                    accelerator: 'CmdOrCtrl+Shift+2'
                },
                {
                    type: 'separator'
                },
                {
                    label: 'Reset Zoom',
                    role: 'resetZoom',
                    accelerator: 'CmdOrCtrl+Shift+1'
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click(): void {
                        shell.openExternal('https://github.com/metawave/kanbanflow-app')
                    }
                }
            ]
        }
    ];

    // MacOS has a slightly different menu
    if (process.platform === 'darwin') {

        // Remove quit from File menu since this will be in the AppMenu
        (menuTemplate[0].submenu as MenuItemConstructorOptions[]).pop();

        const name = app.getName();
        const osxMenu: MenuItemConstructorOptions = {
            label: name,
            submenu: [
                {
                    label: 'Quit',
                    accelerator: 'CmdOrCtrl+Q',
                    click(): void {
                        app.quit();
                    }
                }
            ]
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
    mainWindow.loadURL("https://kanbanflow.com");

    mainWindow.on('close', function () {
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
    mainWindow.webContents.setWindowOpenHandler((details => {
        handleLinkClick(undefined, details.url);
        return {action: "deny"};
    }))

    // Emitted when the window is closed.
    mainWindow.on('closed', function () {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null
    });

    // At last, check for app updates
    autoUpdater.checkForUpdatesAndNotify();
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', () => {
    createWindow();

    app.on("activate", function () {
        // On macOS it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
});

// Quit when all windows are closed.
app.on('window-all-closed', () => {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
