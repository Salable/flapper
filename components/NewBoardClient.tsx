'use client';

/**
 * Choosing a board, the way you choose something to watch: rails of cards,
 * one rail per family of use, a poster on every card that is the board
 * itself in CSS tiles. Pick a card and its details open under the rail -
 * what you get, what it starts with, and the two or three things the type
 * genuinely needs to know - and one button creates it and lands you in its
 * control room with the queue already primed.
 *
 * Everything here is registry-driven: the rails are lib/board-types/
 * templates.mjs, the form is the type's createParams. A new type is a new
 * card on the first rail; a new template is a new card on its rail; this
 * file does not change for either.
 *
 * Forms hold focus (docs/DESIGN-SYSTEM.md): the detail panel is keyed on the
 * template id so it mounts once per choice, inputs keep their identity while
 * the rails re-render, and nothing is defined inside render.
 */

import { useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppBar } from '@/components/AppBar';
import { UserMenu } from '@/components/UserMenu';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, TextInput, Select, Checkbox } from '@/components/ui/Field';
import { Chip } from '@/components/ui/bits';
import { LicenceRequestForm } from '@/components/LicenceRequestForm';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { resolveTheme } from '@/lib/board/themes.mjs';
import { DEFAULTS } from '@/lib/board/flipboard.js';
import type { TypeMeta } from '@/components/board-types/type-meta';
import { nextFreeName } from '@/lib/board-types/names.mjs';

export type TemplateMeta = {
  id: string;
  type: string;
  name: string;
  defaultName: string;
  tagline: string;
  poster: string[];
  what: string[];
  recommended: boolean;
  /** Set when this account's licence does not cover the template's type. */
  locked?: boolean;
  /** One of the three Start here cards, which name an intention rather than a template. */
  starter: boolean;
  params: Record<string, unknown>;
  config: Record<string, unknown>;
  seedCount: number;
};

export type FamilyMeta = {
  id: string;
  title: string;
  blurb: string;
  templates: TemplateMeta[];
};

/** The browser's own zone - the right default for a clock board nine times in ten. */
function localTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Creation asks for the minimum: a name, and what the type genuinely needs. */
function creationParams(type: TypeMeta) {
  return type.createParams.filter((param) => !param.advanced && param.key !== 'name');
}

/**
 * Every poster is the same board: one grid, one tile size, so the cards are a
 * row of identical frames and the only thing that varies between them is the
 * design and the words. A card is an example, not a spec sheet - it is not the
 * place to communicate that this template happens to be twenty-four columns
 * wide, and three different widths in a row read as a mistake rather than as
 * information. The template's real grid still applies to the board you get.
 */
function tileSizeFor(width: number, height: number, maxTile: number) {
  const perTile = 1 + DEFAULTS.gapRatio;
  const byWidth = (width - 12) / (DEFAULTS.cols * perTile);
  const byHeight = (height - 12) / (DEFAULTS.rows * perTile);
  return Math.max(5, Math.min(maxTile, Math.floor(Math.min(byWidth, byHeight))));
}

/**
 * What the three starters look like doing their job.
 *
 * A board's type is the one thing about it that cannot be changed afterwards,
 * and it was being chosen from a still picture. A live queue's whole character
 * is that it keeps changing as things arrive; a clock board's is that it turns
 * over when the time comes. Neither is visible in a frame.
 */
const DEMOS: Record<string, string[]> = {
  // A sign holds. Two messages so Flip has somewhere to go, but the
  // point of it is that it stays - so it does not cycle on its own.
  sign: ['WELCOME'],
  cycle: ['NOW BOARDING', 'GATE 12 OPEN', 'FINAL CALL'],
  timetable: ['STANDUP 0900', 'LUNCH 1300', 'HOME TIME 1730'],
};

