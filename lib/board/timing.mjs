/**
 * The board's motion model, shared so that the renderer's animation and the
 * API's duration estimates cannot drift apart.
 *
 * Steps run fast and then decelerate into the landing, which is what gives the
 * board its mechanical settle. `sweepMs` is the total time between the first
 * tile starting to move and the last one starting - expressed as a total rather
 * than a per-tile offset so it means the same thing on a 1x10 board and on a
 * 60x30 wall.
 */

export const MOTION_DEFAULTS = Object.freeze({
  fastStepMs: 55, // duration of a step while scrolling
  landStepMs: 190, // duration of the final step
  easeSteps: 5, // how many trailing steps decelerate
  sweepMs: 300, // total stagger across the whole board
  staggerMode: 'diagonal', // 'none' | 'column' | 'row' | 'diagonal' | 'random'
});

/** Duration of the step with `remaining` flips left, inclusive. */
export function stepDuration(remaining, motion = MOTION_DEFAULTS) {
  const { fastStepMs, landStepMs, easeSteps } = { ...MOTION_DEFAULTS, ...motion };
  if (easeSteps <= 1) return remaining <= 1 ? landStepMs : fastStepMs;
  const clamped = Math.min(remaining, easeSteps);
  const progress = (easeSteps - clamped) / (easeSteps - 1);
  return fastStepMs + (landStepMs - fastStepMs) * progress * progress;
}

/** How long a tile takes to travel `steps` positions. */
export function travelMs(steps, motion = MOTION_DEFAULTS) {
  let total = 0;
  for (let remaining = steps; remaining > 0; remaining -= 1) {
    total += stepDuration(remaining, motion);
  }
  return total;
}

/**
 * Rough time for one page to land, for API estimates. Uses average travel
 * (half the cycle) because actual travel depends on what is already showing.
 */
export function estimatePageMs(states, motion = MOTION_DEFAULTS) {
  const merged = { ...MOTION_DEFAULTS, ...motion };
  return travelMs(Math.round(states / 2), merged) + merged.sweepMs;
}

/**
 * Normalised stagger position of a tile, 0..1. Multiplied by `sweepMs` to get
 * that tile's delay, so the pattern is independent of grid size.
 */
export function sweepFraction(row, col, rows, cols, mode, jitter) {
  switch (mode) {
    case 'none':
      return 0;
    case 'row':
      return rows > 1 ? row / (rows - 1) : 0;
    case 'column':
      return cols > 1 ? col / (cols - 1) : 0;
    case 'random':
      return jitter;
    case 'diagonal':
    default: {
      const span = rows - 1 + (cols - 1);
      return span > 0 ? (row + col) / span : 0;
    }
  }
}
