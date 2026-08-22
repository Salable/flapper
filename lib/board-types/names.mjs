/**
 * A template prefills the board's name so the fast path is one click. Two
 * clicks on the same template used to make two "Carrow Road"s with nothing
 * on the dashboard to tell them apart; now the second is "Carrow Road 2".
 * Pure: the caller passes the names the account already has.
 */

export function nextFreeName(wanted, taken) {
  const have = new Set([...taken].map((name) => String(name ?? '').trim().toLowerCase()));
  const base = String(wanted ?? '').trim();
  if (base === '' || !have.has(base.toLowerCase())) return base;
  for (let n = 2; n < 1000; n += 1) {
    const candidate = `${base} ${n}`;
    if (!have.has(candidate.toLowerCase())) return candidate;
  }
  return base;
}
