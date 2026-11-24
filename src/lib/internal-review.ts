import { z } from "zod";

/**
 * The quarterly internal review (Internal Audit and Compliance Procedure, in the UNDP response):
 * a remote, risk-based review of a country office by two Home Office staff. After each quarter the
 * lead draws a sample from the app's own records by the procedure's rules, the country office
 * files the documents, the lead and an independent reviewer test each item, findings are rated
 * and tracked until closed, and the reviewer signs the final report for the CEO.
 *
 * Nobody tests a transaction they prepared or approved: an item the lead touched goes to the
 * reviewer, and one both touched is flagged for someone else.
 */

export const AREAS = {
  cash: { title: "Cash and bank", checks: "Monthly bank reconciliations signed, cash counts, unexplained items", sample: "All 3 months" },
  payments: { title: "Payments and advances", checks: "Supporting documents, approvals within authority limits, advances cleared within 30 days", sample: "10% of payments or 25, whichever is larger, plus every payment over $5,000" },
  payroll: { title: "Payroll", checks: "Timesheets, contracts, tax and deductions, payroll matches the HR list", sample: "1 month in full" },
  procurement: { title: "Procurement", checks: "Quotes or bids, evaluation, purchase order, goods received note, signed delivery acknowledgement", sample: "Every procurement over $1,000, and 5 below" },
  assets: { title: "Fixed assets and inventory", checks: "Asset register updated, spot check by photo", sample: "10 items" },
  donor: { title: "Donor compliance", checks: "Costs eligible, charged to the right budget line, reports filed on time", sample: "Each active award" },
} as const;
export type Area = keyof typeof AREAS;
export const AREA_KEYS = Object.keys(AREAS) as Area[];

/** The procedure's numbers. */
export const RULES = { paymentShare: 0.1, paymentMin: 25, paymentAlwaysOverUsd: 5000, procurementAlwaysOverUsd: 1000, procurementBelow: 5, assetItems: 10 };

/** A record the sample can be drawn from. */
export type Candidate = {
  area: Area;
  /** Unique within the quarter: "payment:JE-0012", "procurement:A-2027/PR-2027-006". */
  ref: string;
  what: string;
  date: string;
  usd: number;
  /** Person ids. */
  preparedBy: string[];
  approvedBy: string[];
  /** Where to open it in the app. */
  href?: string;
  /** Payroll: the month it belongs to, so one whole month is taken. */
  group?: string;
};

export type Tester = "lead" | "reviewer" | "someone else";
export type Result = { ok: boolean; note: string; by: string; at: string };
export type SampleItem = Candidate & { why: string; tester: Tester; result?: Result };

export const RATINGS = {
  high: { title: "High", meaning: "Loss of funds, a sign of fraud or a breach of a donor's rules", rule: "Reported to the CEO within 48 hours" },
  medium: { title: "Medium", meaning: "A weak control", rule: "Fixed within 30 days" },
  low: { title: "Low", meaning: "A missing or incomplete document", rule: "Fixed by the next review" },
} as const;
export type Rating = keyof typeof RATINGS;

export type Finding = {
  id: string;
  quarter: string;
  area: Area;
  /** The sample item it came from, if any. */
  ref?: string;
  rating: Rating;
  text: string;
  by: string;
  at: string;
  due: string;
  /** The country office's answer: what it will do, and by when. */
  response?: { text: string; by: string; at: string };
  /** The CEO's approval of the corrective action. */
  approved?: { by: string; at: string };
  /** Closed after the lead re-tests it. */
  closed?: { by: string; at: string; note: string };
};

/** The cycle after each quarter, in days after the quarter ends (procedure, section 4). */
export const STEPS = [
  { id: "sampleSent", title: "Sample list sent to the country office", by: "lead", day: 7 },
  { id: "documentsIn", title: "Documents filed in the internal audit folder", by: "focal", day: 14 },
  { id: "testingDone", title: "Sample tested against the checklist", by: "lead", day: 28 },
  { id: "draftSent", title: "Draft report sent to the country office", by: "lead", day: 35 },
  { id: "responseIn", title: "Management response received", by: "focal", day: 49 },
  { id: "finalSigned", title: "Final report signed and sent to the CEO", by: "reviewer", day: 49 },
] as const;
export type StepId = (typeof STEPS)[number]["id"];

export type Roles = { lead: string; reviewer: string; focal: string; ceo: string };
export type Review = {
  quarter: string;
  drawnAt: string;
  drawnBy: string;
  items: SampleItem[];
  steps: Partial<Record<StepId, { by: string; at: string }>>;
};
export type ReviewBook = { roles: Roles | null; reviews: Review[]; findings: Finding[] };

/* ---------------- Quarters ---------------- */

export const quarterOf = (day: string) => `${day.slice(0, 4)}-Q${Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1}`;
export function quarterRange(q: string): { start: string; end: string; months: string[] } {
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(6));
  const m0 = (n - 1) * 3 + 1;
  const months = [0, 1, 2].map((i) => `${y}-${String(m0 + i).padStart(2, "0")}`);
  const last = new Date(Date.UTC(y, m0 + 2, 0)).toISOString().slice(0, 10);
  return { start: `${months[0]}-01`, end: last, months };
}
export const previousQuarter = (q: string) => {
  const y = Number(q.slice(0, 4));
  const n = Number(q.slice(6));
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
};
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
export const stepDue = (q: string, day: number) => addDays(quarterRange(q).end, day);

