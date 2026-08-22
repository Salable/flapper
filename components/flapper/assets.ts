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
import type { ThemePack } from '@/lib/board/theme-pack.mjs';

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

/** Fonts already registered with the document, by src; art already decoded, by URI. */
const fontCache = new Map<string, Promise<void>>();
const artCache = new Map<string, Promise<ImageBitmap>>();
const ART_CACHE_MAX = 32;

function loadFont(font: { family: string; src: string; weight?: string; style?: string }) {
  const key = `${font.family}|${font.src}|${font.weight ?? 'normal'}|${font.style ?? 'normal'}`;
  let pending = fontCache.get(key);
  if (!pending) {
    pending = (async () => {
      const face = new FontFace(font.family, `url(${font.src})`, {
        weight: font.weight ?? 'normal',
        style: font.style ?? 'normal',
      });
      await face.load();
      document.fonts.add(face);
    })();
    pending.catch(() => fontCache.delete(key));
    fontCache.set(key, pending);
  }
  return pending;
}

function loadArt(key: string, src: string) {
  let pending = artCache.get(src);
  if (!pending) {
    pending = (async () => {
      const response = await fetch(src);
      if (!response.ok) throw new Error(`art ${key}: HTTP ${response.status}`);
      return createImageBitmap(await response.blob());
    })();
    pending.catch(() => artCache.delete(src));
    // Bounded: an editor scrubbing through uploads must not pin them all.
    if (artCache.size >= ART_CACHE_MAX) artCache.delete(artCache.keys().next().value as string);
    artCache.set(src, pending);
  }
  return pending;
}

/**
 * Load a pack's fonts and art and hand back a skin; the skin paints its
 * cards on first draw. Fonts and art are cached across calls, so rebuilding
 * a skin for a colour change (the editor does this on every tweak) costs
 * the cards, not a decode.
 */
export async function loadProcedural(pack: ThemePack): Promise<Skin> {
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
    ...fonts.map((font) => loadFont(font).then(step)),
    ...arts.map(([key, src]) =>
      loadArt(key, src).then((bitmap) => {
        decoded.set(key, bitmap);
        step();
      }),
    ),
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

function cachedSkin(key: string, load: () => Promise<Skin>): Promise<Skin> {
  const existing = cached.get(key);
  if (existing) return existing;
  const loading = load();
  cached.set(key, loading);
  // A failed load must not poison the tab: allow a retry on the next mount.
  loading.catch(() => {
    cached.delete(key);
    report(0);
  });
  return loading;
}

/** A preset's skin, shared by every flapper on the page. */
export function loadSkin(themeId: string = DEFAULT_THEME): Promise<Skin> {
  const theme: any = resolveTheme(themeId);
  return cachedSkin(`preset:${theme.id}`, () => loadProcedural(theme));
}

/**
 * A board's own skin, keyed by the server's theme revision: the same rev
 * is the same pack, so a display that sees a nudge with an unchanged rev
 * never reloads, and the editor gets a fresh skin only when something
 * actually differs.
 */
export function loadBoardSkin(rev: string, pack: ThemePack): Promise<Skin> {
  return cachedSkin(`board:${rev}`, () => loadProcedural(pack));
}
