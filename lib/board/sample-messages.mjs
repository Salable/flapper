/**
 * Sample text for judging a design - the gallery's cards, the design
 * editor's preview, anywhere a design is being looked at rather than a
 * real board's own content.
 *
 * Two messages showed almost nothing: the same two words in the same two
 * positions every time, so a design that happened to look good on "NOW
 * BOARDING" told you nothing about how it handled a long word running the
 * full width, a short one sitting alone, or a message with no digits or
 * punctuation in it at all. Varied on purpose - short lines and long
 * ones, single words and two-line messages, digits, and the full
 * punctuation set the ring actually carries (`.` `,` `!` `(` `)` - no
 * colon, no percent sign, nothing outside what a board can show).
 *
 * More than one message also matters for the travel itself, not just the
 * content: a tile only moves forward round the ring, so cycling between
 * several messages means some tiles barely twitch on a given flip and
 * others riffle most of the way round - a single fixed message never
 * shows that at all.
 *
 * Order matters a little: kept the original "NOW BOARDING" first so an
 * existing screenshot or expectation of "the first thing you see" doesn't
 * change.
 */
export const SAMPLE_MESSAGES = Object.freeze([
  'NOW BOARDING\nGATE 12 .,!()',
  'DELAYED 15 MIN\nPLATFORM 4 (B)',
  'HAPPY BIRTHDAY!',
  'SALE ENDS TODAY\n50 PERCENT OFF',
  'ROOM 204\nCONFERENCE A',
  'THANK YOU FOR\nVISITING US',
  'FINAL CALL\nDOORS CLOSING',
  '2024 RESULTS\n1ST PLACE',
]);
