'use client';

/**
 * The control room, in three tabs: Settings (identity, design, screen, card
 * size, fidget, privacy, access, pause/export, deletion - everything about
 * the board that is not what it's currently showing), Board (the rotation:
 * one tab per slide on the left, the selected one's own text/hold/loop/
 * position on the right), Interruptions (fire one live, and see what's
 * currently active). Used to be two tabs plus a persistent sidebar for
 * design/screen/shape; the sidebar's gone; those fields moved into
 * Settings, on the reasoning that a fact belongs on the one tab about it,
 * not shadowing every other tab forever.
 */

import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react';
import { gridForConfig, screenOf } from '@/lib/board/geometry.mjs';
import { resolveBoardTheme } from '@/lib/board/board-theme.mjs';
import { useRouter } from 'next/navigation';
import { AppBar } from '@/components/AppBar';
import { QueueManager } from '@/components/QueueManager';
import { BOARD_TYPE_CLIENTS } from '@/components/board-types/registry';
import { Tabs } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Chip, CopyButton, KeyReveal } from '@/components/ui/bits';
import { BoardSidebar } from '@/components/BoardSidebar';
import { TypeSettings } from '@/components/TypeSettings';
import type { TypeMeta } from '@/components/board-types/type-meta';
import { maskSecret } from '@/lib/api/mask.mjs';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { UserMenu } from '@/components/UserMenu';

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

