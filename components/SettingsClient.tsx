'use client';

/**
 * The control room, in three tabs: Queue (what plays), Display (how it
 * looks), General (identity, privacy, access, pause/export, deletion).
 * Owner-only - the server component gates before this renders.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { gridForConfig } from '@/lib/board/geometry.mjs';
import { useRouter } from 'next/navigation';
import { AppBar } from '@/components/AppBar';
import { QueueManager } from '@/components/QueueManager';
import { BOARD_TYPE_CLIENTS } from '@/components/board-types/registry';
import { DisplayConfig } from '@/components/DisplayConfig';
import { Tabs } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Chip, CopyButton, KeyReveal } from '@/components/ui/bits';
import { BoardSidebar } from '@/components/BoardSidebar';
import { TypeSettings } from '@/components/TypeSettings';
import { ThemeSettings, type ThemeDraft } from '@/components/ThemeSettings';
import { ThemePreview } from '@/components/flapper/ThemePreview';
import { draftFromConfig } from '@/lib/board/theme-editor.mjs';
import type { TypeMeta } from '@/components/board-types/type-meta';
import { maskSecret } from '@/lib/api/mask.mjs';
import { useConfirm } from '@/components/ui/ConfirmDialog';

type Board = {
  id: string;
  slug: string;
  name: string;
  type: string;
  typeName: string;
  status: 'active' | 'deactivated';
  private: boolean;
  apiKey: string;
  config: Record<string, unknown>;
  /** The type's createParams, serialized; `advanced` ones render under Type settings. */
  typeParams: TypeMeta['createParams'];
  createdAt: number;
};

/* Enough of the ring to judge a pack: letters, digits, and the punctuation
   that has its own card. */
const PREVIEW_TEXT = 'FLAPPER 2026!\nTHE QUICK BROWN\nFOX .,!()';

