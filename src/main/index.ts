import * as Electron from 'electron';
import { app, BrowserWindow, Menu, Rectangle } from 'electron';
import * as url from 'url';
import { autoUpdater } from 'electron-updater';
import * as ElectronStore from 'electron-store';
import * as pkg from '../../package.json';

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow: Electron.BrowserWindow;

// Config store for storing some settings
const conf = new ElectronStore({
        name: (<any>pkg).name,
        defaults: {
            zoomFactor: 1.0,
            windowConfig: {x: null, y: null, width: 1440, height: 900}
        }
    }
);

function getWindowConfig(): Rectangle {
    let posX = conf.get('windowPosX');
    let posY = conf.get('windowPosY');
    let width = conf.get('windowWidth');
    let height = conf.get('windowHeight');

    // check if window is on a screen

    let displays = Electron.screen.getAllDisplays();
    let displayContainingWindow = displays.filter((display) => {
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

function rectContains(bigRect: Rectangle, smallRect: Rectangle): boolean {
    return bigRect.x <= smallRect.x &&
        bigRect.y <= smallRect.y &&
        bigRect.x + bigRect.width >= smallRect.x + smallRect.width &&
        bigRect.y + bigRect.height >= smallRect.y + smallRect.height;
}

function setWindowConfig(rectangle: Rectangle): void {
    conf.set({
        windowPosX: rectangle.x,
        windowPosY: rectangle.y,
        windowWidth: rectangle.width,
        windowHeight: rectangle.height
    })
}

function createWindow() {

    // restore some settings
    let zFactor = conf.get('zoomFactor');

    // get window config
    let windowConfig = getWindowConfig();

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
    const menuTemplate: Electron.MenuItemConstructorOptions[] = [
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
            label: 'View',
            submenu: [
                {
                    label: 'Zoom In',
                    role: 'zoomin',
                    accelerator: 'CmdOrCtrl+Shift+3'
                },
                {
                    label: 'Zoom Out',
                    role: 'zoomout',
                    accelerator: 'CmdOrCtrl+Shift+2'
                },
                {
                    label: 'Reset Zoom',
                    role: 'resetzoom',
                    accelerator: 'CmdOrCtrl+Shift+1'
                }
            ]
        },
        {
            label: 'Help',
            submenu: [
                {
                    label: 'About',
                    click() {
                        Electron.shell.openExternal('https://github.com/metawave/kanbanflow-app')
                    }
                }
            ]
        }
    ];

    // MacOS has a slightly different menu
    if (process.platform === 'darwin') {

        // Remove quit from File menu since this will be in the AppMenu
        (menuTemplate[0].submenu as Electron.MenuItemConstructorOptions[]).pop();

        const name = app.getName();
        const osxMenu: Electron.MenuItemConstructorOptions = {
            label: name,
            submenu: [
                {
                    label: 'Quit',
                    accelerator: 'CmdOrCtrl+Q',
                    click() {
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
    mainWindow.loadURL(url.format({
        pathname: 'kanbanflow.com',
        protocol: 'https:',
        slashes: true
    }));

    mainWindow.on('close', function () {
        mainWindow.webContents.getZoomFactor(function (zoomFactor) {
            conf.set('zoomFactor', zoomFactor)
        });

        // Window positions and size
        setWindowConfig(mainWindow.getBounds());

        // Is it maximized?
        conf.set('windowMaximized', mainWindow.isMaximized());
    });

    // open external links always in system browser instead of kanban app
    mainWindow.webContents.on('will-navigate', handleLinkClick);
    mainWindow.webContents.on('new-window', handleLinkClick);

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

function handleLinkClick(e, reqUrl) {
    let getHost = URL => url.parse(URL).host;
    let reqHost = getHost(reqUrl);

    // is external, eg. not kanbanflow?
    if (reqHost && reqHost != getHost(mainWindow.webContents.getURL())) {
        e.preventDefault();
        Electron.shell.openExternal(reqUrl);
    }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', function () {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== 'darwin') {
        app.quit()
    }
});

app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow()
    }
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
