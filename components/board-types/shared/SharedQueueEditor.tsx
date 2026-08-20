'use client';

/**
 * The shared board's queue tab: the schedule editor, headed by the screens
 * panel - because on a shared board the screens are the point. Adding a
 * screen is opening the URL; the panel says so and shows whether anything
 * is watching right now.
 */

import { useEffect, useState } from 'react';
import ScheduleEditor from '@/components/board-types/scheduled/ScheduleEditor';
import { CopyButton } from '@/components/ui/bits';

const POLL_MS = 5000;

export default function SharedQueueEditor({ slug }: { slug: string }) {
  const [origin, setOrigin] = useState('');
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => setOrigin(window.location.origin), []);

  useEffect(() => {
    let stop = false;
    const poll = async () => {
      try {
        const response = await fetch(`/api/b/${slug}/health`);
        if (!response.ok) return;
        const body = await response.json();
        if (!stop) setReady(Boolean(body.boardReady));
      } catch {
        /* transient */
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [slug]);

  const url = `${origin}/b/${slug}`;

  return (
    <>
      <section className="settings-block">
        <h2>Screens</h2>
        <p className="ui-hint">
          Every screen showing this URL follows the same clock — open it on as many displays as
          you like and they stay in step. Nothing to pair or configure; press <b>F</b> on each
          screen for fullscreen. (If the board is private, use the keyed display URL from the
          General tab instead.)
        </p>
        <code className="curl">{url}</code>
        <div className="ui-modal-actions" style={{ justifyContent: 'flex-start' }}>
          <CopyButton value={url} label="Copy board URL" />
          <span className="muted">
            {ready === null ? '' : ready ? 'At least one screen is watching.' : 'No screen is watching right now.'}
          </span>
        </div>
      </section>
      <ScheduleEditor slug={slug} />
    </>
  );
}
