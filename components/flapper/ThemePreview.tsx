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
import { Button } from '@/components/ui/Button';

const DEBOUNCE_MS = 120;

export function ThemePreview({
  pack,
  text,
  cols = 14,
  rows = 3,
  tilePx = 56,
}: {
  pack: any;
  text: string;
  cols?: number;
  rows?: number;
  tilePx?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<any>(null);
  const [error, setError] = useState('');
  const [replays, setReplays] = useState(0);

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
            boardRef.current.setText(text);
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
  }, [pack, cols, rows, text]);

  useEffect(() => {
    boardRef.current?.setOptions({ cols, rows });
  }, [cols, rows]);

  // Flip the text in again: blank, then the text, so the motion can be judged.
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    if (replays === 0) {
      board.setText(text);
      return;
    }
    board.clear();
    const timer = setTimeout(() => board.setText(text), 400);
    return () => clearTimeout(timer);
  }, [text, replays]);

  // The canvas box settles after first paint and moves with the window.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => boardRef.current?.resize());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  const gap = Math.round(tilePx * 0.035);
  const width = cols * tilePx + (cols - 1) * gap + 12;
  const height = rows * tilePx + (rows - 1) * gap + 12;
  return (
    <div className="theme-preview">
      <canvas
        ref={canvasRef}
        style={{ width: '100%', maxWidth: width, aspectRatio: `${width} / ${height}`, display: 'block', background: '#0a0a0b', borderRadius: 6 }}
        aria-label="Theme preview"
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
