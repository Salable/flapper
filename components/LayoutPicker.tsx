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

export type Layout = { xPct: number; yPct: number; wPct: number; hPct: number };

const FULL: Layout = { xPct: 0, yPct: 0, wPct: 100, hPct: 100 };
const MIN_PCT = 15;

const clamp = (value: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, value));

export function LayoutPicker({
  initial,
  onSave,
  busy = false,
}: {
  initial?: Partial<Layout> | null;
  onSave: (layout: Layout) => void;
  busy?: boolean;
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

  return (
    <div className="ui-field">
      <span className="ui-label">Position on the screen</span>
      <div className="layout-stage" ref={stageRef}>
        <div
          className="layout-region"
          style={{
            left: pct(layout.xPct),
            top: pct(layout.yPct),
            width: pct(layout.wPct),
            height: pct(layout.hPct),
          }}
          onPointerDown={(event) => begin('move', event)}
          onPointerMove={track}
          onPointerUp={end}
          onPointerCancel={end}
        >
          <span className="layout-region-label">BOARD</span>
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
      <span className="ui-hint">
        Drag to place the board; pull the corner to size it. Percentages of the screen, so the
        same layout fits a phone and a video wall.
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
