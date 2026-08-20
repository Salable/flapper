'use client';

/**
 * Pushes the controller's state snapshots up to the broker, throttled: at most
 * one POST per THROTTLE_MS with the latest snapshot, plus a slow heartbeat so
 * an idle board keeps reading as connected (status marks a board stale after
 * ten silent seconds). Authenticates with the display token - state is a
 * write, and the audience of a public board must not hold the pen.
 */

import { useEffect } from 'react';

const THROTTLE_MS = 500;
const HEARTBEAT_MS = 5000;

export function useStatePublisher(
  apiBase: string,
  displayToken: string,
  ready: boolean,
  onStateRef: React.MutableRefObject<((state: unknown) => void) | null>,
) {
  useEffect(() => {
    if (!ready) return;

    let latest: unknown = null;
    let inFlightAt = 0;
    let trailing: ReturnType<typeof setTimeout> | null = null;

    const post = () => {
      if (latest === null) return;
      inFlightAt = performance.now();
      fetch(`${apiBase}/state`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${displayToken}`,
        },
        body: JSON.stringify({ state: latest }),
      }).catch(() => {
        /* transient network loss; the heartbeat retries */
      });
    };

    onStateRef.current = (state) => {
      latest = state;
      const wait = THROTTLE_MS - (performance.now() - inFlightAt);
      if (wait <= 0) {
        post();
      } else if (!trailing) {
        trailing = setTimeout(() => {
          trailing = null;
          post();
        }, wait);
      }
    };

    const beat = setInterval(post, HEARTBEAT_MS);
    return () => {
      onStateRef.current = null;
      clearInterval(beat);
      if (trailing) clearTimeout(trailing);
    };
  }, [apiBase, displayToken, ready, onStateRef]);
}