export function SettingsClient({ board: initial, userName }: { board: Board; userName: string }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [board, setBoard] = useState(initial);
  const [name, setName] = useState(initial.name);
  const [slug, setSlug] = useState(initial.slug);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [exported, setExported] = useState<string | null>(null);
  /*
   * A saved interrupter blocking the rotation is easy to leave running and
   * forget - it only ever said so on the Interruptions tab itself, whose
   * own poll stops the moment you switch to Settings or Board (Tabs only
   * mounts the active one). Polled here instead, independent of which tab
   * is open, so leaving one live is visible wherever you are.
   */
  const [liveInterrupter, setLiveInterrupter] = useState<{ label: string; untilDismissed: boolean } | null>(null);
  /*
   * One shared "Saved", one shared corner - not a badge that only lived
   * beside the sidebar's own fields and read as "saving works here, not
   * when you change what the board actually says". Fixed to the viewport
   * so it holds still regardless of where on the page the change came
   * from, or how far down the page you've scrolled.
   */
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function flashSaved() {
    if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    setSaved(true);
    savedTimer.current = setTimeout(() => setSaved(false), 4000);
  }
  useEffect(
    () => () => {
      if (savedTimer.current !== null) clearTimeout(savedTimer.current);
    },
    [],
  );
  /*
   * The grid, read straight from `board.config` on every render rather than
   * copied into its own state - the sidebar is what sets the screen and the
   * card size now, so a mirrored copy here would go stale the moment it did,
   * and the compose canvas beside the queue would disagree with the board's
   * real size until the page reloaded. Derived fresh, it cannot.
   */
  const grid = gridForConfig(board.config);
  // The screen's own ratio, for letterboxing the preview to it - cols/rows
  // is close but not exact (see ThemePreview's own doc on `screenAspect`).
  const screen = screenOf(board.config);

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
      // The manage URL contains the slug, so a rename moves this page too.
      if (payload.slug !== board.slug) router.replace(`/b/${payload.slug}/manage`);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  }

  /**
   * The two settings that decide the board's shape, saved from the board's own
   * panel. Sent as one PATCH because they belong together, and mirrored into
   * `board` so the panel and the Display tab agree without a reload.
   *
   * Returns whether it worked, not just fire-and-forget - the sidebar applies
   * Start from/Screen/Card size/Fidget the moment you pick them with no Save
   * button anywhere, and needs to know when to show its own "Saved" right
   * there. That confirmation used to live up here as a page-top notice, which
   * nobody watching the sidebar they had just touched ever saw - moved to
   * where the eyes already are instead of duplicating it.
   */
  async function saveShape(patch: Record<string, unknown>): Promise<boolean> {
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
      return true;
    } catch (err: any) {
      setError(err.message);
      return false;
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
  const boardTab = TypeQueueEditor ? (
    <Suspense fallback={null}>
      <TypeQueueEditor
        slug={board.slug}
        // Same board-look values QueueManager gets: a type's own editor
        // should be able to show its board too, not just describe it.
        pack={resolveBoardTheme(board.config).pack}
        cols={grid.cols}
        rows={grid.rows}
        screenAspect={screen.w / screen.h}
        ambientMs={Number(board.config?.ambientMs) || 0}
      />
    </Suspense>
  ) : (
    <QueueManager
      slug={board.slug}
      section="board"
      // The board's own design, so composing happens on it - what look this
      // board wears is picked in Settings now, not a draft owned here.
      pack={resolveBoardTheme(board.config).pack}
      cols={grid.cols}
      rows={grid.rows}
      screenAspect={screen.w / screen.h}
      ambientMs={Number(board.config?.ambientMs) || 0}
      onSaved={flashSaved}
    />
  );

  // A type-specific queue editor (the schedule editor) has no notion of
  // "interrupt this, live" - priority: now is a rolling queue's own
  // mechanism, so the tab simply is not offered for one.
  const interruptionsTab = TypeQueueEditor ? null : (
    <QueueManager
      slug={board.slug}
      section="interruptions"
      pack={resolveBoardTheme(board.config).pack}
      cols={grid.cols}
      rows={grid.rows}
      screenAspect={screen.w / screen.h}
      ambientMs={Number(board.config?.ambientMs) || 0}
      onSaved={flashSaved}
    />
  );

  // A type-specific queue has no interrupters to poll for at all.
  const supportsInterrupts = TypeQueueEditor === null;

  useEffect(() => {
    if (!supportsInterrupts) return;
    let cancelled = false;
    async function poll() {
      try {
        const response = await fetch(`/api/b/${board.slug}/queue`);
        if (!response.ok || cancelled) return;
        const snapshot = await response.json();
        const current = snapshot.items?.find((item: any) => item.id === snapshot.currentItemId);
        const live =
          snapshot.currentState === 'playing' && current?.payload?.options?.interrupt === true
            ? { label: String(current.payload.options.label ?? 'Interrupter'), untilDismissed: current.expiresAtMs == null }
            : null;
        if (!cancelled) setLiveInterrupter(live);
      } catch {
        /* transient; the poll retries */
      }
    }
    poll();
    const timer = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [board.slug, supportsInterrupts]);

  async function dismissLiveInterrupter() {
    if (!liveInterrupter) return;
    try {
      await fetch(`/api/b/${board.slug}/interrupters/${encodeURIComponent(liveInterrupter.label)}/dismiss`, {
        method: 'POST',
      });
    } catch {
      /* transient; the next poll corrects it either way */
    }
    setLiveInterrupter(null);
  }

  const settingsTab = (
    <>
      <BoardSidebar config={board.config} onConfig={saveShape} onSaved={flashSaved} />
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

      <nav className="board-side-links" aria-label="Always for this board">
        <h2>Always</h2>
        <a href={`${apiBase}/AGENTS.md`}>This board’s agent guide</a>
        <a href="/docs/board-api">REST API reference</a>
        <a href="/docs">Documentation</a>
      </nav>
    </>
  );

  return (
    <div className="app-shell">
      {dialog}
      <div className={`saved-toast${saved ? ' is-shown' : ''}`} role="status" aria-live="polite">
        Saved
      </div>
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
            <LinkButton href="/dashboard">Dashboard</LinkButton>
            <UserMenu userName={userName} current="dashboard" />
          </>
        }
      />
      <main className="dash settings">
        <h1 className="dash-title">
          {board.name || board.slug}
          {board.status !== 'active' && <Chip tone="danger">paused</Chip>}
          <LinkButton size="sm" href={boardUrl} target="_blank" rel="noopener">
            Open display
          </LinkButton>
        </h1>
        {liveInterrupter && (
          <div className="live-interrupter-banner" role="status" aria-live="polite">
            <span>
              ⚡ &ldquo;{liveInterrupter.label}&rdquo; is interrupting the rotation
              {liveInterrupter.untilDismissed && ' - until dismissed'}
            </span>
            {liveInterrupter.untilDismissed && (
              <Button size="sm" variant="ghost" onClick={dismissLiveInterrupter}>
                Dismiss
              </Button>
            )}
          </div>
        )}
        {error !== '' && <p className="error">{error}</p>}
        {notice !== '' && <p className="muted">{notice}</p>}
        <Tabs
          initial="board"
          tabs={[
            { id: 'settings', label: 'Settings', content: settingsTab },
            { id: 'board', label: 'Board', content: boardTab },
            ...(interruptionsTab ? [{ id: 'interruptions', label: 'Interruptions', content: interruptionsTab }] : []),
          ]}
        />
      </main>
    </div>
  );
}
