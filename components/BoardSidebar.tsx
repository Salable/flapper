'use client';

import { Chip, CopyButton } from '@/components/ui/bits';
import {
  screenLabel,
  screenOf,
  gridForConfig,
  cardSizeOf,
  CARD_SIZE_IDS,
} from '@/lib/board/geometry.mjs';
import { useEffect, useState } from 'react';
import { Field, Select, TextInput } from '@/components/ui/Field';
import { THEMES, THEME_IDS, DEFAULT_THEME } from '@/lib/board/themes.mjs';
import { presetDraft, draftToPatch } from '@/lib/board/theme-editor.mjs';

/** The shapes offered by name; anything else is shown as its own ratio. */
const SCREENS = [
  { label: '16:9', w: 16, h: 9 },
  { label: '4:3', w: 4, h: 3 },
  { label: '9:16 portrait', w: 9, h: 16 },
  { label: 'Square', w: 1, h: 1 },
];

const SIZE_LABELS: Record<string, string> = {
  huge: 'Huge',
  large: 'Large',
  medium: 'Medium',
  small: 'Small',
  tiny: 'Tiny',
};
import { LinkButton } from '@/components/ui/Button';
import { formatDay } from '@/lib/format';

/**
 * The board itself, beside whatever screen is working on it: name, slug and
 * URL, type and status, when it was made, and the two things you always
 * want to hand (open the display, copy its URL). One shell for every
 * per-board screen, so a board's identity is never something you have to
 * go and find - on settings it was nowhere at all.
 */
