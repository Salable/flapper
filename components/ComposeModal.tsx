'use client';

/**
 * Composing away from the glass, in one view rather than two.
 *
 * Typing straight onto the live canvas (the very first version of this) has
 * no cursor to move, no selection, no paste - one key lands on one cell and
 * that is the whole vocabulary. A real textarea fixed that, but showing it
 * beside a separate animated preview meant judging alignment against a
 * second thing rather than the thing you were typing into - and a real flap
 * board is a poor match for a text box's own rhythm of edits anyway.
 *
 * So the textarea itself is the board now: a fixed cols x rows box, an
 * empty-cell dot for every tile nothing has reached yet, sized in real
 * monospace character units so what fits on a line here is what fits on the
 * glass. Align is the textarea's own `text-align` - exact, it is the same
 * property. Vertical is where the flex box holding it puts it. Both are
 * approximations of the server's actual `layout()` (which also wraps,
 * pages, and reports what it had to drop) rather than that function
 * running live - close enough to compose by, and what finally lands is
 * whatever the preview would have shown anyway: the same `text` posted,
 * laid out by the same engine, after the fact.
 */

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';

export type TextLayout = {
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  wrap: 'word' | 'char' | 'none';
};

const JUSTIFY: Record<TextLayout['valign'], string> = {
  top: 'flex-start',
  middle: 'center',
  bottom: 'flex-end',
};

// A single-width placeholder, not `[]` - the grid is one character per cell,
// and a two-character glyph there would be a cell and a half wide next to
// real letters.
const EMPTY_CELL = '·';

/*
 * The grid box's line height and its own footprint, set inline (not in
 * board.css) because the box's pixel height below is computed from these
 * same numbers - `rows` lines of exactly this size. One source, so they
 * cannot drift apart.
 *
 * Font size is not one of them - it is fitted per board (see fontSizeFor),
 * because a fixed size does not survive contact with every card size a
 * board can be. `cols` runs 8 (huge) to 48 (tiny), `rows` up to 40 on an
 * unusual screen - at 16px a huge board's own placeholder text wraps
 * across three lines for want of eight characters' width, and a tiny
 * board's grid runs to 650px tall, pushing Align/Vertical/Wrap and the
 * button that actually sends it below the fold. Fitted to a footprint
 * instead, clamped so it never goes unreadable at one extreme or silly
 * oversized at the other - past that clamp (a very tall custom screen at
 * a small card size) the box is still capped, just no longer guaranteed
 * to show every row without scrolling, which is what happened everywhere
 * before this.
 */
const LINE_HEIGHT = 1.5;
const MAX_FONT_SIZE = 16;
const MIN_FONT_SIZE = 9;
const BOX_MAX_HEIGHT = 420;
const BOX_MAX_WIDTH = 640;
// A monospace font's advance width as a fraction of its size - not exact
// (it varies a little face to face), close enough to size the box by; the
// box's actual width is still set in real `ch` units, so whatever this
// under- or overshoots by, the grid drawn is still exactly `cols` wide.
const CH_WIDTH_EM = 0.6;

function fontSizeFor(cols: number, rows: number) {
  const byHeight = BOX_MAX_HEIGHT / (rows * LINE_HEIGHT);
  const byWidth = BOX_MAX_WIDTH / (cols * CH_WIDTH_EM);
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, byHeight, byWidth));
}

