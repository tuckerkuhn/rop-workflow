import { z } from "zod";
import { conflictOf, type Entry, type HrState, type Relation } from "@/lib/hr";

/**
 * Monthly timesheets: hours per day per funding source, inside or outside the program country,
 * leave by type and allowance days, as on the ROP timesheet form. Each submission is an entry in
 * the HR ledger; the supervisor approves or sends it back. A revision after approval is a new
 * version that needs approving again, and it is flagged.
 *
 * The split per funding source follows the payroll workbook ("Holiday-Vac - Sick Prorata"):
 * worked hours set the percentages, and leave is shared out in the same proportions, to the
 * hour. Where the workbook rounds by hand, this uses largest remainders, so the hours and the
 * percentages always add up exactly.
 */

export const NON_CONTRACT = "non-contract";
export type FundingSource = { id: string; label: string };

export const HOURS_PER_DAY = 8;

/** Working days per office (0 = Sunday). From the timesheet form: US Monday–Friday, Afghanistan Sunday–Thursday. */
export const WORK_WEEK: Record<string, number[]> = {
  "Home Office": [1, 2, 3, 4, 5],
  Afghanistan: [0, 1, 2, 3, 4],
  Guatemala: [1, 2, 3, 4, 5],
};
/** Where people in each office usually work, for the form's two blocks of hours. */
export const USUAL_PLACE: Record<string, Place> = { "Home Office": "out", Afghanistan: "in", Guatemala: "in" };

export const LEAVE = {
  holiday: "Fixed holiday",
  floating: "Floating holiday",
  vacation: "Vacation leave",
  travel: "Leave travel day",
  sick: "Sick leave",
  other: "Other leave",
} as const;
export type LeaveType = keyof typeof LEAVE;
export const LEAVE_TYPES = Object.keys(LEAVE) as LeaveType[];

export const ALLOWANCES = { dangerPay: "Danger pay", postDiff: "Post differential", separateMaintenance: "Separate maintenance" } as const;
export type Allowance = keyof typeof ALLOWANCES;
export const ALLOWANCE_TYPES = Object.keys(ALLOWANCES) as Allowance[];

/**
 * Public holidays per office. Sample dates: HR confirms them each year (Afghan holidays follow
 * the lunar calendar and are announced late).
 */
export const HOLIDAYS: Record<string, Record<string, string>> = {
  "Home Office": {
    "2026-01-01": "New Year's Day",
    "2026-01-19": "Martin Luther King Jr. Day",
    "2026-02-16": "Presidents' Day",
    "2026-05-25": "Memorial Day",
    "2026-06-19": "Juneteenth",
    "2026-07-03": "Independence Day (observed)",
    "2026-09-07": "Labor Day",
    "2026-10-12": "Indigenous Peoples' Day",
    "2026-11-11": "Veterans Day",
    "2026-11-26": "Thanksgiving",
    "2026-11-27": "Native American Heritage Day",
    "2026-12-25": "Christmas Day",
    "2027-01-01": "New Year's Day",
  },
  Afghanistan: {
    "2026-03-20": "Eid al-Fitr",
    "2026-03-22": "Eid al-Fitr",
    "2026-05-26": "Eid al-Adha",
    "2026-05-27": "Eid al-Adha",
    "2026-05-28": "Eid al-Adha",
    "2026-08-19": "Independence Day",
  },
  Guatemala: {},
};

export type Place = "in" | "out";
export type Day = {
  /** Hours worked per funding source. */
  hours?: Record<string, number>;
  /** Worked inside or outside the program country. */
  place?: Place;
  leave?: { type: LeaveType; hours: number };
  allowances?: Allowance[];
  note?: string;
};
export type Sheet = { month: string; days: Record<string, Day> };

const hours = z.number().min(0).max(24);
const daySchema = z.object({
  hours: z.record(z.string().regex(/^[A-Za-z0-9-]{2,40}$/), hours).optional(),
  place: z.enum(["in", "out"]).optional(),
  leave: z.object({ type: z.enum(LEAVE_TYPES as [LeaveType, ...LeaveType[]]), hours: z.number().min(0).max(24) }).optional(),
  allowances: z.array(z.enum(ALLOWANCE_TYPES as [Allowance, ...Allowance[]])).max(3).optional(),
  note: z.string().trim().max(300).optional(),
});
export const sheetSchema = z
  .object({ month: z.string().regex(/^\d{4}-\d{2}$/), days: z.record(z.string().regex(/^\d{4}-\d{2}-\d{2}$/), daySchema) })
  .refine((s) => Object.keys(s.days).every((d) => d.startsWith(s.month)), "Every day must be in the timesheet's month.")
  .refine((s) => Object.values(s.days).every((d) => Object.values(d.hours ?? {}).reduce((a, b) => a + b, 0) + (d.leave?.hours ?? 0) <= 24), "No day can have more than 24 hours.");

