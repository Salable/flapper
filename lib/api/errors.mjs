/** Throw-with-status, and the Response shapes every route shares. */

/**
 * `extra` rides along on the response body beside `error`. Used by the 402s,
 * which have to tell a machine what was refused (`need`) and a person where
 * to go about it (`getInTouch`) - a caller on the REST or MCP path has no UI
 * to read the sentence out of.
 */
export function reject(message, status, extra) {
  const error = new Error(message);
  error.status = status;
  if (extra) error.extra = extra;
  throw error;
}

export function json(status, body) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

export function errorResponse(error) {
  return json(error?.status || 500, {
    error: error?.message || 'internal error',
    ...(error?.extra ?? {}),
  });
}

/**
 * Read and parse a JSON body the way the desktop server did: empty is `{}`,
 * non-objects are 400, oversize is 413.
 */
export async function readJsonBody(request, maxBytes) {
  const raw = await request.text();
  if (raw.length > maxBytes) reject(`request body exceeds ${maxBytes} bytes`, 413);
  if (raw.trim() === '') return {};
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    reject('body is not valid JSON', 400);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    reject('body must be a JSON object', 400);
  }
  return parsed;
}
