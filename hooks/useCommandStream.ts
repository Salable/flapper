'use client';

/**
 * Subscribes the display to its board's command feed and dispatches each
 * command into the controller - the cloud's replacement for the IPC bridge.
 *
 * The cursor lives in the browser: EventSource resends Last-Event-ID on every
 * reconnect, including the deliberate window-end disconnects the server does,
 * so commands are neither dropped nor replayed across reconnects.
 *
 * On a private board the credential is either the board key (appended as
 * ?key=, since EventSource cannot send headers) or the owner's session cookie,
 * which rides along on same-origin requests by itself.
 */

import { useEffect } from 'react';

type Dispatch = (method: string, params?: object) => { ok: boolean; error?: { message: string } };

export function useCommandStream(
  apiBase: string,
  boardKey: string | null,
  ready: boolean,
  dispatchRef: React.RefObject<Dispatch | null>,
  onGone?: (message: string) => void,
) {
  useEffect(() => {
    if (!ready) return;
    let source: EventSource | null = null;
    let stopped = false;
    const suffix = boardKey ? `?key=${encodeURIComponent(boardKey)}` : '';

    // A missing board 404s; EventSource cannot see the status, so check once
    // up front and say so instead of silently retrying forever.
    fetch(`${apiBase}${suffix}`).then((response) => {
      if (stopped) return;
      if (response.status === 404) {
        onGone?.('This board was renamed or deleted - reopen it from the dashboard.');
        return;
      }
      if (response.status === 401 || response.status === 403) {
        onGone?.('This board is private and the key no longer works.');
        return;
      }
      source = new EventSource(`${apiBase}/commands/stream${suffix}`);
      source.onmessage = (event) => {
        try {
          const { method, params } = JSON.parse(event.data);
          const result = dispatchRef.current?.(method, params);
          if (result && !result.ok) {
            console.warn(`flapper: command ${method} refused - ${result.error?.message}`);
          }
        } catch (error) {
          console.warn('flapper: bad command frame', error);
        }
      };
    });

    return () => {
      stopped = true;
      source?.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, boardKey, ready]);
}
