'use client';

/**
 * The control room's heart: compose messages into the board's server-side
 * queue and manage what is waiting - reorder, edit, loop, remove. The board
 * itself is passive; everything a wallboard shows starts here or on the API.
 *
 * Composing used to happen directly on the board's own canvas - click it and
 * type, one keystroke to one cell. WYSIWYG, but with none of a real text
 * field's vocabulary: no cursor to move, no selection, no paste, backspace
 * only ever eats the last character typed. Editing a slide's text is the
 * panel's own textarea now, styled like the glass it's headed for.
 *
 * A one-slide board is not its own mode - it is just a board with one
 * enabled. It gets the same rail (one tab) and the same panel as any other;
 * there used to be a separate "sign" surface for it, which meant maintaining
 * two UIs for a distinction that was never real to begin with.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { SheetEditor, EditTextPopup, type Align, type Valign } from '@/components/SheetEditor';
import { type QueueItem, payloadToBody } from '@/components/queue-item';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

/** A saved interrupter - named once, fired by that name later, never sent
 * straight from typed text. `durationMs` is one or the other: a number is
 * a hard limit (shown, then gone outright, whichever comes first between
 * its turn ending and the limit); absent is the switch - blocks the
 * rotation entirely until dismissed or broken by a higher-ranked one.
 * Content is `text` (+ optional align/valign) or `rows` - the same
 * either-or a queue item's own payload has, and the same reasoning:
 * `validateInterrupterPreset` refuses align/valign alongside rows. */
type InterrupterPreset = {
  name: string;
  text?: string;
  rows?: string[];
  align?: Align;
  valign?: Valign;
  durationMs?: number;
};

type Snapshot = {
  currentItemId: string | null;
  currentState: 'playing' | 'holding' | 'idle';
  epoch: number;
  items: QueueItem[];
  /** `queueCap` - how many messages this board holds before the type's own
   * policy rolls the oldest waiting one off to make room. `+ Slide` must
   * know it, so adding one never walks the board past it and silently
   * costs a real slide to make room for a blank one. `interrupters` - the
   * saved presets, same door as every other config field. */
  config?: { queueCap?: number; interrupters?: InterrupterPreset[] };
};

const POLL_MS = 3000;

