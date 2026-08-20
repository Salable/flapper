'use client';

/**
 * The flapper as a reusable object: the real rendering engine - the same
 * Flipboard the display page runs, same tile art, same motion - in an
 * embeddable box. Give it a line of text and a tile size and it flips the
 * text in from blank; leave `ambient` on and it keeps itself alive the way
 * a real installation does (lib/board/idle.mjs owns that choreography).
 *
 * Server-side (and until the tile art has decoded) it renders the CSS
 * MiniBoard in the same footprint, so the brand never blanks and the swap
 * is a settle, not a jump. Reduced motion gets the text immediately and no
 * ambient loop.
 */

import { useEffect, useRef, useState } from 'react';
import { Flipboard } from '@/lib/board/flipboard.js';
import { idleAction, withFlicker } from '@/lib/board/idle.mjs';
import { loadFlapperAssets } from '@/components/flapper/assets';
import { MiniBoard } from '@/components/ui/MiniBoard';

const GAP_RATIO = 0.08;
/** One ambient beat ~ every 5s; idle.mjs decides what (mostly nothing). */
const AMBIENT_MS = 5000;
const FLICKER_MS = 900;

export function Flapper({
  text,
  tilePx = 26,
  ambient = true,
  className,
}: {
  text: string;
  /** Tile edge in CSS px; the box is sized from it, so no layout shift. */
  tilePx?: number;
  /** The self-animation: occasional flickers and sweeps. Off = a still sign. */
  ambient?: boolean;
  className?: string;
}) {
  const line = text.toUpperCase();
  const cols = Math.max(1, line.length);
  const gap = Math.max(1, Math.round(tilePx * GAP_RATIO));
  const width = cols * tilePx + (cols - 1) * gap;
  const height = tilePx;

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    let board: any = null;
    let tick = 0;
    let beat: ReturnType<typeof setInterval> | null = null;
    let restore: ReturnType<typeof setTimeout> | null = null;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;

    (async () => {
      let assets;
      try {
        assets = await loadFlapperAssets();
      } catch {
        return; // the MiniBoard fallback simply stays
      }
      if (cancelled) return;

      board = new Flipboard(canvas, assets.manifest, assets.strips, {
        cols,
        rows: 1,
        padding: 0,
        gapRatio: GAP_RATIO,
        background: '#0a0a0b',
      });
      setReady(true);
      // The entrance: tiles start blank and flip the text in.
      board.setText(line, { immediate: still });

      if (still || !ambient) return;
      beat = setInterval(() => {
        if (!board) return;
        tick += 1;
        const action = idleAction(line, board.charset, tick);
        if (action.kind === 'sweep') {
          // One full revolution of every tile, staggered - the board clearing
          // its throat.
          board.setOptions({ alwaysFlip: true });
          board.setText(line);
          board.setOptions({ alwaysFlip: false });
        } else if (action.kind === 'flicker') {
          // A tile misfires, then corrects - all the way around, forward.
          board.setText(withFlicker(line, action));
          restore = setTimeout(() => board?.setText(line), FLICKER_MS);
        }
      }, AMBIENT_MS);
    })();

    return () => {
      cancelled = true;
      if (beat) clearInterval(beat);
      if (restore) clearTimeout(restore);
      board?.stop?.();
      board = null;
      setReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [line, cols, tilePx, ambient]);

  return (
    <span
      className={className}
      role="img"
      aria-label={text}
      style={{ position: 'relative', display: 'inline-block', width, height }}
    >
      {!ready && (
        <span
          aria-hidden
          style={{ position: 'absolute', inset: 0, display: 'inline-flex', alignItems: 'center' }}
        >
          <MiniBoard text={text} fit={tilePx} />
        </span>
      )}
      <canvas
        ref={canvasRef}
        style={{ position: 'absolute', inset: 0, width, height, visibility: ready ? 'visible' : 'hidden' }}
      />
    </span>
  );
}
