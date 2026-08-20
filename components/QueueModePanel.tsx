'use client';

/**
 * The queue's mode and sharing controls (RFC 0002): live vs time-based,
 * attaching sibling boards to a timed queue, and what a dormant board shows.
 * Timed and sharing are Plus; the server enforces, this surface explains.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';

type Props = {
  slug: string;
  mode: 'live' | 'timed';
  dormancyDisplay: 'card' | 'blank';
  tier: 'standard' | 'plus';
  /** This queue's attached boards (slug + primary marker), earliest first. */
  attached: { slug: string; name: string }[];
  /** The owner's other boards that could be attached. */
  attachable: { slug: string; name: string }[];
};

export function QueueModePanel({ slug, mode, dormancyDisplay, tier, attached, attachable }: Props) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState(attachable[0]?.slug ?? '');
  const shared = attached.length > 1;

  async function post(path: string, body: object) {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/b/${slug}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || `HTTP ${response.status}`);
      router.refresh();
    } catch (err: any) {
      setError(err.message);
    }
    setBusy(false);
  }

  return (
    <section className="settings-block">
      <h2>Playback mode</h2>
      {error !== '' && <p className="error">{error}</p>}
      <div className="mode-toggle">
        <button
          className={mode === 'live' ? 'is-on' : ''}
          disabled={busy || mode === 'live'}
          onClick={() => post('/queue/mode', { mode: 'live' })}
        >
          Live queue
        </button>
        <button
          className={mode === 'timed' ? 'is-on' : ''}
          disabled={busy || mode === 'timed'}
          onClick={() => {
            if (
              confirm(
                'Switch to time-based playback? The queue compiles into a repeating cycle driven by the clock; loop messages rotate, one-off messages play once at the next slot.',
              )
            ) {
              post('/queue/mode', { mode: 'timed' });
            }
          }}
        >
          Time-based{tier !== 'plus' ? ' · Plus' : ''}
        </button>
      </div>
      <span className="muted">
        {mode === 'live'
          ? 'Live: the display plays the list top to bottom and reports back. One board per queue.'
          : 'Time-based: every attached board renders the same repeating cycle from the clock — boards stay in step with no coordination.'}
      </span>

      {mode === 'timed' && (
        <>
          <div className="field">
            <label>Boards on this queue</label>
            {attached.map((board, index) => (
              <div className="attach-row" key={board.slug}>
                <span>
                  {board.name || board.slug} <span className="muted">/b/{board.slug}</span>
                  {index === 0 && <span className="muted"> · primary</span>}
                </span>
                {board.slug !== slug && attached.length > 1 && (
                  <button
                    disabled={busy}
                    onClick={() => {
                      // Detach acts on the departing board's own endpoint.
                      setBusy(true);
                      fetch(`/api/b/${board.slug}/queue/detach`, { method: 'POST' })
                        .then(() => router.refresh())
                        .finally(() => setBusy(false));
                    }}
                  >
                    Detach
                  </button>
                )}
              </div>
            ))}
          </div>
          {attachable.length > 0 && (
            <div className="attach-row">
              <select value={pick} onChange={(event) => setPick(event.target.value)}>
                {attachable.map((board) => (
                  <option key={board.slug} value={board.slug}>
                    {board.name || board.slug}
                  </option>
                ))}
              </select>
              <button
                disabled={busy || pick === ''}
                onClick={() => post('/queue/attach', { board: pick })}
              >
                Attach board{tier !== 'plus' ? ' · Plus' : ''}
              </button>
            </div>
          )}
          <span className="muted">
            Attaching a board makes it show this queue. Its own queue must be empty first — nothing
            is ever deleted for you.
          </span>
          <div className="field">
            <label htmlFor="dormancy">When paused by the offering, displays show</label>
            <select
              id="dormancy"
              value={dormancyDisplay}
              onChange={(event) => post('/queue/mode', { dormancyDisplay: event.target.value })}
            >
              <option value="card">A “paused” notice</option>
              <option value="blank">A blank board</option>
            </select>
          </div>
        </>
      )}
    </section>
  );
}
