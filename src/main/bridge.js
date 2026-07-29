'use strict';

const { ipcMain } = require('electron');

/**
 * Request/response calls from the main process into the renderer.
 *
 * `ipcMain.handle` only works renderer-to-main, so calls in this direction need
 * correlating by hand: main sends `{id, method, params}`, the renderer replies
 * `{id, ok, value|error}`, and the promise for that id settles.
 *
 * Keeps contextIsolation intact - the renderer exposes a fixed set of named
 * methods rather than anything evaluable.
 */

const pending = new Map();
let nextId = 1;
let listening = false;
let target = null;
/** Latest state pushed up from the renderer, for event streams. */
let lastState = null;
const watchers = new Set();

function register() {
  if (listening) return;
  listening = true;

  ipcMain.on('flapper:result', (_event, message) => {
    const entry = pending.get(message?.id);
    if (!entry) return;
    pending.delete(message.id);
    clearTimeout(entry.timer);
    if (message.ok) entry.resolve(message.value);
    else {
      const error = new Error(message.error?.message || 'renderer error');
      error.status = message.error?.status || 500;
      entry.reject(error);
    }
  });

  ipcMain.on('flapper:state', (_event, state) => {
    lastState = state;
    for (const watcher of watchers) {
      try {
        watcher(state);
      } catch {
        /* a broken listener must not take the others down */
      }
    }
  });
}

/** The renderer that calls are routed to. */
function setTarget(webContents) {
  target = webContents;
}

function ready() {
  return Boolean(target && !target.isDestroyed());
}

/**
 * Invoke a named method in the renderer.
 * @returns {Promise<any>}
 */
function call(method, params, timeoutMs = 8000) {
  if (!ready()) {
    const error = new Error('board is not ready');
    error.status = 503;
    return Promise.reject(error);
  }
  return new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      const error = new Error(`renderer did not answer ${method} in ${timeoutMs}ms`);
      error.status = 504;
      reject(error);
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    target.send('flapper:call', { id, method, params });
  });
}

function watch(listener) {
  watchers.add(listener);
  return () => watchers.delete(listener);
}

function snapshot() {
  return lastState;
}

module.exports = { register, setTarget, ready, call, watch, snapshot };
