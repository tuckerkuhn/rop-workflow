import { z } from "zod";
import { conflictOf, type Entry, type HrState, type Relation } from "@/lib/hr";
import type { AwayState } from "@/lib/delegation";

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
  vacation: "Annual leave",
  travel: "Leave travel day",
  sick: "Sick leave",
  urgent: "Urgent or bereavement leave",
  compassionate: "Compassionate leave",
  parental: "Maternity or paternity leave",
  hajj: "Hajj leave",
  unpaid: "Unpaid leave",
  other: "Other leave",
} as const;
export type LeaveType = keyof typeof LEAVE;
export const LEAVE_TYPES = Object.keys(LEAVE) as LeaveType[];
/** The types every timesheet has always offered; the others follow the person's leave rules (lib/leave). */
export const BASIC_LEAVE: LeaveType[] = ["holiday", "floating", "vacation", "travel", "sick", "other"];
/** Unpaid leave is recorded but not paid or charged to any funding source. */
export const UNPAID: LeaveType = "unpaid";

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
export function prefill(month: string, office: string, shares: Record<string, number>, leave: Record<string, { type: LeaveType; hours: number }> = {}): Sheet {
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
    else if (leave[d] && leave[d].hours >= HOURS_PER_DAY) days[d] = { leave: { type: leave[d].type, hours: HOURS_PER_DAY }, note: "Approved leave" };
    else if (leave[d]) {
      // Half a day of approved leave: the other half worked on the first source.
      const first = ids[0];
      days[d] = { hours: first ? { [first]: HOURS_PER_DAY - leave[d].hours } : {}, place: USUAL_PLACE[office] ?? "in", leave: { type: leave[d].type, hours: leave[d].hours }, note: "Approved half day of leave" };
    } else days[d] = { hours: Object.fromEntries(Object.entries(per).filter(([, h]) => h > 0)), place: USUAL_PLACE[office] ?? "in" };
  }
  return { month, days };
}

/* ---------------- What a timesheet may say (review round 1, ISS-05 and ISS-06) ---------------- */

/**
 * Worked hours a day and a week before a reason is needed. The defaults are the usual 8 and 40;
 * an office with its own rule gets a line here (decision D-24: a setting per country).
 */
export const HOUR_LIMITS: Record<string, { day: number; week: number }> = { default: { day: HOURS_PER_DAY, week: 40 } };
export const limitsFor = (office: string) => HOUR_LIMITS[office] ?? HOUR_LIMITS.default;
/** The shortest note that says why. */
export const OVER_NOTE_MIN = 5;

/**
 * Each office's own time zone: "today" for a timesheet is the office's day, not the server's UTC
 * day (code review of ISS-05: in Kabul before 04:30 the last working day was still "tomorrow").
 */
export const OFFICE_TZ: Record<string, string> = { Afghanistan: "Asia/Kabul", Guatemala: "America/Guatemala", "Home Office": "America/Los_Angeles" };
export function todayIn(office: string, now: Date = new Date()): string {
  const tz = OFFICE_TZ[office];
  if (!tz) return now.toISOString().slice(0, 10);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const v = (k: string) => p.find((x) => x.type === k)?.value ?? "";
  return `${v("year")}-${v("month")}-${v("day")}`;
}

const worked = (d: Day | undefined) => Object.values(d?.hours ?? {}).reduce((a, b) => a + b, 0);
const longDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });

/** The month's last working day for the office: the first day its timesheet can be submitted. */
export const lastWorkday = (month: string, office: string) => {
  const all = daysIn(month);
  return [...all].reverse().find((d) => isWorkday(d, office)) ?? all[all.length - 1];
};

export type OverDay = { date: string; hours: number; limit: number; note: string };
export type OverWeek = { from: string; to: string; hours: number; limit: number; note: string; noteOn: string };
/**
 * Days over the daily limit and weeks over the weekly one. A week runs from the office's first
 * working day; only days of this month are counted. Each carries the note that explains it, if any:
 * for a week, a note on any of its worked days that is not already over the daily limit, else any.
 */
