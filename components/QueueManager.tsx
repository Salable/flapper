'use client';

/**
 * The control room's heart: compose messages into the board's server-side
 * queue and manage what is waiting - reorder, edit, loop, remove. The board
 * itself is passive; everything a wallboard shows starts here or on the API.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Checkbox, Field, Select, TextInput } from '@/components/ui/Field';

type QueueItem = {
  id: string;
  payload: { text?: string; rows?: string[]; options?: Record<string, unknown> };
  loop: boolean;
  source: string;
};

type Snapshot = {
  currentItemId: string | null;
  currentState: 'playing' | 'holding' | 'idle';
  epoch: number;
  items: QueueItem[];
};

const POLL_MS = 3000;

export function QueueManager({ slug, cap = Infinity }: { slug: string; cap?: number }) {
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
  const [text, setText] = useState('');
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

  async function act(run: () => Promise<Response>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setError('');
    try {
      const response = await run();
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
      }
    } catch (err: any) {
      setError(err.message);
    }
    busyRef.current = false;
    refresh();
  }

  const post = (path: string, method: string, body?: object) =>
    fetch(`${apiBase}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  function send() {
    if (text.trim() === '') return;
    if (isSign) {
      /*
       * Replace, not add. A queue of one is full the moment it says anything,
       * and the roll rule will not evict the message on the glass - so posting
       * to a sign would be refused with "none can be rolled off". Clearing
       * first is what changing a sign means anyway.
       */
      act(async () => {
        const cleared = await post('/clear', 'POST', {});
        if (!cleared.ok) return cleared;
        return post('/queue/items', 'POST', { text, loop: true });
      });
      setText('');
      return;
    }
    const body: Record<string, unknown> = { text };
    if (priority !== 'normal') body.priority = priority;
    if (holdMs !== '') body.dwellMs = Number(holdMs);
    if (loop) body.loop = true;
    act(() => post('/queue/items', 'POST', body));
    setText('');
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
    if (item.payload.text !== undefined && item.payload.text !== '') return item.payload.text;
    if (Array.isArray(item.payload.rows)) return `[rows × ${item.payload.rows.length}]`;
    return '(blank)';
  }

  const items = snapshot?.items ?? [];
  const playingId = snapshot?.currentState === 'playing' ? snapshot.currentItemId : null;
  const holdingId = snapshot?.currentState === 'holding' ? snapshot.currentItemId : null;
  // What each destructive button would actually do; disabled when nothing.
  const pendingCount = items.filter((entry) => entry.id !== playingId).length;
  const nothingOnBoard = items.length === 0 && !holdingId && !playingId;

  return (
    <>
      {dialog}
      <section className="settings-block">
        <h2>{isSign ? 'What it says' : 'Queue'}</h2>
        {error !== '' && <p className="error">{error}</p>}
        {items.length === 0 ? (
          <p className="muted">
            {isSign
              ? 'The board is blank. Type below to put something on it.'
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
                    </>
                  )}
                  <button
                    title="Edit"
                    aria-label="Edit message"
                    disabled={item.payload.text === undefined}
                    onClick={() => setEditing({ id: item.id, text: item.payload.text ?? '' })}
                  >
                    ✎
                  </button>
                  <button title="Remove" aria-label="Remove from queue" onClick={() => act(() => post(`/queue/items/${item.id}`, 'DELETE'))}>
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
        <div className="compose" aria-label="Add a message">
          <Field label={isSign ? 'Change what it says' : 'Add a message'} htmlFor="compose-text">
            <TextInput
              id="compose-text"
              className="ui-input as-board"
              placeholder={
                isSign ? 'Type what it should say — Enter to change it' : 'Type a message — Enter to queue it'
              }
              autoComplete="off"
              spellCheck={false}
              value={text}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') send();
              }}
            />
          </Field>
          <div className="compose-options">
            {/* Priority, hold and loop all arrange things that are waiting.
                On a sign nothing waits, so there is one button and it does
                the one thing: replace what is on the glass. */}
            {isSign ? (
              <Button variant="primary" size="sm" onClick={send} disabled={text.trim() === ''}>
                Change it
              </Button>
            ) : (
              <>
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
            <Checkbox
              id="compose-loop"
              label="Loop"
              checked={loop}
              onChange={(e) => setLoop(e.target.checked)}
            />
            <Button variant="primary" size="sm" onClick={send}>
              Add to queue
            </Button>
              </>
            )}
          </div>
          {!isSign && (
            <span className="muted">
              Loop sends a played message to the back of the queue instead of removing it. A
              band&apos;s only exit from a loop is removing the item or clearing.
            </span>
          )}
        </div>
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
    </>
  );
}
