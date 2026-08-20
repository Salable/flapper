/**
 * The display credential: proves "I am a legitimate display of this board"
 * without handing the page the full API key.
 *
 * HMAC(secret, boardId + apiKey): minted server-side into the board page,
 * accepted on the two write-backs a display makes (advance, state). Rotating
 * the board's key revokes every outstanding display token, which is the same
 * recovery story the key itself has. Deliberately no expiry - wall displays
 * run for months between reloads.
 */

import { sha256Hex, tokenMatches } from '../broker/tokens.mjs';

function secret() {
  return process.env.BETTER_AUTH_SECRET ?? 'flapper-dev-secret-do-not-deploy';
}

export async function mintDisplayToken(board) {
  return sha256Hex(`flapper-display:${secret()}:${board.id}:${board.apiKey}`);
}

export async function displayTokenValid(token, board) {
  if (typeof token !== 'string' || token === '') return false;
  return tokenMatches(await mintDisplayToken(board), await sha256Hex(token));
}
