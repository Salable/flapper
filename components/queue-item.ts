/**
 * The one shape a queue item's payload takes, and the one function that
 * turns it back into a POST/PATCH body - shared between QueueManager (the
 * rail + compact panel) and SheetEditor (the popup that edits one item's
 * text), so the two never drift into two different ideas of what a queue
 * item looks like.
 */

/*
 * A stored item's payload is not the shape you posted it in: `rows` arrives
 * as a top-level field (rowsOption reads body.rows) and comes back nested
 * under `options` (textOptions builds { text, options: { rows, ... } } for
 * either mode). `text` is always present, empty string for a rows-mode item.
 */
export type QueueItem = {
  id: string;
  payload: { text?: string; options?: { rows?: string[]; [key: string]: unknown } };
  loop: boolean;
  source: string;
  /** When this item is gone outright, not just done with its turn - null
   * (the default) means it stands until dismissed. */
  expiresAtMs?: number | null;
};

/** The stored shape, turned back into something POST /queue/items accepts. */
export function payloadToBody(payload: QueueItem['payload'] | undefined): Record<string, unknown> {
  if (!payload) return { text: '' };
  const { text, options } = payload;
  // `options` already uses the input's own key names (rows included - it is
  // nested here but top-level on the way in), so spreading it reconstructs
  // the original body.
  //
  // `text` is always included, even '' - patchQueueItem (lib/api/handlers.mjs)
  // only looks at loop/label/dwellMs/etc when body.text or body.rows is
  // *present*, not when it's truthy. A blank text-mode slide (the one
  // "+ Slide" creates) has neither, so omitting an empty text here used to
  // make every caller that spreads this and adds just one field - renaming a
  // tab, setting Hold - patch an empty object and get refused with "nothing
  // to change", on exactly the slide most likely to be renamed first.
  return { ...(options ?? {}), text: text ?? '' };
}
