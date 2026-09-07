/**
 * Telling a person that a person is waiting.
 *
 * Every paid plan is bespoke, so the end of a 402 is a conversation, and the
 * RFC's commitment is a reply within a day or two. A row in Postgres nobody
 * looks at does not meet that, so a request also goes wherever the people
 * answering it already are: `LICENCE_REQUEST_WEBHOOK_URL`, which is a Slack
 * incoming webhook in our case and any URL that takes `{text}` in general.
 *
 * Unset, this is a no-op and `tools/licence-requests.mjs` is how the queue
 * gets read. Best-effort either way: a failed notification must never lose
 * the request, which is already committed by the time this runs.
 */

export async function notifyGetInTouch(
  { need, label, email, contact, message, requestedAt },
  { fetchImpl = globalThis.fetch, url = process.env.LICENCE_REQUEST_WEBHOOK_URL, timeoutMs = 4000 } = {},
) {
  if (!url) return false;
  const lines = [
    `*Flapper: ${label ?? need}*`,
    `From: ${email}${contact ? ` (better: ${contact})` : ''}`,
    `Needs: \`${need}\``,
    `Said: ${message}`,
    `At: ${new Date(requestedAt).toISOString()}`,
  ];
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: lines.join('\n') }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) throw new Error(`webhook answered ${response.status}`);
    return true;
  } catch (error) {
    console.error(`flapper: get-in-touch notification skipped - ${error.message}`);
    return false;
  }
}
