'use client';

/**
 * A board drawn from a pack, for judging it: the real engine, the real
 * skin, re-skinned whenever the pack changes. Debounced, because the editor
 * changes it on every keystroke of a colour; fonts and art are cached by
 * the loader, so a rebuild is the cards and nothing else.
 */

import { useEffect, useRef, useState } from 'react';
import { Flipboard } from '@/lib/board/flipboard.js';
import { loadProcedural } from '@/components/flapper/assets';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';
import { Button } from '@/components/ui/Button';

const DEBOUNCE_MS = 120;

export function ThemePreview({
  pack,
  text,
  cols = 14,
  rows = 3,
  tilePx = 56,
  onText,
  bar = true,
  fixed = false,
  loop = 0,
}: {
  pack: ThemePack;
  /**
   * One message, or several to alternate between. Several is how the uneven
   * travel becomes visible: a tile only moves forward round the ring, so going
   * from A to B is one step and from Z to A is thirty-odd. Flipping the same
   * text again sends every tile the same distance every time and shows none of
   * that; flipping to a *different* message does.
   */
  text: string | string[];
  cols?: number;
  rows?: number;
  tilePx?: number;
  /**
   * Given, the board becomes the typing panel: click it and type, and what
   * you type is what the glass shows. Judging a design against a fixed
   * pangram tells you very little about whether your own words fit.
   */
  onText?: (text: string) => void;
  /**
   * Off for a board used as a picture - the posters on /new are twelve boards
   * on one page and twelve Flip again buttons would be noise. They still flip
   * once on arrival, which is the point of them being real.
   */
  bar?: boolean;
  /**
   * Fixed sizing rather than fluid.
   *
   * Fluid is right where the board should follow its column: `width: 100%` up
   * to a cap, measured back by a ResizeObserver. But a row of posters that all
   * ask for the same size must *get* the same size, and measurement is a race -
   * one card in a rail came out 205px wide where its neighbours were 212, for
   * no reason anybody could see except that it was measured a moment earlier.
   * Given an exact tile size there is nothing to measure, so don't.
   */
  fixed?: boolean;
  /**
   * Advance to the next message every `loop` ms, for a board being used to
   * demonstrate a behaviour rather than a design. 0 is off, which is what
   * everything else wants.
   */
  loop?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<any>(null);
  const [error, setError] = useState('');
  const [replays, setReplays] = useState(0);
  const messages = Array.isArray(text) ? text : [text];
  const showing = messages[replays % messages.length] ?? '';
  // What to paint the moment the board exists. Held in a ref so the effect that
  // builds the board does not depend on the text: a message change should flip
  // the tiles, not rebuild a skin and its forty-two cards.
  const firstText = useRef(showing);
  firstText.current = showing;

  // The box this board wants, in CSS pixels. Declared here because the effects
  // below hand it to Flipboard rather than have it measured.
  const gap = Math.round(tilePx * 0.035);
  const width = cols * tilePx + (cols - 1) * gap + 12;
  const height = rows * tilePx + (rows - 1) * gap + 12;

  // Build (or re-skin) after the pack has been still for a moment.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      loadProcedural(pack)
        .then((skin) => {
          if (cancelled) return;
          if (!boardRef.current) {
            boardRef.current = new Flipboard(canvas, skin, {
              cols,
              rows,
              padding: 6,
              // Told, not measured - see Flipboard.resize.
              ...(fixed ? { cssSize: { width, height } } : {}),
            });
            // Fluid boards still have to measure, and the box may still be
            // settling: the ResizeObserver below cannot help, because it fires
            // when it starts observing - before this board exists - and never
            // again if the box does not change afterwards.
            if (!fixed) requestAnimationFrame(() => boardRef.current?.resize());
            boardRef.current.setText(firstText.current);
          } else {
            boardRef.current.setSkin(skin);
          }
          setError('');
        })
        .catch((err: any) => {
          if (!cancelled) setError(err.message);
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pack, cols, rows, fixed, width, height]);

  useEffect(() => {
    boardRef.current?.setOptions({ cols, rows });
  }, [cols, rows]);

  /*
   * Stop drawing while off screen.
   *
   * A wash that moves - a drift, a runner going round the edge - is a reason to
   * keep asking for frames, and that used to mean asking forever. On a page of
   * designs, every card below the fold went on repainting for nobody; at the
   * sixty-design limit that is sixty loops nobody is looking at, which is fan
   * noise on a laptop and worse on the hardware a wall runs on.
   *
   * A board that is not visible is parked and picked up again on the way back.
   * Nothing is lost by it: a drift and a runner are both functions of the
   * clock, so they resume where they would have been rather than where they
   * stopped.
   */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const board = boardRef.current;
        if (!board) return;
        if (entry.isIntersecting) board.start?.();
        else board.stop?.();
      },
      { rootMargin: '200px' },
    );
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // On the way out, for good. A board with anything left to draw otherwise
  // keeps a frame loop alive on a canvas nobody can see, for the life of the
  // tab, one per visit to the page.
  useEffect(
    () => () => {
      boardRef.current?.stop?.();
      boardRef.current = null;
    },
    [],
  );

  // Flip the text in again: blank, then the text, so the motion can be judged.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    // With more than one message, going straight to the next is the point:
    // blanking first would send every tile from the blank and make the travel
    // even again, which is the thing we are trying to show.
    if (replays === 0 || messages.length > 1) {
      board.setText(showing);
      return;
    }
    board.clear();
    const timer = setTimeout(() => board.setText(showing), 400);
    return () => clearTimeout(timer);
  }, [showing, replays, messages.length]);

  // A board that is demonstrating rather than sitting still.
  useEffect(() => {
    if (!loop || messages.length < 2) return;
    const timer = setInterval(() => setReplays((n) => n + 1), loop);
    return () => clearInterval(timer);
  }, [loop, messages.length]);

  // The canvas box settles after first paint and moves with the window.
  useEffect(() => {
    const canvas = canvasRef.current;
    // A board that was told its size has nothing to watch for.
    if (fixed || !canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => boardRef.current?.resize());
    // And once the board arrives, whenever that is.
    const settle = requestAnimationFrame(() => boardRef.current?.resize());
    observer.observe(canvas);
    return () => {
      cancelAnimationFrame(settle);
      observer.disconnect();
    };
  }, []);

  /* The board is the input. Rows are lines and columns are characters, so the
     grid is also the limit - you cannot type more than the board can hold, and
     running out of room is something you should feel here rather than discover
     on the wall. Anything outside the ring is left to the layout engine, which
     substitutes and reports. */
  function type(event: React.KeyboardEvent<HTMLCanvasElement>) {
    if (!onText || Array.isArray(text)) return;
    const lines = text.split('\n');
    const last = () => lines[lines.length - 1] ?? '';

    if (event.key === 'Enter') {
      event.preventDefault();
      if (lines.length >= rows) return;
      onText(`${text}\n`);
      return;
    }
    if (event.key === 'Backspace') {
      event.preventDefault();
      onText(text.slice(0, -1));
      return;
    }
    if (event.key === 'Escape') {
      event.currentTarget.blur();
      return;
    }
    // One printable character, and no modifier combination we should swallow.
    if (event.key.length !== 1 || event.metaKey || event.ctrlKey || event.altKey) return;
    event.preventDefault();
    if (last().length >= cols) {
      if (lines.length >= rows) return;
      onText(`${text}\n${event.key.toUpperCase()}`);
      return;
    }
    onText(text + event.key.toUpperCase());
  }

  return (
    <div className="theme-preview">
      <canvas
        ref={canvasRef}
        className={onText ? 'theme-preview-canvas is-editable' : 'theme-preview-canvas'}
        style={
          fixed
            ? { width, height, display: 'block', background: '#0a0a0b', borderRadius: 6 }
            : {
                width: '100%',
                maxWidth: width,
                aspectRatio: `${width} / ${height}`,
                display: 'block',
                background: '#0a0a0b',
                borderRadius: 6,
              }
        }
        tabIndex={onText ? 0 : undefined}
        role={onText ? 'textbox' : 'img'}
        aria-multiline={onText ? true : undefined}
        aria-label={
          onText
            ? `The board, ${cols} by ${rows} cards. Click and type to put words on it; Enter starts a new row.`
            : 'Theme preview'
        }
        onKeyDown={onText ? type : undefined}
      />
      {bar ? (
        <div className="theme-preview-bar">
          <Button size="sm" variant="ghost" onClick={() => setReplays((n) => n + 1)}>
            Flip again
          </Button>
          {error !== '' && <span className="error">{error}</span>}
        </div>
      ) : (
        // No bar, but a failed skin load must still say so somewhere - without
        // this a poster whose design would not build is just a blank rectangle
        // with no signal anywhere on the page.
        error !== '' && <span className="error">{error}</span>
      )}
    </div>
  );
}
