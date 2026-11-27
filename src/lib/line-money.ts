/**
 * What is left on a budget line: one figure, worked out one way, shown in the same words wherever
 * a purchase meets its budget (review round 1, ISS-07; Q3 audit finding 3, a contract above its
 * budget line). Before this the ask form, the calendar, the requisition and the approver each
 * saw a different amount for the same line.
 *
 *   available = the line's budget
 *             - spending already posted to the books
 *             - what purchases under way are committed to and have not yet paid
 *             - what has been asked for outside the calendar and not yet started
 *
 * A planned calendar item is not taken off: it is the line's own remainder, an estimate of what
 * is still to buy, and becomes a commitment when its request starts. Pure, and in one currency:
 * the caller converts before calling.
 */
export type LineFigure = { code: string; budget: number; spent: number; committed: number; asked: number; available: number };

const round2 = (n: number) => Math.round(n * 100) / 100;

export function lineFigure(code: string, budget: number, spent: number, committed: number, asked: number): LineFigure {
  return { code, budget: round2(budget), spent: round2(spent), committed: round2(committed), asked: round2(asked), available: round2(budget - spent - committed - asked) };
}

/** The figure in words, the same on every screen: "$4,200 available on 2.3: budget $12,000, less $7,800 committed to purchases under way". */
export function lineFigureText(f: LineFigure, fmt: (n: number) => string, committedTo?: string): string {
  const parts = [`budget ${fmt(f.budget)}`];
  if (f.spent) parts.push(`less ${fmt(f.spent)} spent`);
  if (f.committed) parts.push(`less ${fmt(f.committed)} committed to ${committedTo || "purchases under way"}`);
  if (f.asked) parts.push(`less ${fmt(f.asked)} asked for outside the calendar`);
  return `${fmt(Math.max(0, f.available))} available on ${f.code}: ${parts.join(", ")}${f.available < 0 ? ` (${fmt(-f.available)} over)` : ""}`;
}
