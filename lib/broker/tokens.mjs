/**
 * Board identity. A boardId is the display capability - unguessable and safe in
 * a URL. The write token is the control capability - returned once at creation,
 * stored only as a hash, and required on every call that changes the board.
 */

// Crockford-ish base32: no vowels that make words, no lookalike characters.
const ALPHABET = '0123456789abcdefghjkmnpqrstvwxyz';

/** 16 chars of base32 = 80 random bits. */
export function newBoardId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => ALPHABET[byte % 32]).join('');
}

/** 32 random bytes, hex. */
export function newWriteToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function sha256Hex(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Constant-time-ish comparison; both sides are fixed-length hex. */
export async function tokenMatches(token, tokenHash) {
  if (typeof token !== 'string' || token === '') return false;
  const hash = await sha256Hex(token);
  if (hash.length !== tokenHash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i += 1) diff |= hash.charCodeAt(i) ^ tokenHash.charCodeAt(i);
  return diff === 0;
}

/**
 * Compare a presented secret against a stored one without leaking length or
 * prefix through timing: hash both, compare the fixed-length digests.
 */
export async function secretsMatch(presented, stored) {
  if (typeof presented !== 'string' || presented === '') return false;
  return tokenMatches(presented, await sha256Hex(stored));
}