export function NewBoardClient({
  userName,
  types,
  families,
  takenNames = [],
  requestable,
  accountEmail,
}: {
  userName: string;
  types: TypeMeta[];
  families: FamilyMeta[];
  /** Board names the account already has; a template's prefill steps around them. */
  takenNames?: string[];
  /** What can be asked for (lib/salable/licence.mjs REQUESTABLE), for the 402 form. */
  requestable: Record<string, string>;
  accountEmail: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<{ familyId: string; template: TemplateMeta } | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  /*
   * A 402 is not an error, it is the start of a conversation - so the form
   * opens here rather than sending someone to another page to describe what
   * they just tried to do. `need` comes off the refusal, so the ask arrives
   * already sorted into the entitlement a plan would grant.
   */
  const [refused, setRefused] = useState<{ need: string; message: string } | null>(null);

  const rails = useRef(new Map<string, HTMLDivElement>());
  const detailRef = useRef<HTMLDivElement>(null);

  const typeOf = (template: TemplateMeta) => types.find((type) => type.id === template.type);

  function choose(familyId: string, template: TemplateMeta) {
    const type = typeOf(template);
    const seeded: Record<string, unknown> = { name: nextFreeName(template.defaultName, takenNames), ...template.params };
    // Only a zone the template did not pin is defaulted from the browser.
    if (type?.createParams.some((param) => param.key === 'timezone') && seeded.timezone === undefined) {
      seeded.timezone = localTimezone();
    }
    setSelected({ familyId, template });
    setValues(seeded);
    setSlug('');
    setError('');
    setRefused(null);
  }

  function close() {
    setSelected(null);
    setValues({});
    setSlug('');
    setError('');
  }

  // The panel opens under its rail; bring it into view without yanking the
  // page when it is already visible.
  useEffect(() => {
    if (selected && detailRef.current) {
      detailRef.current.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [selected]);

  function scrollRail(familyId: string, direction: -1 | 1) {
    const rail = rails.current.get(familyId);
    if (!rail) return;
    rail.scrollBy({ left: direction * rail.clientWidth * 0.8, behavior: 'smooth' });
  }

  // ?theme=sorbet, from the designs gallery's "make a board in this".
  const params = useSearchParams();
  const wantedTheme = params.get('theme');
  // ?design=<id>, from a design of your own. A shipped one arrives as ?theme=;
  // both end up as the board's look, by different routes - a preset is a name
  // the build knows, and yours is a pack the server reads off your account.
  const wantedDesign = params.get('design');
  const nameValue = String(values.name ?? '').trim();

  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!selected) return;
    if (nameValue === '') {
      setError('Give the board a name - it is how you will tell it apart on the dashboard.');
      return;
    }
    setBusy(true);
    setError('');
    setRefused(null);
    try {
      const response = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          template: selected.template.id,
          ...(slug.trim() !== '' ? { slug: slug.trim() } : {}),
          // Arrived from /designs wanting a particular look: the template
          // still decides the type and the seeds, the design is yours.
          ...(wantedTheme ? { theme: wantedTheme } : {}),
          ...(wantedDesign ? { designId: wantedDesign } : {}),
          ...values,
        }),
      });
      const body = await response.json();
      if (response.status === 402 && typeof body.need === 'string') {
        setRefused({ need: body.need, message: body.error });
        setBusy(false);
        return;
      }
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      router.push(`/b/${body.slug}/manage`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  const set = (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value }));

  /**
   * The poster: the board this template actually makes.
   *
   * One tile size for the whole page, deliberately. Sizing each board to fill
   * its card instead gave a 24-column template 8px tiles and a 20-column one
   * 10px, so every poster was drawn at a different scale and they read as
   * arbitrarily different when the only real difference was how many cards they
   * have. With one scale, a 24x10 board is simply bigger than a 20x8 one, which
   * is true and looks it.
   *
   * The size is whatever makes the widest and tallest grid any template uses
   * fit the space, so nothing is clipped and nothing has to be measured.
   */
  const poster = (template: TemplateMeta, width: number, height: number, maxTile: number) => {
    const pack = resolveTheme(template.config.theme);
    // The three starters teach a behaviour, so they demonstrate it: a live
    // board keeps changing, a clock board turns over. The nine examples hold
    // still, because twelve permanent animation loops on one page is a lot of
    // laptop fan for no extra information.
    const demo = DEMOS[template.id];
    // A sign's character is that it does not change, so it does not.
    const cycles = demo !== undefined && demo.length > 1;
    return (
      <span className="poster" aria-hidden="true">
        <ThemePreview
          pack={pack}
          text={demo ?? template.poster.join('\n')}
          loop={cycles ? 4200 : 0}
          cols={DEFAULTS.cols}
          rows={DEFAULTS.rows}
          tilePx={tileSizeFor(width, height, maxTile)}
          bar={false}
          fixed
        />
      </span>
    );
  };

  /** The expanded card under a rail. Called, not rendered as a component. */
  const detail = (template: TemplateMeta) => {
    const type = typeOf(template);
    return (
      <div className="rail-detail flap-in" ref={detailRef} key={template.id}>
        <div className="rail-detail-poster">{poster(template, 300, 150, 40)}</div>
        <div className="rail-detail-about">
          <div className="rail-detail-head">
            <h3>{template.name}</h3>
            {type && !template.starter && <Chip>{type.name}</Chip>}
            {template.recommended && <Chip tone="amber">Start here</Chip>}
            {template.locked && <Chip>Get in touch</Chip>}
          </div>
          <p className="rail-detail-tagline">{template.tagline}</p>
          <ul className="rail-detail-what">
            {template.what.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {template.seedCount > 0 ? (
            <p className="ui-hint">
              Starts with {template.seedCount === 1 ? 'one message' : `${template.seedCount} messages`} on the
              queue - keep, edit, or clear them in the control room.
            </p>
          ) : (
            type && <p className="ui-hint">{type.description}</p>
          )}
        </div>
        <form className="rail-detail-form" onSubmit={create}>
          <Field label="Board name (required)" htmlFor="nb-name">
            <TextInput
              id="nb-name"
              value={String(values.name ?? '')}
              placeholder="Lobby, Departures, Build status…"
              required
              autoFocus
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          {type &&
            creationParams(type).map((param) => (
              <Field key={param.key} label={param.label} hint={param.hint} htmlFor={`nb-${param.key}`}>
                {param.kind === 'number' ? (
                  // Raw string while typing - the server coerces and validates.
                  <TextInput
                    id={`nb-${param.key}`}
                    inputMode="numeric"
                    value={String(values[param.key] ?? param.default ?? '')}
                    onChange={(e) => set(param.key, e.target.value)}
                  />
                ) : param.kind === 'select' ? (
                  <Select
                    id={`nb-${param.key}`}
                    value={String(values[param.key] ?? param.default ?? '')}
                    onChange={(e) => set(param.key, e.target.value)}
                  >
                    {(param.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                ) : param.kind === 'checkbox' ? (
                  <Checkbox
                    id={`nb-${param.key}`}
                    label={param.label}
                    checked={Boolean(values[param.key] ?? param.default ?? false)}
                    onChange={(e) => set(param.key, e.target.checked)}
                  />
                ) : (
                  <TextInput
                    id={`nb-${param.key}`}
                    value={String(values[param.key] ?? param.default ?? '')}
                    onChange={(e) => set(param.key, e.target.value)}
                  />
                )}
              </Field>
            ))}
          <Field label="URL slug" hint="Optional - blank for a generated one like amber-falcon-42." htmlFor="nb-slug">
            <TextInput
              id="nb-slug"
              value={slug}
              spellCheck={false}
              onChange={(e) => setSlug(e.target.value.toLowerCase())}
            />
          </Field>
          {error !== '' && <p className="error">{error}</p>}
          {refused !== null && <p className="error">{refused.message}</p>}
          <div className="rail-detail-actions">
            <Button type="submit" variant="primary" disabled={busy || nameValue === ''}>
              {busy ? 'Creating…' : 'Create board'}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </form>
        {/* Outside the form above, deliberately: this is its own <form>
            (LicenceRequestForm), and HTML forbids nesting one form inside
            another - a real hydration error in Next 16, not a lint nit. */}
        {refused !== null && (
          <div className="licence-refusal">
            <LicenceRequestForm requestable={requestable} need={refused.need} accountEmail={accountEmail} />
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="app-shell">
      <AppBar right={<UserMenu userName={userName} current="dashboard" />} />
      <main className="new-board">
        <header className="new-head">
          <h1 className="dash-title">New board</h1>
          <p>
            Pick a starting point. Every card is a real board - its own URL, key, and agent guide -
            and everything about it can be changed in its control room afterwards.
          </p>
          <LinkButton size="sm" variant="ghost" href="/dashboard">
            Back to boards
          </LinkButton>
        </header>

        {families.map((family) => (
          <section className="rail-section" key={family.id} aria-labelledby={`rail-${family.id}`}>
            <div className="rail-head">
              <h2 id={`rail-${family.id}`}>{family.title}</h2>
              <p>{family.blurb}</p>
            </div>
            <div className="rail-wrap">
              <button
                type="button"
                className="rail-arrow is-prev"
                aria-label={`Scroll ${family.title} back`}
                onClick={() => scrollRail(family.id, -1)}
              >
                ‹
              </button>
              <div
                className="rail"
                ref={(element) => {
                  if (element) rails.current.set(family.id, element);
                  else rails.current.delete(family.id);
                }}
              >
                {family.templates.map((template, index) => {
                  const active = selected?.template.id === template.id;
                  return (
                    <button
                      type="button"
                      key={template.id}
                      className={`rail-card flap-in${active ? ' is-selected' : ''}${template.recommended ? ' is-recommended' : ''}${template.locked ? ' is-locked' : ''}`}
                      style={{ '--flap-i': index } as React.CSSProperties}
                      aria-pressed={active}
                      aria-label={`${template.name}${template.recommended ? ', recommended' : ''}${template.locked ? ', get in touch' : ''}. ${template.tagline}`}
                      // A locked template's whole point is "ask, don't build" - opening the
                      // create form just to fail at submit (with a get-in-touch form nested
                      // inside it, which is its own bug - see below) taught the wrong thing.
                      // The "Get in touch" chip already says what it is; clicking it stays inert.
                      onClick={() => {
                        if (template.locked) return;
                        active ? close() : choose(family.id, template);
                      }}
                    >
                      <span className="rail-card-poster">{poster(template, 226, 112, 28)}</span>
                      <span className="rail-card-body">
                        <span className="rail-card-head">
                          <span className="rail-card-name">{template.name}</span>
                          {template.recommended && <Chip tone="amber">Start here</Chip>}
                          {template.locked && <Chip>Get in touch</Chip>}
                        </span>
                        <span className="rail-card-tagline">{template.tagline}</span>
                        {!template.starter && (
                          <span className="rail-card-type">{typeOf(template)?.name ?? template.type}</span>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                className="rail-arrow is-next"
                aria-label={`Scroll ${family.title} forward`}
                onClick={() => scrollRail(family.id, 1)}
              >
                ›
              </button>
            </div>
            {selected?.familyId === family.id && detail(selected.template)}
          </section>
        ))}
      </main>
    </div>
  );
}
