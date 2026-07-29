'use strict';

const { app, BrowserWindow, powerSaveBlocker } = require('electron');
const path = require('node:path');
const { registerScheme, serve, ORIGIN } = require('./serve');
const ipc = require('./ipc');
const bridge = require('./bridge');
const access = require('./access');
const { version } = require('../../package.json');

registerScheme();

// Only one instance may own the control port. Say so rather than vanishing:
// a silent exit looks identical to a crash from the outside.
if (!app.requestSingleInstanceLock()) {
  console.error('flapper: another instance is already running; focusing it and exiting');
  app.quit();
  process.exit(0);
}

let blockerId = null;

function createWindow() {
  const win = new BrowserWindow({
    // Sized for the default 20 x 8 grid at a comfortable tile size.
    width: 1320,
    height: 620,
    minWidth: 520,
    minHeight: 240,
    backgroundColor: '#0a0a0b',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // A wall display is permanently unfocused and often occluded. Without
      // this, Chromium throttles requestAnimationFrame and an API-triggered
      // flip stalls, then jumps when the delta clamp catches up.
      backgroundThrottling: false,
    },
  });

  win.loadURL(`${ORIGIN}/src/renderer/index.html`);
  bridge.setTarget(win.webContents);
  win.webContents.on('destroyed', () => bridge.setTarget(null));
  return win;
}

app.on('second-instance', () => {
  const [win] = BrowserWindow.getAllWindows();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.whenReady().then(async () => {
  serve();
  ipc.register();
  bridge.register();

  access.init({ userDataDir: app.getPath('userData'), version });
  access.register();

  createWindow();

  // Keep the display awake; an installation that sleeps is a black wall.
  blockerId = powerSaveBlocker.start('prevent-display-sleep');

  // Failures are reported to the console and to the in-app readout rather than
  // a modal dialog: an unattended wall must not sit behind an OK button.
  await access.start();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => {
  if (blockerId !== null && powerSaveBlocker.isStarted(blockerId)) {
    powerSaveBlocker.stop(blockerId);
  }
  access.stop();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
