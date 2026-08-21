'use client';

/**
 * The one loader for skins. Every flapper on a page - the wordmark in the
 * app bar, a hero, the display itself - shares a single load of a theme,
 * cached for the life of the tab. The bitmaps behind a skin's art are
 * shared property: a component unmounting must not close them out from
 * under another.
 *
 * One cache entry per theme (lib/board/themes.mjs): a display that switches
 * to Canary loads it once and keeps both. A theme loads its declared fonts
 * and art, then builds cards lazily at whatever tile size it is drawn at.
 */

import { DEFAULT_THEME, resolveTheme } from '@/lib/board/themes.mjs';
import { ProceduralSkin } from '@/lib/board/skins/procedural.mjs';
import type { Skin } from '@/lib/board/skins/skin.mjs';

export type { Skin };

const cached = new Map<string, Promise<Skin>>();
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

/** Load a pack's fonts and art; the skin paints its cards on first draw. */
export async function loadProcedural(pack: any): Promise<Skin> {
  const fonts: { family: string; src: string; weight?: string; style?: string }[] = pack.fonts || [];
  const arts: [string, string][] = Object.entries(pack.art || {});
  const total = fonts.length + arts.length + 1;
  let done = 0;
  report(0);
  const step = () => {
    done += 1;
    report(done / total);
  };
  const decoded = new Map<string, ImageBitmap>();
  await Promise.all([
    ...fonts.map(async (font) => {
      const face = new FontFace(font.family, `url(${font.src})`, {
        weight: font.weight ?? 'normal',
        style: font.style ?? 'normal',
      });
      await face.load();
      document.fonts.add(face);
      step();
    }),
    ...arts.map(async ([key, src]) => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`art ${key}: HTTP ${response.status}`);
      decoded.set(key, await createImageBitmap(await response.blob()));
      step();
    }),
  ]);
  // The glyph face itself may be a web font the page declares; wait for it
  // so the first cards are not painted in the fallback.
  try {
    await document.fonts.ready;
  } catch {
    /* fonts API absent: draw with what we have */
  }
  step();
  return new ProceduralSkin(pack, { arts: decoded });
}

export function loadSkin(themeId: string = DEFAULT_THEME): Promise<Skin> {
  const theme: any = resolveTheme(themeId);
  const existing = cached.get(theme.id);
  if (existing) return existing;
  const loading = loadProcedural(theme);
  cached.set(theme.id, loading);
  // A failed load must not poison the tab: allow a retry on the next mount.
  loading.catch(() => {
    cached.delete(theme.id);
    report(0);
  });
  return loading;
}
