import { z } from "zod";

/**
 * The six facts about a target that setup does not ask for and that reports depend on: its
 * baseline, how it is broken down, the documents that prove it, the budget line that pays for it,
 * the workplan step that delivers it, and whether it is in the donor's quarterly table. Until
 * 10 Nov 2026 only a script could set them. The rules here have no database in them.
 */

/** The breakdowns the data checks act on (lib/data-checks). Others already saved are kept as they are. */
export const BREAKDOWNS = ["sex", "province", "district"] as const;
export type Breakdown = (typeof BREAKDOWNS)[number];

export const targetDetailsSchema = z.object({
  indicator: z.string().regex(/^IND-\d+$/, "Choose a target."),
  // The column holds 14 digits, two of them decimals: anything finer would be stored as a different number than the one logged.
  baseline: z
    .number()
    .min(-999_999_999_999)
    .max(999_999_999_999)
    .refine((n) => Math.round(n * 100) / 100 === n, "Give the baseline with at most two decimals.")
    .nullable(),
  breakdown: z.array(z.enum(BREAKDOWNS)).max(BREAKDOWNS.length),
  verification: z.string().trim().max(500),
  budgetRef: z.string().trim().max(60),
  workplanCode: z.string().trim().max(40),
  inQuarterlyReport: z.boolean(),
});
export type TargetDetailsPatch = z.infer<typeof targetDetailsSchema>;

/** The six facts as the database holds them. */
export type StoredDetails = { baseline: number | null; disaggregation: string[] | null; verification: string | null; budgetRef: string | null; workplanCode: string | null; inQuarterlyReport: boolean };

const sameSet = (a: string[], b: string[]) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
const known = (x: string): x is Breakdown => (BREAKDOWNS as readonly string[]).includes(x);

/** What to store: empty text becomes "not set", and a breakdown this screen does not offer (e.g. "crop") stays. */
export function nextDetails(before: StoredDetails, a: TargetDetailsPatch): StoredDetails {
  const others = (before.disaggregation ?? []).filter((x) => !known(x));
  const chosen = [...BREAKDOWNS.filter((b) => a.breakdown.includes(b)), ...others];
  // The same breakdowns in another order are not a change: what was stored stays as it was.
  const by = before.disaggregation && sameSet(before.disaggregation, chosen) ? before.disaggregation : chosen;
  return {
    baseline: a.baseline,
    disaggregation: by.length || before.disaggregation ? by : null,
    verification: a.verification || null,
    budgetRef: a.budgetRef || null,
    workplanCode: a.workplanCode || null,
    inQuarterlyReport: a.inQuarterlyReport,
  };
}

/** Only what changed, as from and to, for the audit log. Empty when nothing did. */
export function detailChanges(before: StoredDetails, after: StoredDetails): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const k of Object.keys(after) as (keyof StoredDetails)[]) {
    const [x, y] = [before[k], after[k]];
    const same = Array.isArray(x) || Array.isArray(y) ? sameSet((x as string[] | null) ?? [], (y as string[] | null) ?? []) : x === y;
    if (!same) out[k] = { from: x, to: y };
  }
  return out;
}

/** A budget line or workplan step that is not in the project's own plan is refused, in plain words. */
export function linkProblem(a: Pick<TargetDetailsPatch, "budgetRef" | "workplanCode">, budgetCodes: string[], workplanCodes: string[]): string | null {
  if (a.budgetRef && !budgetCodes.includes(a.budgetRef)) return `Budget line ${a.budgetRef} is not in this project's budget.`;
  if (a.workplanCode && !workplanCodes.includes(a.workplanCode)) return `Workplan step ${a.workplanCode} is not in this project's workplan.`;
  return null;
}