export function ComposeModal({
  open,
  onClose,
  title,
  submitLabel,
  cols,
  rows,
  initialText,
  initialLayout,
  busy = false,
  error = '',
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  submitLabel: string;
  cols: number;
  rows: number;
  initialText: string;
  initialLayout: TextLayout;
  busy?: boolean;
  error?: string;
  onSubmit: (text: string, layout: TextLayout) => void;
}) {
  const [text, setText] = useState(initialText);
  const [layout, setLayout] = useState(initialLayout);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Reseeded on every open, not just on mount - the modal is one instance
  // reused for every compose, so a second opening must not show the first
  // one's leftover draft.
  useEffect(() => {
    if (!open) return;
    setText(initialText);
    setLayout(initialLayout);
    // initialText/initialLayout are snapshots taken at open time, not a
    // running state to stay synced with - re-running this on their identity
    // would blow away what's being typed the moment a parent re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) textareaRef.current?.focus();
  }, [open]);

  // A textarea does not size itself to its content, so left at its default
  // it would either clip a third line or sit stretched to the box's full
  // height regardless of Vertical - defeating the point of Vertical. Grown
  // to fit what's typed instead, up to the box's own max-height (CSS), past
  // which it scrolls like any overflowing text does.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
    // layout.wrap is a dependency, not just text: switching Wrap changes the
    // textarea's own `wrap` attribute, which changes scrollHeight for the
    // same text (word-wrapped lines fold, "none" doesn't) - left out, the
    // height only caught up on the next keystroke.
  }, [text, open, layout.wrap]);

  function submit() {
    if (text.trim() === '') return;
    onSubmit(text, layout);
  }

  // One dot per cell, `rows` lines of exactly `cols` - the same shape a
  // stored page is. Only depends on the grid, so it is built once and left
  // alone rather than on every keystroke.
  const dots = Array.from({ length: rows }, () => EMPTY_CELL.repeat(cols)).join('\n');
  const fontSize = fontSizeFor(cols, rows);

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="compose-modal">
        {error !== '' && <p className="error">{error}</p>}
        <div className="compose-board-frame">
          <div
            className="compose-board"
            style={{
              width: `min(${cols}ch, 100%)`,
              height: `${Math.round(rows * fontSize * LINE_HEIGHT)}px`,
              fontSize,
              lineHeight: LINE_HEIGHT,
            }}
          >
            <pre className="compose-board-dots" aria-hidden="true">
              {dots}
            </pre>
            <div className="compose-board-inner" style={{ justifyContent: JUSTIFY[layout.valign] }}>
              <textarea
                ref={textareaRef}
                className="compose-board-input"
                style={{ textAlign: layout.align }}
                wrap={layout.wrap === 'none' ? 'off' : 'soft'}
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    submit();
                  }
                }}
                // Short on purpose: a huge card size is 8 columns wide, and
                // even at full font size "Type what it should say..." wraps
                // across four broken lines there for want of it.
                placeholder="Type here…"
              />
            </div>
          </div>
        </div>
        <div className="compose-modal-layout">
          <Field label="Align" htmlFor="compose-modal-align">
            <Select
              id="compose-modal-align"
              value={layout.align}
              onChange={(event) => setLayout((prev) => ({ ...prev, align: event.target.value as TextLayout['align'] }))}
            >
              <option value="left">Left</option>
              <option value="center">Centre</option>
              <option value="right">Right</option>
            </Select>
          </Field>
          <Field label="Vertical" htmlFor="compose-modal-valign">
            <Select
              id="compose-modal-valign"
              value={layout.valign}
              onChange={(event) => setLayout((prev) => ({ ...prev, valign: event.target.value as TextLayout['valign'] }))}
            >
              <option value="top">Top</option>
              <option value="middle">Middle</option>
              <option value="bottom">Bottom</option>
            </Select>
          </Field>
          <Field label="Wrap" htmlFor="compose-modal-wrap">
            <Select
              id="compose-modal-wrap"
              value={layout.wrap}
              onChange={(event) => setLayout((prev) => ({ ...prev, wrap: event.target.value as TextLayout['wrap'] }))}
            >
              <option value="word">By word</option>
              <option value="char">By character</option>
              <option value="none">Off, clipped</option>
            </Select>
          </Field>
        </div>
        <div className="ui-modal-actions">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button size="sm" variant="primary" onClick={submit} disabled={busy || text.trim() === ''}>
            {submitLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
