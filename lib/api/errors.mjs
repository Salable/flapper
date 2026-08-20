/** Throw-with-status, and the Response shapes every route shares. */

export function reject(message, status) {
  const error = new Error(message);
  error.status = status;
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
  return json(error?.status || 500, { error: error?.message || 'internal error' });
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
