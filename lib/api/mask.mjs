/**
 * Hide a secret inside text meant for eyes, not clipboards. Settings shows
 * the board key behind Reveal, and then quotes it in a curl and a
 * `claude mcp add` line - printed in full, the masking was theatre (and the
 * demo script has people screen-share that page). Render `maskSecret(text,
 * key)`; copy the real text. Empty or missing secrets leave the text alone.
 */

export const MASK = '•'.repeat(12);

export function maskSecret(text, secret, mask = MASK) {
  if (typeof text !== 'string' || typeof secret !== 'string' || secret === '') return text;
  return text.split(secret).join(mask);
}
