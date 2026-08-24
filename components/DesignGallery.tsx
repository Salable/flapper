'use client';

/**
 * The designs, as boards that actually work.
 *
 * Two kinds, in one list. The ones that ship come from lib/board/themes.mjs and
 * are part of the build, so a typo in one fails the test run rather than a
 * wall. Yours live on your account and can be made here, or by an agent posting
 * a pack to /api/designs - the same door and the same validator.
 *
 * Each card is the real engine on a real canvas, drawing from that design's own
 * pack, because a design's behaviour - the hinge, the shading through a flip,
 * the wash moving - is most of what it is, and a CSS tile cannot flap. It is
 * also the standing check that nothing about a design is hard-coded: if a card
 * here ever comes out looking like Classic, something is keyed on an id again.
 */

import { useCallback, useEffect, useState } from 'react';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { Button, LinkButton } from '@/components/ui/Button';
import { Chip } from '@/components/ui/bits';
import { Field, TextInput, Select } from '@/components/ui/Field';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { THEMES, THEME_IDS, DEFAULT_THEME, resolveTheme } from '@/lib/board/themes.mjs';
import { DEFAULTS } from '@/lib/board/flipboard.js';
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

const themes: Record<string, any> = THEMES;

/**
 * Two messages, not one. Flip again alternates between them, because sending
 * every tile the same distance every time shows none of what makes a
 * split-flap board worth watching - a tile only moves forward round the ring,
 * so O to P is one step and P back round to O is forty-one. Between these two,
 * some tiles barely twitch and others riffle the whole way round.
 */
const SAMPLE = ['NOW BOARDING\nGATE 12 .,!()', 'DELAYED 15 MIN\nPLATFORM 4 (B)'];

/**
 * The mock is the system's own geometry, not a shape chosen to suit a card.
 * DEFAULTS is what a new board actually gets, so a design seen here is a design
 * seen at the proportions it will be used at.
 */
const { cols: COLS, rows: ROWS } = DEFAULTS;

type Design = {
  id: string;
  name: string;
  pack: ThemePack;
  basedOn: string | null;
  updatedAt: number;
};

export function DesignGallery() {
  const { confirm, dialog } = useConfirm();
  const [mine, setMine] = useState<Design[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [newName, setNewName] = useState('');
  const [newFrom, setNewFrom] = useState<string>(DEFAULT_THEME);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/designs');
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setMine(body.designs);
    } catch (err: any) {
      setError(err.message);
      setMine([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function create() {
    if (newName.trim() === '') return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/designs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), from: newFrom }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setMaking(false);
      setNewName('');
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(design: Design) {
    const yes = await confirm({
      title: `Delete ${design.name}?`,
      confirmLabel: 'Delete design',
      danger: true,
    });
    if (!yes) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/designs/${design.id}`, { method: 'DELETE' });
      if (!response.ok) throw new Error((await response.json()).error || `HTTP ${response.status}`);
      await load();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const packButton = (key: string) => (
    <button
      type="button"
      className="ui-btn ui-btn-default ui-btn-sm"
      aria-expanded={open === key}
      onClick={() => setOpen(open === key ? null : key)}
    >
      {open === key ? 'Hide the pack' : 'The pack'}
    </button>
  );

  const card = (
    key: string,
    pack: ThemePack,
    name: string,
    description: React.ReactNode,
    actions: React.ReactNode,
    marks?: React.ReactNode,
  ) => (
    <article className="design-card" key={key}>
      <div className="design-card-board">
        <ThemePreview pack={pack} text={SAMPLE} cols={COLS} rows={ROWS} tilePx={26} />
      </div>
      <div className="design-card-body">
        <h3 className="design-card-name">
          {name}
          {marks}
        </h3>
        <p className="muted">{description}</p>
        <div className="design-card-actions">{actions}</div>
        {open === key && (
          <pre className="design-card-pack">
            <code>{JSON.stringify(strip(pack as unknown as Record<string, unknown>), null, 2)}</code>
          </pre>
        )}
      </div>
    </article>
  );

  return (
    <>
      {dialog}
      {error !== '' && <p className="error">{error}</p>}

      <section className="design-section">
        <header className="design-section-head">
          <h3 className="design-section-title">Yours</h3>
          {!making && (
            <Button size="sm" variant="primary" onClick={() => setMaking(true)}>
              New design
            </Button>
          )}
        </header>

        {making && (
          <div className="design-new">
            <Field label="Name" htmlFor="design-name" hint="What you will call it on this page.">
              <TextInput
                id="design-name"
                value={newName}
                autoFocus
                placeholder="Carrow Road"
                onChange={(event) => setNewName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') create();
                  if (event.key === 'Escape') setMaking(false);
                }}
              />
            </Field>
            <Field
              label="Start from"
              htmlFor="design-from"
              hint="A copy to change, not a link - editing yours later never touches the original."
            >
              <Select id="design-from" value={newFrom} onChange={(event) => setNewFrom(event.target.value)}>
                {THEME_IDS.map((id: string) => (
                  <option key={id} value={id}>
                    {themes[id].name}
                  </option>
                ))}
              </Select>
            </Field>
            <div className="design-new-actions">
              <Button size="sm" variant="primary" disabled={busy || newName.trim() === ''} onClick={create}>
                Make it
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setMaking(false)}>
                Cancel
              </Button>
            </div>
          </div>
        )}

        {mine === null && <p className="muted">Loading your designs…</p>}
        {mine !== null && mine.length === 0 && !making && (
          <p className="muted">
            None yet. Start one from any design in the box below, or have an agent post a pack to{' '}
            <code>/api/designs</code>.
          </p>
        )}
        {mine !== null && mine.length > 0 && (
          <div className="design-gallery">
            {mine.map((design) =>
              card(
                design.id,
                design.pack,
                design.name,
                design.basedOn
                  ? `Started from ${themes[design.basedOn]?.name ?? design.basedOn}.`
                  : 'Made from a pack.',
                <>
                  <LinkButton size="sm" variant="primary" href={`/new?design=${design.id}`}>
                    Make a board in this
                  </LinkButton>
                  {packButton(design.id)}
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => remove(design)}>
                    Delete
                  </Button>
                </>,
                <Chip tone="amber">yours</Chip>,
              ),
            )}
          </div>
        )}
      </section>

      <section className="design-section">
        <h3 className="design-section-title">In the box</h3>
        <p className="muted">
          These ship with Flapper, so they are the same for everybody and cannot be changed here.
          Start one of your own from any of them.
        </p>
        <div className="design-gallery">
          {THEME_IDS.map((id: string) =>
            card(
              id,
              resolveTheme(id),
              themes[id].name,
              themes[id].description,
              <>
                <LinkButton size="sm" variant="primary" href={`/new?theme=${id}`}>
                  Make a board in this
                </LinkButton>
                {packButton(id)}
                <Button
                  size="sm"
                  onClick={() => {
                    setNewFrom(id);
                    setNewName(`${themes[id].name} copy`);
                    setMaking(true);
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                >
                  Start one from this
                </Button>
              </>,
              <>
                {id === DEFAULT_THEME && <Chip>default</Chip>}
                {themes[id].tint && <Chip tone="amber">wash</Chip>}
              </>,
            ),
          )}
        </div>
      </section>
    </>
  );
}

/** The pack without the parts that are the same for every design. */
function strip(pack: Record<string, unknown>) {
  const { id, name, description, fonts, states, art, ...rest } = pack;
  return rest;
}
