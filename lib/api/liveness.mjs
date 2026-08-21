/**
 * Is the display alive? One rule, shared by GET /status, GET /health, and
 * the dashboard cards, so they never disagree.
 *
 * Two distinct failures, because they look different on the wall and need
 * different fixes:
 *
 * - **stale** - no display has posted state for STALE_MS. The tab is closed,
 *   offline, or never opened. Nothing is on the glass that we know of.
 * - **frozen** - a display is posting, but its tab is hidden, or it says it
 *   is mid-animation and has not drawn a frame for FROZEN_MS. Browsers
 *   suspend requestAnimationFrame entirely for a background tab while
 *   timers (and so our heartbeat) keep running, so the board halts
 *   mid-flip showing half-turned tiles and reports itself healthy. The
 *   display stamps each post with `display: { visibility, lastFrameAgeMs }`
 *   (hooks/useStatePublisher.ts); this is where that is read.
 *
 * `boardReady` stays "a display is connected" - a frozen board is connected,
 * just not animating - so existing callers keep their meaning; anyone who
 * cares whether the glass is actually moving reads `frozen`.
 */

/** A display that has not posted state for this long counts as disconnected. */
export const STALE_MS = 10_000;
/** Animating with no frame for this long is a stuck renderer, not a slow one. */
export const FROZEN_MS = 2_000;

export function displayHealth(state, now = Date.now()) {
  if (!state) return { boardReady: false, stale: true, frozen: false, updatedAt: null, display: null };
  const age = now - state.updatedAt;
  const stale = age > STALE_MS;
  const display = state.snapshot?.display ?? null;
  const hidden = display?.visibility === 'hidden';
  const stuck =
    state.snapshot?.animating === true &&
    typeof display?.lastFrameAgeMs === 'number' &&
    display.lastFrameAgeMs > FROZEN_MS;
  return {
    boardReady: !stale,
    stale,
    frozen: !stale && (hidden || stuck),
    updatedAt: state.updatedAt,
    display,
  };
}
