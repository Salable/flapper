'use client';

/**
 * The one loader for the tile art. Every flapper on a page - the wordmark in
 * the app bar, a hero, the display itself - shares a single fetch+decode of
 * a theme's manifest and strips, cached for the life of the tab. Nothing ever
 * closes these bitmaps: they are shared property, and a component unmounting
 * must not pull the tiles out from under another.
 *
 * One cache entry per theme (lib/board/themes.mjs): a display that switches
 * to Canary decodes the green set once and keeps both.
 */

import { DEFAULT_THEME, resolveTheme } from '@/lib/board/themes.mjs';

export type FlapperAssets = {
  manifest: { cycle: { char: string; strip: string; name: string }[]; tileSize: number; framesPerStrip: number };
  strips: ImageBitmap[];
};

const cached = new Map<string, Promise<FlapperAssets>>();
let loadedFraction = 0;
const progressListeners = new Set<(fraction: number) => void>();

function report(fraction: number) {
  loadedFraction = fraction;
  for (const listener of progressListeners) listener(fraction);
}

/** Watch load progress (0..1) of whichever theme is loading. Returns an unsubscribe; fires current state. */
export function onAssetProgress(listener: (fraction: number) => void) {
  progressListeners.add(listener);
  listener(loadedFraction);
  return () => {
    progressListeners.delete(listener);
  };
}

export function loadFlapperAssets(themeId: string = DEFAULT_THEME): Promise<FlapperAssets> {
  const theme = resolveTheme(themeId);
  const existing = cached.get(theme.id);
  if (existing) return existing;
  const base = theme.path;
  const loading = (async () => {
    const response = await fetch(`${base}/manifest.json`);
    if (!response.ok) throw new Error(`${base}/manifest.json: HTTP ${response.status}`);
    const manifest = await response.json();
    const strips: ImageBitmap[] = new Array(manifest.cycle.length);
    let done = 0;
    report(0);
    await Promise.all(
      manifest.cycle.map(async (state: { strip: string }, i: number) => {
        const strip = await fetch(`${base}/${state.strip}`);
        if (!strip.ok) throw new Error(`${state.strip}: HTTP ${strip.status}`);
        strips[i] = await createImageBitmap(await strip.blob());
        done += 1;
        report(done / manifest.cycle.length);
      }),
    );
    return { manifest, strips };
  })();
  cached.set(theme.id, loading);
  // A failed load must not poison the tab: allow a retry on the next mount.
  loading.catch(() => {
    cached.delete(theme.id);
    report(0);
  });
  return loading;
}
