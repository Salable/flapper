'use client';

/**
 * The display: a passive renderer of its board's server-side queue.
 *
 * No panel, no compose - configuration and the queue live in Settings and the
 * API; this page plays what the server says and reports completions. The keys
 * are F (fullscreen), Esc (panic blank - the queue is untouched and resumes
 * when it next changes), M (mute) and the up/down arrows (volume). Sound is
 * the one thing that is the display's own rather than the board's: it is
 * remembered per browser, not per board.
 *
 * Boot order matters: the command stream opens before the first queue fetch,
 * so a nudge can never fall between "read the queue" and "start listening".
 */

import { useEffect, useRef, useState } from 'react';
import { Flipboard } from '@/lib/board/flipboard.js';
import { gridForConfig } from '@/lib/board/geometry.mjs';
import { Controller } from '@/lib/board/controller.mjs';
import { Player } from '@/lib/board/player.mjs';
import { useStatePublisher } from '@/hooks/useStatePublisher';
import { loadBoardSkin, onAssetProgress } from '@/components/flapper/assets';
import { createAmbient } from '@/components/flapper/ambient';
import { resolveBoardTheme } from '@/lib/board/board-theme.mjs';
import { PACK_DEFAULTS } from '@/lib/board/theme-pack.mjs';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';
import {
  FlapSound,
  VOLUME_STEP,
  describeAudio,
  nudgeVolume,
  readAudioState,
  toggleMute,
  writeAudioState,
} from '@/lib/board/audio.mjs';

const TOAST_MS = 1800;

/** Board config is trusted but bands are deferred: never let a footer in. */
/*
 * The config the renderer wants, with the grid worked out.
 *
 * A board's config carries a screen and a card size, never a grid - so the
 * grid is computed at the moment of use, here, and the display is the only
 * thing that ever holds a cols/rows pair. It cannot go stale because it is
 * never stored.
 */
function sanitizeConfig(config: any) {
  const { regions: _regions, footerRows: _footerRows, ...rest } = config ?? {};
  return { ...rest, ...gridForConfig(rest), footerRows: 0 };
}

/**
 * How the board moves, from the design rather than the board.
 *
 * Hold, Scroll speed, Landing, Sweep, Sweep shape and Always flip are
 * `pack.advanced` now - a property of the design being worn, not of this
 * board's own config - so they reach the controller from here instead of
 * from sanitizeConfig above. Read on every theme resolution, so a design
 * change updates them the same way it updates the colours.
 */
