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
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<any>(null);
  const [error, setError] = useState('');
  const [replays, setReplays] = useState(0);
  const messages = Array.isArray(text) ? text : [text];
  const showing = messages[replays % messages.length] ?? '';

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
            boardRef.current = new Flipboard(canvas, skin, { cols, rows, padding: 6 });
            boardRef.current.setText(showing);
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
  }, [pack, cols, rows, showing]);

  useEffect(() => {
    boardRef.current?.setOptions({ cols, rows });
  }, [cols, rows]);

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

  // The canvas box settles after first paint and moves with the window.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => boardRef.current?.resize());
    observer.observe(canvas);
    return () => observer.disconnect();
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

  const gap = Math.round(tilePx * 0.035);
  const width = cols * tilePx + (cols - 1) * gap + 12;
  const height = rows * tilePx + (rows - 1) * gap + 12;
  return (
    <div className="theme-preview">
      <canvas
        ref={canvasRef}
        className={onText ? 'theme-preview-canvas is-editable' : 'theme-preview-canvas'}
        style={{ width: '100%', maxWidth: width, aspectRatio: `${width} / ${height}`, display: 'block', background: '#0a0a0b', borderRadius: 6 }}
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
      <div className="theme-preview-bar">
        <Button size="sm" variant="ghost" onClick={() => setReplays((n) => n + 1)}>
          Flip again
        </Button>
        {error !== '' && <span className="error">{error}</span>}
      </div>
    </div>
  );
}
