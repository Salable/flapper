'use client';

/**
 * The display layout picker: a miniature of the screen where you drag the
 * board around and scale it by its corner. Writes config.layout as
 * percentages of the viewport, which the display page applies - so one
 * layout fits every screen size. Built to grow into multiple sections later:
 * the region is an array of one today.
 */

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { fitInRegion, gridFor } from '@/lib/board/geometry.mjs';

export type Layout = { xPct: number; yPct: number; wPct: number; hPct: number };

const FULL: Layout = { xPct: 0, yPct: 0, wPct: 100, hPct: 100 };
const MIN_PCT = 15;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function LayoutPicker({
  initial,
  onSave,
  busy = false,
  screen = { w: 16, h: 9 },
  grid = gridFor(),
}: {
  initial?: Partial<Layout> | null;
  onSave: (layout: Layout) => void;
  busy?: boolean;
  /** The screen being designed for. The stage takes its shape. */
  screen?: { w: number; h: number };
  /** The board's own grid, drawn inside the region so a letterbox is visible. */
  grid?: { cols: number; rows: number };
}) {
  const [layout, setLayout] = useState<Layout>({ ...FULL, ...(initial ?? {}) });
  const [dirty, setDirty] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    kind: 'move' | 'scale';
    startX: number;
    startY: number;
    origin: Layout;
  } | null>(null);

  function begin(kind: 'move' | 'scale', event: React.PointerEvent) {
    event.preventDefault();
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    gesture.current = { kind, startX: event.clientX, startY: event.clientY, origin: layout };
  }

  function track(event: React.PointerEvent) {
    const active = gesture.current;
    const stage = stageRef.current;
    if (!active || !stage) return;
    const rect = stage.getBoundingClientRect();
    const dx = ((event.clientX - active.startX) / rect.width) * 100;
    const dy = ((event.clientY - active.startY) / rect.height) * 100;
    const { origin } = active;
    if (active.kind === 'move') {
      setLayout({
        ...origin,
        xPct: clamp(origin.xPct + dx, 0, 100 - origin.wPct),
        yPct: clamp(origin.yPct + dy, 0, 100 - origin.hPct),
      });
    } else {
      setLayout({
        ...origin,
        wPct: clamp(origin.wPct + dx, MIN_PCT, 100 - origin.xPct),
        hPct: clamp(origin.hPct + dy, MIN_PCT, 100 - origin.yPct),
      });
    }
    setDirty(true);
  }

  function end() {
    gesture.current = null;
  }

  const pct = (value: number) => `${value}%`;
  const round1 = (value: number) => Math.round(value * 10) / 10;

  /* The board could only be placed by dragging it, which left the layout
     unreachable by keyboard and its values unknowable - you could see roughly
     where the board sat but never say where. Arrows nudge, Shift+arrows size,
     and the four numbers below are the same state, typed. */
  function nudge(event: React.KeyboardEvent) {
    const step = event.altKey ? 0.5 : 1;
    const sizing = event.shiftKey;
    const move: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const delta = move[event.key];
    if (!delta) return;
    event.preventDefault();
    const [dx, dy] = delta;
    setLayout((prev) =>
      sizing
        ? {
            ...prev,
            wPct: round1(clamp(prev.wPct + dx, MIN_PCT, 100 - prev.xPct)),
            hPct: round1(clamp(prev.hPct + dy, MIN_PCT, 100 - prev.yPct)),
          }
        : {
            ...prev,
            xPct: round1(clamp(prev.xPct + dx, 0, 100 - prev.wPct)),
            yPct: round1(clamp(prev.yPct + dy, 0, 100 - prev.hPct)),
          },
    );
    setDirty(true);
  }

  function setValue(key: keyof Layout, raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    setLayout((prev) => {
      const next = { ...prev, [key]: value };
      // Keep the board on the screen whichever number moved.
      next.wPct = clamp(next.wPct, MIN_PCT, 100);
      next.hPct = clamp(next.hPct, MIN_PCT, 100);
      next.xPct = clamp(next.xPct, 0, 100 - next.wPct);
      next.yPct = clamp(next.yPct, 0, 100 - next.hPct);
      return next;
    });
    setDirty(true);
  }

  /* What the region actually does to the board. A 20x8 board is 2.5:1; drop it
     in a region that is not 2.5:1 and it letterboxes, which nothing on this
     screen used to say. */
  const fit = {
    exact: 'The board fills this region exactly.',
    'bands-sides':
      'The board is taller than this region: it will fit the height and leave bands left and right.',
    'bands-top-bottom':
      'The board is wider than this region: it will fit the width and leave bands top and bottom.',
  }[fitInRegion(grid.cols, grid.rows, screen.w * layout.wPct, screen.h * layout.hPct)];

  const number = (key: keyof Layout, label: string) => (
    <Field label={label} htmlFor={`layout-${key}`}>
      <TextInput
        id={`layout-${key}`}
        type="number"
        className="ui-input layout-number"
        min={key === 'wPct' || key === 'hPct' ? MIN_PCT : 0}
        max={100}
        step={0.5}
        value={String(round1(layout[key]))}
        onChange={(event) => setValue(key, event.target.value)}
      />
    </Field>
  );

  return (
    <div className="ui-field">
      <span className="ui-label">Position on the screen</span>
      <div
        className="layout-stage"
        ref={stageRef}
        style={{ aspectRatio: `${screen.w} / ${screen.h}` }}
      >
        <div
          className="layout-region"
          role="group"
          tabIndex={0}
          aria-label={`The board: ${round1(layout.wPct)}% by ${round1(layout.hPct)}% of the screen, ${round1(layout.xPct)}% from the left and ${round1(layout.yPct)}% from the top. Arrow keys move it, Shift and arrow keys size it.`}
          style={{
            left: pct(layout.xPct),
            top: pct(layout.yPct),
            width: pct(layout.wPct),
            height: pct(layout.hPct),
          }}
          onKeyDown={nudge}
          onPointerDown={(event) => begin('move', event)}
          onPointerMove={track}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <span
            className="layout-board"
            style={{ aspectRatio: `${grid.cols} / ${grid.rows}` }}
          >
            <span className="layout-region-label">
              {grid.cols} × {grid.rows}
            </span>
          </span>
          <span
            className="layout-handle"
            onPointerDown={(event) => {
              event.stopPropagation();
              begin('scale', event);
            }}
            onPointerMove={track}
            onPointerUp={end}
            onPointerCancel={end}
          />
        </div>
      </div>
      <p className="layout-fit">{fit}</p>
      <div className="layout-numbers">
        {number('xPct', 'From left %')}
        {number('yPct', 'From top %')}
        {number('wPct', 'Width %')}
        {number('hPct', 'Height %')}
      </div>
      <span className="ui-hint">
        Drag to place the board, pull the corner to size it, or type the numbers. With the board
        focused, arrow keys move it and Shift with an arrow sizes it. Percentages of the screen, so
        the same layout fits a phone and a video wall.
      </span>
      <div className="ui-modal-actions" style={{ justifyContent: 'flex-start' }}>
        <Button
          variant="primary"
          size="sm"
          disabled={busy || !dirty}
          onClick={() => {
            onSave({
              xPct: Math.round(layout.xPct * 10) / 10,
              yPct: Math.round(layout.yPct * 10) / 10,
              wPct: Math.round(layout.wPct * 10) / 10,
              hPct: Math.round(layout.hPct * 10) / 10,
            });
            setDirty(false);
          }}
        >
          Apply layout
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setLayout(FULL);
            setDirty(true);
          }}
        >
          Full screen
        </Button>
      </div>
    </div>
  );
}
