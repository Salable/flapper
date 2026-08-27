'use client';

/**
 * A slide's own content: Name, Source, and whichever setup step the source
 * needs. Inline in the panel now, not a popup of its own - Name and Source
 * are small, frequent edits, the same kind of thing Hold already is right
 * next to them, and committing immediately (blur/Enter, no separate Save)
 * matches that rather than asking for a bigger gesture than the edit
 * warrants. Only "Edit text" - a real multi-field editing surface, not a
 * quick toggle - still opens its own popup.
 *
 * `EditTextPopup` is exported too, generic over what it edits (a plain
 * `{text, rows, align, valign}` shape, not a `QueueItem`) - a saved
 * interrupter's own text is the same editing surface, wired up from
 * `QueueManager`'s own preset state instead of a queue item's, with its
 * own existing Save/Save changes batching rather than this file's
 * immediate-commit.
 *
 * Text is the only source that does anything real today; API and Animation
 * are honest about not being connected to anything yet (see TODO.md, "The
 * source picker itself" and "Then — sheets") rather than pretending a
 * picker with nowhere to send its choice.
 */

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { type QueueItem, payloadToBody } from '@/components/queue-item';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

export type Align = 'left' | 'center' | 'right';
export type Valign = 'top' | 'middle' | 'bottom';
type Source = 'text' | 'api' | 'animation';
type Layout = 'align' | 'free';

/** The plain shape `EditTextPopup` edits - independent of whether it came
 * from a queue item's payload or a saved interrupter preset. `rows: null`
 * means "not rows-mode"; a non-null array (even empty) means Free text,
 * seeded from it. */
export type TextContent = { text: string; rows: string[] | null; align: Align; valign: Valign };

/** What "Done" hands back - only the keys that actually changed shape,
 * same as `commitHold`'s own "delete or set" pattern elsewhere in this
 * panel; the caller decides how that merges into its own save shape. */
export type TextPatch = { text?: string; rows?: string[]; align?: Align; valign?: Valign };

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

/** A `QueueItem`'s own content, read down to the plain shape `EditTextPopup`
 * edits. */
function contentOf(item: QueueItem): TextContent {
  if (isRowsItem(item)) {
    const raw = item.payload.options?.rows;
    return { text: '', rows: Array.isArray(raw) ? raw : [], align: 'center', valign: 'middle' };
  }
  return { text: item.payload.text ?? '', rows: null, align: alignOf(item), valign: valignOf(item) };
}

