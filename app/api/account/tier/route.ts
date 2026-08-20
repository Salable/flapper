const GONE = JSON.stringify({
  error:
    'offerings were removed in Flapper 4.0 - every board type is available to every account for now',
});

export async function POST() {
  return new Response(GONE, { status: 410, headers: { 'content-type': 'application/json' } });
}