export function overLimits(sheet: Sheet, office: string, before: Record<string, Day> = {}): { days: OverDay[]; weeks: OverWeek[] } {
  const lim = limitsFor(office);
  const first = (WORK_WEEK[office] ?? WORK_WEEK["Home Office"])[0] ?? 1;
  const days: OverDay[] = [];
  const weeks: OverWeek[] = [];
  let week: string[] = [];
  const close = () => {
    const hours = week.reduce((a, d) => a + workedOn(d), 0);
    if (hours > lim.week) {
      const workedDays = week.filter((d) => d >= start && worked(sheet.days[d]) > 0);
      const noted = workedDays.find((d) => (sheet.days[d]?.note ?? "").trim().length >= OVER_NOTE_MIN);
      weeks.push({ from: week[0], to: week[week.length - 1], hours, limit: lim.week, note: noted ? (sheet.days[noted]?.note ?? "").trim() : "", noteOn: noted ?? workedDays[workedDays.length - 1] ?? week[week.length - 1] });
    }
    week = [];
  };
  // A week that began last month counts last month's days of it too (code review of ISS-06: 30
  // hours either side of the month's start was never a 60-hour week). Only this month's days are
  // flagged for a note.
  const start = daysIn(sheet.month)[0];
  let k = start;
  const tail: string[] = [];
  while (weekday(k) !== first && tail.length < 7) {
    k = new Date(Date.parse(`${k}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);
    tail.unshift(k);
  }
  const all = { ...before, ...sheet.days };
  const workedOn = (d: string) => worked(all[d]);
  for (const d of tail) if (before[d]) week.push(d);
  for (const d of daysIn(sheet.month)) {
    if (weekday(d) === first && week.length) close();
    week.push(d);
    const h = worked(sheet.days[d]);
    if (h > lim.day) days.push({ date: d, hours: h, limit: lim.day, note: (sheet.days[d]?.note ?? "").trim() });
  }
  if (week.length) close();
  return { days, weeks };
}

/**
 * Why a timesheet cannot be submitted yet, or null. A timesheet records time after it is worked,
 * never before: it is submitted from the month's last working day, and no day still to come
 * carries worked hours. Hours over the daily or weekly limit are allowed only with a note saying
 * why, which the supervisor sees when approving: refusing long days outright teaches people to
 * write 8 when they worked 12.
 */
export function submitProblem(sheet: Sheet, office: string, today: string, opts: { cap?: number | null; before?: Record<string, Day> } = {}): string | null {
  const opens = lastWorkday(sheet.month, office);
  const monthName = new Date(`${sheet.month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  if (today < opens) return `The timesheet for ${monthName} can be submitted from ${longDate(opens)}, its last working day. A timesheet records time after it is worked, never before.`;
  const ahead = Object.keys(sheet.days).filter((d) => d > today && worked(sheet.days[d]) > 0).sort();
  if (ahead.length) return `${longDate(ahead[0])} has not happened yet, so it cannot carry worked hours. Remove them, or submit once the day is worked.`;
  // A hard limit a donor or a personnel policy sets (Settings, People): refused, not just noted.
  if (opts.cap && opts.cap > 0) {
    const long = Object.keys(sheet.days).sort().find((d) => worked(sheet.days[d]) > opts.cap!);
    if (long) return `${longDate(long)} has ${worked(sheet.days[long])} hours. No one may record more than ${opts.cap} hours in a day here: a donor's or the personnel policy's limit. Correct the day, and speak to your supervisor about the extra time.`;
  }
  const over = overLimits(sheet, office, opts.before);
  const day = over.days.find((d) => d.note.length < OVER_NOTE_MIN);
  if (day) return `${longDate(day.date)} has ${day.hours} hours, over the ${day.limit}-hour day. Add a note on that day saying why: your supervisor sees it when approving.`;
  const week = over.weeks.find((w) => w.note.length < OVER_NOTE_MIN);
  if (week) return `The week of ${longDate(week.from)} has ${week.hours} hours, over the ${week.limit}-hour week. Add a note on ${longDate(week.noteOn)} saying why: your supervisor sees it when approving.`;
  return null;
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
  /** Paid leave hours (unpaid leave is not included). */
  leaveTotal: number;
  /** Unpaid leave hours: on the sheet, but not paid or charged. */
  unpaidHours: number;
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
  const unpaidHours = leave[UNPAID];
  const leaveTotal = Object.values(leave).reduce((a, b) => a + b, 0) - unpaidHours;
  // Leave with no worked hours (a month all on leave) goes to non-contract.
  const leaveBySource = directTotal ? apportion(direct, leaveTotal, 1) : leaveTotal ? { [NON_CONTRACT]: leaveTotal } : {};
  const all = [...new Set([...sources, ...Object.keys(leaveBySource)])].sort();
  const total = Object.fromEntries(all.map((s) => [s, (direct[s] ?? 0) + (leaveBySource[s] ?? 0)]));
  const grandTotal = Object.values(total).reduce((a, b) => a + b, 0);
  const pct = grandTotal ? apportion(total, 100, 0.01) : {};
  return { sources: all, inCountry, outside, direct, directTotal, leave, leaveTotal, unpaidHours, leaveBySource, total, grandTotal, pct, allowanceDays, expected: expectedHours(sheet.month, office) };
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
export function approversFor(t: Pick<Timesheet, "person" | "by">, hr: Pick<HrState, "people" | "relations" | "rules">, away?: AwayState | null, day = new Date().toISOString().slice(0, 10)): { people: string[]; via: "supervisor" | "hr" } {
  const ok = (u: string) => !conflictOf(u, { subject: t.person, by: t.by, signatures: [], type: "timesheet" }, hr as { people: HrState["people"]; relations: Relation[] });
  const sup = hr.people[t.person]?.current.supervisor;
  // The supervisor, and whoever acts for them while they are away (R2-16, MF-01).
  if (typeof sup === "string" && ok(sup)) return { people: [sup, ...(away?.entries.filter((a) => a.person === sup && a.delegate && day >= a.from && day <= a.to && a.delegate !== t.person && ok(a.delegate)).map((a) => a.delegate as string) ?? [])], via: "supervisor" };
  return { people: (hr.rules?.holders.hr ?? []).filter(ok), via: "hr" };
}

/** Every timesheet's current version, checked as it is read. Superseded versions stay in the ledger. */
export function foldTimesheets(entries: Entry[], hr: HrState, away?: AwayState | null): { sheets: Timesheet[]; ignored: TsIgnored[] } {
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
      if (!approversFor(t, hr, away, e.at.slice(0, 10)).people.includes(e.actor)) {
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

/** Days where the timesheet's leave differs from approved leave requests, for the approver. */
export function leaveMismatch(sheet: Sheet, approved: Record<string, { type: LeaveType; hours: number }>): string[] {
  const out: string[] = [];
  for (const [d, a] of Object.entries(approved)) {
    const l = sheet.days[d]?.leave;
    if (!l || l.hours < a.hours) out.push(`${d}: approved leave not on the timesheet.`);
  }
  for (const [d, day] of Object.entries(sheet.days)) {
    const l = day.leave;
    if (l && l.hours > 0 && l.type !== "holiday" && !approved[d]) out.push(`${d}: ${LEAVE[l.type].toLowerCase()} on the timesheet with no approved request.`);
  }
  return out.sort();
}

/** Funding shares from a person's latest approved (else latest) timesheet, for prefilling the next one. */
export function lastShares(sheets: Timesheet[], person: string, office: string): Record<string, number> | null {
  const mine = sheets.filter((t) => t.person === person).sort((a, b) => b.month.localeCompare(a.month));
  const t = mine.find((x) => x.status === "approved") ?? mine[0];
  if (!t) return null;
  const s = splitOf(t.sheet, office);
  return s.directTotal ? s.direct : null;
}