export function SheetEditor({
  item,
  pack,
  cols,
  rows,
  screenAspect,
  ambientMs = 0,
  onSave,
}: {
  item: QueueItem;
  pack: ThemePack;
  cols: number;
  rows: number;
  screenAspect?: number;
  ambientMs?: number;
  /** Returns whether it worked - the caller's own `error` state reports a
   * failure; a rejected commit here just leaves the field as it was. */
  onSave: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const [name, setName] = useState(nameOf(item));
  const [source, setSource] = useState<Source>('text');
  const [textOpen, setTextOpen] = useState(false);

  // Re-seed when the selection itself changes - not on every poll, or a
  // name mid-edit would be clobbered the moment the next one landed.
  useEffect(() => {
    setName(nameOf(item));
    setSource('text');
  }, [item.id]);

  /** Required - a blank commit is refused, reverting to the last real name,
   * the same shape Escape already has elsewhere in this panel (Hold's own
   * "" is a real, meaningful choice - "board default" - so this is not
   * that pattern; a slide's Name has no meaningful blank to fall back to
   * any more). */
  function commitName() {
    const trimmed = name.trim();
    if (trimmed === '') {
      setName(nameOf(item));
      return;
    }
    if (trimmed === nameOf(item)) return;
    onSave({ ...payloadToBody(item.payload), label: trimmed });
  }

  const endpointSlot = name.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') || '…';

  return (
    <div className="sheet-editor">
      <div className="sheet-editor-row">
        <Field label="Name" htmlFor="sheet-name" hint="Required - the rail's own tab label.">
          <TextInput
            id="sheet-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitName();
              if (event.key === 'Escape') setName(nameOf(item));
            }}
            onBlur={commitName}
          />
        </Field>
        <Field label="Source" htmlFor="sheet-source">
          <Select id="sheet-source" value={source} onChange={(event) => setSource(event.target.value as Source)}>
            <option value="text">Text</option>
            <option value="api">API</option>
            <option value="animation">Animation</option>
          </Select>
        </Field>
      </div>

      {source === 'text' && (
        <div className="sheet-source-setup">
          <div className="sheet-text-preview">
            <span className={`sheet-text-preview-sample${samplePreview(item) === '' ? ' is-empty' : ''}`}>
              {samplePreview(item) === '' ? 'Nothing typed yet' : samplePreview(item)}
            </span>
            <Button size="sm" onClick={() => setTextOpen(true)}>
              Edit text →
            </Button>
          </div>
          <EditTextPopup
            open={textOpen}
            onClose={() => setTextOpen(false)}
            pack={pack}
            cols={cols}
            rows={rows}
            screenAspect={screenAspect}
            ambientMs={ambientMs}
            initial={contentOf(item)}
            onSave={(patch) => {
              const body: Record<string, unknown> = { ...payloadToBody(item.payload) };
              if (patch.rows !== undefined) {
                body.rows = patch.rows;
                delete body.text;
                delete body.align;
                delete body.valign;
              } else {
                if (patch.text !== undefined) body.text = patch.text;
                delete body.rows;
                if (patch.align !== undefined) body.align = patch.align;
                if (patch.valign !== undefined) body.valign = patch.valign;
              }
              return onSave(body);
            }}
          />
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
    </div>
  );
}

function samplePreview(item: QueueItem): string {
  if (isRowsItem(item)) return ((item.payload.options?.rows as string[]) ?? []).join(' / ').trim();
  return (item.payload.text ?? '').trim();
}

/**
 * The nested popup, not folded into the panel's own body - a real text
 * designer needs room a row of inline fields doesn't have, the same
 * reasoning ComposeModal was its own popup in the first place.
 *
 * Not built on the shared <Modal> component: this app's other modals never
 * nest, so Modal's own window Escape listener never had to consider one
 * already being open when it registers another - closing this one only,
 * not every modal on the page, needs its own capture-phase handler that
 * stops the event before a listener like Modal's own could see it.
 *
 * Generic over `TextContent`/`TextPatch`, not `QueueItem` - a saved
 * interrupter's own text is the same editing surface (same grid, same
 * Align/Valign/Word-break/Free), wired up from wherever the caller's own
 * content and save mechanics actually live.
 */
export function EditTextPopup({
  open,
  onClose,
  pack,
  cols,
  rows,
  screenAspect,
  ambientMs,
  initial,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  pack: ThemePack;
  cols: number;
  rows: number;
  screenAspect?: number;
  ambientMs?: number;
  initial: TextContent;
  /** "Done" is the one commit point this has - returns whether it worked,
   * the same convention as the rest of this panel's own saves. */
  onSave: (patch: TextPatch) => Promise<boolean>;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState<Layout>('align');
  const [align, setAlign] = useState<Align>('center');
  const [valign, setValign] = useState<Valign>('middle');
  const [text, setText] = useState('');
  const [freeRows, setFreeRows] = useState<string[]>([]);
  const [freePos, setFreePos] = useState(0);
  const [saving, setSaving] = useState(false);

  // Seeded fresh each time this popup opens - not on every render, or a
  // keystroke mid-edit would be clobbered by the item's own poll landing
  // behind it.
  useEffect(() => {
    if (!open) return;
    setAlign(initial.align);
    setValign(initial.valign);
    if (initial.rows !== null) {
      setLayout('free');
      const seeded = initial.rows.slice(0, rows);
      while (seeded.length < rows) seeded.push('');
      setFreeRows(seeded.map((line) => line.padEnd(cols, ' ').slice(0, cols)));
      setText('');
    } else {
      setLayout('align');
      setText(initial.text);
      setFreeRows(blankRows(cols, rows));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
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
      setFreeRows(seeded);
      let last = -1;
      seeded.forEach((line, r) => {
        for (let c = 0; c < cols; c += 1) if (line[c] !== ' ') last = r * cols + c;
      });
      setFreePos(Math.min(cols * rows - 1, last + 1));
    } else {
      setText(freeRows.map((line) => line.trimEnd()).join('\n').replace(/\n+$/, ''));
    }
    setLayout(next);
  }

  /** One cell, written or cleared - the only mutation Free text has. */
  function writeCell(pos: number, char: string | null) {
    const r = Math.floor(pos / cols);
    const c = pos % cols;
    const next = freeRows.slice();
    const line = (next[r] ?? ' '.repeat(cols)).split('');
    line[c] = char ?? ' ';
    next[r] = line.join('');
    setFreeRows(next);
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

  async function done() {
    setSaving(true);
    const patch: TextPatch = layout === 'free' ? { rows: freeRows } : { text, align, valign };
    const ok = await onSave(patch);
    setSaving(false);
    if (ok) onClose();
  }

  return (
    <div className="ui-modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
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
                <Select id="sheet-align" value={align} onChange={(event) => setAlign(event.target.value as Align)}>
                  <option value="left">Left</option>
                  <option value="center">Center</option>
                  <option value="right">Right</option>
                </Select>
              </Field>
              <Field label="Valign" htmlFor="sheet-valign">
                <Select id="sheet-valign" value={valign} onChange={(event) => setValign(event.target.value as Valign)}>
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
              onChange={(event) => setText(event.target.value)}
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
          <div className="sheet-grid-frame" tabIndex={0} onKeyDown={onGridKeyDown}>
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
          <Button variant="primary" onClick={done} disabled={saving}>
            {saving ? 'Saving…' : 'Done'}
          </Button>
        </div>
      </div>
    </div>
  );
}
