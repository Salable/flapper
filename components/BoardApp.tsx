'use client';

/**
 * The board page: canvas, overlays, and the control panel.
 *
 * The engine stays framework-free - this component instantiates Flipboard and
 * Controller imperatively and React only renders the chrome around them. State
 * flows one way: panel edits go through `applyConfigure`, whose return value
 * (the board's account of what actually happened, clamps included) is mirrored
 * back into the settings, so a slider can never disagree with the glass.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Flipboard } from '@/lib/board/flipboard.js';
import { Controller, MAIN } from '@/lib/board/controller.mjs';
import { describeDiagnostics, bandViews, resolvePanelRegion } from '@/lib/board/panel.mjs';
import { loadSettings, saveSettings } from '@/lib/board/settings.mjs';
import { createDispatch } from '@/lib/board/dispatch.mjs';
import { useCommandStream } from '@/hooks/useCommandStream';
import { useStatePublisher } from '@/hooks/useStatePublisher';
import { Panel } from './Panel';

const ASSETS = '/assets';

/** Settings mirrored back from the board after a configure. */
const MIRRORED = [
  'cols',
  'rows',
  'footerRows',
  'align',
  'valign',
  'wrap',
  'fastStepMs',
  'landStepMs',
  'sweepMs',
  'staggerMode',
] as const;

type Settings = Record<string, unknown> & { playlist: string; dwellMs: number };

async function loadStrips(manifest: any, onProgress: (fraction: number) => void) {
  const strips = new Array(manifest.cycle.length);
  let done = 0;
  await Promise.all(
    manifest.cycle.map(async (state: any, i: number) => {
      const response = await fetch(`${ASSETS}/${state.strip}`);
      if (!response.ok) throw new Error(`${state.strip}: HTTP ${response.status}`);
      strips[i] = await createImageBitmap(await response.blob());
      done += 1;
      onProgress(done / manifest.cycle.length);
    }),
  );
  return strips as ImageBitmap[];
}