export function QueueManager({
  slug,
  section,
  pack,
  cols,
  rows,
  screenAspect,
  ambientMs = 0,
  fidget,
  onSaved,
}: {
  slug: string;
  /** The Board tab (the preview, and the rail/panel) or the Interruptions
   * tab (the form and the currently-active list) - the two horizontal tabs
   * SettingsClient renders this into, each its own mounted instance so
   * switching between them costs nothing more than a fresh poll. */
  section: 'board' | 'interruptions';
  /** The board's own design, so composing happens in it rather than beside it. */
  pack: ThemePack;
  cols: number;
  rows: number;
  /** The board's own screen ratio, passed straight through to both
   * ThemePreview calls below - see its own doc for why this isn't just
   * `cols / rows` again. */
  screenAspect?: number;
  /** The board's Fidget setting, so the "what's on the glass" preview
   * fidgets too - see ThemePreview's own doc for why. */
  ambientMs?: number;
  /** Which fidget the board does, so a preview fidgets like the wall does. */
  fidget?: string | null;
  /** The same shared "Saved" the sidebar flags - composing is saving too,
   * and showing confirmation in one place but not the other reads as
   * "this part doesn't actually save". */
  onSaved?: () => void;
}) {
  const apiBase = `/api/b/${slug}`;
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  /** Its own panel, always visible - not a modal, and not hidden behind a
   * click either. Name, Text and Duration together - what firing one by
   * name, later, will need. No Loop - an interruption is one-off by
   * definition; a recurring one is just a slide. No door from typed text
   * straight to the glass: save it, then fire the saved one. */
  const [presetName, setPresetName] = useState('');
  const [presetText, setPresetText] = useState('');
  /** null - text mode (Align/Valign apply). A non-null array - Free text,
   * taken literally, the same either-or a slide's own content has. */
  const [presetRows, setPresetRows] = useState<string[] | null>(null);
  const [presetAlign, setPresetAlign] = useState<Align>('center');
  const [presetValign, setPresetValign] = useState<Valign>('middle');
  /** Source, same three choices a slide has (Text/API/Animation) - local
   * only, nothing to persist for API/Animation yet (see SheetEditor's own
   * doc). Always resets to Text on selecting a different tab. */
  const [presetSource, setPresetSource] = useState<'text' | 'api' | 'animation'>('text');
  const [presetTextOpen, setPresetTextOpen] = useState(false);
  /** '' is the switch - blocks the rotation entirely until dismissed or
   * broken by a higher-ranked one. Anything else is a hard limit in
   * milliseconds: shown, then gone outright, sent as `durationMs`. */
  const [presetDuration, setPresetDuration] = useState('');
  /** Which saved interrupter's tab is open - null for the "+ Interrupt"
   * tab itself (the save form, blank). */
  const [presetSelectedName, setPresetSelectedName] = useState<string | null>(null);
  const [presetSending, setPresetSending] = useState(false);
  /** Fire gave no sign a click had even registered - no disabled state,
   * no label change, nothing between clicking and the poll eventually
   * catching up. This is that sign: the name of the preset in flight, so
   * "Firing…" labels only the tab actually being fired rather than
   * whichever tab happens to be open when the floor below runs out -
   * switching tabs mid-fire must not make an untouched preset claim to be
   * firing too. Every Fire button still disables while it is non-null,
   * the same single-flight guard `act` already gives every other action:
   * without it, firing a second preset before the first's floor clears
   * would slip past `act`'s own `busyRef` reentrancy check and read as
   * having fired when the request was never sent. */
  const [presetFiring, setPresetFiring] = useState<string | null>(null);
  /** Which slide the tab rail has open. Its own content is edited by
   * SheetEditor, rendered inline below and keyed on the item's id - no
   * draft state needed out here, the same reasoning Hold never needed one. */
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  /**
   * "+ Slide": the only way to add one. Blank, at the back of the queue,
   * looping - typed straight into the panel's own text box, not through
   * this modal, so adding and editing never share a door again. A board
   * that already has more than one slide is a rotation, not a one-shot, so
   * a new slide joins it the same way the Cycle starter's own seed slides
   * do; turn it off in the panel if this one really is a one-off. No
   * Priority/Hold to set first either: they are exactly the panel's own
   * controls, right there the moment the new slide is selected, so asking
   * for them twice (once before it exists, again once it does) was the
   * actual "loop twice" - move it earlier with the same ↑ any other slide
   * gets, if the back of the queue is not where you want it.
   */
  async function addSlide() {
    // Same reentrancy guard `act` uses, by hand - this doesn't go through
    // `act` itself because it needs the created item's own id back (`act`
    // only ever reports ok/not-ok) and needs to bail before posting at all
    // once the queue's full. Without this, a fast double-click posted two
    // blank slides at once and could push the queue past the cap the
    // error above claims to enforce.
    if (busyRef.current) return;
    busyRef.current = true;
    setError('');
    try {
      // The type's own cap rolls the oldest waiting item off to make room -
      // built for a ticker fed by an API, where that item is disposable. On
      // this rail, every item is a slide someone kept on purpose, and a blank
      // filler is not worth losing one of them for. Refuse before that
      // happens, rather than let it happen silently and call it "added".
      const cap = snapshot?.config?.queueCap ?? 5;
      if ((snapshot?.items.length ?? 0) >= cap) {
        setError(`This board holds ${cap} message${cap === 1 ? '' : 's'} and is full - remove one, or raise Queue size in Settings, before adding another.`);
        return;
      }
      const response = await post('/queue/items', 'POST', { text: '', loop: true });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({}));
        setError(errBody.error || `HTTP ${response.status}`);
        return;
      }
      const created = await response.json().catch(() => null);
      await refresh();
      if (created?.id) setSelectedId(created.id);
    } finally {
      busyRef.current = false;
    }
    onSaved?.();
  }

  /** Load a saved preset's fields into the form, or blank it for `null` -
   * the same tab, whichever one is open. */
  function selectPreset(preset: InterrupterPreset | null) {
    setPresetSelectedName(preset?.name ?? null);
    setPresetName(preset?.name ?? '');
    setPresetSource('text');
    setPresetTextOpen(false);
    if (preset?.rows !== undefined) {
      setPresetRows(preset.rows);
      setPresetText('');
      setPresetAlign('center');
      setPresetValign('middle');
    } else {
      setPresetRows(null);
      setPresetText(preset?.text ?? '');
      setPresetAlign(preset?.align ?? 'center');
      setPresetValign(preset?.valign ?? 'middle');
    }
    setPresetDuration(preset?.durationMs !== undefined ? String(preset.durationMs) : '');
    setError('');
  }

  /** What "Edit text" is currently showing, as the plain shape it edits -
   * same reasoning a slide's own `contentOf` has (SheetEditor.tsx). */
  function presetContent(): { text: string; rows: string[] | null; align: Align; valign: Valign } {
    return { text: presetText, rows: presetRows, align: presetAlign, valign: presetValign };
  }

  /**
   * Save the form as a preset - a new one, or (naming an existing one)
   * replacing it outright. This is the only door to a saved interrupter;
   * firing one is a separate, later action against the name this creates.
   */
  async function savePreset() {
    const name = presetName.trim();
    if (name === '' || (presetRows === null && presetText.trim() === '')) return;
    // Captured before the await, not read again after it - the rail
    // selection can move to a different preset (or off a new, unsaved one)
    // while this request is in flight, since only the Save button itself
    // is disabled. Comparing against what it *was* when Save was clicked,
    // rather than forcing it back to `name` unconditionally, is the same
    // guard `deletePreset` already has for its own post-await state
    // change - without it, a save landing after the user had switched away
    // stole the rail's selection back and left every draft field on
    // screen out of sync with what was actually just saved.
    const wasSelectedName = presetSelectedName;
    setPresetSending(true);
    const body: Record<string, unknown> = { name };
    if (presetRows !== null) {
      body.rows = presetRows;
    } else {
      body.text = presetText.trim();
      body.align = presetAlign;
      body.valign = presetValign;
    }
    if (presetDuration !== '') body.durationMs = Number(presetDuration);
    const ok = await act(() => post('/interrupters', 'POST', body));
    setPresetSending(false);
    if (ok && presetSelectedName === wasSelectedName) {
      // Opens straight onto the saved tab - Fire is right there, the
      // moment there is something to fire.
      setPresetSelectedName(name);
      onSaved?.();
    }
  }

  /**
   * Fire a saved interrupter, by name - the one door from a saved
   * interrupter to the glass. Same pre-empt-and-requeue rule as any other
   * `now` (whatever it displaces is not deleted, it just gets its own
   * turn once this one's is over) - unless what's currently showing is
   * itself a saved interrupter ranked ahead of this one, in which case the
   * server refuses outright (409, surfaced through `act`/`error` the same
   * as any other failed action): a lower one can never break a higher one
   * out of order, only the reverse.
   */
  async function firePreset(name: string) {
    setPresetFiring(name);
    const startedAt = Date.now();
    await act(() => post(`/interrupters/${encodeURIComponent(name)}/fire`, 'POST'));
    // The fire itself lands in well under 100ms - too fast for "Firing…" to
    // read as anything before it's gone again, which is exactly the "did
    // that even do anything?" complaint this state exists to answer. Floor
    // the visible time so the click has something to see, and so a second
    // click can't land before the first one's feedback has even shown up.
    const elapsed = Date.now() - startedAt;
    const MIN_FIRING_MS = 600;
    if (elapsed < MIN_FIRING_MS) await new Promise((resolve) => setTimeout(resolve, MIN_FIRING_MS - elapsed));
    setPresetFiring(null);
  }

  /** Manually end whatever saved interrupter is currently live - the only
   * way off the glass for one fired "until dismissed" (no `durationMs`),
   * which by design blocks the rotation until this happens or a
   * higher-ranked interrupter fires. Clears every queued instance of this
   * name, not just the one on the glass - re-firing while already live
   * queues a second copy behind the first rather than replacing it, and
   * ending only the head would just promote an identical clone into its
   * place (see `dismissInterrupter`'s own doc). */
  async function dismissPreset(name: string) {
    await act(() => post(`/interrupters/${encodeURIComponent(name)}/dismiss`, 'POST'));
  }

  async function deletePreset(name: string) {
    if (
      !(await confirm({
        title: 'Delete this interrupter?',
        body: 'Its text and settings are gone for good.',
        confirmLabel: 'Delete',
        danger: true,
      }))
    ) {
      return;
    }
    const ok = await act(() => post(`/interrupters/${encodeURIComponent(name)}`, 'DELETE'));
    if (ok && presetSelectedName === name) selectPreset(null);
  }

  /**
   * The rail's own tab order, swapped with a neighbour - the only rank a
   * saved interrupter has, and it is enforced (see firePreset's own doc):
   * put the one that should win a clash first.
   */
  function reorderPreset(name: string, direction: -1 | 1) {
    const index = presets.findIndex((preset) => preset.name === name);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= presets.length) return;
    const names = presets.map((preset) => preset.name);
    [names[index], names[target]] = [names[target], names[index]];
    act(() => post('/interrupters/reorder', 'POST', { names }));
  }

  function presetReorderBlockedReason(name: string, direction: -1 | 1): string | undefined {
    const index = presets.findIndex((preset) => preset.name === name);
    const target = index + direction;
    if (target < 0) return 'Already first';
    if (target >= presets.length) return 'Already last';
    return undefined;
  }

  /** Everything reorder() can actually move something relative to - the
   * playing item is excluded, it isn't "in line" the way the rest are. */
  function pendingItems(): QueueItem[] {
    if (!snapshot) return [];
    return snapshot.items.filter(
      (entry) => entry.id !== snapshot.currentItemId || snapshot.currentState !== 'playing',
    );
  }

  function reorder(item: QueueItem, direction: -1 | 1) {
    const pending = pendingItems();
    const index = pending.findIndex((entry) => entry.id === item.id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= pending.length) return;
    // Moving up lands after the item two slots above; the front is afterId null.
    const afterId =
      direction === -1 ? (target === 0 ? null : pending[target - 1].id) : pending[target].id;
    act(() => post('/queue/reorder', 'POST', { itemId: item.id, afterId }));
  }

  /**
   * Why a Move button for `item` would be disabled, or undefined if it
   * would actually do something - the same no-op guard `reorder` itself
   * applies, surfaced as a reason rather than a silent click that moves
   * nothing. Covers both "it's what's currently playing" and "it's already
   * at that end of the queue", which used to look identically clickable.
   */
  function reorderBlockedReason(item: QueueItem, direction: -1 | 1): string | undefined {
    if (!snapshot) return undefined;
    if (item.id === playingId) return "Can't reorder what's currently playing";
    const pending = pendingItems();
    const index = pending.findIndex((entry) => entry.id === item.id);
    const target = index + direction;
    if (target < 0) return 'Already first in the queue';
    if (target >= pending.length) return 'Already last in the queue';
    return undefined;
  }

  /** Switch the rail's selection. Editing a slide's content is SheetEditor's
   * own component now (`SheetEditor`, keyed on the item's id so switching
   * slides remounts it fresh rather than carrying over a stale draft or a
   * text popup left open on the wrong one), immediate-commit the same way
   * Hold already is - nothing to commit or revert here on the way out. */
  function selectItem(item: QueueItem) {
    setSelectedId(item.id);
    // Same reasoning as selectPreset's own reset: a failed reorder/add on
    // the tab you're leaving should not go on reading as still-current
    // once you're looking at a different slide entirely.
    setError('');
  }

  /** An item's own hold override, as the Select's value - '' for none (the
   * board's own dwell applies), same empty-string-means-default convention
   * the compose panel's own Hold field uses. */
  function holdOf(item: QueueItem) {
    const dwell = item.payload.options?.dwellMs;
    return typeof dwell === 'number' ? String(dwell) : '';
  }

  /** Set or clear an existing item's hold, the same way commitEdit changes
   * its text - the full current payload, round-tripped through the API's
   * own text/rows path (patchQueueItem only reads dwellMs alongside one of
   * those), with just this one field changed. */
  function commitHold(item: QueueItem, value: string) {
    const body = { ...payloadToBody(item.payload) };
    if (value === '') delete body.dwellMs;
    else body.dwellMs = Number(value);
    act(() => post(`/queue/items/${item.id}`, 'PATCH', body));
  }

  /** Align/Valign, read-only here - SheetEditor is what sets them now. Kept
   * for the outer preview beside the rail, which shows the item's own
   * saved layout, not a draft (there is no draft out here any more). */
  function alignOf(item: QueueItem): 'left' | 'center' | 'right' | '' {
    const align = item.payload.options?.align;
    return align === 'left' || align === 'center' || align === 'right' ? align : '';
  }
  function valignOf(item: QueueItem): 'top' | 'middle' | 'bottom' | '' {
    const valign = item.payload.options?.valign;
    return valign === 'top' || valign === 'middle' || valign === 'bottom' ? valign : '';
  }

  function label(item: QueueItem) {
    if (item.payload.text) return item.payload.text;
    if (Array.isArray(item.payload.options?.rows)) return item.payload.options.rows.join(' / ');
    return '(blank)';
  }

  /** A short "Ns"/"Nms" reading of a duration - just enough to say what
   * "Board default" actually is inline, rather than a name for a number
   * you'd otherwise have to go check the design for. */
  function formatMs(ms: number) {
    if (ms < 1000) return `${ms}ms`;
    const s = ms / 1000;
    return `${Number.isInteger(s) ? s : s.toFixed(1)}s`;
  }

  /** A slide's own name, set apart from what it says - '' if none. */
  function nameOf(item: QueueItem) {
    const name = item.payload.options?.label;
    return typeof name === 'string' ? name : '';
  }

  /** What the rail shows: the name you gave it, or the text itself when you
   * have not - never both, and never the placeholder '(blank)' text stands
   * in for once there is a real name to show instead. */
  function tabLabel(item: QueueItem) {
    const name = nameOf(item);
    return name !== '' ? name : label(item);
  }

  /** An interruption, not a standing member of the rotation - always fired
   * with priority: now, and kept out of the tab rail because of it: it is
   * an event you triggered, not a slide you're cycling through. */
  function isInterrupt(item: QueueItem) {
    return item.payload.options?.interrupt === true;
  }


  // The board's own dwell, from the design itself - "Board default" in the
  // Hold field otherwise names a number nobody can see without going and
  // checking the theme.
  const boardDefaultHoldLabel = formatMs(pack.advanced.dwellMs);

  const items = snapshot?.items ?? [];
  const playingId = snapshot?.currentState === 'playing' ? snapshot.currentItemId : null;
  const holdingId = snapshot?.currentState === 'holding' ? snapshot.currentItemId : null;

  // The rotation, and interruptions, kept apart - a fired interrupter is not
  // a slide you're cycling through, so it never occupies a tab. Only read
  // here now for the Board tab's own empty-state copy ("an interrupter is
  // standing on the glass instead") - the Interruptions rail itself lists
  // saved presets, not fired instances; see `presets` below.
  const railItems = items.filter((entry) => !isInterrupt(entry));
  const interrupters = items.filter(isInterrupt);

  // Saved interrupters live in board config, the same door every other
  // setting does - not the queue, which only ever holds a fired instance
  // once it exists. `presetSelectedName` names the open tab; `null` is
  // "+ Interrupt", the save form.
  const presets = snapshot?.config?.interrupters ?? [];
  const selectedPreset = presets.find((entry) => entry.name === presetSelectedName) ?? null;
  // Not just `presetSelectedName === null` - the tab it names can vanish
  // (deleted elsewhere) without an effect to notice and reset it; falling
  // back to the save form here is enough.
  const showingNewPreset = selectedPreset === null;
  // What the preset tab's own preview shows: the draft as it's typed for a
  // new one, or the saved content for an existing tab - the same "what
  // this looks like on the glass" the Board tab's panel gives a slide.
  const presetPreviewText = presetRows !== null ? presetRows.join(' / ') : presetText;
  // Whether the form actually differs from what's saved (or, for a new
  // one, from blank) - Save/Revert otherwise offer to do something to
  // nothing, which reads as "what do these even do" the moment you look
  // at them with no edit made.
  const presetDirty = showingNewPreset
    ? presetName.trim() !== '' || presetText.trim() !== '' || presetRows !== null || presetDuration !== ''
    : presetText !== (selectedPreset.text ?? '') ||
      JSON.stringify(presetRows) !== JSON.stringify(selectedPreset.rows ?? null) ||
      presetAlign !== (selectedPreset.align ?? 'center') ||
      presetValign !== (selectedPreset.valign ?? 'middle') ||
      presetDuration !== (selectedPreset.durationMs !== undefined ? String(selectedPreset.durationMs) : '');
  // Mirrors the Board tab's own "not what is playing" caption - the one
  // thing worth saying about a saved interrupter's preview is whether
  // it's the thing actually on the glass right now, not just what would
  // show if fired. Matched by name via `label`, the same identity a
  // fired instance carries (see firePreset's own doc).
  const playingItem = items.find((entry) => entry.id === playingId) ?? null;
  const selectedPresetIsLive =
    !showingNewPreset &&
    playingItem?.payload.options?.interrupt === true &&
    String(playingItem.payload.options?.label ?? '').toLowerCase() === selectedPreset.name.toLowerCase();

  const selected = items.find((entry) => entry.id === selectedId) ?? null;

  // A tab is always selected when there is anything in the rotation to
  // select - defaulting to whatever is playing, so the rail opens on the
  // thing you are most likely watching. Only runs when the current
  // selection is gone (nothing yet, or the selected item was removed
  // elsewhere): every other poll leaves selectedId alone, or the tab
  // you're looking at (or editing, in SheetEditor) would jump out from
  // under you the moment the next poll landed.
  useEffect(() => {
    // Recomputed from `items`, not read from the `railItems` above - a
    // fresh .filter() result on every render would never compare equal to
    // itself in this effect's own dependency array, running the whole
    // thing (harmlessly, but needlessly) on every keystroke elsewhere in
    // the panel. `items` only changes identity when a poll actually lands.
    const rail = items.filter((entry) => !isInterrupt(entry));
    if (rail.length === 0) {
      if (selectedId !== null) setSelectedId(null);
      return;
    }
    if (selectedId && rail.some((entry) => entry.id === selectedId)) return;
    const next = rail.find((entry) => entry.id === playingId) ?? rail[0];
    setSelectedId(next.id);
  }, [items, selectedId, playingId]);

  // Opens on the first saved interrupter, the same reasoning the rail
  // above has - a person landing on an empty "+ Interrupt" form when
  // something is already saved (the only one, often) reads as "did that
  // not save" rather than "nothing is selected yet". Once only, not kept
  // in step the way the slide rail is: staying on "+ Interrupt" after
  // deliberately clicking it is the point, not a state to correct.
  const autoSelectedPresetRef = useRef(false);
  useEffect(() => {
    if (autoSelectedPresetRef.current || presets.length === 0) return;
    autoSelectedPresetRef.current = true;
    selectPreset(presets[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets.length]);

  // A rows-mode item's text is '' rather than undefined - editing it as a
  // single line would silently throw its row structure away on save, so it
  // stays read-only wherever it would otherwise take the live draft.
  const selectedIsRows = Boolean(selected) && !selected!.payload.text && Array.isArray(selected!.payload.options?.rows);
  // The item's own saved content - not a live draft (there is no draft out
  // here any more; SheetEditor's own preview, inside the popup, is what
  // shows live-as-you-type now). Not necessarily what is playing either -
  // the caption below says "not what is playing" when they differ.
  const previewText = selected ? (selectedIsRows ? label(selected) : (selected.payload.text ?? '')) : '';
  // '' (board default) becomes undefined so ThemePreview falls back to the
  // layout engine's real default rather than an empty string it would refuse.
  const previewAlign = selected && !selectedIsRows ? alignOf(selected) || undefined : undefined;
  const previewValign = selected && !selectedIsRows ? valignOf(selected) || undefined : undefined;

  return (
    <>
      {dialog}
      {section === 'board' && (
        <div className="board-surface">
          {/* Narrow, on the left: just the tabs, one per slide. Everything
              about whichever one is selected - preview, text, hold, moving
              it, removing it - lives in the wide column beside it. Always
              here, even with nothing queued yet, so + Slide never moves. */}
          <div className="queue-rail" role="tablist" aria-label="Slides">
            {railItems.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={item.id === selectedId}
                className={item.id === selectedId ? 'is-selected' : ''}
                onClick={() => selectItem(item)}
              >
                <span className="queue-rail-label">{tabLabel(item)}</span>
              </button>
            ))}
            <button type="button" className="queue-rail-add" title="Add a slide" aria-label="Add a slide" onClick={addSlide}>
              + Slide
            </button>
          </div>
          <div className="board-controls">
            <section className="settings-block">
              <h2>Queue</h2>
              {error !== '' && <p className="error">{error}</p>}
              {/* The selected slide's own editor beside its own preview -
                  both belong to the wide side of the page, the rail (its
                  own column, above) is the narrow one. The preview belongs
                  here unconditionally, same as Interruptions' own - the
                  glass has something to show (even blank) whether or not
                  there is a slide selected to say so. */}
              <div className="queue-tabs">
                {railItems.length === 0 ? (
                  <p className="muted">
                    {snapshot?.currentState === 'holding'
                      ? 'The queue has drained; the last message is standing on the glass.'
                      : interrupters.length > 0
                        ? 'Nothing in the rotation - an interrupter is standing on the glass instead.'
                        : 'Nothing queued. The board is blank until something is.'}
                  </p>
                ) : (
                  selected &&
                  (() => {
                    return (
                      <div className="queue-panel">
                        <SheetEditor
                          key={selected.id}
                          item={selected}
                          cols={cols}
                          rows={rows}
                          onSave={(body) => act(() => post(`/queue/items/${selected.id}`, 'PATCH', body))}
                        />
                        <div className="queue-panel-row">
                          {/* No Loop toggle here - being in the rotation
                              already means coming back round; that is
                              what the rail is. Removing this slide (below)
                              is the only way out, same as an interrupter's
                              own loop, just never optional for a slide. */}
                          <Field label="Hold" htmlFor="queue-panel-hold">
                            <Select
                              id="queue-panel-hold"
                              value={holdOf(selected)}
                              onChange={(event) => commitHold(selected, event.target.value)}
                            >
                              <option value="">{`Board default (${boardDefaultHoldLabel})`}</option>
                              <option value="1000">1s</option>
                              <option value="2000">2s</option>
                              <option value="5000">5s</option>
                              <option value="10000">10s</option>
                              <option value="30000">30s</option>
                            </Select>
                          </Field>
                        </div>
                        <div className="queue-panel-actions">
                          <button
                            onClick={() => reorder(selected, -1)}
                            disabled={reorderBlockedReason(selected, -1) !== undefined}
                            title={reorderBlockedReason(selected, -1)}
                          >
                            ↑ Move earlier
                          </button>
                          <button
                            onClick={() => reorder(selected, 1)}
                            disabled={reorderBlockedReason(selected, 1) !== undefined}
                            title={reorderBlockedReason(selected, 1)}
                          >
                            ↓ Move later
                          </button>
                          {/* Dan's call: hide Remove rather than let someone empty a
                              board down to nothing from here. The API still allows it
                              (the board just goes idle, per removeItem in queue.mjs) -
                              this is a UI choice, not a backend restriction, so a slide
                              can still be cleared via other paths (e.g. Clear queue). */}
                          {items.length > 1 && (
                            <button
                              className="danger"
                              onClick={async () => {
                                if (
                                  await confirm({
                                    title: 'Remove this slide?',
                                    body: 'Its text and settings are gone for good.',
                                    confirmLabel: 'Remove',
                                    danger: true,
                                  })
                                ) {
                                  act(() => post(`/queue/items/${selected.id}`, 'DELETE'));
                                }
                              }}
                            >
                              ✕ Remove this slide
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })()
                )}
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
                    align={previewAlign}
                    valign={previewValign}
                  />
                  <div className="design-preview-bar">
                    <p className="design-preview-caption">
                      {cols} × {rows} cards{previewText === '' ? ' · this slide is blank' : ''}
                      {selected && selected.id !== playingId && ' · not what is playing'}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
      {section === 'interruptions' && (
        <div className="board-surface">
          {/* One tab per saved interrupter, plus "+ Interrupt" for saving
              a new one. There is no path from typed text straight to the
              glass - selecting a tab opens it to edit or fire; firing is
              its own button, never a side effect of saving. */}
          <div className="queue-rail" role="tablist" aria-label="Interrupters">
            {presets.map((preset) => (
              <button
                key={preset.name}
                type="button"
                role="tab"
                aria-selected={preset.name === presetSelectedName}
                className={preset.name === presetSelectedName ? 'is-selected' : ''}
                onClick={() => selectPreset(preset)}
              >
                <span className="queue-rail-label">{preset.name}</span>
              </button>
            ))}
            <button
              type="button"
              className="queue-rail-add"
              title="Save a new interrupter"
              aria-label="Save a new interrupter"
              onClick={() => selectPreset(null)}
            >
              + Interrupt
            </button>
          </div>
          <div className="board-controls">
            <section className="settings-block">
              <h2>Interruptions</h2>
              <p className="muted">
                Order is the only ranking a saved interrupter has, and it's enforced: move the one that
                should win a clash to the top, and a lower one can never break it while it's showing.
              </p>
              {error !== '' && <p className="error">{error}</p>}
              <div className="queue-tabs">
                {/* Not hidden behind a click - the whole point of Duration
                    existing is to be visible before you need it, the same
                    as the Board tab's own panel never hides its fields.
                    Name is locked once saved: editing it here would
                    silently create a second preset rather than rename
                    this one (Save is an upsert by name) - delete and
                    re-save under a new name instead. */}
                <div className="interrupt-form">
                  <div className="sheet-editor-row">
                    <Field
                      label="Name"
                      htmlFor="interrupt-name"
                      hint="Required - how this interrupter is fired, from its own tab here or by name over the API. Locked once saved (Save is an upsert by name, not a rename) - delete and re-save under a new name instead."
                    >
                      <TextInput
                        id="interrupt-name"
                        required
                        value={presetName}
                        disabled={!showingNewPreset}
                        placeholder="FIRE"
                        onChange={(event) => setPresetName(event.target.value)}
                      />
                    </Field>
                    <Field label="Source" htmlFor="interrupt-source">
                      <Select
                        id="interrupt-source"
                        value={presetSource}
                        onChange={(event) => setPresetSource(event.target.value as 'text' | 'api' | 'animation')}
                      >
                        <option value="text">Text</option>
                        <option value="api">API</option>
                        <option value="animation">Animation</option>
                      </Select>
                    </Field>
                  </div>

                  {presetSource === 'text' && (
                    <div className="sheet-source-setup">
                      <Button size="sm" onClick={() => setPresetTextOpen(true)}>
                        Edit text →
                      </Button>
                      <EditTextPopup
                        open={presetTextOpen}
                        onClose={() => setPresetTextOpen(false)}
                        cols={cols}
                        rows={rows}
                        initial={presetContent()}
                        onSave={async (patch) => {
                          if (patch.rows !== undefined) {
                            setPresetRows(patch.rows);
                          } else {
                            if (patch.text !== undefined) setPresetText(patch.text);
                            if (patch.align !== undefined) setPresetAlign(patch.align);
                            if (patch.valign !== undefined) setPresetValign(patch.valign);
                            setPresetRows(null);
                          }
                          // Local draft only - the interrupter's own Save/
                          // Save changes below is still the real commit
                          // point, same as every other field in this form.
                          return true;
                        }}
                      />
                    </div>
                  )}

                  {presetSource === 'api' && (
                    <div className="sheet-source-setup">
                      <Field label="Endpoint">
                        <code className="curl">
                          {`POST /api/b/{slug}/sheets/${presetName.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-') || '…'}`}
                        </code>
                      </Field>
                      <p className="ui-hint">
                        This interrupter's own Name, above, is the address - nothing extra to set here. Not built
                        yet - the endpoint above isn't live.
                      </p>
                    </div>
                  )}

                  {presetSource === 'animation' && (
                    <div className="sheet-source-setup">
                      <Field label="Animation" htmlFor="interrupt-animation">
                        <Select id="interrupt-animation" disabled>
                          <option>No animations yet</option>
                        </Select>
                      </Field>
                      <p className="ui-hint">Nothing to pick - none exist yet. The picker can wait here until some do.</p>
                    </div>
                  )}

                  <div className="interrupt-form-row">
                    <Field
                      label="Duration"
                      htmlFor="interrupt-duration"
                      hint="One or the other: a time limit means shown, then gone outright - whether or not anything else is queued - the instant it's up. Until dismissed is a switch: it blocks the rotation entirely, full stop, until you remove it or a higher-ranked interrupter fires."
                    >
                      <Select
                        id="interrupt-duration"
                        value={presetDuration}
                        onChange={(event) => setPresetDuration(event.target.value)}
                      >
                        <option value="">Until dismissed (blocks the rotation)</option>
                        <option value="5000">5 seconds</option>
                        <option value="10000">10 seconds</option>
                        <option value="30000">30 seconds</option>
                        <option value="60000">1 minute</option>
                        <option value="300000">5 minutes</option>
                        <option value="900000">15 minutes</option>
                        <option value="1800000">30 minutes</option>
                        <option value="3600000">1 hour</option>
                        <option value="21600000">6 hours</option>
                        <option value="86400000">24 hours</option>
                      </Select>
                    </Field>
                  </div>
                  {/* Save only exists once there is something to save - a
                      disabled "Save changes" sitting there with nothing
                      changed invites the question "what does this even
                      do", same reasoning Revert/Clear share it with. */}
                  {(showingNewPreset || presetDirty) && (
                    <div className="interrupt-form-actions">
                      <Button
                        variant="primary"
                        disabled={
                          presetName.trim() === '' ||
                          (presetRows === null && presetText.trim() === '') ||
                          presetSending
                        }
                        onClick={savePreset}
                      >
                        {showingNewPreset ? 'Save' : 'Save changes'}
                      </Button>
                      <Button variant="ghost" onClick={() => selectPreset(selectedPreset)}>
                        {showingNewPreset ? 'Clear' : 'Revert'}
                      </Button>
                    </div>
                  )}
                  {!showingNewPreset && (
                    <div className="interrupt-form-actions">
                      <Button
                        variant={selectedPresetIsLive && selectedPreset.durationMs === undefined ? 'ghost' : 'primary'}
                        // Muted means genuinely inert here, not just quieter -
                        // firing an "until dismissed" preset that's already
                        // live queues a second copy behind the first rather
                        // than doing anything (see dismissPreset's own doc),
                        // so there is nothing for a second click to do.
                        disabled={
                          presetFiring !== null || (selectedPresetIsLive && selectedPreset.durationMs === undefined)
                        }
                        onClick={() => firePreset(selectedPreset.name)}
                      >
                        {presetFiring === selectedPreset.name ? 'Firing…' : 'Fire'}
                      </Button>
                      {selectedPresetIsLive && selectedPreset.durationMs === undefined && (
                        <Button
                          variant="primary"
                          disabled={presetFiring !== null}
                          onClick={() => dismissPreset(selectedPreset.name)}
                        >
                          Dismiss
                        </Button>
                      )}
                    </div>
                  )}
                  {!showingNewPreset && (
                    <div className="interrupt-form-actions">
                      <Button
                        variant="ghost"
                        disabled={presetReorderBlockedReason(selectedPreset.name, -1) !== undefined}
                        title={presetReorderBlockedReason(selectedPreset.name, -1)}
                        onClick={() => reorderPreset(selectedPreset.name, -1)}
                      >
                        ↑ Move earlier
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={presetReorderBlockedReason(selectedPreset.name, 1) !== undefined}
                        title={presetReorderBlockedReason(selectedPreset.name, 1)}
                        onClick={() => reorderPreset(selectedPreset.name, 1)}
                      >
                        ↓ Move later
                      </Button>
                    </div>
                  )}
                  {!showingNewPreset && (
                    <div className="interrupt-form-actions">
                      <Button variant="danger" onClick={() => deletePreset(selectedPreset.name)}>
                        Delete
                      </Button>
                    </div>
                  )}
                </div>
                <div className="board-preview">
                  <ThemePreview
                    pack={pack}
                    text={presetPreviewText}
                    cols={cols}
                    rows={rows}
                    tilePx={56}
                    ambientMs={ambientMs}
                    fidget={fidget}
                    screenAspect={screenAspect}
                    align={presetRows === null ? presetAlign : undefined}
                    valign={presetRows === null ? presetValign : undefined}
                  />
                  <div className="design-preview-bar">
                    <p className="design-preview-caption">
                      {cols} × {rows} cards{presetPreviewText === '' ? ' · nothing typed yet' : ''}
                      {selectedPresetIsLive && ' · live now'}
                    </p>
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>
      )}
    </>
  );
}
