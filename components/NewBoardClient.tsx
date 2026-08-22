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
import { useRouter } from 'next/navigation';
import { AppBar } from '@/components/AppBar';
import { UserMenu } from '@/components/UserMenu';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, TextInput, Select, Checkbox } from '@/components/ui/Field';
import { Chip } from '@/components/ui/bits';
import { MiniBoard } from '@/components/ui/MiniBoard';
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
  tier?: string;
  blank: boolean;
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

export function NewBoardClient({
  userName,
  types,
  families,
  takenNames = [],
}: {
  userName: string;
  types: TypeMeta[];
  families: FamilyMeta[];
  /** Board names the account already has; a template's prefill steps around them. */
  takenNames?: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<{ familyId: string; template: TemplateMeta } | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [slug, setSlug] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
    try {
      const response = await fetch('/api/boards', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          template: selected.template.id,
          ...(slug.trim() !== '' ? { slug: slug.trim() } : {}),
          ...values,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      router.push(`/b/${body.slug}/settings`);
    } catch (err: any) {
      setError(err.message);
      setBusy(false);
    }
  }

  const set = (key: string, value: unknown) => setValues((prev) => ({ ...prev, [key]: value }));

  /**
   * The poster: the board in CSS tiles, skinned by the template's theme.
   * Tiles are sized so the longest line fits the width it has - a twelve-tile
   * line and a seven-tile line both fill the card without spilling.
   */
  const poster = (template: TemplateMeta, width: number, maxTile: number) => {
    const longest = Math.max(1, ...template.poster.map((line) => line.length));
    const fit = Math.max(10, Math.min(maxTile, Math.floor(width / (longest + (longest - 1) * 0.08))));
    return (
      <span className={`poster${template.config.theme === 'canary' ? ' is-canary' : ''}`} aria-hidden="true">
        {template.poster.map((line, index) => (
          <MiniBoard key={index} text={line} fit={fit} />
        ))}
      </span>
    );
  };

  /** The expanded card under a rail. Called, not rendered as a component. */
  const detail = (template: TemplateMeta) => {
    const type = typeOf(template);
    return (
      <div className="rail-detail flap-in" ref={detailRef} key={template.id}>
        <div className="rail-detail-poster">{poster(template, 300, 40)}</div>
        <div className="rail-detail-about">
          <div className="rail-detail-head">
            <h3>{template.name}</h3>
            {type && !template.blank && <Chip>{type.name}</Chip>}
            {template.recommended && <Chip tone="amber">Start here</Chip>}
            {template.tier && <Chip>{template.tier}</Chip>}
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
          <div className="rail-detail-actions">
            <Button type="submit" variant="primary" disabled={busy || nameValue === ''}>
              {busy ? 'Creating…' : 'Create board'}
            </Button>
            <Button type="button" variant="ghost" onClick={close}>
              Close
            </Button>
          </div>
        </form>
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
                      className={`rail-card flap-in${active ? ' is-selected' : ''}${template.recommended ? ' is-recommended' : ''}`}
                      style={{ '--flap-i': index } as React.CSSProperties}
                      aria-pressed={active}
                      aria-label={`${template.name}${template.recommended ? ', recommended' : ''}. ${template.tagline}`}
                      onClick={() => (active ? close() : choose(family.id, template))}
                    >
                      <span className="rail-card-poster">{poster(template, 226, 28)}</span>
                      <span className="rail-card-body">
                        <span className="rail-card-head">
                          <span className="rail-card-name">{template.name}</span>
                          {template.recommended && <Chip tone="amber">Start here</Chip>}
                          {template.tier && <Chip>{template.tier}</Chip>}
                        </span>
                        <span className="rail-card-tagline">{template.tagline}</span>
                        {!template.blank && (
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
