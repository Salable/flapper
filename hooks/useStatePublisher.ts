'use client';

/**
 * Pushes the controller's state snapshots up to the broker, throttled: at most
 * one POST per THROTTLE_MS with the latest snapshot, plus a slow heartbeat so
 * an idle board keeps reading as connected (status marks a board stale after
 * ten silent seconds). Authenticates with the display token - state is a
 * write, and the audience of a public board must not hold the pen.
 *
 * Every post also carries `display: { visibility, lastFrameAgeMs }`. A
 * background tab keeps its timers (so this heartbeat keeps the board
 * "connected") but loses requestAnimationFrame entirely, so the flip halts
 * mid-turn while /status reads healthy. A one-line rAF pulse here records
 * when a frame last ran; the server turns hidden-or-no-frames into
 * `frozen` (lib/api/liveness.mjs). A visibility change posts at once so the
 * flag flips within a round trip, not a heartbeat.
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

    // Frame pulse: stamps the last time the renderer was allowed to draw.
    let lastFrameAt = performance.now();
    let raf = 0;
    const pulse = () => {
      lastFrameAt = performance.now();
      raf = requestAnimationFrame(pulse);
    };
    raf = requestAnimationFrame(pulse);

    const post = () => {
      if (latest === null) return;
      inFlightAt = performance.now();
      const display = {
        visibility: document.visibilityState,
        lastFrameAgeMs: Math.round(performance.now() - lastFrameAt),
      };
      fetch(`${apiBase}/state`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${displayToken}`,
        },
        body: JSON.stringify({ state: { ...(latest as object), display } }),
      }).catch(() => {
        /* transient network loss; the heartbeat retries */
      });
    };
    const onVisibility = () => post();
    document.addEventListener('visibilitychange', onVisibility);

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
      cancelAnimationFrame(raf);
      document.removeEventListener('visibilitychange', onVisibility);
      if (trailing) clearTimeout(trailing);
    };
  }, [apiBase, displayToken, ready, onStateRef]);
}
