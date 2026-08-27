'use client';

/**
 * The popup that edits one slide's content - Name, Source, and whichever
 * setup step the source needs. Text is the only source that does anything
 * real today; API and Animation are honest about not being connected to
 * anything yet (see TODO.md, "The source picker itself" and "Then —
 * sheets") rather than pretending a picker with nowhere to send its choice.
 *
 * Nothing here saves until "Save" - unlike Hold/Align/Valign's own
 * immediate-commit pattern elsewhere in this panel, a popup with a Cancel
 * button has to mean it: closing without saving must actually discard
 * whatever was typed, so every field here is local draft state until then.
 */

import { useEffect, useRef, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { type QueueItem, payloadToBody } from '@/components/queue-item';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

type Align = 'left' | 'center' | 'right';
type Valign = 'top' | 'middle' | 'bottom';
type Source = 'text' | 'api' | 'animation';
type Layout = 'align' | 'free';

function alignOf(item: QueueItem): Align {
  const a = item.payload.options?.align;
  return a === 'left' || a === 'center' || a === 'right' ? a : 'center';
}
function valignOf(item: QueueItem): Valign {
  const v = item.payload.options?.valign;
  return v === 'top' || v === 'middle' || v === 'bottom' ? v : 'middle';
}
function nameOf(item: QueueItem): string {
  const n = item.payload.options?.label;
  return typeof n === 'string' ? n : '';
}
function isRowsItem(item: QueueItem): boolean {
  return !item.payload.text && Array.isArray(item.payload.options?.rows);
}
/** A blank row per board row, the shape a fresh Free-text grid starts from. */
function blankRows(cols: number, rows: number): string[] {
  return Array.from({ length: rows }, () => ' '.repeat(cols));
}

export function SheetEditor({
  open,
  item,
  pack,
  cols,
  rows,
  screenAspect,
  ambientMs = 0,
  onClose,
  onSave,
}: {
  open: boolean;
  item: QueueItem;
  pack: ThemePack;
  cols: number;
  rows: number;
  screenAspect?: number;
  ambientMs?: number;
  onClose: () => void;
  /** Returns whether it worked - the caller's own `error` state reports a
   * failure; this popup just stays open on one rather than losing the draft. */
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState('');
  const [source, setSource] = useState<Source>('text');
  const [textOpen, setTextOpen] = useState(false);
  const [layout, setLayout] = useState<Layout>('align');
  const [align, setAlign] = useState<Align>('center');
  const [valign, setValign] = useState<Valign>('middle');
  const [text, setText] = useState('');
  const [freeRows, setFreeRows] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  // Seeded fresh each time the popup opens for a given item - not on every
  // render, or an edit in progress would be clobbered by the item's own
  // poll landing behind it.
  useEffect(() => {
    if (!open) return;
    setName(nameOf(item));
    setSource('text');
    setAlign(alignOf(item));
    setValign(valignOf(item));
    if (isRowsItem(item)) {
      setLayout('free');
      const raw = item.payload.options?.rows;
      const seeded = Array.isArray(raw) ? raw.slice(0, rows) : [];
      while (seeded.length < rows) seeded.push('');
      setFreeRows(seeded.map((line) => line.padEnd(cols, ' ').slice(0, cols)));
      setText('');
    } else {
      setLayout('align');
      setText(item.payload.text ?? '');
      setFreeRows(blankRows(cols, rows));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, item.id]);

  async function save() {
    setSaving(true);
    const body: Record<string, unknown> = { ...payloadToBody(item.payload) };
    if (name === '') delete body.label;
    else body.label = name;
    if (layout === 'free') {
      body.rows = freeRows;
      delete body.text;
      delete body.align;
      delete body.valign;
    } else {
      body.text = text;
      delete body.rows;
      body.align = align;
      body.valign = valign;
    }
    const ok = await onSave(body);
    setSaving(false);
    if (ok) onClose();
  }

  const previewSample = layout === 'free' ? freeRows.join(' / ').trim() : text.trim();
  const endpointSlot = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') || '…';

  return (
    <>
      <Modal open={open} title="Edit sheet" onClose={onClose}>
        <Field
          label="Name"
          htmlFor="sheet-name"
          hint="What the rail calls this slide - not what it says. Blank shows the text itself instead. For an API sheet, also what a pusher posts to - one name, not two."
        >
          <TextInput id="sheet-name" value={name} onChange={(event) => setName(event.target.value)} />
        </Field>

        <Field label="Source" htmlFor="sheet-source">
          <Select id="sheet-source" value={source} onChange={(event) => setSource(event.target.value as Source)}>
            <option value="text">Text</option>
            <option value="api">API</option>
            <option value="animation">Animation</option>
          </Select>
        </Field>

        {source === 'text' && (
          <div className="sheet-source-setup">
            <div className="sheet-text-preview">
              <span className={`sheet-text-preview-sample${previewSample === '' ? ' is-empty' : ''}`}>
                {previewSample === '' ? 'Nothing typed yet' : previewSample}
              </span>
              <Button size="sm" onClick={() => setTextOpen(true)}>
                Edit text →
              </Button>
            </div>
          </div>
        )}

        {source === 'api' && (
          <div className="sheet-source-setup">
            <Field label="Endpoint">
              <code className="curl">{`POST /api/b/{slug}/sheets/${endpointSlot}`}</code>
            </Field>
            <p className="ui-hint">
              This sheet's own Name, above, is the address - nothing extra to set here. A board can hold several
              API sheets; each is reached by its own name. Not built yet - the endpoint above isn't live.
            </p>
          </div>
        )}

        {source === 'animation' && (
          <div className="sheet-source-setup">
            <Field label="Animation" htmlFor="sheet-animation">
              <Select id="sheet-animation" disabled>
                <option>No animations yet</option>
              </Select>
            </Field>
            <p className="ui-hint">Nothing to pick - none exist yet. The picker can wait here until some do.</p>
          </div>
        )}

        <div className="ui-modal-actions">
          <Button onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </Modal>

      <EditTextPopup
        open={open && textOpen}
        onDone={() => setTextOpen(false)}
        pack={pack}
        cols={cols}
        rows={rows}
        screenAspect={screenAspect}
        ambientMs={ambientMs}
        layout={layout}
        onLayout={setLayout}
        align={align}
        onAlign={setAlign}
        valign={valign}
        onValign={setValign}
        text={text}
        onText={setText}
        freeRows={freeRows}
        onFreeRows={setFreeRows}
      />
    </>
  );
}

/**
 * The nested popup, not folded into Edit sheet's own body - a real text
 * designer needs room a Name/Source-sized dialog doesn't have, the same
 * reasoning ComposeModal was its own popup in the first place.
 *
 * Not built on the shared <Modal>: two independent <Modal>s each bind their
 * own window Escape listener, and the outer's (registered first, on mount)
 * would win a race against the inner's, closing both at once instead of
 * just this one. Reuses `.ui-modal*`'s own classes for identical chrome,
 * with its own capture-phase Escape handler that stops the event before it
 * ever reaches the outer modal's bubble-phase one.
 */
function EditTextPopup({
  open,
  onDone,
  pack,
  cols,
  rows,
  screenAspect,
  ambientMs,
  layout,
  onLayout,
  align,
  onAlign,
  valign,
  onValign,
  text,
  onText,
  freeRows,
  onFreeRows,
}: {
  open: boolean;
  onDone: () => void;
  pack: ThemePack;
  cols: number;
  rows: number;
  screenAspect?: number;
  ambientMs?: number;
  layout: Layout;
  onLayout: (layout: Layout) => void;
  align: Align;
  onAlign: (align: Align) => void;
  valign: Valign;
  onValign: (valign: Valign) => void;
  text: string;
  onText: (text: string) => void;
  freeRows: string[];
  onFreeRows: (rows: string[]) => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [freePos, setFreePos] = useState(0);
  const [gridFocused, setGridFocused] = useState(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onDone();
      }
    };
    window.addEventListener('keydown', onKey, true);
    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) panel.focus();
    return () => window.removeEventListener('keydown', onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  /* One window, not two - switching Layout must never blank what's there.
     Snapshots the currently-typed text into rows (joined with newlines,
     re-flowed fresh) or the rows into a flowing string (joined with
     newlines) before switching, so content survives the round trip. */
  function switchLayout(next: Layout) {
    if (next === layout) return;
    if (next === 'free') {
      const lines = text.toUpperCase().split('\n');
      const seeded = Array.from({ length: rows }, (_, i) => (lines[i] ?? '').padEnd(cols, ' ').slice(0, cols));
      onFreeRows(seeded);
      let last = -1;
      seeded.forEach((line, r) => {
        for (let c = 0; c < cols; c += 1) if (line[c] !== ' ') last = r * cols + c;
      });
      setFreePos(Math.min(cols * rows - 1, last + 1));
    } else {
      onText(freeRows.map((line) => line.trimEnd()).join('\n').replace(/\n+$/, ''));
    }
    onLayout(next);
  }

  /** One cell, written or cleared - the only mutation Free text has. */
  function writeCell(pos: number, char: string | null) {
    const r = Math.floor(pos / cols);
    const c = pos % cols;
    const next = freeRows.slice();
    const line = (next[r] ?? ' '.repeat(cols)).split('');
    line[c] = char ?? ' ';
    next[r] = line.join('');
    onFreeRows(next);
  }

  function onGridKeyDown(event: React.KeyboardEvent) {
    const total = cols * rows;
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (freePos === 0) return;
      const next = freePos - 1;
      writeCell(next, null);
      setFreePos(next);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      setFreePos(Math.min(total - 1, (Math.floor(freePos / cols) + 1) * cols));
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setFreePos(Math.min(total - 1, freePos + 1));
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setFreePos(Math.max(0, freePos - 1));
      return;
    }
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      writeCell(freePos, event.key.toUpperCase());
      setFreePos(Math.min(total - 1, freePos + 1));
    }
  }

  return (
    <div className="ui-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onDone()}>
      <div className="ui-modal ui-modal-wide flap-in" role="dialog" aria-modal="true" tabIndex={-1} ref={panelRef}>
        <h2 className="ui-modal-title">Edit text</h2>

        <div className="sheet-controls-row">
          <Field label="Layout" htmlFor="sheet-layout">
            <Select id="sheet-layout" value={layout} onChange={(event) => switchLayout(event.target.value as Layout)}>
              <option value="align">Word break</option>
              <option value="free">Free</option>
            </Select>
          </Field>
          {layout === 'align' && (
            <>
              <Field label="Align" htmlFor="sheet-align">
                <Select id="sheet-align" value={align} onChange={(event) => onAlign(event.target.value as Align)}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </Select>
              </Field>
              <Field label="Valign" htmlFor="sheet-valign">
                <Select id="sheet-valign" value={valign} onChange={(event) => onValign(event.target.value as Valign)}>
                  <option value="top">Top</option>
                  <option value="middle">Middle</option>
                  <option value="bottom">Bottom</option>
                </Select>
              </Field>
            </>
          )}
        </div>

        {layout === 'align' ? (
          <>
            <textarea
              className="queue-edit as-board queue-edit-large sheet-align-textarea"
              rows={4}
              autoFocus
              value={text}
              onChange={(event) => onText(event.target.value)}
            />
            <div className="sheet-align-preview">
              <ThemePreview
                pack={pack}
                text={text}
                cols={cols}
                rows={rows}
                tilePx={40}
                ambientMs={ambientMs}
                screenAspect={screenAspect}
                align={align}
                valign={valign}
              />
            </div>
          </>
        ) : (
          <div
            className={`sheet-grid-frame${gridFocused ? ' is-focused' : ''}`}
            tabIndex={0}
            onKeyDown={onGridKeyDown}
            onFocus={() => setGridFocused(true)}
            onBlur={() => setGridFocused(false)}
          >
            <div className="sheet-grid" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {Array.from({ length: cols * rows }, (_, i) => {
                const r = Math.floor(i / cols);
                const c = i % cols;
                const char = (freeRows[r] ?? '')[c]?.trim() ?? '';
                return (
                  <div key={i} className={`sheet-cell${i === freePos ? ' is-cursor' : ''}`}>
                    <span className="sheet-cell-glyph">{char}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="ui-modal-actions">
          <Button variant="primary" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