function advancedFrom(pack: ThemePack) {
  // Merged against the pack's own defaults, never a bare read - an
  // explicit `undefined` in the spread that reaches Flipboard.setOptions
  // (Object.assign) or Controller.configure overwrites a good default
  // with nothing, which is worse than the field being absent.
  return { ...PACK_DEFAULTS.advanced, ...((pack as any)?.advanced ?? {}) };
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
  /** The board's theme as the server resolved it at page load - the first paint is already the right colour. */
  initialTheme: { rev: string; pack: ThemePack };
}) {
  // Read through a ref and keyed on the rev: an object prop must not re-run the boot effect on every parent render.
  const initialThemeRef = useRef(initialTheme);
  initialThemeRef.current = initialTheme;
  const initialRev = initialTheme.rev;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<any>(null);
  const soundRef = useRef<FlapSound | null>(null);
  /*
   * The board, held only so the cleanup can stop it. `board` itself is a
   * const inside the async IIFE below, so without this the teardown had no
   * way to reach it - and a design that drifts or runs a wash keeps its frame
   * loop re-arming (tick re-arms while needsFrames() is true), so the loop
   * outlived the effect. On the initialRev path a replacement board is built
   * for the same canvas, which is where that actually bites: two live loops
   * painting one element, the stale one drawing the old page over the new.
   */
  const boardRef = useRef<any>(null);
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [phase, setPhase] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState('');
  const [note, setNote] = useState('');

  /** Set by the state-publisher hook; called on every controller change. */
  const onStateRef = useRef<((state: any) => void) | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    // Assigned once the board exists; the cleanup below has to be able to reach
    // it, and the board is built inside an async block.
    let ambient: ReturnType<typeof createAmbient> | null = null;
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
      let skin;
      try {
        skin = await loadBoardSkin(initialThemeRef.current.rev, initialThemeRef.current.pack);
      } catch (error: any) {
        if (cancelled) return;
        console.error(`flapper: tile art failed to load — ${error.message}`);
        setFailure(`Could not load the board's theme: ${error.message}.`);
        setPhase('failed');
        return;
      }
      if (cancelled) return;

      const board = new Flipboard(canvas, skin, {});

      // The clacks. Loaded alongside the art; silent until the browser has
      // had a gesture (see the keydown/pointerdown handlers below).
      const sound = new FlapSound({ state: readAudioState(window.localStorage) });
      soundRef.current = sound;
      sound.attach(board);
      sound.load().catch((error: any) => {
        console.warn(`flapper: sound failed to load - ${error.message}`);
      });

      // The theme lives in the board config, so a change in Settings reaches
      // every display through the same sync nudge as a grid change. The
      // queue snapshot carries only the theme's revision; when it moves, the
      // display fetches /theme, builds the skin in the background, and swaps
      // it under the tiles in place. A failed fetch leaves `rev` where it
      // was, so the next nudge tries again.
      let rev = initialThemeRef.current.rev;
      const applyTheme = (wanted: string | undefined) => {
        if (!wanted || wanted === rev) return;
        const previous = rev;
        rev = wanted;
        fetch(`${apiBase}/theme${keySuffix}`)
          .then(async (response) => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const body = await response.json();
            // Defence in depth: draw what this build resolves from the stored
            // config, not whatever the server says the pack is.
            const resolved = resolveBoardTheme({ theme: body.theme, themePack: body.themePack });
            const nextSkin = await loadBoardSkin(body.rev, resolved.pack);
            if (!cancelled && rev === wanted) {
              board.setSkin(nextSkin);
              controller.configure(advancedFrom(resolved.pack));
            }
          })
          .catch((error: any) => {
            if (rev === wanted) rev = previous;
            console.warn(`flapper: theme ${wanted} failed to load, keeping ${previous} - ${error.message}`);
          });
      };
      /*
       * Ambient motion while the glass is holding - see components/flapper/
       * ambient.ts for the mechanism (shared with the settings-page
       * preview, so a board fidgets the same way wherever it is watched).
       * Off unless a board asks for it: a wall in an office should not
       * clack once a minute all night because a default said so.
       */
      ambient = createAmbient(board);

      const controller = new Controller(board, {});
      controller.configure(advancedFrom(initialThemeRef.current.pack));
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
        onConfig: (config: any, meta?: { themeRev?: string }) => {
          try {
            applyTheme(meta?.themeRev);
            controller.configure(sanitizeConfig(config));
            ambient?.start(Number((config as any)?.ambientMs) || 0);
          } catch (error: any) {
            console.warn(`flapper: stored config refused - ${error.message}`);
          }
        },
        onNote: (text: string) => setNote(text),
      });
      playerRef.current = player;

      boardRef.current = board;

      // Reachable from the devtools console for diagnosing an installation.
      (window as any).flipboard = board;
      (window as any).controller = controller;
      (window as any).player = player;
      (window as any).sound = sound;

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
      // Not the restore: the board is going away, and painting it on the way
      // out would arm a frame loop on a canvas nobody owns.
      ambient?.destroy();
      source?.close();
      boardObserver?.disconnect();
      if (ratioQuery && onRatioChange) ratioQuery.removeEventListener('change', onRatioChange);
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      playerRef.current?.stop();
      playerRef.current = null;
      soundRef.current?.stop();
      soundRef.current = null;
      // Last: the player and the ambient timer both paint, so stopping the
      // board before them could let one of them arm it again on the way out.
      boardRef.current?.stop?.();
      boardRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, apiBase, boardKey, displayToken, initialRev]);

  useStatePublisher(apiBase, displayToken, phase === 'ready', onStateRef);

  useEffect(() => {
    const showToast = (text: string) => {
      setToast(text);
      if (toastTimer.current) clearTimeout(toastTimer.current);
      toastTimer.current = setTimeout(() => setToast(''), TOAST_MS);
    };
    const setAudio = (next: { volume: number; muted: boolean }) => {
      const sound = soundRef.current;
      const state = sound ? sound.setState(next) : next;
      writeAudioState(window.localStorage, state);
      showToast(describeAudio(state));
    };
    // Browsers hold audio until the page has had a gesture. Any key or click
    // on the display counts, so the first one wakes the sound up - and if it
    // was a volume key, the toast says so rather than pretending it played.
    const unlock = () => {
      soundRef.current?.unlock();
    };
    const onPointerDown = () => unlock();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      unlock();
      const sound = soundRef.current;
      if (event.key.toLowerCase() === 'm') {
        event.preventDefault();
        if (sound) setAudio(toggleMute(sound.state));
        return;
      }
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault();
        if (sound) setAudio(nudgeVolume(sound.state, event.key === 'ArrowUp' ? VOLUME_STEP : -VOLUME_STEP));
        return;
      }
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
    window.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointerdown', onPointerDown);
      if (toastTimer.current) clearTimeout(toastTimer.current);
    };
  }, []);

  return (
    <>
      <main id="stage">
        {/* The board fills the window it is in - see .board-frame. */}
        <div className="board-frame">
          <canvas id="board" ref={canvasRef} />
        </div>
        {phase === 'loading' && (
          <div id="loading" className="overlay">
            <div className="loading-label">Loading board</div>
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
      <div id="audio-toast" className={toast !== '' ? 'visible' : ''} role="status" aria-live="polite">
        {toast}
      </div>
    </>
  );
}
