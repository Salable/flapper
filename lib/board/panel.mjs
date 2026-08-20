/**
 * What the control panel shows, worked out away from the DOM.
 *
 * The panel itself cannot be unit-tested - it reads `document` the moment it
 * loads - so every decision it makes lives here instead, where a test can reach
 * it. `app.js` and the queue view are left applying results to nodes.
 *
 * The case this exists for: a band whose queue has drained keeps its last page
 * on the glass. It reports nothing showing, but it is not blank - it is
 * *holding*, and that is the normal steady state of a standing strip. A readout
 * built on `showing` alone calls it "idle" while the board plainly says
 * otherwise, which is the one thing this module must never do.
 */

import { MAIN } from './regions.mjs';

/** Shown in place of a message whose text is empty or all spaces. */
export const BLANK_LABEL = '(blank)';

/**
 * What a band is doing.
 * @returns {'live'|'held'|'blank'}
 */
export function glassState(band) {
  if (!band) return 'blank';
  if (band.showing) return 'live';
  return band.holding ? 'held' : 'blank';
}

/** A message's text, trimmed and shortened to fit a single line. */
export function label(text, max = 28) {
  const trimmed = String(text ?? '').trim();
  if (trimmed === '') return BLANK_LABEL;
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max - 1).trimEnd()}…`;
}

/** One line saying what a band is doing. Never the word "idle". */
export function bandSummary(band) {
  switch (glassState(band)) {
    case 'live': {
      const { text, page, pages } = band.showing;
      return pages > 1 ? `${label(text)} ${page}/${pages}` : label(text);
    }
    case 'held':
      return `holding ${label(band.holding.text)}`;
    default:
      return 'blank';
  }
}

/**
 * The badges beside a queued message - only what is not already obvious from
 * its text and its place in the list.
 */
export function itemMeta(item) {
  const meta = [];
  if (item.repeat) meta.push('↻');
  if (item.priority) meta.push(item.priority.toUpperCase());
  if (item.pages > 1) meta.push(`${item.pages}P`);
  if (item.resumesOnPage) meta.push(`→${item.resumesOnPage}`);
  if (item.source) meta.push(item.source.toUpperCase());
  return meta;
}

/** A band's pending messages, in play order. Read-only. */
export function queueRows(band) {
  return (band?.queue?.items ?? []).map((item) => ({
    id: item.id,
    label: label(item.text),
    position: item.position,
    repeat: Boolean(item.repeat),
    meta: itemMeta(item),
  }));
}

/**
 * A cheap check for whether a band's *list* needs rebuilding.
 *
 * Deliberately ignores which page is showing: that changes on every flip, and
 * it belongs to the header rather than the list. So the most frequent event on
 * the board costs a string compare instead of a reconcile.
 */
export function queueSignature(band) {
  return (band?.queue?.items ?? [])
    .map((item) => `${item.id}:${item.repeat ? 1 : 0}:${item.priority ?? ''}:${item.pages}`)
    .join(',');
}

/** One card per band, in the order they sit on the board. */
export function bandViews(status) {
  const regions = status?.regions ?? {};
  return Object.entries(regions)
    .sort(([, a], [, b]) => (a.top ?? 0) - (b.top ?? 0))
    .map(([id, band]) => ({
      id,
      name: id.toUpperCase(),
      height: band.rows,
      dwellMs: band.dwellMs,
      dwellInherited: (band.dwellOverride ?? null) === null,
      animating: Boolean(band.animating),
      state: glassState(band),
      summary: bandSummary(band),
      queued: band.queue?.length ?? 0,
      items: queueRows(band),
      signature: queueSignature(band),
    }));
}

/**
 * Keep the composer pointed somewhere real. A band can be configured away
 * while it is selected, and the next message would otherwise be refused.
 */
export function resolvePanelRegion(selected, availableIds = []) {
  if (availableIds.includes(selected)) return selected;
  if (availableIds.includes(MAIN)) return MAIN;
  return availableIds[0] ?? MAIN;
}

/**
 * What the layout engine did to a message, in one line. Moved here from
 * `app.js`, where it had real branching and no test could reach it.
 */
export function describeDiagnostics(diagnostics) {
  if (!diagnostics) return '';
  const notes = [];
  if (diagnostics.pageCount > 1) notes.push(`${diagnostics.pageCount} pages`);

  const dropped = (diagnostics.unsupported ?? []).map((entry) => entry.char);
  if (dropped.length > 0) notes.push(`dropped ${dropped.join(' ')}`);

  const changed = (diagnostics.substitutions ?? []).map((sub) => `${sub.from}→${sub.to || '·'}`);
  if (changed.length > 0) notes.push(changed.join(' '));

  const broken = diagnostics.brokenWords ?? [];
  if (broken.length > 0) notes.push(`split ${broken.join(' ')}`);

  const clipped = diagnostics.clippedLines ?? [];
  if (clipped.length > 0) notes.push(`clipped ${clipped.length}`);

  if (diagnostics.truncated) notes.push('truncated');
  return notes.join(' · ');
}
