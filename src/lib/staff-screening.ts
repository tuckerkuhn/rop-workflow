import { z } from "zod";
import type { Entry, HrState } from "@/lib/hr";

/**
 * Staff screening (review round 1, MF-03, decisions D-23 and D-05): every finalist is checked
 * against the sanctions lists before the offer, the result is filed, and the check is repeated
 * yearly while they work here. Both lists by default: OFAC's SDN list and the UN Security Council
 * 1267 list (lib/policy screeningLists).
 *
 * A possible match goes to a person to review; it never decides on its own. Common names match a
 * list constantly. A hire waits until a clear result is recorded, after that review.
 *
 * Written in the HR ledger ("screening" entries), by HR only. The printout stays in the file store;
 * the record keeps its link.
 */

export const DEFAULT_LISTS = "OFAC SDN list; UN Security Council 1267 list";
/** D-23: re-checked every year. */
export const RESCREEN_MONTHS = 12;

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the date the lists were checked.");
export const screeningInput = z.object({
  person: z.string().regex(/^[a-z0-9-]{2,40}$/),
  date: iso,
  lists: z.string().trim().min(3, "Say which lists were checked.").max(400),
  result: z.enum(["clear", "possible_match"]),
  /** Where the printout is kept. */
  link: z.string().trim().url("Paste the link to the printout.").max(1000).optional(),
  note: z.string().trim().max(1000).optional(),
});
export type ScreeningInput = z.infer<typeof screeningInput>;
export type Screening = ScreeningInput & { n: number; by: string; at: string };

const isHr = (u: string, hr: HrState) => !!hr.rules?.holders.hr.includes(u);

/**
 * R2-10: why a new screening result may not be recorded after the ones before it, or null. A clear
 * result after a possible match is a review: by someone other than who found the match, on or after
 * that day, with a note saying how it was found not to be this person. Used for staff and farmers.
 */
export function reviewProblem(before: { date: string; result: string; by: string }[], next: { date: string; result: string; note?: string }, by: string): string | null {
  const last = [...before].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
  if (!last || last.result !== "possible_match" || next.result !== "clear") return null;
  if (last.by === by) return "You recorded the possible match, so someone else reviews it and records the clear result.";
  if (next.date < last.date) return `The review is dated before the possible match it clears (${last.date}).`;
  if ((next.note ?? "").trim().length < 10) return "Say how the possible match was found not to be this person.";
  return null;
}

/** Every screening recorded, by person (newest last). An entry from someone not holding HR does not count. */
export function foldScreening(entries: Entry[], hr: HrState): Record<string, Screening[]> {
  const out: Record<string, Screening[]> = {};
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (e.kind !== "screening" || !isHr(e.actor, hr)) continue;
    const d = screeningInput.safeParse(e.data);
    if (!d.success) continue;
    // A clear result that is not a proper review of a possible match does not count (R2-10).
    if (reviewProblem(out[d.data.person] ?? [], d.data, e.actor)) continue;
    (out[d.data.person] ??= []).push({ ...d.data, n: e.n, by: e.actor, at: e.at });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
  return out;
}

const monthsBetween = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + (Number(to.slice(5, 7)) - Number(from.slice(5, 7))) - (to.slice(8, 10) < from.slice(8, 10) ? 1 : 0);

/**
 * Why this person's screening is not in order today, or null: never screened, last screened more
 * than a year ago, or the last check found a possible match still to be reviewed.
 */
export function screeningProblem(list: Screening[] | undefined, today: string, months = RESCREEN_MONTHS): string | null {
  const last = list?.at(-1);
  if (!last) return "Not screened against the sanctions lists yet.";
  if (last.result === "possible_match") return `The check on ${last.date} found a possible match. A person reviews it, then records a clear result if it is not this person.`;
  if (monthsBetween(last.date, today) >= months) return `Last screened ${last.date}: more than ${months} months ago. Check the lists again.`;
  return null;
}

/** Why a hire (the offer) cannot be approved yet, or null: the finalist needs a clear, current screening. */
export const hireBlock = (list: Screening[] | undefined, today: string) => {
  const p = screeningProblem(list, today);
  return p ? `Screen the finalist before the offer. ${p}` : null;
};
