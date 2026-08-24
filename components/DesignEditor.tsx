'use client';

/**
 * Editing a design, using the editor that dresses a board.
 *
 * It is the same job - a pack, and controls for every field in it - so it is
 * the same component. Only the destination differs: a board saves a sparse diff
 * against a preset, because a board's look is an edit *of* something; a design
 * saves its whole pack, because a design is a thing in its own right and there
 * is nothing underneath it to diff against.
 *
 * The preview beside it is the same split screen the board's Display tab uses,
 * for the same reason: a design is mostly how it behaves, and you cannot judge
 * that from a list of numbers.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ThemeSettings, type ThemeDraft } from '@/components/ThemeSettings';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { Button, LinkButton } from '@/components/ui/Button';
import { validatePack, type ThemePack } from '@/lib/board/theme-pack.mjs';
import { stableStringify } from '@/lib/board/board-theme.mjs';
import { DEFAULT_THEME } from '@/lib/board/themes.mjs';
import { DEFAULTS } from '@/lib/board/flipboard.js';

const SAMPLE = ['NOW BOARDING\nGATE 12 .,!()', 'DELAYED 15 MIN\nPLATFORM 4 (B)'];

type Design = { id: string; name: string; pack: ThemePack; basedOn: string | null };

export function DesignEditor({ design }: { design: Design }) {
  const router = useRouter();
  const [saved, setSaved] = useState<ThemePack>(design.pack);
  const [draft, setDraft] = useState<ThemeDraft>({
    theme: design.basedOn ?? DEFAULT_THEME,
    pack: design.pack,
  });
  const [error, setError] = useState('');

  /*
   * Dirty when the pack differs from the one on the server - but compared as
   * the server will store it, not as it happens to be held here.
   *
   * validatePack fills the gaps: a pack with no `description` comes back with
   * `description: ''`, and switching Start from puts an `id` on the draft that
   * the server strips. Comparing raw, a design was dirty for ever the moment it
   * was saved once - the caption said "unsaved changes" permanently and leaving
   * the page always warned. Comparing what will actually be stored is the
   * comparison that means anything.
   */
  const dirty = useMemo(
    () => forComparison(draft.pack) !== forComparison(saved),
    [draft.pack, saved],
  );

  // A design is a whole pack, so it has to be a valid one before it is stored -
  // the same validator the API will run, so a problem is named here rather than
  // coming back as a 422.
  const valid = useMemo(() => validatePack({ ...draft.pack, id: undefined }), [draft.pack]);

  const save = useCallback(
    async (next: ThemeDraft) => {
      const checked = validatePack({ ...next.pack, id: undefined });
      if (!checked.ok) throw new Error(checked.errors.join('; '));
      const response = await fetch(`/api/designs/${design.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pack: checked.pack }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
      setSaved(body.design.pack);
      router.refresh();
    },
    [design.id, router],
  );

  // Leaving with unsaved changes should cost a confirmation, because a pack is
  // fiddly to rebuild from memory.
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  return (
    <div className="design-surface">
      <div className="design-preview">
        <ThemePreview
          pack={draft.pack}
          text={SAMPLE}
          cols={DEFAULTS.cols}
          rows={DEFAULTS.rows}
          tilePx={30}
        />
        <div className="design-preview-bar">
          <p className="design-preview-caption">
            {DEFAULTS.cols} × {DEFAULTS.rows} cards · {dirty ? 'unsaved changes' : 'saved'}
          </p>
          <div className="design-preview-actions">
            <Button
              size="sm"
              variant="ghost"
              disabled={!dirty}
              onClick={() => setDraft({ theme: draft.theme, pack: saved })}
            >
              Undo changes
            </Button>
            <LinkButton size="sm" href="/designs">
              All designs
            </LinkButton>
          </div>
        </div>
        {!valid.ok && <p className="error">{valid.errors.join('; ')}</p>}
        {error !== '' && <p className="error">{error}</p>}
      </div>
      <div className="design-controls">
        <ThemeSettings
          slug=""
          draft={draft}
          onDraft={setDraft}
          config={{}}
          onSaved={() => {}}
          saveTo={{
            label: 'Save design',
            dirty,
            save: async (next) => {
              setError('');
              try {
                await save(next);
              } catch (err: any) {
                setError(err.message);
                throw err;
              }
            },
          }}
        />
      </div>
    </div>
  );
}

/**
 * A pack as the server will hold it: run through the same validator, with the
 * identity stripped the same way the create and update handlers strip it. Two
 * packs that stringify the same here are the same design.
 */
function forComparison(pack: ThemePack) {
  const checked = validatePack({ ...pack, id: undefined });
  const settled = checked.ok ? checked.pack : pack;
  return stableStringify({ ...settled, id: undefined, name: undefined, description: undefined });
}
