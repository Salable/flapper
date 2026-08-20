/**
 * Slug rules: what may appear in /b/{slug}.
 *
 * Lowercase a-z0-9 and hyphens, 3-40 chars, no edge hyphens. Reserved words
 * are paths the app itself owns - a board named `dashboard` would shadow the
 * dashboard for anyone who trusted a bare link.
 */

import { reject } from '../api/errors.mjs';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;

export const RESERVED_SLUGS = new Set([
  'api',
  'b',
  'board',
  'boards',
  'dashboard',
  'login',
  'logout',
  'signup',
  'settings',
  'assets',
  'agents',
  'admin',
  'docs',
  'new',
]);

/** @returns {string} the slug, or throws a 422 naming what is wrong */
export function validateSlug(slug) {
  if (typeof slug !== 'string') reject('slug must be a string', 422);
  if (slug.length < 3 || slug.length > 40) {
    reject('slug must be 3-40 characters', 422);
  }
  if (!SLUG_RE.test(slug)) {
    reject('slug must be lowercase letters, digits and hyphens, not starting or ending with a hyphen', 422);
  }
  if (slug.includes('--')) reject('slug must not contain consecutive hyphens', 422);
  if (RESERVED_SLUGS.has(slug)) reject(`"${slug}" is reserved`, 422);
  return slug;
}

const ADJECTIVES = [
  'amber', 'brisk', 'coral', 'dusky', 'eager', 'faded', 'gilded', 'hazel',
  'ivory', 'jaunty', 'keen', 'lunar', 'mellow', 'nimble', 'olive', 'plaid',
  'quiet', 'rustic', 'slate', 'tidal', 'umber', 'vivid', 'woven', 'zesty',
];
const NOUNS = [
  'falcon', 'gate', 'harbor', 'junction', 'kiosk', 'ledger', 'meridian',
  'nocturne', 'orbit', 'platform', 'quay', 'relay', 'signal', 'terminal',
  'transit', 'vector', 'waypoint', 'zephyr', 'beacon', 'circuit', 'depot',
];

/** A readable starting slug: amber-falcon-42. */
export function generateSlug(random = Math.random) {
  const pick = (list) => list[Math.floor(random() * list.length)];
  const digits = String(Math.floor(random() * 90) + 10);
  return `${pick(ADJECTIVES)}-${pick(NOUNS)}-${digits}`;
}
