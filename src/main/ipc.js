'use strict';

const { BrowserWindow, ipcMain, screen } = require('electron');

// How much window height the renderer has asked us to set aside for chrome.
const reserved = new WeakMap();

function register() {
  ipcMain.handle('flapper:toggle-fullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    const next = !win.isFullScreen();
    win.setFullScreen(next);
    return next;
  });

  /**
   * Grow or shrink the window so opening the control panel doesn't squeeze the
   * board. A no-op when the window can't usefully be resized.
   */
  ipcMain.handle('flapper:reserve-height', (event, pixels) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win || win.isFullScreen() || win.isMaximized()) return false;

    const want = Math.max(0, Math.round(pixels) || 0);
    const delta = want - (reserved.get(win) || 0);
    reserved.set(win, want);
    if (delta === 0) return true;

    const bounds = win.getBounds();
    const { workArea } = screen.getDisplayMatching(bounds);
    const height = Math.min(Math.max(180, bounds.height + delta), workArea.height);
    // Pull the window back up if growing would push it past the bottom.
    const y = Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - height));
    win.setBounds({ x: bounds.x, y, width: bounds.width, height }, false);
    return true;
  });
}

module.exports = { register };