/* ---------------- The sample ---------------- */

/** A repeatable random order: the same quarter gives the same sample, so it can be checked later. */
function seeded(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = (h + 0x6d2b79f5) | 0;
    let t = h;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(list: T[], n: number, rand: () => number): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a.slice(0, Math.max(0, n));
}

/** Who tests an item: the lead, unless the lead prepared or approved it; then the reviewer; if both did, someone else. */
export function testerFor(c: Pick<Candidate, "preparedBy" | "approvedBy">, roles: Pick<Roles, "lead" | "reviewer">): Tester {
  const touched = new Set([...c.preparedBy, ...c.approvedBy]);
  if (!touched.has(roles.lead)) return "lead";
  if (!touched.has(roles.reviewer)) return "reviewer";
  return "someone else";
}

/** Draws the quarter's sample by the procedure's rules. */
export function drawSample(candidates: Candidate[], quarter: string, roles: Pick<Roles, "lead" | "reviewer">): SampleItem[] {
  const rand = seeded(`internal-review:${quarter}`);
  const of = (a: Area) => candidates.filter((c) => c.area === a).sort((x, y) => x.ref.localeCompare(y.ref));
  const out: { c: Candidate; why: string }[] = [];

  for (const c of of("cash")) out.push({ c, why: "Every month" });

  const payments = of("payments");
  const big = payments.filter((c) => c.usd > RULES.paymentAlwaysOverUsd);
  const rest = payments.filter((c) => c.usd <= RULES.paymentAlwaysOverUsd);
  const n = Math.max(RULES.paymentMin, Math.ceil(payments.length * RULES.paymentShare)) - 0;
  for (const c of big) out.push({ c, why: `Over $${RULES.paymentAlwaysOverUsd.toLocaleString("en-US")}` });
  for (const c of pick(rest, n, rand)) out.push({ c, why: "Drawn at random" });

  const months = [...new Set(of("payroll").map((c) => c.group ?? c.date.slice(0, 7)))].sort();
  const month = pick(months, 1, rand)[0];
  for (const c of of("payroll").filter((c) => (c.group ?? c.date.slice(0, 7)) === month)) out.push({ c, why: "The month drawn" });

  const procs = of("procurement");
  for (const c of procs.filter((c) => c.usd > RULES.procurementAlwaysOverUsd)) out.push({ c, why: `Over $${RULES.procurementAlwaysOverUsd.toLocaleString("en-US")}` });
  for (const c of pick(procs.filter((c) => c.usd <= RULES.procurementAlwaysOverUsd), RULES.procurementBelow, rand)) out.push({ c, why: "Drawn at random" });

  for (const c of of("donor")) out.push({ c, why: "Every active award" });

  // There is no asset register in the app yet: the spot check is one item the lead records by hand.
  out.push({ c: { area: "assets", ref: "assets:spot-check", what: `Spot check of ${RULES.assetItems} items on the asset register, by photo`, date: quarterRange(quarter).end, usd: 0, preparedBy: [], approvedBy: [] }, why: "Every quarter" });

  return out.map(({ c, why }) => ({ ...c, why, tester: testerFor(c, roles) }));
}

/** When a finding is due, from its rating. */
export function dueFor(rating: Rating, at: string, quarter: string): string {
  if (rating === "high") return addDays(at, 2);
  if (rating === "medium") return addDays(at, 30);
  // By the next review: the next quarter's final report.
  const next = quarterRange(quarter).end;
  return stepDue(quarterOf(addDays(next, 1)), 49);
}

/* ---------------- Actions ---------------- */

const personId = z.string().regex(/^[a-z0-9-]{2,40}$/);
const quarter = z.string().regex(/^\d{4}-Q[1-4]$/);
export const reviewAction = z.discriminatedUnion("action", [
  z.object({ action: z.literal("roles"), roles: z.object({ lead: personId, reviewer: personId, focal: personId, ceo: personId }) }),
  z.object({ action: z.literal("draw"), quarter }),
  z.object({ action: z.literal("step"), quarter, step: z.enum(STEPS.map((s) => s.id) as [StepId, ...StepId[]]) }),
  z.object({ action: z.literal("test"), quarter, ref: z.string().max(200), ok: z.boolean(), note: z.string().trim().max(1000) }),
  z.object({ action: z.literal("finding"), quarter, area: z.enum(AREA_KEYS as [Area, ...Area[]]), ref: z.string().max(200).optional(), rating: z.enum(["high", "medium", "low"]), text: z.string().trim().min(10, "Say what was found, in a sentence or two.").max(2000) }),
  z.object({ action: z.literal("respond"), finding: z.string().max(40), text: z.string().trim().min(10, "Say what will be done, and by when.").max(2000) }),
  z.object({ action: z.literal("approve"), finding: z.string().max(40) }),
  z.object({ action: z.literal("close"), finding: z.string().max(40), note: z.string().trim().min(10, "Say how the re-test showed it is fixed.").max(1000) }),
]);
export type ReviewAction = z.infer<typeof reviewAction>;