export function BoardSidebar({
  name,
  slug,
  typeName,
  status,
  isPrivate,
  createdAt,
  boardUrl,
  config,
  onConfig,
}: {
  name: string;
  slug: string;
  typeName: string;
  status: 'active' | 'deactivated';
  isPrivate: boolean;
  createdAt: number;
  /** Resolved client-side (the server does not know the public origin); '' until then. */
  boardUrl: string;
  /** The board's config, for the shape it is designed for. */
  config: Record<string, unknown>;
  /** Save a change to the two settings that decide the board's shape. */
  onConfig: (patch: Record<string, unknown>) => void;
}) {
  /*
   * The screen, beside the type and the created date, because it is the fact
   * that decides what the board looks like - and until it was said here, the
   * only way to find out was to open Display and scroll. A board that has
   * never been asked says so rather than quietly showing the default as though
   * somebody had picked it.
   */
  const chosen = (config?.screen ?? null) !== null;
  const screen = screenOf(config);
  const shape = screenLabel(screen);
  const grid = gridForConfig(config);
  const onList = SCREENS.some((option) => option.w === screen.w && option.h === screen.h);
  const [custom, setCustom] = useState(false);
  // The pair being typed, so neither half is saved on its own.
  const [draftW, setDraftW] = useState(String(screen.w));
  const [draftH, setDraftH] = useState(String(screen.h));

  function commitCustom() {
    const w = Number(draftW);
    const h = Number(draftH);
    if (!Number.isFinite(w) || w <= 0 || !Number.isFinite(h) || h <= 0) return;
    if (w === screen.w && h === screen.h) return;
    onConfig({ screen: { w, h } });
  }

  /*
   * Your own designs, so a board can wear one without leaving this panel.
   * Copied in, not linked, same as everywhere else a design is applied - the
   * board stores what it was given, editing the design later never reaches
   * a wall.
   */
  const [own, setOwn] = useState<{ id: string; name: string; pack: any; basedOn: string | null }[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/designs')
      .then((response) => (response.ok ? response.json() : { designs: [] }))
      .then((body) => {
        if (!cancelled) setOwn(body.designs ?? []);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * A preset id, or `design:<id>` for one of your own - applied immediately,
   * the same as Screen and Card size are. Sends `themePack` explicitly, null
   * included: sending only `theme` would have left an old customisation
   * layered onto the new preset instead of replacing it.
   */
  function pickTheme(value: string) {
    const chosen = own.find((design) => `design:${design.id}` === value);
    const draft = chosen ? { theme: chosen.basedOn ?? DEFAULT_THEME, pack: chosen.pack } : presetDraft(value);
    const patch = draftToPatch(draft);
    if (!patch.ok) return;
    onConfig({ theme: patch.theme, themePack: patch.themePack });
  }

  const themes: Record<string, any> = THEMES;

  return (
    <aside className="board-side" aria-label="This board">
      <h1 className="board-side-name">{name || slug}</h1>
      <div className="board-side-slug">
        <code>/b/{slug}</code>
        {boardUrl !== '' && <CopyButton value={boardUrl} label="Copy URL" />}
      </div>
      <div className="board-side-chips">
        <Chip title="How this board plays what's posted to it - a rolling queue that plays as it arrives. A sign is one of these with its queue capped at one message.">
          {typeName}
        </Chip>
        {status !== 'active' ? (
          <Chip tone="danger" title="Paused in General: every display shows a paused card and ignores new messages. The queue is kept exactly as it is.">
            paused
          </Chip>
        ) : (
          <Chip tone="live" title="Live: displays play what's posted and accept new messages.">
            active
          </Chip>
        )}
        {isPrivate && <Chip title="Only reachable with the board's API key - see General.">private</Chip>}
      </div>
      {/* What decides how this board looks and behaves, in the one place
          that is always on screen - no separate tab to go and find. */}
      <div className="board-side-shape">
        <Field
          label="Start from"
          htmlFor="side-theme"
          hint="Replaces this board's look with the one you pick. To make your own, go to Designs."
        >
          <Select id="side-theme" value={String(config.theme ?? DEFAULT_THEME)} onChange={(e) => pickTheme(e.target.value)}>
            <optgroup label="In the box">
              {THEME_IDS.map((id: string) => (
                <option key={id} value={id}>
                  {themes[id].name}
                </option>
              ))}
            </optgroup>
            {own.length > 0 && (
              <optgroup label="Yours">
                {own.map((design) => (
                  <option key={design.id} value={`design:${design.id}`}>
                    {design.name}
                  </option>
                ))}
              </optgroup>
            )}
          </Select>
        </Field>
        <Field label="Screen" htmlFor="side-screen">
          <Select
            id="side-screen"
            value={custom || !onList ? 'custom' : `${screen.w}:${screen.h}`}
            onChange={(event) => {
              if (event.target.value === 'custom') {
                setCustom(true);
                // Refreshed from the current screen, not left at whatever
                // was last typed - picking a preset and reopening Custom
                // must not show a stale shape from an earlier session.
                setDraftW(String(screen.w));
                setDraftH(String(screen.h));
                return;
              }
              setCustom(false);
              const found = SCREENS.find((option) => `${option.w}:${option.h}` === event.target.value);
              if (found) onConfig({ screen: { w: found.w, h: found.h } });
            }}
          >
            {SCREENS.map((option) => (
              <option key={option.label} value={`${option.w}:${option.h}`}>
                {option.label}
              </option>
            ))}
            <option value="custom">Custom{!onList ? ` (${shape})` : ''}</option>
          </Select>
        </Field>
        {(custom || !onList) && (
          /* Committed together, on Enter or on leaving the pair - a shape is
             two numbers and saving after the first one means saving a shape
             nobody asked for. Typing 300 into the width of a 16:9 board was
             briefly a 100:3 screen, and it saved. */
          <div className="board-side-custom">
            <Field label="Width" htmlFor="side-screen-w">
              <TextInput
                id="side-screen-w"
                type="number"
                min={1}
                value={draftW}
                onChange={(event) => setDraftW(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitCustom();
                }}
                onBlur={commitCustom}
              />
            </Field>
            <Field
              label="Height"
              htmlFor="side-screen-h"
              hint="Any units - centimetres, pixels, or proportions. Only the ratio matters."
            >
              <TextInput
                id="side-screen-h"
                type="number"
                min={1}
                value={draftH}
                onChange={(event) => setDraftH(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitCustom();
                }}
                onBlur={commitCustom}
              />
            </Field>
          </div>
        )}
        <Field label="Card size" htmlFor="side-cardsize">
          <Select
            id="side-cardsize"
            value={cardSizeOf(config)}
            onChange={(event) => onConfig({ cardSize: event.target.value })}
          >
            {CARD_SIZE_IDS.map((id: string) => (
              <option key={id} value={id}>
                {SIZE_LABELS[id] ?? id}
              </option>
            ))}
          </Select>
        </Field>
        <p className="board-side-grid muted">
          {grid.cols} × {grid.rows} cards{!chosen && ' · default screen'}
        </p>
        <Field
          label="Fidget"
          htmlFor="side-ambient"
          hint="A board holding one message sits perfectly still, which a real one never does. On, it twitches a tile now and then and corrects itself, and sweeps about once in twelve. Off by default - a wall should not clack all night unless you asked it to."
        >
          <Select
            id="side-ambient"
            value={String(Number(config.ambientMs) || 0)}
            onChange={(event) => onConfig({ ambientMs: Number(event.target.value) })}
          >
            <option value="0">Off - perfectly still</option>
            <option value="15000">Every 15 seconds</option>
            <option value="30000">Every 30 seconds</option>
            <option value="60000">Every minute</option>
            <option value="300000">Every 5 minutes</option>
          </Select>
        </Field>
      </div>
      <dl className="board-side-facts">
        <dt>Created</dt>
        <dd>{formatDay(createdAt)}</dd>
      </dl>
      <div className="board-side-actions">
        {boardUrl !== '' && (
          <LinkButton size="sm" href={boardUrl} target="_blank" rel="noopener">
            Open display
          </LinkButton>
        )}
      </div>
    </aside>
  );
}