export const submitSchema = z.object({ action: z.literal("submit"), person: z.string().regex(/^[a-z0-9-]{2,40}$/), sheet: sheetSchema, certify: z.literal(true) });
export const tsActionSchema = z.discriminatedUnion("action", [
  submitSchema,
  z.object({ action: z.literal("approve"), timesheet: z.number().int().positive() }),
  z.object({ action: z.literal("return"), timesheet: z.number().int().positive(), note: z.string().trim().min(3).max(1000) }),
]);
export type TsAction = z.infer<typeof tsActionSchema>;

/* ---------------- Calendar ---------------- */

export const daysIn = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
};
export const weekday = (d: string) => new Date(`${d}T00:00:00Z`).getUTCDay();
export const isWorkday = (d: string, office: string) => (WORK_WEEK[office] ?? WORK_WEEK["Home Office"]).includes(weekday(d)) && !HOLIDAYS[office]?.[d];
export const expectedHours = (month: string, office: string) => daysIn(month).filter((d) => (WORK_WEEK[office] ?? WORK_WEEK["Home Office"]).includes(weekday(d))).length * HOURS_PER_DAY;

/**
 * A starting sheet: every working day at 8 hours, split across funding sources as last month
 * was (or all to one source), and public holidays filled in as leave.
 */
export function prefill(month: string, office: string, shares: Record<string, number>): Sheet {
  const days: Record<string, Day> = {};
  const total = Object.values(shares).reduce((a, b) => a + b, 0) || 1;
  // Whole and half hours per source, with any remainder on the largest source.
  const ids = Object.keys(shares).sort((a, b) => shares[b] - shares[a]);
  const per: Record<string, number> = {};
  for (const id of ids) per[id] = Math.floor((HOURS_PER_DAY * shares[id]) / total * 2) / 2;
  const left = HOURS_PER_DAY - Object.values(per).reduce((a, b) => a + b, 0);
  if (ids[0]) per[ids[0]] += left;
  const work = WORK_WEEK[office] ?? WORK_WEEK["Home Office"];
  for (const d of daysIn(month)) {
    if (!work.includes(weekday(d))) continue;
    if (HOLIDAYS[office]?.[d]) days[d] = { leave: { type: "holiday", hours: HOURS_PER_DAY }, note: HOLIDAYS[office][d] };
    else days[d] = { hours: Object.fromEntries(Object.entries(per).filter(([, h]) => h > 0)), place: USUAL_PLACE[office] ?? "in" };
  }
  return { month, days };
}

/* ---------------- Totals and the split ---------------- */

/** Shares `total` out in proportion to `weights`, rounded to `step`, so the parts add up exactly (largest remainders). */
export function apportion(weights: Record<string, number>, total: number, step = 1): Record<string, number> {
  const sum = Object.values(weights).reduce((a, b) => a + b, 0);
  const out: Record<string, number> = {};
  if (!sum || !total) {
    for (const k of Object.keys(weights)) out[k] = 0;
    return out;
  }
  const units = Math.round(total / step);
  const exact = Object.entries(weights).map(([k, w]) => ({ k, x: (units * w) / sum }));
  for (const e of exact) out[e.k] = Math.floor(e.x + 1e-9);
  let short = units - Object.values(out).reduce((a, b) => a + b, 0);
  for (const e of [...exact].sort((a, b) => b.x - Math.floor(b.x + 1e-9) - (a.x - Math.floor(a.x + 1e-9)) || a.k.localeCompare(b.k))) {
    if (short <= 0) break;
    out[e.k]++;
    short--;
  }
  for (const k of Object.keys(out)) out[k] = Math.round(out[k] * step * 100) / 100;
  return out;
}

export type Split = {
  sources: string[];
  inCountry: Record<string, number>;
  outside: Record<string, number>;
  direct: Record<string, number>;
  directTotal: number;
  leave: Record<LeaveType, number>;
  leaveTotal: number;
  /** Leave shared out by worked hours, to the hour. */
  leaveBySource: Record<string, number>;
  total: Record<string, number>;
  grandTotal: number;
  /** Percentage per source, two decimals, adding to exactly 100. */
  pct: Record<string, number>;
  allowanceDays: Record<Allowance, number>;
  expected: number;
};

export function splitOf(sheet: Sheet, office: string): Split {
  const inCountry: Record<string, number> = {};
  const outside: Record<string, number> = {};
  const leave = Object.fromEntries(LEAVE_TYPES.map((t) => [t, 0])) as Record<LeaveType, number>;
  const allowanceDays = Object.fromEntries(ALLOWANCE_TYPES.map((t) => [t, 0])) as Record<Allowance, number>;
  for (const day of Object.values(sheet.days)) {
    const bucket = day.place === "out" ? outside : inCountry;
    for (const [s, h] of Object.entries(day.hours ?? {})) bucket[s] = (bucket[s] ?? 0) + h;
    if (day.leave && day.leave.hours > 0) leave[day.leave.type] += day.leave.hours;
    for (const a of day.allowances ?? []) allowanceDays[a]++;
  }
  const sources = [...new Set([...Object.keys(inCountry), ...Object.keys(outside)])].sort();
  const direct = Object.fromEntries(sources.map((s) => [s, (inCountry[s] ?? 0) + (outside[s] ?? 0)]));
  const directTotal = Object.values(direct).reduce((a, b) => a + b, 0);
  const leaveTotal = Object.values(leave).reduce((a, b) => a + b, 0);
  // Leave with no worked hours (a month all on leave) goes to non-contract.
  const leaveBySource = directTotal ? apportion(direct, leaveTotal, 1) : leaveTotal ? { [NON_CONTRACT]: leaveTotal } : {};
  const all = [...new Set([...sources, ...Object.keys(leaveBySource)])].sort();
  const total = Object.fromEntries(all.map((s) => [s, (direct[s] ?? 0) + (leaveBySource[s] ?? 0)]));
  const grandTotal = Object.values(total).reduce((a, b) => a + b, 0);
  const pct = grandTotal ? apportion(total, 100, 0.01) : {};
  return { sources: all, inCountry, outside, direct, directTotal, leave, leaveTotal, leaveBySource, total, grandTotal, pct, allowanceDays, expected: expectedHours(sheet.month, office) };
}

