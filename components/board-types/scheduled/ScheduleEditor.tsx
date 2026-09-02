'use client';

/**
 * The scheduled board's queue tab: compose messages onto the clock, see the
 * schedule as a list with live "next" times, and tune the board's timezone
 * and fallback. The preview runs the real evaluator (lib/board/schedule.mjs)
 * against the server clock, so what it promises is what the glass does.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  describeSchedule,
  occurrencesAfter,
  isTimezone,
  relativeWhen,
} from '@/lib/board/schedule.mjs';
import { Button } from '@/components/ui/Button';
import { Field, TextInput, Select } from '@/components/ui/Field';
import { Chip } from '@/components/ui/bits';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import type { BoardTypeEditorProps } from '@/components/board-types/registry';

type Spec = Record<string, unknown> & { kind: string; durationMs?: number | null };

type Item = {
  id: string;
  payload: { text?: string; rows?: string[] };
  schedule: Spec | null;
  computedDurationMs: number | null;
  createdAt: number;
};

type Snapshot = {
  items: Item[];
  config: { timezone?: string; fallback?: string };
  serverNowMs: number;
  activeItemId: string | null;
  onFallback: boolean;
  nextChangeAtMs: number | null;
};

const POLL_MS = 3000;

const KIND_OPTIONS = [
  { value: 'everyN', label: 'Every N minutes' },
  { value: 'interval', label: 'Every N seconds' },
  { value: 'hourly', label: 'Hourly at a minute' },
  { value: 'daily', label: 'Daily at a time' },
  { value: 'weekly', label: 'Weekly on a day' },
  { value: 'once', label: 'Once, at a moment' },
];

const DURATION_OPTIONS = [
  { value: 'auto', label: 'Auto (one read-through)' },
  { value: 'null', label: 'Until its next trigger' },
  { value: '10000', label: '10 seconds' },
  { value: '30000', label: '30 seconds' },
  { value: '60000', label: '1 minute' },
  { value: '300000', label: '5 minutes' },
  { value: '3600000', label: '1 hour' },
];

const DOW = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function ScheduleEditor({
  slug,
  pack,
  cols,
  rows,
  screenAspect,
  ambientMs = 0,
  fidget,
}: BoardTypeEditorProps) {
  const apiBase = `/api/b/${slug}`;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState('');
  const busyRef = useRef(false);
  const { confirm, dialog } = useConfirm();

  /**
   * Which slot the preview is showing. Null means "whatever the glass is
   * showing right now" - the active slot, or the fallback between slots -
   * so arriving at the tab previews the real board rather than nothing.
   * Clicking a row pins that one; clicking it again unpins.
   */
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Compose state.
  const [text, setText] = useState('');
  const [kind, setKind] = useState('everyN');
  const [minutes, setMinutes] = useState('15');
  const [seconds, setSeconds] = useState('30');
  const [minute, setMinute] = useState('0');
  const [at, setAt] = useState('09:00');
  const [dow, setDow] = useState('1');
  const [onceAt, setOnceAt] = useState('');
  const [duration, setDuration] = useState('auto');

  // Board clock settings.
  const [timezone, setTimezone] = useState('');
  const [fallback, setFallback] = useState('');
  const seededConfig = useRef(false);

  // The server clock, carried as an offset from this machine's.
  const skewRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`${apiBase}/queue`);
      if (!response.ok) return;
      const body = await response.json();
      skewRef.current = (body.serverNowMs ?? Date.now()) - Date.now();
      setSnapshot(body);
      if (!seededConfig.current) {
        seededConfig.current = true;
        setTimezone(body.config?.timezone ?? 'UTC');
        setFallback(body.config?.fallback ?? '');
      }
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

  /** The spec the compose form currently describes, or null while incomplete. */
  const spec = useMemo<Spec | null>(() => {
    let base: Spec | null = null;
    if (kind === 'everyN') {
      const n = Number(minutes);
      if (Number.isInteger(n) && n >= 1) base = { kind, minutes: n };
    } else if (kind === 'interval') {
      const s = Number(seconds);
      if (Number.isFinite(s) && s >= 5) base = { kind, everyMs: Math.round(s * 1000) };
    } else if (kind === 'hourly') {
      const m = Number(minute);
      if (Number.isInteger(m) && m >= 0 && m <= 59) base = { kind, minute: m };
    } else if (kind === 'daily') {
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(at)) base = { kind, at };
    } else if (kind === 'weekly') {
      if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(at)) base = { kind, at, dow: Number(dow) };
    } else if (kind === 'once') {
      const ms = Date.parse(onceAt);
      if (Number.isFinite(ms)) base = { kind, atMs: ms };
    }
    if (!base) return null;
    if (duration === 'null') base.durationMs = null;
    else if (duration !== 'auto') base.durationMs = Number(duration);
    return base;
  }, [kind, minutes, seconds, minute, at, dow, onceAt, duration]);

  const tz = snapshot?.config?.timezone ?? 'UTC';
  /**
   * When an occurrence happens, phrased so it cannot be misread: relative
   * for anything soon ("in 4 min" - a bare "Thu 23:15" near midnight reads
   * as next Thursday), a clock time for later today, and a weekday only
   * when it really is days away.
   */
  const timeIn = useCallback(
    (ms: number) => {
      const delta = ms - (Date.now() + skewRef.current);
      if (delta < 90 * 60_000) return relativeWhen(ms, ms - delta);
      try {
        const far = delta > 20 * 3_600_000;
        return new Intl.DateTimeFormat(undefined, {
          timeZone: tz,
          ...(far ? { weekday: 'short', day: 'numeric', month: 'short' } : {}),
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23',
        }).format(ms);
      } catch {
        return new Date(ms).toISOString();
      }
    },
    [tz],
  );

  /** Runs the real evaluator: the preview cannot drift from the glass. */
  const preview = useMemo(() => {
    if (!spec) return [];
    try {
      const nowMs = Date.now() + skewRef.current;
      return occurrencesAfter(spec, { tz, createdAtMs: nowMs }, nowMs, 3);
    } catch {
      return [];
    }
  }, [spec, tz, snapshot]);

  function send() {
    if (text.trim() === '' || !spec) return;
    act(() => post('/queue/items', 'POST', { text, schedule: spec }));
    setText('');
  }

  const nextOf = useCallback(
    (item: Item) => {
      if (!item.schedule) return null;
      try {
        const nowMs = Date.now() + skewRef.current;
        const [next] = occurrencesAfter(
          item.schedule,
          { tz, createdAtMs: item.createdAt },
          nowMs,
          1,
        );
        return next ?? null;
      } catch {
        return null;
      }
    },
    [tz, snapshot],
  );

  const items = snapshot?.items ?? [];

  /**
   * An item's content as one string. A rows-mode item (only an API caller can
   * make one here) has no single line to show, so its rows are joined and the
   * caption says the preview re-wrapped them - better than previewing nothing.
   */
  const textOf = (item: Item) => item.payload.text ?? (item.payload.rows ?? []).join(' ');

  const selected = items.find((i) => i.id === selectedId) ?? null;
  const active = items.find((i) => i.id === snapshot?.activeItemId) ?? null;
  // A row that has been deleted out from under the selection stops pinning it.
  useEffect(() => {
    if (selectedId !== null && !items.some((i) => i.id === selectedId)) setSelectedId(null);
  }, [items, selectedId]);

  /**
   * What the preview shows, in the order that answers the question actually
   * being asked: a pinned row, else what you are typing right now, else what
   * is on the glass (the active slot, or the fallback between slots).
   */
  const composing = selectedId === null && text.trim() !== '';
  const previewText = selected
    ? textOf(selected)
    : composing
      ? text
      : active
        ? textOf(active)
        : fallback;
  const previewCaption = selected
    ? selected.id === snapshot?.activeItemId
      ? 'this slot · on the glass now'
      : 'this slot · not on the glass now'
    : composing
      ? 'the message you are composing'
      : active
        ? 'on the glass now'
        : fallback !== ''
          ? 'the fallback · on the glass now'
          : // No slot due and nothing standing behind it. Which of the two
            // reasons matters: an empty schedule is a board waiting to be
            // given something, a full one is simply between slots.
            items.length > 0
            ? 'between slots · the glass is dark'
            : 'nothing scheduled and no fallback';
  const previewIsRewrapped = Boolean(selected && !selected.payload.text && (selected.payload.rows?.length ?? 0) > 0);

  const configDirty =
    snapshot !== null &&
    (timezone !== (snapshot.config?.timezone ?? 'UTC') ||
      fallback !== (snapshot.config?.fallback ?? ''));

  return (
    <>
      {dialog}
      <section className="settings-block">
        <h2>Put a message on the clock</h2>
        {error !== '' && <p className="error">{error}</p>}
        <Field label="Message" htmlFor="sched-text">
          <TextInput
            id="sched-text"
            className="ui-input as-board"
            value={text}
            placeholder="What the board says in this slot"
            spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
          />
        </Field>
        <div className="compose-options">
          <Field label="Schedule" htmlFor="sched-kind">
            <Select id="sched-kind" value={kind} onChange={(e) => setKind(e.target.value)}>
              {KIND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          {kind === 'everyN' && (
            <Field label="Minutes" htmlFor="sched-minutes">
              <TextInput id="sched-minutes" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
            </Field>
          )}
          {kind === 'interval' && (
            <Field label="Seconds (min 5)" htmlFor="sched-seconds">
              <TextInput id="sched-seconds" value={seconds} onChange={(e) => setSeconds(e.target.value)} />
            </Field>
          )}
          {kind === 'hourly' && (
            <Field label="At minute" htmlFor="sched-minute">
              <TextInput id="sched-minute" value={minute} onChange={(e) => setMinute(e.target.value)} />
            </Field>
          )}
          {(kind === 'daily' || kind === 'weekly') && (
            <Field label="At (HH:MM[:SS])" htmlFor="sched-at">
              <TextInput id="sched-at" value={at} onChange={(e) => setAt(e.target.value)} />
            </Field>
          )}
          {kind === 'weekly' && (
            <Field label="Day" htmlFor="sched-dow">
              <Select id="sched-dow" value={dow} onChange={(e) => setDow(e.target.value)}>
                {DOW.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </Select>
            </Field>
          )}
          {kind === 'once' && (
            <Field label="When" htmlFor="sched-once">
              <TextInput
                id="sched-once"
                type="datetime-local"
                value={onceAt}
                onChange={(e) => setOnceAt(e.target.value)}
              />
            </Field>
          )}
          <Field label="Shows for" htmlFor="sched-duration">
            <Select id="sched-duration" value={duration} onChange={(e) => setDuration(e.target.value)}>
              {DURATION_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
          <Button variant="primary" onClick={send} disabled={!spec || text.trim() === ''}>
            Add to schedule
          </Button>
        </div>
        <span className="ui-hint">
          {spec
            ? preview.length > 0
              ? (() => {
                  const labels = preview.map(timeIn);
                  // The zone only matters when a wall-clock time is shown.
                  const clocked = labels.some((label) => label.includes(':'));
                  return `Next: ${labels.join('  ·  ')}${clocked ? ` (${tz})` : ''}`;
                })()
              : 'This schedule has no upcoming occurrence.'
            : 'Finish the schedule fields to see the next occurrences.'}
        </span>
      </section>

      <section className="settings-block">
        <h2>The schedule</h2>
        {/* The board itself. Every other editing surface shows one; editing a
            schedule used to be the one place you changed what a wall says
            without ever seeing the wall. */}
        <div className="board-preview">
          <ThemePreview
            pack={pack}
            text={previewText}
            cols={cols}
            rows={rows}
            tilePx={56}
            ambientMs={ambientMs}
            fidget={fidget}
            screenAspect={screenAspect}
          />
          <div className="design-preview-bar">
            <p className="design-preview-caption">
              {cols} × {rows} cards · {previewCaption}
              {previewIsRewrapped ? ' · rows re-wrapped to fit' : ''}
            </p>
          </div>
        </div>
        {items.length === 0 ? (
          <p className="muted">
            Nothing scheduled. The board stands on its fallback message until something is.
          </p>
        ) : (
          <ol className="queue-list">
            {items.map((item) => (
              <li
                key={item.id}
                className={
                  (item.id === snapshot?.activeItemId ? 'is-playing' : '') +
                  (item.id === selectedId ? ' is-selected' : '')
                }
              >
                <button
                  type="button"
                  className="queue-text"
                  aria-pressed={item.id === selectedId}
                  title="Show this slot in the preview"
                  onClick={() => setSelectedId((id) => (id === item.id ? null : item.id))}
                >
                  {item.id === snapshot?.activeItemId && <b className="now">▶</b>}
                  {item.payload.text ?? `[rows × ${item.payload.rows?.length ?? 0}]`}
                </button>
                <span className="queue-meta muted">
                  {describeSchedule(item.schedule)}
                  {(() => {
                    const next = nextOf(item);
                    return next ? ` · next ${timeIn(next)}` : '';
                  })()}
                </span>
                <span className="queue-actions">
                  <button
                    title="Remove"
                    aria-label="Remove from schedule"
                    onClick={() => act(() => post(`/queue/items/${item.id}`, 'DELETE'))}
                  >
                    ✕
                  </button>
                </span>
              </li>
            ))}
          </ol>
        )}
        {snapshot && (
          <p className="muted">
            {snapshot.onFallback
              ? 'The glass is on the fallback message right now.'
              : 'A scheduled slot is on the glass right now.'}
            {snapshot.nextChangeAtMs ? ` Next change ${timeIn(snapshot.nextChangeAtMs)}.` : ''}
          </p>
        )}
        <div className="actions">
          <button
            onClick={async () => {
              if (
                await confirm({
                  title: 'Clear the whole schedule?',
                  body: 'Every scheduled message goes; the board falls back to its standing message.',
                  confirmLabel: 'Clear schedule',
                  danger: true,
                })
              ) {
                act(() => post('/clear', 'POST', {}));
              }
            }}
          >
            Clear schedule
          </button>
        </div>
      </section>

      <section className="settings-block">
        <h2>Clock</h2>
        <Field
          label="Timezone"
          htmlFor="sched-tz"
          hint="IANA name — wall-clock schedules (daily, hourly) follow it, DST included."
        >
          <TextInput
            id="sched-tz"
            value={timezone}
            spellCheck={false}
            onChange={(e) => setTimezone(e.target.value)}
          />
        </Field>
        <Field
          label="Fallback message"
          htmlFor="sched-fallback"
          hint="What stands on the glass between scheduled slots. Blank = dark glass."
        >
          <TextInput
            id="sched-fallback"
            className="ui-input as-board"
            value={fallback}
            onChange={(e) => setFallback(e.target.value)}
          />
        </Field>
        <Button
          variant="primary"
          disabled={!configDirty || (timezone !== '' && !isTimezone(timezone))}
          onClick={() =>
            act(() => post('/config', 'PATCH', { timezone, fallback }))
          }
        >
          Save clock settings
        </Button>
        {timezone !== '' && !isTimezone(timezone) && (
          <span className="error">Not an IANA timezone (try Europe/London or UTC).</span>
        )}
      </section>
    </>
  );
}
