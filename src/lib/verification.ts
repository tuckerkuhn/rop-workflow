/**
 * Verification (review round 1, MF-10, decision D-26).
 *
 * 1. Bulk acceptance: many records are accepted at once only when none has a flag, and only after
 *    the person has opened a random sample of them (`sampleSize`, `pickSample`). A sample opened
 *    is what makes "accept all" a check rather than a click.
 * 2. The monthly verification sample: each month a random 2 to 5% of the project's sites (farmers;
 *    3% by default, a project setting) is drawn for a visit, each assigned to someone other than
 *    the person who collected that farmer's records. The share done is tracked month by month.
 *
 * The draw is random but repeatable: it is seeded by the project and the month, so drawing again
 * gives the same farmers and nobody can redraw until a convenient set comes up.
 */

export const DEFAULT_RATE = 0.03;
export const MIN_RATE = 0.02;
export const MAX_RATE = 0.05;

/** A small, repeatable random stream from a text seed (mulberry32 over a string hash). */
function stream(seed: string) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `n` of the items, chosen at random but the same for the same seed. */
export function pick<T>(items: T[], n: number, seed: string): T[] {
  const r = stream(seed);
  const pool = [...items];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.max(0, Math.min(n, pool.length)));
}

/** How many of a batch to open before accepting it all: 10%, at least one, at most five. */
export const sampleSize = (batch: number) => (batch <= 0 ? 0 : Math.min(5, Math.max(1, Math.ceil(batch * 0.1))));

/** The records to open before accepting a batch: chosen afresh each time the batch changes. */
export const pickSample = (ids: string[], seed: string) => pick([...ids].sort(), sampleSize(ids.length), `${seed}:${[...ids].sort().join(",")}`);

/**
 * Why a batch may not be accepted at once yet, or null. With `seed` (R2-19) the records opened must be
 * the ones drawn at random for this batch, which the server draws again itself: a person cannot pick
 * convenient ones. Without it, any full sample of the batch counts.
 */
export function bulkProblem(ids: string[], opened: string[], seed?: string): string | null {
  const need = sampleSize(ids.length);
  const ask = `Open ${need === 1 ? "one record" : `${need} records`} of the batch first, chosen at random, and check them; then accept the rest at once.`;
  if (seed) {
    const drawn = pickSample(ids, seed);
    return drawn.every((id) => opened.includes(id)) ? null : `${ask} The records to open are the ones drawn for this batch: reload the page to see them.`;
  }
  const seen = opened.filter((id) => ids.includes(id));
  return seen.length >= need ? null : ask;
}

export const clampRate = (r: number | undefined) => Math.min(MAX_RATE, Math.max(MIN_RATE, r ?? DEFAULT_RATE));

export type VisitResult = "confirmed" | "discrepancy";
export type Visit = { farmer: string; collector: string | null; assignee: string | null; done?: { by: string; byName: string; at: string; result: VisitResult; note: string } };
export type MonthSample = { month: string; rate: number; drawnAt: string; drawnBy: string; visits: Visit[] };
export type VerificationState = { months: Record<string, MonthSample> };
export const EMPTY_VERIFICATION: VerificationState = { months: {} };
export const VERIFICATION_KEY = "verification";

/**
 * This month's sample: `rate` of the farmers (at least one), each assigned to the first of the
 * `checkers` who did not collect that farmer's records; none when every checker did.
 */
export function drawMonth(code: string, month: string, farmers: { id: string; collectors: string[] }[], checkers: string[], rate: number): Visit[] {
  const n = Math.max(1, Math.round(farmers.length * clampRate(rate)));
  const chosen = pick(
    [...farmers].sort((a, b) => a.id.localeCompare(b.id)),
    n,
    `${code}:${month}`,
  );
  return chosen.map((f, i) => {
    // Spread the work: start each farmer's search at a different checker.
    const order = [...checkers.slice(i % Math.max(1, checkers.length)), ...checkers.slice(0, i % Math.max(1, checkers.length))];
    return { farmer: f.id, collector: f.collectors[0] ?? null, assignee: order.find((c) => !f.collectors.includes(c)) ?? null };
  });
}

/** The share of a month's sample visited, as a whole percent. */
export const doneRate = (m: MonthSample) => (m.visits.length ? Math.round((m.visits.filter((v) => v.done).length / m.visits.length) * 100) : 0);
