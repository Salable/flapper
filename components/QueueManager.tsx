'use client';

/**
 * The control room's heart: compose messages into the board's server-side
 * queue and manage what is waiting - reorder, edit, loop, remove. The board
 * itself is passive; everything a wallboard shows starts here or on the API.
 *
 * Composing used to happen directly on the board's own canvas - click it and
 * type, one keystroke to one cell. WYSIWYG, but with none of a real text
 * field's vocabulary: no cursor to move, no selection, no paste, backspace
 * only ever eats the last character typed. Composing now opens ComposeModal
 * instead - a real textarea, styled like the glass it's headed for - and
 * posts `text` (laid out by the server, align/valign/wrap and all) rather
 * than `rows` (taken literally): a real textarea's cursor does not correspond
 * to a cell the way a click on the canvas did, so there is no longer a
 * position of your own choosing to preserve.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Checkbox, Field, Select } from '@/components/ui/Field';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { ComposeModal, type TextLayout } from '@/components/ComposeModal';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

/** Mirrors lib/board/layout.mjs's DEFAULTS - what a message gets when it
 * names none of the three itself. */
const LAYOUT_DEFAULTS: TextLayout = { align: 'center', valign: 'middle', wrap: 'word' };

/*
 * A stored item's payload is not the shape you posted it in: `rows` arrives
 * as a top-level field (rowsOption reads body.rows) and comes back nested
 * under `options` (textOptions builds { text, options: { rows, ... } } for
 * either mode). `text` is always present, empty string for a rows-mode item.
 */
type QueueItem = {
  id: string;
  payload: { text?: string; options?: { rows?: string[]; [key: string]: unknown } };
  loop: boolean;
  source: string;
};

/** The stored shape, turned back into something POST /queue/items accepts. */
function payloadToBody(payload: QueueItem['payload'] | undefined): Record<string, unknown> {
  if (!payload) return {};
  const { text, options } = payload;
  // `options` already uses the input's own key names (rows included - it is
  // nested here but top-level on the way in), so spreading it reconstructs
  // the original body; `text` only belongs back in it when there was one.
  return { ...(options ?? {}), ...(text ? { text } : {}) };
}

type Snapshot = {
  currentItemId: string | null;
  currentState: 'playing' | 'holding' | 'idle';
  epoch: number;
  items: QueueItem[];
};

const POLL_MS = 3000;

