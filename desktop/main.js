'use strict';

const { app, BrowserWindow, powerSaveBlocker } = require('electron');
const settings = require('./settings');

/**
 * The desktop app is a thin shell around the deployed web app: a window that
 * loads a board URL, stays awake, and can go kiosk. The board engine, the
 * control panel, and the REST API all live in the web app - there is no
 * preload, no IPC, and no local server here.
 *
 * Which URL, in order of precedence:
 *   1. --url=<board url> on the command line
 *   2. FLAPPER_URL in the environment
 *   3. the last board this machine navigated to (persisted in userData)
 *   4. the service landing page, to create or open one
 */
const SERVICE_URL = 'https://flapper-tan.vercel.app';

if (!app.requestSingleInstanceLock()) {
  console.error('flapper: another instance is already running; focusing it and exiting');
  app.quit();
  process.exit(0);
}

const kiosk = process.argv.includes('--kiosk');

function chosenUrl() {
  const arg = process.argv.find((entry) => entry.startsWith('--url='));
  if (arg) return arg.slice('--url='.length);
  if (process.env.FLAPPER_URL) return process.env.FLAPPER_URL;
  return settings.read(app.getPath('userData')).boardUrl || SERVICE_URL;
}

let blockerId = null;

// Nobody presses a key on a wall display, and a browser will not make a
// sound until somebody does. The kiosk is the one place that rule is
// wrong, so here the clacks start with the first flip. (M and the arrow
// keys still mute and set the level; the setting is per machine.)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow() {
  const win = new BrowserWindow({
    // Sized for the default 20 x 8 grid at a comfortable tile size.
    width: 1320,
    height: 620,
    minWidth: 520,
    minHeight: 240,
    backgroundColor: '#0a0a0b',
    autoHideMenuBar: true,
    kiosk,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // A wall display is permanently unfocused and often occluded. Without
      // this, Chromium throttles requestAnimationFrame and an API-triggered
      // flip stalls, then jumps when the delta clamp catches up.
      backgroundThrottling: false,
    },
  });

  // Landing on a board - clicked to, created, or loaded directly - makes it
  // this machine's board, so a kiosk reboots straight back into it.
  // The ?key= query survives here too, so a private board's display URL is
  // remembered whole and the kiosk reopens with access.
  win.webContents.on('did-navigate', (_event, url) => {
    if (/\/b\/[a-z0-9][a-z0-9-]+/.test(new URL(url).pathname)) {
      settings.write(app.getPath('userData'), { boardUrl: url });
    }
  });

  win.loadURL(chosenUrl());
  return win;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(() => {
  createWindow();

  // Keep the display awake; an installation that sleeps is a black wall.
  blockerId = powerSaveBlocker.start('prevent-display-sleep');

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
