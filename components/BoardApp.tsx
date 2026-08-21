'use client';

/**
 * The display: a passive renderer of its board's server-side queue.
 *
 * No panel, no compose, no local settings - configuration and the queue live
 * in Settings and the API; this page plays what the server says and reports
 * completions. The only keys are F (fullscreen) and Esc (panic blank - the
 * queue is untouched and resumes when it next changes).
 *
 * Boot order matters: the command stream opens before the first queue fetch,
 * so a nudge can never fall between "read the queue" and "start listening".
 */

import { useEffect, useRef, useState } from 'react';
import { Flipboard } from '@/lib/board/flipboard.js';
import { Controller } from '@/lib/board/controller.mjs';
import { Player } from '@/lib/board/player.mjs';
import { useStatePublisher } from '@/hooks/useStatePublisher';
import { loadFlapperAssets, onAssetProgress } from '@/components/flapper/assets';
import { resolveTheme } from '@/lib/board/themes.mjs';

/** Board config is trusted but bands are deferred: never let a footer in. */
function sanitizeConfig(config: any) {
  const { regions: _regions, footerRows: _footerRows, ...rest } = config ?? {};
  return { ...rest, footerRows: 0 };
}

export function BoardApp({
  slug,
  apiBase,
  boardKey,
  displayToken,
  initialTheme,
}: {
  slug: string;
  apiBase: string;
  boardKey: string | null;
  displayToken: string;
  /** The board's theme as the server knew it at page load - the first paint is already the right colour. */
  initialTheme: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<any>(null);

  const [phase, setPhase] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState('');
  const [layout, setLayout] = useState<{ xPct: number; yPct: number; wPct: number; hPct: number } | null>(null);

  /** Set by the state-publisher hook; called on every controller change. */
  const onStateRef = useRef<((state: any) => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let source: EventSource | null = null;
    let boardObserver: ResizeObserver | null = null;
    let ratioQuery: MediaQueryList | null = null;
    let onRatioChange: (() => void) | null = null;
    let onVisibility: (() => void) | null = null;

    const keySuffix = boardKey ? `?key=${encodeURIComponent(boardKey)}` : '';

    // The tile art comes from the shared loader (one decode per tab, shared
    // with the wordmark); the bitmaps are shared property and never closed.
    const stopProgress = onAssetProgress((fraction) => {
      if (!cancelled) setProgress(fraction);
    });

    (async () => {
      let manifest;
      let strips: ImageBitmap[];
      try {
        ({ manifest, strips } = await loadFlapperAssets(initialTheme));
      } catch (error: any) {
        if (cancelled) return;
        console.error(`flapper: tile art failed to load — ${error.message}`);
        setFailure(`Could not load tile art: ${error.message}.`);
        setPhase('failed');
        return;
      }
      if (cancelled) return;

      const board = new Flipboard(canvas, manifest, strips, {});

      // The theme lives in the board config, so a change in Settings reaches
      // every display through the same sync nudge as a grid change. The new
      // set decodes in the background; the board keeps playing in the old
      // paint until it is ready, then swaps under the tiles in place.
      let theme = resolveTheme(initialTheme).id;
      const applyTheme = (wanted: string) => {
        const next = resolveTheme(wanted).id;
        if (next === theme) return;
        theme = next;
        loadFlapperAssets(next)
          .then((art) => {
            if (!cancelled && theme === next) board.setArt(art.manifest, art.strips);
          })
          .catch((error: any) => {
            console.warn(`flapper: tile art for theme ${next} failed to load - ${error.message}`);
          });
      };
      const controller = new Controller(board, {});
      controller.onChange = (state: any) => {
        onStateRef.current?.({
          ...state,
          playingItemId: playerRef.current?.playing?.id ?? null,
        });
      };

      const api = {
        fetchQueue: async () => {
          const response = await fetch(`${apiBase}/queue${keySuffix}`);
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${response.status}`);
          }
          return response.json();
        },
        advance: async (itemId: string, epoch: number, error?: object) => {
          const response = await fetch(`${apiBase}/queue/advance`, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              authorization: `Bearer ${displayToken}`,
            },
            body: JSON.stringify({ itemId, epoch, ...(error ? { error } : {}) }),
          });
          if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${response.status}`);
          }
          return response.json();
        },
      };

      const player = new Player(controller, board, api, {
        onConfig: (config: any) => {
          try {
            setLayout(config?.layout ?? null);
            applyTheme(config?.theme);
            controller.configure(sanitizeConfig(config));
          } catch (error: any) {
            console.warn(`flapper: stored config refused - ${error.message}`);
          }
        },
        onNote: (text: string) => setNote(text),
      });
      playerRef.current = player;

      // Reachable from the devtools console for diagnosing an installation.
      (window as any).flipboard = board;
      (window as any).controller = controller;
      (window as any).player = player;

      setPhase('ready');

      boardObserver = new ResizeObserver(() => board.resize());
      boardObserver.observe(canvas);
      const watchRatio = () => {
        ratioQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        onRatioChange = () => {
          board.resize();
          watchRatio();
        };
        ratioQuery.addEventListener('change', onRatioChange, { once: true });
      };
      watchRatio();

      // The command stream first; the initial fetch races nothing this way.
      const streamUrl = `${apiBase}/commands/stream${keySuffix}`;
      source = new EventSource(streamUrl);
      source.onmessage = (event) => {
        try {
          const { method, params } = JSON.parse(event.data);
          if (method === 'clear') player.onClear();
          else player.onSync(method === 'sync' ? params : undefined);
        } catch (error) {
          console.warn('flapper: bad command frame', error);
        }
      };

      const begin = async () => {
        let snapshot;
        try {
          snapshot = await player.start();
        } catch {
          snapshot = null;
        }
        if (cancelled) return;
        if (snapshot === null) {
          // The fetch failed - likely a renamed or deleted board.
          setNote('This board is unreachable - it may have been renamed or deleted.');
          return;
        }
        // A pristine board greets; a cleared one stays deliberately blank.
        if (snapshot.currentState === 'idle' && snapshot.items.length === 0 && snapshot.epoch === 0) {
          try {
            controller.enqueue('FLAPPER', { source: 'ui' });
          } catch {
            /* cosmetic only */
          }
        }
      };
      // Wait for the stream before the first read; fall through after 3s so a
      // blocked stream cannot keep the glass dark.
      let began = false;
      const beginOnce = () => {
        if (began || cancelled) return;
        began = true;
        begin();
      };
      source.onopen = beginOnce;
      setTimeout(beginOnce, 3000);

      // A tab coming back from background throttling snaps to the truth.
      onVisibility = () => {
        if (document.visibilityState === 'visible') player.onSync(undefined);
      };
      document.addEventListener('visibilitychange', onVisibility);
    })();

    return () => {
      cancelled = true;
      stopProgress();
      source?.close();
      boardObserver?.disconnect();
      if (ratioQuery && onRatioChange) ratioQuery.removeEventListener('change', onRatioChange);
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      playerRef.current?.stop();
      playerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, apiBase, boardKey, displayToken, initialTheme]);

  useStatePublisher(apiBase, displayToken, phase === 'ready', onStateRef);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        playerRef.current?.panicBlank();
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (document.fullscreenElement) document.exitFullscreen();
        else document.documentElement.requestFullscreen();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <main id="stage">
        <div
          className="board-frame"
          style={
            layout
              ? {
                  left: `${layout.xPct}%`,
                  top: `${layout.yPct}%`,
                  width: `${layout.wPct}%`,
                  height: `${layout.hPct}%`,
                }
              : { inset: 0, width: '100%', height: '100%' }
          }
        >
          <canvas id="board" ref={canvasRef} />
        </div>
        {phase === 'loading' && (
          <div id="loading" className="overlay">
            <div className="loading-label">Loading tiles</div>
            <div className="loading-bar">
              <div id="loading-fill" style={{ width: `${progress * 100}%` }} />
            </div>
          </div>
        )}
        {phase === 'failed' && (
          <div id="failure" className="overlay">
            {failure}
          </div>
        )}
      </main>
      <div id="hint" className={note !== '' ? 'visible' : ''}>
        {note}
      </div>
    </>
  );
}
