/**
 * A short, word-safe preview of a longer string.
 *
 * The summary row above "Edit text →" (QueueManager, SheetEditor) relies on
 * CSS `text-overflow: ellipsis` to fit one line, and CSS truncates wherever
 * the box ends - mid-word, half a letter showing, whatever the pixel width
 * lands on. Clipping the string itself first, back to the last whole word,
 * means the ellipsis (when CSS still needs one for a narrower box) lands
 * after a real word rather than through the middle of one.
 */
export function previewClip(text, max = 48) {
  const trimmed = String(text ?? '').trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  const safe = lastSpace > 0 ? cut.slice(0, lastSpace) : cut;
  return `${safe}…`;
}
