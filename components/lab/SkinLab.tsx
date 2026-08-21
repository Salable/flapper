'use client';

import { useEffect, useRef, useState } from 'react';
import { Flipboard } from '@/lib/board/flipboard.js';
import { THEMES as REGISTRY, THEME_IDS } from '@/lib/board/themes.mjs';

const THEMES: Record<string, any> = REGISTRY;
import { validatePack } from '@/lib/board/theme-pack.mjs';
import { loadSkin, loadProcedural, type Skin } from '@/components/flapper/assets';

const EVERY_GLYPH = 'THE QUICK BROWN FOX\nJUMPS OVER 13 LAZY DOGS\n0123456789 .,!()\nHELLO, WORLD!';

/** One board on one canvas, re-skinned whenever `skin` changes. */
function Bench({ skin, text, rows, cols, tilePx, label }: { skin: Skin | null; text: string; rows: number; cols: number; tilePx: number; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boardRef = useRef<any>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !skin) return;
    if (!boardRef.current) {
      boardRef.current = new Flipboard(canvas, skin, { cols, rows, padding: 8 });
      // Like window.flipboard on the display: a handle for poking at the bench.
      const w = window as any;
      w.skinlab = { ...(w.skinlab || {}), [label]: boardRef.current };
    } else {
      try {
        boardRef.current.setSkin(skin);
      } catch (error: any) {
        console.warn(error.message);
      }
    }
  }, [skin, cols, rows]);

  useEffect(() => {
    boardRef.current?.setOptions({ cols, rows });
    boardRef.current?.resize();
  }, [cols, rows, tilePx]);

  // The canvas box settles after first paint and moves with the window;
  // the backing store has to follow it or the board draws small and blurry.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => boardRef.current?.resize());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [skin]);

  useEffect(() => {
    boardRef.current?.setText(text);
  }, [text, skin]);

  const width = cols * tilePx + (cols - 1) * Math.round(tilePx * 0.035) + 16;
  const height = rows * tilePx + (rows - 1) * Math.round(tilePx * 0.035) + 16;
  return (
    <figure style={{ margin: 0 }}>
      <canvas ref={canvasRef} style={{ width: '100%', maxWidth: width, aspectRatio: `${width} / ${height}`, display: 'block', background: '#0a0a0b' }} />
      <figcaption className="muted" style={{ marginTop: 6 }}>{label}</figcaption>
    </figure>
  );
}

export function SkinLab() {
  const [leftId, setLeftId] = useState('classic');
  const [left, setLeft] = useState<Skin | null>(null);
  const [json, setJson] = useState(() => JSON.stringify(stripKind(THEMES['classic-p']), null, 2));
  const [right, setRight] = useState<Skin | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [text, setText] = useState(EVERY_GLYPH);
  const [pending, setPending] = useState(EVERY_GLYPH);
  const [tilePx, setTilePx] = useState(64);
  const [cols, setCols] = useState(20);
  const [rows, setRows] = useState(4);

  useEffect(() => {
    let cancelled = false;
    loadSkin(leftId).then((skin) => {
      if (!cancelled) setLeft(skin);
    });
    return () => {
      cancelled = true;
    };
  }, [leftId]);

  const apply = async () => {
    let parsed;
    try {
      parsed = JSON.parse(json);
    } catch (error: any) {
      setErrors([`JSON: ${error.message}`]);
      return;
    }
    const result = validatePack(parsed);
    if (!result.ok) {
      setErrors(result.errors ?? []);
      return;
    }
    setErrors([]);
    try {
      setRight(await loadProcedural(result.pack));
    } catch (error: any) {
      setErrors([error.message]);
    }
  };

  useEffect(() => {
    apply();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
        <label className="field">
          <span className="field-label">Left (reference)</span>
          <select value={leftId} onChange={(e) => setLeftId(e.target.value)}>
            {THEME_IDS.map((id) => (
              <option key={id} value={id}>{THEMES[id].name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          <span className="field-label">Tile px: {tilePx}</span>
          <input type="range" min={16} max={160} value={tilePx} onChange={(e) => setTilePx(Number(e.target.value))} />
        </label>
        <label className="field">
          <span className="field-label">Cols</span>
          <input type="number" min={1} max={40} value={cols} onChange={(e) => setCols(Math.max(1, Number(e.target.value) || 1))} style={{ width: 64 }} />
        </label>
        <label className="field">
          <span className="field-label">Rows</span>
          <input type="number" min={1} max={12} value={rows} onChange={(e) => setRows(Math.max(1, Number(e.target.value) || 1))} style={{ width: 64 }} />
        </label>
        <button className="button" type="button" onClick={() => setText(pending)}>Flip</button>
        <button className="button" type="button" onClick={() => { setText(''); }}>Clear</button>
        <button
          className="button"
          type="button"
          onClick={() => {
            const id = THEME_IDS.find((t) => THEMES[t].kind === 'procedural' && t !== 'classic-p') || 'classic-p';
            setJson(JSON.stringify(stripKind(THEMES[id]), null, 2));
          }}
        >
          Load canary-p
        </button>
      </div>
      <textarea value={pending} onChange={(e) => setPending(e.target.value)} rows={4} style={{ fontFamily: 'var(--next-font-mono)', width: '100%' }} />
      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: '1fr' }}>
        <Bench skin={left} text={text} rows={rows} cols={cols} tilePx={tilePx} label={`${THEMES[leftId].name} — ${THEMES[leftId].kind}`} />
        <Bench skin={right} text={text} rows={rows} cols={cols} tilePx={tilePx} label="Pack below — procedural" />
      </div>
      <div style={{ display: 'grid', gap: 8 }}>
        <textarea value={json} onChange={(e) => setJson(e.target.value)} rows={22} spellCheck={false} style={{ fontFamily: 'var(--next-font-mono)', width: '100%' }} />
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button className="button button-primary" type="button" onClick={apply}>Apply pack</button>
          {errors.length > 0 && (
            <ul style={{ margin: 0, color: 'var(--danger, #e5484d)' }}>
              {errors.map((e) => <li key={e}>{e}</li>)}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

function stripKind(theme: any) {
  const { kind, ...pack } = theme;
  return pack;
}
