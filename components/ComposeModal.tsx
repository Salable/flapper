'use client';

/**
 * Composing away from the glass.
 *
 * Typing straight onto the live canvas (the old compose box) has no cursor
 * to move, no selection, no paste - one key lands on one cell and that is
 * the whole vocabulary. Fine for judging a design against a few words;
 * unpleasant for actually writing a message. This is the same act in a
 * popup shaped like where it is going - fixed-width, the board's own
 * palette - but backed by a real textarea, so editing it feels like editing
 * text: arrow keys, backspace mid-line, paste, all of it.
 *
 * The preview above the textarea is the real engine (ThemePreview, same as
 * everywhere else a pack is judged), given the same align/valign/wrap this
 * modal will actually post - what it shows here is what lands, the same
 * promise the canvas used to make, kept a different way.
 */

import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select } from '@/components/ui/Field';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

export type TextLayout = {
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  wrap: 'word' | 'char' | 'none';
};

export function ComposeModal({
  open,
  onClose,
  title,
  submitLabel,
  pack,
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
  pack: ThemePack;
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

  function submit() {
    if (text.trim() === '') return;
    onSubmit(text, layout);
  }

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="compose-modal">
        <ThemePreview
          pack={pack}
          text={text}
          cols={cols}
          rows={rows}
          tilePx={36}
          bar={false}
          align={layout.align}
          valign={layout.valign}
          wrap={layout.wrap}
        />
        {error !== '' && <p className="error">{error}</p>}
        <textarea
          className="compose-textarea"
          autoFocus
          rows={Math.max(3, Math.min(8, rows))}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
          placeholder="Type what it should say…"
        />
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
