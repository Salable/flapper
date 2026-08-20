const GONE = JSON.stringify({
  error:
    'attaching boards to a queue was removed in Flapper 4.0 - a shared board is the same board URL opened on many screens; see /docs',
});

export async function POST() {
  return new Response(GONE, { status: 410, headers: { 'content-type': 'application/json' } });
}
