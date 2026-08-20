const GONE = JSON.stringify({
  error:
    'queue modes were replaced by board types in Flapper 4.0 - a board is created as a type (live, scheduled, shared); see /docs',
});

// 410, not 404: the route existed and callers deserve to know where it went.
export async function POST() {
  return new Response(GONE, { status: 410, headers: { 'content-type': 'application/json' } });
}