export function BoardApp({
  slug,
  apiBase,
  boardKey,
  isOwner,
}: {
  slug: string;
  apiBase: string;
  boardKey: string | null;
  isOwner: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<any>(null);
  const controllerRef = useRef<any>(null);

  const [phase, setPhase] = useState<'loading' | 'failed' | 'ready'>('loading');
  const [progress, setProgress] = useState(0);
  const [failure, setFailure] = useState('');
  const [panelOpen, setPanelOpen] = useState(false);
  const [hintVisible, setHintVisible] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [boardState, setBoardState] = useState<any>(null);
  const [target, setTarget] = useState<string>(MAIN);
  const [settings, setSettings] = useState<Settings>(() => loadSettings(localStorage));

  // Refs so the boot effect, keyboard handler, and rAF callback - none of which
  // re-run per render - always see current values.
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const panelOpenRef = useRef(panelOpen);
  panelOpenRef.current = panelOpen;
  const targetRef = useRef(target);
  targetRef.current = target;
  /** Set by the state-publisher hook; called on every state change. */
  const onStateRef = useRef<((state: any) => void) | null>(null);
  /** The fixed method surface remote commands dispatch into. */
  const dispatchRef = useRef<any>(null);
  const [remoteNote, setRemoteNote] = useState('');

  /* ---- board operations ---- */

  const applyConfigure = useCallback((patch: object) => {
    const controller = controllerRef.current;
    if (!controller) return null;
    const state = controller.configure(patch);
    setSettings((prev) => {
      const next: Settings = { ...prev };
      for (const key of MIRRORED) {
        const value = state.grid[key] ?? state.motion[key];
        if (value !== undefined) next[key] = value;
      }
      next.dwellMs = state.dwellMs;
      return next;
    });
    setBoardState(state);
    return state;
  }, []);

  /** Everything the UI shows goes through the same queue as the API. */
  const show = useCallback((text: string, options: object = {}) => {
    const controller = controllerRef.current;
    if (!controller) return;
    try {
      const result = controller.enqueue(text, { source: 'ui', ...options });
      setStatusMsg(describeDiagnostics(result.diagnostics));
    } catch (error: any) {
      setStatusMsg(error.message);
    }
  }, []);

  const addSavedLines = useCallback(() => {
    const controller = controllerRef.current;
    if (!controller) return;
    const entries = String(settingsRef.current.playlist)
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line) => line.trim() !== '');
    if (entries.length === 0) {
      setStatusMsg('No saved lines to add.');
      return;
    }
    // Repeating, so they cycle in the band rather than playing once and
    // stopping. A band's Clear is what stops them again.
    for (const entry of entries) {
      try {
        controller.enqueue(entry, { source: 'ui', region: targetRef.current, repeat: true });
      } catch (error: any) {
        setStatusMsg(error.message);
        return;
      }
    }
    setStatusMsg(`Added ${entries.length} to ${targetRef.current}.`);
  }, []);

  const refreshPanel = useCallback(() => {
    const controller = controllerRef.current;
    if (controller) setBoardState(controller.status());
  }, []);

  const toggleControls = useCallback(
    (force?: boolean) => {
      setPanelOpen((open) => {
        const next = force ?? !open;
        // Nothing is rendered while it is closed, so it needs a full pass on
        // the way in.
        if (next) refreshPanel();
        return next;
      });
    },
    [refreshPanel],
  );

  /* ---- boot ---- */

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let strips: ImageBitmap[] = [];
    let boardObserver: ResizeObserver | null = null;
    let helloTimer: ReturnType<typeof setTimeout> | null = null;
    let ratioQuery: MediaQueryList | null = null;
    let onRatioChange: (() => void) | null = null;

    (async () => {
      let manifest;
      try {
        const response = await fetch(`${ASSETS}/manifest.json`);
        if (!response.ok) throw new Error(`manifest.json: HTTP ${response.status}`);
        manifest = await response.json();
        strips = await loadStrips(manifest, (fraction) => {
          if (!cancelled) setProgress(fraction);
        });
      } catch (error: any) {
        if (cancelled) return;
        console.error(`flapper: tile art failed to load — ${error.message}`);
        setFailure(`Could not load tile art: ${error.message}.`);
        setPhase('failed');
        return;
      }
      if (cancelled) {
        strips.forEach((bitmap) => bitmap.close());
        return;
      }

      const initial = settingsRef.current;
      const board = new Flipboard(canvas, manifest, strips, {
        cols: initial.cols,
        rows: initial.rows,
        footerRows: initial.footerRows,
        align: initial.align,
        valign: initial.valign,
        wrap: initial.wrap,
        fastStepMs: initial.fastStepMs,
        landStepMs: initial.landStepMs,
        sweepMs: initial.sweepMs,
        staggerMode: initial.staggerMode,
        alwaysFlip: initial.alwaysFlip,
      });
      const controller = new Controller(board, { dwellMs: initial.dwellMs });
      boardRef.current = board;
      controllerRef.current = controller;

      // The board settles several times a second in every band, and each of
      // those is a state change. Render the panel at most once a frame and drop
      // the intermediates - only listeners (SSE) want every state.
      let pendingState: any = null;
      let pendingFrame = false;
      controller.onChange = (state: any) => {
        onStateRef.current?.(state);
        pendingState = state;
        if (!panelOpenRef.current || pendingFrame) return;
        pendingFrame = true;
        requestAnimationFrame(() => {
          pendingFrame = false;
          setBoardState(pendingState);
        });
      };

      dispatchRef.current = createDispatch({ controller, applyConfigure });

      // Reachable from the devtools console for tuning an installation live.
      (window as any).flipboard = board;
      (window as any).controller = controller;

      setPhase('ready');

      boardObserver = new ResizeObserver(() => board.resize());
      boardObserver.observe(canvas);

      // devicePixelRatio changes when the window moves to a display with a
      // different scale factor, without the CSS size changing. The media query
      // only matches the ratio it was built for, so re-arm after each change.
      const watchRatio = () => {
        ratioQuery = matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`);
        onRatioChange = () => {
          board.resize();
          watchRatio();
        };
        ratioQuery.addEventListener('change', onRatioChange, { once: true });
      };
      watchRatio();

      // Reconcile with what the board did with the stored settings - a footer
      // height saved against a taller board is clamped here rather than
      // sitting wrong until something touches the API.
      applyConfigure({});

      setHintVisible(true);
      setTimeout(() => {
        if (!panelOpenRef.current) setHintVisible(false);
      }, 3200);

      // Start from a blank board, then flip in so the first thing you see is
      // the effect. Skipped if anything has already driven the board by then.
      helloTimer = setTimeout(() => {
        if (!controller.current && controller.queue.length === 0) show('FLAPPER');
      }, 500);
    })();

    return () => {
      cancelled = true;
      if (helloTimer) clearTimeout(helloTimer);
      boardObserver?.disconnect();
      if (ratioQuery && onRatioChange) ratioQuery.removeEventListener('change', onRatioChange);
      const controller = controllerRef.current;
      if (controller) {
        controller.onChange = null;
        controller.clear();
      }
      controllerRef.current = null;
      boardRef.current = null;
      dispatchRef.current = null;
      strips.forEach((bitmap) => bitmap.close());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- the cloud connection ---- */

  useCommandStream(apiBase, boardKey, phase === 'ready', dispatchRef, setRemoteNote);
  useStatePublisher(apiBase, boardKey, phase === 'ready', onStateRef);

  /* ---- persistence & derived state ---- */

  useEffect(() => {
    if (phase === 'ready') saveSettings(localStorage, settingsRef.current);
  }, [settings, phase]);

  useEffect(() => {
    if (!boardState) return;
    const ids = bandViews(boardState).map((view: any) => view.id);
    setTarget((current) => resolvePanelRegion(current, ids));
  }, [boardState]);

  useEffect(() => {
    setHintVisible(!panelOpen && phase === 'ready');
  }, [panelOpen, phase]);

  /* ---- keyboard ---- */

  useEffect(() => {
    const isTyping = () => {
      const node = document.activeElement;
      if (!node) return false;
      // SELECT included: a focused dropdown swallows the shortcut keys
      // otherwise, and space over one both opens it and fires the panel's
      // space binding.
      return ['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      if (event.key === 'Escape') {
        event.preventDefault();
        // The panic key: every band, blank. Each band's own Clear is the
        // considered version.
        controllerRef.current?.clear();
        setStatusMsg('Cleared every band.');
        return;
      }

      if (isTyping()) return;

      switch (event.key.toLowerCase()) {
        case 'c':
          event.preventDefault();
          toggleControls();
          break;
        case 'f':
          event.preventDefault();
          if (document.fullscreenElement) document.exitFullscreen();
          else document.documentElement.requestFullscreen();
          break;
        case ' ':
          event.preventDefault();
          addSavedLines();
          break;
        case 'enter':
          event.preventDefault();
          toggleControls(true);
          break;
        default:
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [toggleControls, addSavedLines]);

  /* ---- render ---- */

  return (
    <>
      <main id="stage">
        <canvas id="board" ref={canvasRef} />
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

      <div id="hint" className={hintVisible || remoteNote !== '' ? 'visible' : ''}>
        {remoteNote !== '' ? (
          remoteNote
        ) : (
          <>
            Press <kbd>C</kbd> for controls
          </>
        )}
      </div>

      {panelOpen && phase === 'ready' && (
        <Panel
          slug={slug}
          isOwner={isOwner}
          settings={settings as any}
          boardState={boardState}
          target={target}
          statusMsg={statusMsg}
          maxFooterRows={controllerRef.current?.capabilities().maxFooterRows ?? 10}
          onPatch={applyConfigure}
          onSetSetting={(key, value) => setSettings((prev) => ({ ...prev, [key]: value }))}
          onSend={(text, options) => show(text, options)}
          onAddSaved={addSavedLines}
          onTarget={(region) => {
            setTarget(region);
            refreshPanel();
          }}
          onFlush={(region) => {
            const removed = controllerRef.current?.flush(region) ?? 0;
            setStatusMsg(
              removed ? `Dropped ${removed} waiting in ${region}.` : `Nothing waiting in ${region}.`,
            );
            refreshPanel();
          }}
          onClear={(region) => {
            controllerRef.current?.clear(region);
            setStatusMsg(`Cleared ${region}.`);
            refreshPanel();
          }}
        />
      )}
    </>
  );
}