export function QueueManager({
  slug,
  cap = Infinity,
  pack,
  cols,
  rows,
  ambientMs = 0,
}: {
  slug: string;
  cap?: number;
  /** The board's own design, so composing happens in it rather than beside it. */
  pack: ThemePack;
  cols: number;
  rows: number;
  /** The board's Fidget setting, so the "what's on the glass" preview
   * fidgets too - see ThemePreview's own doc for why. */
  ambientMs?: number;
}) {
  const apiBase = `/api/b/${slug}`;
  /*
   * A board that holds one message is a sign, and a sign has no queue.
   *
   * Everything a queue panel offers exists to arrange things that are waiting:
   * ordering them, jumping one ahead, holding one longer, looping round them,
   * dropping the ones that have not shown yet. At a cap of one there is
   * nothing waiting and never can be, so all of it is furniture - and the one
   * thing you actually want, changing what it says, was the hardest thing on
   * the panel to find.
   *
   * Derived from the cap rather than the template id, so a board is whatever
   * its settings say: raise the cap and the queue appears, drop it to one and
   * it becomes a sign again.
   */
  const isSign = cap === 1;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [priority, setPriority] = useState('normal');
  const [holdMs, setHoldMs] = useState('');
  const [loop, setLoop] = useState(false);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const { confirm, dialog } = useConfirm();

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/queue`);
      if (!response.ok) return;
      setSnapshot(await response.json());
    } catch {
      /* transient; the poll retries */
    }
  }, [apiBase]);

  useEffect(() => {
    refresh();
    const timer = setInterval(refresh, POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  /** @returns whether `run` landed - most callers fire-and-forget, but the
   * compose modal stays open (showing `error`) rather than closing on a
   * message that never posted. */
  async function act(run: () => Promise<Response>): Promise<boolean> {
    if (busyRef.current) return false;
    busyRef.current = true;
    setError('');
    let ok = true;
    try {
      const response = await run();
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
    } catch (err: any) {
      setError(err.message);
      ok = false;
    }
    busyRef.current = false;
    refresh();
    return ok;
  }

  const post = (path: string, method: string, body?: object) =>
    fetch(`${apiBase}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  async function send(text: string, layout: TextLayout) {
    const body: Record<string, unknown> = { text, ...layout };
    setSending(true);
    let ok: boolean;
    if (isSign) {
      /*
       * Replace, not add. A queue of one is full the moment it says anything,
       * and the roll rule will not evict the message on the glass - so posting
       * to a sign would be refused with "none can be rolled off". Clearing
       * first is what changing a sign means anyway.
       */
      // What is on the glass right now, so it can go back if the replacement
      // fails - clearing first means there is a moment with nothing on it,
      // and a rejected post (too long, or the network) should not leave the
      // board silently blank rather than showing what it said before. Turned
      // back into a postable body (payloadToBody), not just re-sent as
      // stored - the stored shape and the posted shape are not the same one.
      const previousBody = payloadToBody(items[0]?.payload);
      ok = await act(async () => {
        const cleared = await post('/clear', 'POST', {});
        if (!cleared.ok) return cleared;
        const posted = await post('/queue/items', 'POST', { ...body, loop: true });
        if (!posted.ok && Object.keys(previousBody).length > 0) {
          await post('/queue/items', 'POST', { ...previousBody, loop: true }).catch(() => {});
        }
        return posted;
      });
    } else {
      if (priority !== 'normal') body.priority = priority;
      if (holdMs !== '') body.dwellMs = Number(holdMs);
      if (loop) body.loop = true;
      ok = await act(() => post('/queue/items', 'POST', body));
    }
    setSending(false);
    // Stay open on failure - error is already set by act(), and the modal
    // shows it right beside the text that caused it rather than sending the
    // reader hunting for a message that landed outside a popup that closed.
    if (ok) setComposeOpen(false);
  }

  function reorder(item: QueueItem, direction: -1 | 1) {
    if (!snapshot) return;
    const pending = snapshot.items.filter(
      (entry) =>
        entry.id !== snapshot.currentItemId || snapshot.currentState !== 'playing',
    );
    const index = pending.findIndex((entry) => entry.id === item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= pending.length) return;
    // Moving up lands after the item two slots above; the front is afterId null.
    const afterId =
      direction === -1 ? (target === 0 ? null : pending[target - 1].id) : pending[target].id;
    act(() => post('/queue/reorder', 'POST', { itemId: item.id, afterId }));
  }

  function label(item: QueueItem) {
    if (item.payload.text) return item.payload.text;
    if (Array.isArray(item.payload.options?.rows)) return item.payload.options.rows.join(' / ');
    return '(blank)';
  }

  const items = snapshot?.items ?? [];
  const playingId = snapshot?.currentState === 'playing' ? snapshot.currentItemId : null;
  const holdingId = snapshot?.currentState === 'holding' ? snapshot.currentItemId : null;
  // What each destructive button would actually do; disabled when nothing.
  const pendingCount = items.filter((entry) => entry.id !== playingId).length;
  const nothingOnBoard = items.length === 0 && !holdingId && !playingId;

  // What is actually on the glass right now, to preview and (for a sign) to
  // seed the compose modal with - editing a sign is replacing what is there,
  // which reads as editing it in place, not starting from blank.
  const glassItem =
    items.find((entry) => entry.id === playingId) ??
    items.find((entry) => entry.id === holdingId) ??
    (isSign ? items[0] : undefined);
  const glassText = glassItem ? label(glassItem) : '';
  const glassOptions = isSign ? glassItem?.payload.options : undefined;
  const composeSeedLayout: TextLayout = {
    align: (glassOptions?.align as TextLayout['align']) ?? LAYOUT_DEFAULTS.align,
    valign: (glassOptions?.valign as TextLayout['valign']) ?? LAYOUT_DEFAULTS.valign,
    wrap: (glassOptions?.wrap as TextLayout['wrap']) ?? LAYOUT_DEFAULTS.wrap,
  };

  return (
    <>
      {dialog}
      <ComposeModal
        open={composeOpen}
        onClose={() => setComposeOpen(false)}
        title={isSign ? 'Change what it says' : 'Add a message'}
        submitLabel={isSign ? 'Change it' : 'Put this on the board'}
        cols={cols}
        rows={rows}
        initialText={isSign ? glassText : ''}
        initialLayout={composeSeedLayout}
        busy={sending}
        error={error}
        onSubmit={send}
      />
      <div className="design-surface">
        <div className="design-preview">
          <ThemePreview pack={pack} text={glassText} cols={cols} rows={rows} tilePx={56} ambientMs={ambientMs} />
          <div className="design-preview-bar">
            <p className="design-preview-caption">
              {cols} × {rows} cards{glassText === '' ? ' · the board is blank' : ''}
            </p>
          </div>
          <Button variant="primary" onClick={() => setComposeOpen(true)}>
            {isSign ? 'Change it' : 'Compose'}
          </Button>
        </div>
        <div className="design-controls">
          <section className="settings-block">
            <h2>{isSign ? 'What it says' : 'Queue'}</h2>
            {error !== '' && <p className="error">{error}</p>}
            {items.length === 0 ? (
              <p className="muted">
                {isSign
                  ? 'The board is blank. Compose something to put on it.'
                  : snapshot?.currentState === 'holding'
                    ? 'The queue has drained; the last message is standing on the glass.'
                    : 'Nothing queued. The board is blank until something is.'}
              </p>
            ) : (
              <ol className="queue-list">
                {items.map((item) => (
                  <li key={item.id} className={item.id === playingId ? 'is-playing' : ''}>
                    {editing?.id === item.id ? (
                      <input
                        className="queue-edit as-board"
                        type="text"
                        autoFocus
                        value={editing.text}
                        onChange={(event) => setEditing({ id: item.id, text: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') {
                            act(() => post(`/queue/items/${item.id}`, 'PATCH', { text: editing.text }));
                            setEditing(null);
                          }
                          if (event.key === 'Escape') setEditing(null);
                        }}
                        onBlur={() => setEditing(null)}
                      />
                    ) : (
                      <span className="queue-text">
                        {item.id === playingId && <b className="now">▶</b>}
                        {item.id === holdingId && <b className="now">◼</b>}
                        {label(item)}
                      </span>
                    )}
                    <span className="queue-meta muted">
                      {isSign ? '' : item.loop ? 'loop · ' : ''}
                      {isSign ? 'on the glass' : item.source}
                    </span>
                    <span className="queue-actions">
                      {/* Reorder, loop, edit-in-place, remove - all of it arranges
                          or amends something that is waiting or already playing.
                          A sign is neither: there is nothing behind it to reorder,
                          and "remove" would empty the queue while the glass, which
                          holds its last message, kept showing this one regardless -
                          the panel would say blank while the wall did not. Change
                          it (which replaces) and Blank it (which actually clears)
                          are the only two things a sign's one item can mean. */}
                      {!isSign && (
                        <>
                          <button title="Move up" aria-label="Move up" onClick={() => reorder(item, -1)} disabled={item.id === playingId}>
                            ↑
                          </button>
                          <button title="Move down" aria-label="Move down" onClick={() => reorder(item, 1)} disabled={item.id === playingId}>
                            ↓
                          </button>
                          <button
                            title={item.loop ? 'Stop looping' : 'Loop'}
                            aria-label={item.loop ? 'Stop looping' : 'Loop'}
                            aria-pressed={item.loop}
                            className={item.loop ? 'is-on' : ''}
                            onClick={() => act(() => post(`/queue/items/${item.id}`, 'PATCH', { loop: !item.loop }))}
                          >
                            ↻
                          </button>
                          <button
                            title="Edit"
                            aria-label="Edit message"
                            // A rows-mode item has text: '' - not undefined - so
                            // this checked the wrong thing and offered to edit a
                            // rows-based message as a single line, which would
                            // have silently thrown its row structure away on save.
                            disabled={!item.payload.text}
                            onClick={() => setEditing({ id: item.id, text: item.payload.text ?? '' })}
                          >
                            ✎
                          </button>
                          <button title="Remove" aria-label="Remove from queue" onClick={() => act(() => post(`/queue/items/${item.id}`, 'DELETE'))}>
                            ✕
                          </button>
                        </>
                      )}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {/* Priority, hold and loop all arrange things that are waiting - a
                sign has nothing waiting, so none of it applies; its one control
                is the "Change it" button beside the preview above. Left here
                rather than inside the modal: these decide where the message
                that is about to be written will land, not how it is written. */}
            {!isSign && (
              <div className="compose-options">
                <Field label="Priority" htmlFor="compose-priority">
                  <Select id="compose-priority" value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="normal">Queue it</option>
                    <option value="next">Play next</option>
                    <option value="now">Play now</option>
                  </Select>
                </Field>
                <Field label="Hold" htmlFor="compose-hold">
                  <Select id="compose-hold" value={holdMs} onChange={(e) => setHoldMs(e.target.value)}>
                    <option value="">Board default</option>
                    <option value="1000">1s</option>
                    <option value="2000">2s</option>
                    <option value="5000">5s</option>
                    <option value="10000">10s</option>
                    <option value="30000">30s</option>
                  </Select>
                </Field>
                <Checkbox id="compose-loop" label="Loop" checked={loop} onChange={(e) => setLoop(e.target.checked)} />
              </div>
            )}
            {!isSign && (
              <span className="muted">
                Loop sends a played message to the back of the queue instead of removing it. A
                band&apos;s only exit from a loop is removing the item or clearing.
              </span>
            )}
            <div className="actions">
              {!isSign && (
                <Button
                  size="sm"
                  onClick={() => act(() => post('/queue', 'DELETE'))}
                  disabled={pendingCount === 0}
                  title={
                    pendingCount === 0
                      ? 'Nothing is waiting'
                      : 'Drop everything waiting; whatever is playing finishes'
                  }
                >
                  Flush pending
                </Button>
              )}
              <Button
                size="sm"
                variant="danger"
                disabled={nothingOnBoard}
                onClick={async () => {
                  if (
                    await confirm({
                      title: isSign ? 'Blank the board?' : 'Clear the queue and blank the board?',
                      confirmLabel: isSign ? 'Blank it' : 'Clear board',
                      danger: true,
                    })
                  ) {
                    act(() => post('/clear', 'POST', {}));
                  }
                }}
                title={nothingOnBoard ? 'The board is already blank' : 'Stop everything and blank the glass'}
              >
                {isSign ? 'Blank it' : 'Clear board'}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