export function SettingsClient({ board: initial }: { board: Board }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [board, setBoard] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [exported, setExported] = useState<string | null>(null);
  // The theme draft lives here, above the tabs: Tabs remounts its panel on a
  // switch, and a half-edited theme (an uploaded logo) must survive one.
  const [themeDraft, setThemeDraft] = useState<ThemeDraft>(() => draftFromConfig(initial.config));
  // The grid, mirrored up out of DisplayConfig so the preview beside the
  // controls can show the board at the size it actually is. Columns and rows
  // used to sit 1,900px below the layout stage, which meant the two decisions
  // that together make the board's shape could never be seen at once.
  const [grid, setGrid] = useState<{ cols: number; rows: number }>(() => ({
    ...gridForConfig(initial.config),
  }));
  // The shape of the screen the board is being designed for, mirrored up for
  // the same reason: the layout stage was a hard-coded 16:9 rectangle, so a
  // portrait wall could not be designed against at all.
  const [screen, setScreen] = useState<{ w: number; h: number }>(
    () => (initial.config.screen as { w: number; h: number } | undefined) ?? { w: 16, h: 9 },
  );
  // What the preview board is showing. It starts as enough of the ring to judge
  // a pack and becomes whatever the designer types onto the board itself.
  const [previewText, setPreviewText] = useState(PREVIEW_TEXT);

  // Resolved after mount: the server does not know the public origin, and
  // rendering it there would make hydration disagree with the glass.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const boardUrl = `${origin}/b/${board.slug}`;
  const displayUrl = board.private ? `${boardUrl}?key=${board.apiKey}` : boardUrl;
  const apiBase = `${origin}/api/b/${board.slug}`;
  const curl = `curl -X POST ${apiBase}/message -H 'authorization: Bearer ${board.apiKey}' -H 'content-type: application/json' -d '{"text":"HELLO"}'`;
  // The MCP endpoint is one URL for the whole deployment; this board's key
  // as the bearer scopes a connection to this board alone.
  const mcpUrl = `${origin}/api/mcp`;
  const mcpAdd = `claude mcp add --transport http ${board.slug} ${mcpUrl} --header "authorization: Bearer ${board.apiKey}"`;
  // The key is printed only behind Reveal. Everything that quotes it (the
  // display URL, the curl, the connector command) renders masked and copies
  // real, and Reveal unmasks them all together.
  const [keyShown, setKeyShown] = useState(false);
  const shown = (text: string) => (keyShown ? text : maskSecret(text, board.apiKey));

  async function patch(body: object) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch(`/api/b/${board.slug}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setBoard((prev) => ({
        ...prev,
        name: payload.name,
        slug: payload.slug,
        private: payload.private,
        ...(payload.status !== undefined ? { status: payload.status } : {}),
      }));
      setName(payload.name);
      setSlug(payload.slug);
      // The settings URL contains the slug, so a rename moves this page too.
      if (payload.slug !== board.slug) router.replace(`/b/${payload.slug}/settings`);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  }

  /* The design surface's way out: what you typed onto the preview goes to the
     real board, through the same endpoint the compose box uses. */
  async function sendPreviewToBoard() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/b/${board.slug}/message`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rows: previewText.split('\n'), priority: 'now' }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setNotice('On the board.');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * The two settings that decide the board's shape, saved from the board's own
   * panel. Sent as one PATCH because they belong together, and mirrored into
   * `board` so the panel and the Display tab agree without a reload.
   */
  async function saveShape(patch: Record<string, unknown>) {
    setError('');
    try {
      const response = await fetch(`/api/b/${board.slug}/config`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setBoard((prev) => ({ ...prev, config: { ...prev.config, ...(payload.config ?? patch) } }));
    } catch (err: any) {
      setError(err.message);
    }
  }



  async function regenerate() {
    const ok = await confirm({
      title: 'Regenerate the API key?',
      body: 'The current key stops working immediately — every script and display URL using it must be updated.',
      confirmLabel: 'Regenerate',
      danger: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/b/${board.slug}/key`, { method: 'POST' });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setBoard((prev) => ({ ...prev, apiKey: payload.apiKey }));
      setNotice('New key minted. The old one no longer works.');
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  }

  async function toggleStatus() {
    const deactivating = board.status === 'active';
    if (deactivating) {
      const ok = await confirm({
        title: 'Pause this board?',
        body: 'Every display goes to a paused card. The queue is kept exactly as it is, and you can export it below.',
        confirmLabel: 'Pause board',
      });
      if (!ok) return;
    }
    await patch({ status: deactivating ? 'deactivated' : 'active' });
  }

  async function exportItems() {
    setError('');
    try {
      const response = await fetch(`/api/b/${board.slug}/export`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      setExported(JSON.stringify(payload, null, 2));
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${board.name || board.slug}?`,
      body: 'Its URL, key, and queue are gone for good.',
      confirmLabel: 'Delete board',
      danger: true,
    });
    if (!ok) return;
    const response = await fetch(`/api/b/${board.slug}`, { method: 'DELETE' });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      setError(payload.error || `Delete failed: HTTP ${response.status}`);
      return;
    }
    router.push('/dashboard');
  }

  const identityDirty = name !== board.name || slug !== board.slug;

  // A type may bring its own queue tab (the schedule editor); the generic
  // rolling-queue manager is the default.
  const TypeQueueEditor = useMemo(() => {
    const thunk = BOARD_TYPE_CLIENTS.find((c) => c.id === board.type)?.queueEditor;
    return thunk ? lazy(thunk) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board.type]);
  const queueTab = TypeQueueEditor ? (
    <Suspense fallback={null}>
      <TypeQueueEditor slug={board.slug} />
    </Suspense>
  ) : (
    <QueueManager
      slug={board.slug}
      // A board that holds one message is a sign; the panel drops everything
      // that only makes sense with a queue behind it.
      cap={Number(board.config?.queueCap) || Infinity}
    />
  );

  const generalTab = (
    <>
      <section className="settings-block">
        <h2>Identity</h2>
        <Field label="Name" htmlFor="board-name">
          <TextInput id="board-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field
          label="Slug — the board's URL"
          htmlFor="board-slug"
          hint={`Renaming moves the board to /b/${slug || '…'} — old links and the API base stop working, and open displays must be reloaded.`}
        >
          <TextInput
            id="board-slug"
            value={slug}
            spellCheck={false}
            onChange={(e) => setSlug(e.target.value.toLowerCase())}
          />
        </Field>
        <Button variant="primary" disabled={busy || !identityDirty} onClick={() => patch({ name, slug })}>
          Save
        </Button>
      </section>

      <section className="settings-block">
        <h2>Privacy</h2>
        <p className="ui-hint">
          {board.private
            ? 'Private: viewing and API reads need the key (or your login).'
            : 'Public: anyone with the URL can watch. Writing always needs the key.'}
        </p>
        <Button disabled={busy} onClick={() => patch({ private: !board.private })}>
          {board.private ? 'Make public' : 'Make private'}
        </Button>
        {board.private && (
          <Field
            label="Display URL for wall screens"
            hint="Carries the key so a kiosk can open it without logging in — anyone who sees this URL can drive the board."
          >
            <code className="curl">{shown(displayUrl)}</code>
            <CopyButton value={displayUrl} label="Copy display URL" />
          </Field>
        )}
      </section>

      <section className="settings-block">
        <h2>Access</h2>
        <Field label="API key">
          <KeyReveal value={board.apiKey} shown={keyShown} onToggle={setKeyShown} />
          <Button size="sm" onClick={regenerate} disabled={busy}>
            Regenerate
          </Button>
        </Field>
        <Field label="Send a message">
          <code className="curl">{shown(curl)}</code>
          <CopyButton value={curl} label="Copy curl" />
        </Field>
        <Field
          label="Connect Claude or ChatGPT to this board"
          hint="An MCP connection that can only drive this board. Claude Code takes the command as-is; in claude.ai or ChatGPT add the URL as a connector with the key as a bearer/authorization header."
        >
          <code className="curl">{shown(mcpAdd)}</code>
          <CopyButton value={mcpAdd} label="Copy Claude Code command" />
        </Field>
        <Field label="For agents">
          <span className="ui-hint">
            To connect once for <em>all</em> your boards, add <code>{mcpUrl}</code> as a connector
            and sign in when asked — no key needed (see the dashboard). For plain HTTP, point an
            agent at <a href={`${apiBase}/AGENTS.md`}>{apiBase}/AGENTS.md</a> — the full contract
            for driving this board, with its URLs baked in.
          </span>
        </Field>
      </section>

      <TypeSettings
        slug={board.slug}
        params={board.typeParams}
        config={board.config}
        onSaved={(config) => setBoard((prev) => ({ ...prev, config: { ...prev.config, ...config } }))}
      />

      <section className="settings-block">
        <h2>Pause &amp; export</h2>
        <p className="ui-hint">
          Pausing sends every display to a standing card and keeps the queue untouched. Export
          returns the queue as JSON you can keep or paste into another board.
        </p>
        <div className="ui-modal-actions" style={{ justifyContent: 'flex-start' }}>
          <Button onClick={toggleStatus} disabled={busy}>
            {board.status === 'active' ? 'Pause board' : 'Reactivate board'}
          </Button>
          <Button onClick={exportItems}>Export items</Button>
        </div>
      </section>

      <section className="settings-block danger">
        <h2>Danger</h2>
        <Button variant="danger" onClick={remove} disabled={busy}>
          Delete this board
        </Button>
      </section>
    </>
  );

  return (
    <div className="app-shell">
      {dialog}
      <Modal open={exported !== null} title="Queue export" wide onClose={() => setExported(null)}>
        <code className="curl" style={{ maxHeight: '50vh', overflowY: 'auto' }}>
          {exported}
        </code>
        <div className="ui-modal-actions">
          <CopyButton value={exported ?? ''} label="Copy JSON" />
          <Button onClick={() => setExported(null)}>Close</Button>
        </div>
      </Modal>
      <AppBar
        right={
          <>
            {/* Identity lives in the sidebar; paused is live status, and a
                paused board plays nothing, so it stays in view up here too. */}
            {board.status !== 'active' && <Chip tone="danger">paused</Chip>}
            <LinkButton href={boardUrl} target="_blank" rel="noopener">
              Open display
            </LinkButton>
            <LinkButton href="/dashboard">Dashboard</LinkButton>
          </>
        }
      />
      <main className="dash settings">
        {error !== '' && <p className="error">{error}</p>}
        {notice !== '' && <p className="muted">{notice}</p>}
        <Tabs
          orientation="vertical"
          before={
            <BoardSidebar
              name={board.name}
              slug={board.slug}
              typeName={board.typeName}
              status={board.status}
              isPrivate={board.private}
              createdAt={board.createdAt}
              boardUrl={origin === '' ? '' : boardUrl}
              config={board.config}
              onConfig={saveShape}
            />
          }
          after={
            <nav className="board-side-links" aria-label="Always for this board">
              <h2>Always</h2>
              <a href={`${apiBase}/AGENTS.md`}>This board’s agent guide</a>
              <a href="/docs/board-api">REST API reference</a>
              <a href="/docs">Documentation</a>
            </nav>
          }
          tabs={[
            { id: 'queue', label: 'Queue', content: queueTab },
            {
              id: 'display',
              label: 'Display',
              content: (
                <div className="design-surface">
                  <div className="design-preview">
                    <ThemePreview
                      pack={themeDraft.pack}
                      text={previewText}
                      cols={grid.cols}
                      rows={grid.rows}
                      tilePx={56}
                      onText={setPreviewText}
                    />
                    <div className="design-preview-bar">
                      <p className="design-preview-caption">
                        {grid.cols} × {grid.rows} cards · click the board and type
                      </p>
                      <div className="design-preview-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setPreviewText(PREVIEW_TEXT)}
                          disabled={previewText === PREVIEW_TEXT}
                        >
                          Reset words
                        </Button>
                        <Button
                          size="sm"
                          disabled={busy || previewText.trim() === ''}
                          onClick={() => sendPreviewToBoard()}
                        >
                          Put this on the board
                        </Button>
                      </div>
                    </div>
                  </div>
                  <div className="design-controls">
                    <ThemeSettings
                      slug={board.slug}
                      draft={themeDraft}
                      onDraft={setThemeDraft}
                      config={board.config}
                      onSaved={(config) => setBoard((prev) => ({ ...prev, config }))}
                    />
                    <DisplayConfig
                      slug={board.slug}
                      initial={board.config}
                      onChange={(config) => {
                        setGrid({
                          ...gridForConfig(config),
                        });
                        const next = config.screen as { w: number; h: number } | undefined;
                        if (next) setScreen(next);
                        /*
                         * And into the board itself, because the panel beside
                         * this reads the board's config for the shape. Without
                         * it the two disagreed: the Display tab would say 20x1
                         * on a 100:3 screen while the panel still said 20x11
                         * on the default.
                         */
                        setBoard((prev) => ({ ...prev, config: { ...prev.config, ...config } }));
                      }}
                    />
                  </div>
                </div>
              ),
            },
            { id: 'general', label: 'General', content: generalTab },
          ]}
        />
      </main>
    </div>
  );
}
