/**
 * Formatting that has to agree between the server and the browser.
 *
 * A client component is rendered twice - once into the HTML on the server,
 * once again when React hydrates - and anything that reads the runtime's
 * locale or time zone gives two different answers. `toLocaleDateString()`
 * with no locale is exactly that: "Aug 24, 2026" from a US server, "24 Aug
 * 2026" in a British browser, and a hydration mismatch that throws away the
 * whole tree.
 *
 * So dates that appear in the markup are pinned: en-GB, UTC, both ends. A
 * created-on date is a fact about the board, not a clock, and a fact should
 * read the same wherever it is rendered.
 */

const DAY = new Intl.DateTimeFormat('en-GB', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  timeZone: 'UTC',
});

/** A calendar day, as `24 Aug 2026`. Identical on the server and the client. */
export function formatDay(when: number | Date): string {
  return DAY.format(when instanceof Date ? when : new Date(when));
}
