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
import { Controller } from '@/lib/board/controller.mjs';
import { idleAction, withFlicker } from '@/lib/board/idle.mjs';
import { Player } from '@/lib/board/player.mjs';
import { useStatePublisher } from '@/hooks/useStatePublisher';
import { loadBoardSkin, onAssetProgress } from '@/components/flapper/assets';
import { resolveBoardTheme } from '@/lib/board/board-theme.mjs';
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
  const [toast, setToast] = useState('');
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // Assigned once the board exists; the cleanup below has to be able to reach
    // it, and the board is built inside an async block.
    let stopAmbient: () => void = () => {};
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
            if (!cancelled && rev === wanted) board.setSkin(nextSkin);
          })
          .catch((error: any) => {
            if (rev === wanted) rev = previous;
            console.warn(`flapper: theme ${wanted} failed to load, keeping ${previous} - ${error.message}`);
          });
      };
      /*
       * Ambient motion while the glass is holding.
       *
       * A board standing on one message is dead in a way a real installation
       * never is: idle.mjs already models the alternative - mostly stillness,
       * the occasional tile misfiring to a wrong character and correcting
       * itself all the way round, and now and then a whole sweep - and until
       * now it only ran on the wordmark, which is not what it was written for.
       *
       * It works on what is physically on the glass (`board.page`) and puts it
       * back afterwards, and it only ever runs when nothing else is moving.
       * The restore is guarded: if anything else painted the board in the
       * meantime the flicker is abandoned rather than stamped over the top of
       * whatever arrived, which is the one way this could have hurt.
       *
       * Off unless a board asks for it. A wall in an office should not clack
       * once a minute all night because a default said so.
       */
      let ambientTimer: ReturnType<typeof setInterval> | null = null;
      let restoreTimer: ReturnType<typeof setTimeout> | null = null;
      let ambientTick = 0;
      /** Put the words back, if a flicker is still showing. */
      let undoFlicker: (() => void) | null = null;
      stopAmbient = () => {
        if (ambientTimer !== null) clearInterval(ambientTimer);
        if (restoreTimer !== null) clearTimeout(restoreTimer);
        ambientTimer = null;
        restoreTimer = null;
        // Do the restore rather than drop it. startAmbient calls this, and it
        // runs from onConfig - which fires on every sync nudge - so a sync
        // landing inside the flicker window would otherwise leave the
        // deliberately-wrong character on the glass with nothing coming to
        // correct it.
        const undo = undoFlicker;
        undoFlicker = null;
        undo?.();
      };
      const startAmbient = (everyMs: number) => {
        stopAmbient();
        // onConfig can land after the effect has been torn down - the queue
        // fetch that triggers it may still be in flight - and an interval
        // started then would tick against a detached canvas for ever.
        if (cancelled) return;
        if (!Number.isFinite(everyMs) || everyMs < 5000) return;
        ambientTimer = setInterval(() => {
          if (board.isAnimating() || restoreTimer !== null) return;
          const page = board.page;
          if (!page || page.every((line: string) => line.trim() === '')) return;
          ambientTick += 1;
          /*
           * Flat, not newline-joined. A page is rows of exactly `cols`
           * characters, so index/cols and index%cols put a character back where
           * it came from - whereas joining on newlines puts separators into the
           * pool idleAction picks from, and it only skips spaces. On a board
           * holding a short message the separators outnumber the letters, so
           * more than half of all flickers landed on one, `split` came back a
           * row short, and the restore guard could not match a page with the
           * wrong number of rows. The board simply shifted up and stayed there.
           */
          const width = page[0]?.length ?? 0;
          if (width === 0 || page.some((line: string) => line.length !== width)) return;
          const flat = page.join('');
          const action = idleAction(flat, board.charset, ambientTick);
          if (action.kind === 'sweep') {
            // Restore whatever the board was set to, not a hard-coded false: a
            // board configured to always flip would have quietly lost it.
            const wasAlwaysFlip = board.opts.alwaysFlip;
            board.setOptions({ alwaysFlip: true });
            board.setPage(page);
            board.setOptions({ alwaysFlip: wasAlwaysFlip });
            return;
          }
          if (action.kind !== 'flicker') return;
          const changed = withFlicker(flat, action);
          const flickered = page.map((_: string, row: number) =>
            changed.slice(row * width, (row + 1) * width),
          );
          board.setPage(flickered);
          const restore = () => {
            // Only if nothing else has painted since. A message that arrived
            // mid-flicker must not be replaced by the words it interrupted.
            const now = board.page;
            if (now && now.join('\u0000') === flickered.join('\u0000')) board.setPage(page);
          };
          undoFlicker = restore;
          restoreTimer = setTimeout(() => {
            restoreTimer = null;
            undoFlicker = null;
            restore();
          }, 900);
        }, everyMs);
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
        onConfig: (config: any, meta?: { themeRev?: string }) => {
          try {
            setLayout(config?.layout ?? null);
            applyTheme(meta?.themeRev);
            controller.configure(sanitizeConfig(config));
            startAmbient(Number((config as any)?.ambientMs) || 0);
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
      stopAmbient();
      source?.close();
      boardObserver?.disconnect();
      if (ratioQuery && onRatioChange) ratioQuery.removeEventListener('change', onRatioChange);
      if (onVisibility) document.removeEventListener('visibilitychange', onVisibility);
      playerRef.current?.stop();
      playerRef.current = null;
      soundRef.current?.stop();
      soundRef.current = null;
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
