'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('flapper', {
  toggleFullscreen: () => ipcRenderer.invoke('flapper:toggle-fullscreen'),
  reserveHeight: (pixels) => ipcRenderer.invoke('flapper:reserve-height', pixels),
  serverInfo: () => ipcRenderer.invoke('flapper:server-info'),
  setPublic: (enabled) => ipcRenderer.invoke('flapper:set-public', enabled),

  /**
   * Handle calls from the main process. `handler(method, params)` returns an
   * envelope: `{ok: true, value}` or `{ok: false, error: {message, status}}`.
   * Only named methods cross the boundary - nothing evaluable - so
   * contextIsolation stays meaningful.
   *
   * The envelope exists because contextBridge copies an Error across the world
   * boundary and drops its own properties on the way, so a thrown `status` of
   * 422 or 429 arrived here as undefined and every such failure was reported as
   * a 500. A plain object is cloned intact, so the handler reports failure as a
   * value rather than by throwing.
   */
  onCall: (handler) => {
    ipcRenderer.removeAllListeners('flapper:call');
    ipcRenderer.on('flapper:call', async (_event, { id, method, params }) => {
      try {
        const result = await handler(method, params);
        if (result && result.ok === false) {
          ipcRenderer.send('flapper:result', {
            id,
            ok: false,
            error: {
              message: String(result.error?.message || 'renderer error'),
              status: Number(result.error?.status) || 500,
            },
          });
          return;
        }
        ipcRenderer.send('flapper:result', { id, ok: true, value: result?.value });
      } catch (error) {
        // A handler that throws anyway still gets reported, just without the
        // status the boundary ate.
        ipcRenderer.send('flapper:result', {
          id,
          ok: false,
          error: { message: String(error?.message || error), status: error?.status },
        });
      }
    });
  },

  /** Push board state up so the main process can serve it to API listeners. */
  publishState: (state) => ipcRenderer.send('flapper:state', state),
});
