'use client';

/**
 * The control room, in three tabs: Queue (what plays), Display (how it
 * looks), General (identity, privacy, access, pause/export, deletion).
 * Owner-only - the server component gates before this renders.
 */

import { Suspense, lazy, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppBar } from '@/components/AppBar';
import { QueueManager } from '@/components/QueueManager';
import { BOARD_TYPE_CLIENTS } from '@/components/board-types/registry';
import { DisplayConfig } from '@/components/DisplayConfig';
import { LayoutPicker, type Layout } from '@/components/LayoutPicker';
import { Tabs } from '@/components/ui/Tabs';
import { Modal } from '@/components/ui/Modal';
import { Button, LinkButton } from '@/components/ui/Button';
import { Field, TextInput } from '@/components/ui/Field';
import { Chip, CopyButton, KeyReveal } from '@/components/ui/bits';
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
  createdAt: number;
};

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

  // Resolved after mount: the server does not know the public origin, and
  // rendering it there would make hydration disagree with the glass.
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const boardUrl = `${origin}/b/${board.slug}`;
  const displayUrl = board.private ? `${boardUrl}?key=${board.apiKey}` : boardUrl;
  const apiBase = `${origin}/api/b/${board.slug}`;
  const curl = `curl -X POST ${apiBase}/message -H 'authorization: Bearer ${board.apiKey}' -H 'content-type: application/json' -d '{"text":"HELLO"}'`;

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

  async function saveLayout(layout: Layout) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/b/${board.slug}/config`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ layout }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || `HTTP ${response.status}`);
      }
      setNotice('Layout applied to every open display.');
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
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
    <QueueManager slug={board.slug} />
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
            <code className="curl">{displayUrl}</code>
            <CopyButton value={displayUrl} label="Copy display URL" />
          </Field>
        )}
      </section>

      <section className="settings-block">
        <h2>Access</h2>
        <Field label="API key">
          <KeyReveal value={board.apiKey} />
          <Button size="sm" onClick={regenerate} disabled={busy}>
            Regenerate
          </Button>
        </Field>
        <Field label="Send a message">
          <code className="curl">{curl}</code>
          <CopyButton value={curl} label="Copy curl" />
        </Field>
        <Field label="For agents">
          <span className="ui-hint">
            Point an agent at <a href={`${apiBase}/AGENTS.md`}>{apiBase}/AGENTS.md</a> — the full
            contract for driving this board, with its URLs baked in.
          </span>
        </Field>
      </section>

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
            <span className="muted">/b/{board.slug}</span>
            <Chip>{board.typeName}</Chip>
            {board.status !== 'active' && <Chip tone="danger">paused</Chip>}
            <LinkButton href={boardUrl}>Open display</LinkButton>
            <LinkButton href="/dashboard">Dashboard</LinkButton>
          </>
        }
      />
      <main className="dash settings">
        {error !== '' && <p className="error">{error}</p>}
        {notice !== '' && <p className="muted">{notice}</p>}
        <Tabs
          tabs={[
            { id: 'queue', label: 'Queue', content: queueTab },
            {
              id: 'display',
              label: 'Display',
              content: (
                <>
                  <section className="settings-block">
                    <h2>Layout</h2>
                    <LayoutPicker
                      initial={(board.config.layout as Partial<Layout>) ?? null}
                      onSave={saveLayout}
                      busy={busy}
                    />
                  </section>
                  <DisplayConfig slug={board.slug} initial={board.config} />
                </>
              ),
            },
            { id: 'general', label: 'General', content: generalTab },
          ]}
        />
      </main>
    </div>
  );
}
