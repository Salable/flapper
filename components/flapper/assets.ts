'use client';

/**
 * The one loader for the tile art. Every flapper on a page - the wordmark in
 * the app bar, a hero, the display itself - shares a single fetch+decode of
 * the manifest and its strips, cached for the life of the tab. Nothing ever
 * closes these bitmaps: they are shared property, and a component unmounting
 * must not pull the tiles out from under another.
 */

export type FlapperAssets = {
  manifest: { cycle: { char: string; strip: string; name: string }[]; tileSize: number; framesPerStrip: number };
  strips: ImageBitmap[];
};

const ASSETS = '/assets';

let cached: Promise<FlapperAssets> | null = null;
let loadedFraction = 0;
const progressListeners = new Set<(fraction: number) => void>();

function report(fraction: number) {
  loadedFraction = fraction;
  for (const listener of progressListeners) listener(fraction);
}

/** Watch load progress (0..1). Returns an unsubscribe; fires current state. */
export function onAssetProgress(listener: (fraction: number) => void) {
  progressListeners.add(listener);
  listener(loadedFraction);
  return () => {
    progressListeners.delete(listener);
  };
}

export function loadFlapperAssets(): Promise<FlapperAssets> {
  if (cached) return cached;
  cached = (async () => {
    const response = await fetch(`${ASSETS}/manifest.json`);
    if (!response.ok) throw new Error(`manifest.json: HTTP ${response.status}`);
    const manifest = await response.json();
    const strips: ImageBitmap[] = new Array(manifest.cycle.length);
    let done = 0;
    await Promise.all(
      manifest.cycle.map(async (state: { strip: string }, i: number) => {
        const strip = await fetch(`${ASSETS}/${state.strip}`);
        if (!strip.ok) throw new Error(`${state.strip}: HTTP ${strip.status}`);
        strips[i] = await createImageBitmap(await strip.blob());
        done += 1;
        report(done / manifest.cycle.length);
      }),
    );
    return { manifest, strips };
  })();
  // A failed load must not poison the tab: allow a retry on the next mount.
  cached.catch(() => {
    cached = null;
    report(0);
  });
  return cached;
}
