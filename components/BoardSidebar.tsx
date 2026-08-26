'use client';

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
import { resolveBoardTheme } from '@/lib/board/board-theme.mjs';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { SAMPLE_MESSAGES } from '@/lib/board/sample-messages.mjs';

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

/**
 * What decides how a board looks and behaves - design, screen, card size,
 * fidget - as one section of the Settings tab. Used to be a persistent
 * sidebar beside every tab, on the reasoning that these are facts you
 * always want visible; the board editor is three tabs now (Settings,
 * Board, Interruptions), and a fact belongs on the one tab about it, not
 * shadowing the other two forever.
 */
export function BoardSidebar({
  config,
  onConfig,
  onSaved,
}: {
  /** The board's config, for the shape it is designed for. */
  config: Record<string, unknown>;
  /** Save a change to the two settings that decide the board's shape.
   * Resolves to whether it worked - `void` still accepted, for a caller
   * with nothing to report either way. */
  onConfig: (patch: Record<string, unknown>) => Promise<boolean> | void;
  /**
   * Told, not shown: the confirmation itself is one shared corner toast
   * (SettingsClient), the same one Queue's own compose flags - not a
   * badge that only exists here and only for these four fields, which
   * read as "saving works in the sidebar, not when you actually change
   * what it says" the moment you compared the two.
   */
  onSaved?: () => void;
}) {
  async function apply(patch: Record<string, unknown>) {
    const ok = await onConfig(patch);
    if (ok !== false) onSaved?.();
  }
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
    apply({ screen: { w, h } });
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
    apply({ theme: patch.theme, themePack: patch.themePack });
  }

  const themes: Record<string, any> = THEMES;

  const { pack } = resolveBoardTheme(config);

  return (
    <section className="settings-block settings-block-wide">
      <h2>Design &amp; shape</h2>
      <div className="shape-surface">
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
                if (found) apply({ screen: { w: found.w, h: found.h } });
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
                    if (event.key === 'Escape') setDraftW(String(screen.w));
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
                    if (event.key === 'Escape') setDraftH(String(screen.h));
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
              onChange={(event) => apply({ cardSize: event.target.value })}
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
              onChange={(event) => apply({ ambientMs: Number(event.target.value) })}
            >
              <option value="0">Off - perfectly still</option>
              <option value="15000">Every 15 seconds</option>
              <option value="30000">Every 30 seconds</option>
              <option value="60000">Every minute</option>
              <option value="300000">Every 5 minutes</option>
            </Select>
          </Field>
        </div>
        {/* What all of the above is actually deciding, beside the fields
            instead of a scroll away - the same reasoning Board's and
            Interruptions' own panels give their preview, sticky here since
            the field column can run longer than the glass is tall. */}
        <div className="shape-preview">
          <ThemePreview
            pack={pack}
            text={SAMPLE_MESSAGES}
            cols={grid.cols}
            rows={grid.rows}
            tilePx={56}
            ambientMs={Number(config.ambientMs) || 0}
            screenAspect={screen.w / screen.h}
          />
          <p className="design-preview-caption">{grid.cols} × {grid.rows} cards</p>
        </div>
      </div>
    </section>
  );
}