/* ---------------- Folding timesheets out of the ledger ---------------- */

export type TsStatus = "pending" | "approved" | "returned";
export type Timesheet = {
  /** Entry number of this version. */
  n: number;
  person: string;
  month: string;
  sheet: Sheet;
  by: string;
  at: string;
  version: number;
  /** Earlier versions of the same month, oldest first. */
  previous: number[];
  revisedAfterApproval: boolean;
  status: TsStatus;
  decidedBy?: { by: string; at: string; note?: string; n: number };
};

export type TsIgnored = { n: number; kind: string; actor: string; why: string };

/** Who may approve a timesheet: the person's supervisor, or HR when the supervisor has a conflict or there is none. */
export function approversFor(t: Pick<Timesheet, "person" | "by">, hr: Pick<HrState, "people" | "relations" | "rules">): { people: string[]; via: "supervisor" | "hr" } {
  const ok = (u: string) => !conflictOf(u, { subject: t.person, by: t.by, signatures: [], type: "timesheet" }, hr as { people: HrState["people"]; relations: Relation[] });
  const sup = hr.people[t.person]?.current.supervisor;
  if (typeof sup === "string" && ok(sup)) return { people: [sup], via: "supervisor" };
  return { people: (hr.rules?.holders.hr ?? []).filter(ok), via: "hr" };
}

/** Every timesheet's current version, checked as it is read. Superseded versions stay in the ledger. */
export function foldTimesheets(entries: Entry[], hr: HrState): { sheets: Timesheet[]; ignored: TsIgnored[] } {
  const byKey = new Map<string, Timesheet>();
  const byN = new Map<number, Timesheet>();
  const ignored: TsIgnored[] = [];
  const isHr = (u: string) => !!hr.rules?.holders.hr.includes(u);
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (e.kind === "timesheet") {
      const d = sheetSchema.safeParse(e.data);
      if (!d.success || !e.subject) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "unreadable" });
        continue;
      }
      if (e.actor !== e.subject && !isHr(e.actor)) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "only the person or HR submits a timesheet" });
        continue;
      }
      if (!hr.people[e.subject]) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "no HR record for this person" });
        continue;
      }
      const key = `${e.subject}|${d.data.month}`;
      const prev = byKey.get(key);
      const t: Timesheet = {
        n: e.n,
        person: e.subject,
        month: d.data.month,
        sheet: d.data,
        by: e.actor,
        at: e.at,
        version: (prev?.version ?? 0) + 1,
        previous: prev ? [...prev.previous, prev.n] : [],
        revisedAfterApproval: !!prev && (prev.status === "approved" || prev.revisedAfterApproval),
        status: "pending",
      };
      byKey.set(key, t);
      byN.set(e.n, t);
    } else if (e.kind === "ts-approve" || e.kind === "ts-return") {
      const data = e.data as { timesheet?: number; note?: string };
      const t = typeof data?.timesheet === "number" ? byN.get(data.timesheet) : undefined;
      const current = t && byKey.get(`${t.person}|${t.month}`);
      if (!t || current !== t || t.status !== "pending") {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "not the current version waiting for approval" });
        continue;
      }
      if (!approversFor(t, hr).people.includes(e.actor)) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "not the person who approves this timesheet" });
        continue;
      }
      if (e.kind === "ts-return" && !(typeof data.note === "string" && data.note.trim().length >= 3)) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "sent back without a reason" });
        continue;
      }
      t.status = e.kind === "ts-approve" ? "approved" : "returned";
      t.decidedBy = { by: e.actor, at: e.at, n: e.n, ...(e.kind === "ts-return" ? { note: data.note } : {}) };
    }
  }
  return { sheets: [...byKey.values()], ignored };
}

/** Funding shares from a person's latest approved (else latest) timesheet, for prefilling the next one. */
export function lastShares(sheets: Timesheet[], person: string, office: string): Record<string, number> | null {
  const mine = sheets.filter((t) => t.person === person).sort((a, b) => b.month.localeCompare(a.month));
  const t = mine.find((x) => x.status === "approved") ?? mine[0];
  if (!t) return null;
  const s = splitOf(t.sheet, office);
  return s.directTotal ? s.direct : null;
}
