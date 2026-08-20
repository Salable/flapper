const GONE = JSON.stringify({
  error: 'detach was removed with queue sharing in Flapper 4.0; see /docs',
});

export async function POST() {
  return new Response(GONE, { status: 410, headers: { 'content-type': 'application/json' } });
}
