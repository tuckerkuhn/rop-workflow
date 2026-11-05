import { z } from "zod";
import { conflictOf, type Entry, type Fields, type HrState } from "@/lib/hr";
import { receiptSchema } from "@/lib/expense";
import { HOLIDAYS, HOURS_PER_DAY, WORK_WEEK, weekday, type LeaveType as TsLeave } from "@/lib/timesheet";

/**
 * Leave requests and balances, from ROP's personnel rules:
 *   [PP] 2024 Personnel Policies, Home Office & Expatriate Staff (Apr 22 2024), §9 and §8.21.
 *   [AF] Employee Handbook for Afghanistan National Employees (Apr 21 2025), Ch.7–8.
 *   [GT] PP Attachment (Guatemala): 15 business days a year; sick leave per Guatemalan law.
 * Balances are worked out from the start date, month by month, from the rules below and the
 * approved requests and adjustments in the HR ledger; nothing is stored as a number to edit.
 */

export type Group = "homeOffice" | "expat" | "afghanistan" | "guatemala" | "none";
export const GROUP_LABEL: Record<Group, string> = { homeOffice: "Home Office", expat: "Expatriate", afghanistan: "Afghanistan national staff", guatemala: "Guatemala", none: "No paid leave (consultant)" };

/** Which rules apply: expatriates follow PP whatever their office; consultants earn no leave (PP §6.1.7). */
export function groupOf(rec: Fields): Group {
  const employment = String(rec.employment ?? "");
  if (employment === "Contractor") return "none";
  if (employment === "Expatriate") return "expat";
  const office = String(rec.office ?? "");
  if (office === "Home Office") return "homeOffice";
  if (office === "Guatemala") return "guatemala";
  return "afghanistan";
}

export const TYPES = {
  vacation: "Annual leave",
  sick: "Sick leave",
  floating: "Floating holiday",
  urgent: "Urgent or bereavement leave",
  compassionate: "Compassionate leave",
  parental: "Maternity or paternity leave",
  hajj: "Hajj leave",
  unpaid: "Unpaid leave",
  other: "Other leave",
} as const;
export type LeaveKind = keyof typeof TYPES;
export const LEAVE_KINDS = Object.keys(TYPES) as LeaveKind[];

/** How each kind shows on the timesheet form. */
export const ON_TIMESHEET: Record<LeaveKind, TsLeave> = { vacation: "vacation", sick: "sick", floating: "floating", urgent: "other", compassionate: "other", parental: "other", hajj: "other", unpaid: "other", other: "other" };

type Balance =
  | { mode: "monthly"; hoursPerMonth: (years: number, manager: boolean) => number; capHours: number | null }
  | { mode: "annual"; hours: number };
export type Rule = {
  kinds: LeaveKind[];
  balances: Partial<Record<LeaveKind, Balance>>;
  /** Days' notice expected before annual leave. */
  notice: number;
  probationDays: number;
  /** Annual leave cannot be used during probation (AF Ch.7E). */
  noLeaveInProbation: boolean;
  /** Days of sick leave after which a doctor's certificate is needed. */
  certificateAfter: number;
  maxConsecutive: Partial<Record<LeaveKind, number>>;
  /** Kinds that need HR as well as the supervisor. */
  hrAlso: LeaveKind[];
  notes: string[];
};

const band = (years: number, a: number, b: number, c: number) => (years < 2 ? a : years < 4 ? b : c);

export const RULES: Record<Group, Rule> = {
  homeOffice: {
    kinds: ["vacation", "sick", "floating", "compassionate", "parental", "unpaid", "other"],
    balances: {
      // PP §9.2: staff 8/12/16 h a month by service (0–2, 2–4, 4+ years); managers 10/13.33/16.5; cap 24 days.
      vacation: { mode: "monthly", hoursPerMonth: (y, m) => (m ? band(y, 10, 13.33, 16.5) : band(y, 8, 12, 16)), capHours: 24 * HOURS_PER_DAY },
      // PP §9.2.5: half a day a month, carried over up to 24 days.
      sick: { mode: "monthly", hoursPerMonth: () => 4, capHours: 24 * HOURS_PER_DAY },
    },
    notice: 28,
    probationDays: 90,
    noLeaveInProbation: false,
    certificateAfter: 3,
    maxConsecutive: { compassionate: 7 },
    hrAlso: ["parental", "unpaid"],
    notes: [
      "Annual leave: 8, 12 or 16 hours a month after 0, 2 and 4 years (managers 10, 13.33, 16.5), up to 24 days; unused leave is paid out on leaving (PP §9.2).",
      "Ask your supervisor at least 4 weeks ahead, in full days (PP §9.2.2).",
      "Sick leave: half a day a month, carried over up to 24 days; a doctor's certificate after 3 days in a row (PP §9.2.5–9.2.8).",
      "Floating holidays are earned through the year and cannot be carried over or paid out (PP §9.1).",
      "Compassionate leave: 7 days for a spouse or child, 5 for a parent, sibling or grandparent (PP §9.7).",
      "Pregnancy leave: half pay for up to 4 months after 6 months' service, paid on return; fathers 7 days paid (PP §9.4).",
    ],
  },
  expat: {
    kinds: ["vacation", "sick", "floating", "compassionate", "parental", "unpaid", "other"],
    balances: {
      // PP §8.21 and §9.2: expatriates earn 2 days a month (taken as R&R or vacation), up to 24 days.
      vacation: { mode: "monthly", hoursPerMonth: () => 2 * HOURS_PER_DAY, capHours: 24 * HOURS_PER_DAY },
      sick: { mode: "monthly", hoursPerMonth: () => 4, capHours: 24 * HOURS_PER_DAY },
    },
    notice: 28,
    probationDays: 90,
    noLeaveInProbation: false,
    certificateAfter: 3,
    maxConsecutive: { compassionate: 7 },
    hrAlso: ["parental", "unpaid"],
    notes: [
      "Annual leave and R&R: 2 days a month, up to 24 days; at most 3 R&R trips a year (PP §8.21). The policy's table says \"2.0\" without a unit; HR to confirm days.",
      "Leaving the country needs the Country Director's approval; more than 32 days away needs the supervisor and the CEO in writing (PP §9.11).",
      "Sick leave: half a day a month, carried over up to 24 days (PP §9.2.5).",
    ],
  },
  afghanistan: {
    kinds: ["vacation", "sick", "urgent", "parental", "hajj", "unpaid", "other"],
    balances: {
      // AF Ch.7E: 20 days a year, earned monthly, capped at 20 days (accrual stops at the cap).
      vacation: { mode: "monthly", hoursPerMonth: () => (20 * HOURS_PER_DAY) / 12, capHours: 20 * HOURS_PER_DAY },
      // AF Ch.7F: 20 days a year, no carry-over, no payout.
      sick: { mode: "annual", hours: 20 * HOURS_PER_DAY },
      // AF Ch.8C: a pool of 10 days a year for urgent matters, bereavement, marriage and a father's leave at a birth.
      urgent: { mode: "annual", hours: 10 * HOURS_PER_DAY },
    },
    notice: 5,
    probationDays: 90,
    noLeaveInProbation: true,
    certificateAfter: 3,
    maxConsecutive: { urgent: 3 },
    hrAlso: ["parental", "hajj", "unpaid"],
    notes: [
      "Annual leave: 20 days a year, earned monthly, up to 20 days; usable after the 90-day probation, with 5 days' notice (AF Ch.7E).",
      "Sick leave: 20 days a year, not carried over; tell your supervisor within half an hour of your start time; up to half may be for your children, parents or spouse (AF Ch.7F).",
      "Urgent and bereavement leave: 10 days a year, at most 3 in a row (AF Ch.8C).",
      "Maternity: 90 days paid, 30 before and 60 after the birth, with 90 days' notice; 15 more for complications (AF Ch.8B).",
      "Hajj: up to 45 calendar days paid after 5 years' service (AF Ch.8F).",
      "Unpaid leave: the supervisor recommends, HR decides (AF Ch.8A).",
    ],
  },
  guatemala: {
    kinds: ["vacation", "sick", "parental", "unpaid", "other"],
    balances: {
      // PP Guatemala attachment: 15 business days a year.
      vacation: { mode: "monthly", hoursPerMonth: () => (15 * HOURS_PER_DAY) / 12, capHours: null },
    },
    notice: 14,
    probationDays: 60,
    noLeaveInProbation: false,
    certificateAfter: 3,
    maxConsecutive: {},
    hrAlso: ["parental", "unpaid"],
    notes: ["Annual leave: 15 business days a year (Guatemala attachment). Sick leave follows Guatemalan law; HR to set the rule."],
  },
  none: { kinds: [], balances: {}, notice: 0, probationDays: 0, noLeaveInProbation: false, certificateAfter: 0, maxConsecutive: {}, hrAlso: [], notes: ["Consultants do not earn paid leave (PP §6.1.7)."] },
};

/* ---------------- Requests ---------------- */

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const requestSchema = z
  .object({
    kind: z.enum(LEAVE_KINDS as [LeaveKind, ...LeaveKind[]]),
    start: iso,
    end: iso,
    /** A half day (4 hours), only for a one-day request. */
    half: z.boolean().optional(),
    note: z.string().trim().max(500).optional(),
    certificate: receiptSchema.optional(),
  })
  .refine((r) => r.end >= r.start, "The last day is before the first.")
  .refine((r) => !r.half || r.start === r.end, "A half day is for one day only.");
export type LeaveRequestInput = z.infer<typeof requestSchema>;

export const lvActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), request: requestSchema }),
  z.object({ action: z.literal("approve"), request: z.number().int().positive() }),
  z.object({ action: z.literal("return"), request: z.number().int().positive(), note: z.string().trim().min(3).max(1000) }),
  z.object({ action: z.literal("cancel"), request: z.number().int().positive() }),
]);
export type LvAction = z.infer<typeof lvActionSchema>;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/** The working days a request covers in the person's office: weekends and public holidays are not leave. */
export function workingDays(start: string, end: string, office: string): string[] {
  const week = WORK_WEEK[office] ?? WORK_WEEK["Home Office"];
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (week.includes(weekday(d)) && !HOLIDAYS[office]?.[d]) out.push(d);
  return out;
}
export const hoursOf = (r: Pick<LeaveRequestInput, "start" | "end" | "half">, office: string) => (r.half ? HOURS_PER_DAY / 2 : workingDays(r.start, r.end, office).length * HOURS_PER_DAY);

export type LvStatus = "pending" | "approved" | "returned" | "cancelled";
export type Step = "supervisor" | "hr";
export type LeaveRequest = LeaveRequestInput & {
  n: number;
  person: string;
  by: string;
  at: string;
  office: string;
  group: Group;
  hours: number;
  steps: Step[];
  signatures: { step: Step; by: string; at: string; n: number }[];
  status: LvStatus;
  closed?: { by: string; at: string; note?: string };
};
export type LvIgnored = { n: number; kind: string; actor: string; why: string };

/** Who may sign the next step: the supervisor (else HR), then HR for the kinds that need it. */
export function nextSigner(r: LeaveRequest, hr: HrState): { step: Step; people: string[] } | null {
  if (r.status !== "pending") return null;
  const step = r.steps[r.signatures.length];
  if (!step) return null;
  const signed = r.signatures.map((s) => s.by);
  const ok = (u: string) => !signed.includes(u) && !conflictOf(u, { subject: r.person, by: r.by, signatures: [], type: "leave" }, hr);
  if (step === "supervisor") {
    const sup = hr.people[r.person]?.current.supervisor;
    if (typeof sup === "string" && ok(sup)) return { step, people: [sup] };
  }
  return { step, people: (hr.rules?.holders.hr ?? []).filter(ok) };
}

export function foldLeave(entries: Entry[], hr: HrState): { requests: LeaveRequest[]; ignored: LvIgnored[] } {
  const byN = new Map<number, LeaveRequest>();
  const ignored: LvIgnored[] = [];
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (e.kind === "leave") {
      const d = requestSchema.safeParse(e.data);
      const person = e.subject;
      if (!d.success || !person || !hr.people[person]) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "unreadable, or no HR record" });
        continue;
      }
      if (e.actor !== person) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "only the person asks for their own leave" });
        continue;
      }
      const rec = hr.people[person].current;
      const group = groupOf(rec);
      if (!RULES[group].kinds.includes(d.data.kind)) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: `${TYPES[d.data.kind]} does not apply to ${GROUP_LABEL[group]}` });
        continue;
      }
      const office = String(rec.office ?? "Home Office");
      const steps: Step[] = RULES[group].hrAlso.includes(d.data.kind) ? ["supervisor", "hr"] : ["supervisor"];
      byN.set(e.n, { ...d.data, n: e.n, person, by: e.actor, at: e.at, office, group, hours: hoursOf(d.data, office), steps, signatures: [], status: "pending" });
    } else if (e.kind === "lv-approve" || e.kind === "lv-return" || e.kind === "lv-cancel") {
      const data = e.data as { request?: number; note?: string };
      const r = typeof data?.request === "number" ? byN.get(data.request) : undefined;
      if (!r) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "no such request" });
        continue;
      }
      if (e.kind === "lv-cancel") {
        const isHr = !!hr.rules?.holders.hr.includes(e.actor) && e.actor !== r.person;
        const mine = e.actor === r.person && (r.status === "pending" || (r.status === "approved" && r.start > e.at.slice(0, 10)));
        if ((r.status !== "pending" && r.status !== "approved") || !(mine || isHr)) {
          ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "only the person (before it starts) or HR cancels leave" });
          continue;
        }
        r.status = "cancelled";
        r.closed = { by: e.actor, at: e.at };
        continue;
      }
      const next = nextSigner(r, hr);
      if (!next?.people.includes(e.actor)) {
        ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "not the person who approves this step" });
        continue;
      }
      if (e.kind === "lv-return") {
        if (!(typeof data.note === "string" && data.note.trim().length >= 3)) {
          ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "sent back without a reason" });
          continue;
        }
        r.status = "returned";
        r.closed = { by: e.actor, at: e.at, note: data.note };
      } else {
        r.signatures.push({ step: next.step, by: e.actor, at: e.at, n: e.n });
        if (r.signatures.length === r.steps.length) r.status = "approved";
      }
    }
  }
  return { requests: [...byN.values()], ignored };
}

/* ---------------- Balances ---------------- */

export type BalanceView = {
  kind: LeaveKind;
  /** Earned or granted up to today, after the cap. */
  earned: number;
  taken: number;
  adjusted: number;
  /** Available now (hours). */
  available: number;
  /** Available once pending requests are approved. */
  afterPending: number;
  capHours: number | null;
  atCap: boolean;
  /** Earned per month now, for monthly kinds. */
  perMonth: number | null;
};

const monthKey = (d: string) => d.slice(0, 7);
const nextMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
};

/** Is this person anyone's supervisor? Managers earn the higher Home Office rate (PP §9.2). */
export const isManager = (person: string, hr: HrState) => Object.values(hr.people).some((p) => p.current.supervisor === person && !p.separated);

/**
 * One kind's balance, simulated month by month from the start date: earnings at each month end
 * (the hire month counts if the start is on or before the 15th, AF Ch.7E), capped; leave taken
 * on its first day; adjustments on their effective date; annual kinds reset each January.
 */
export function balanceOf(
  person: string,
  kind: LeaveKind,
  hr: HrState,
  requests: LeaveRequest[],
  adjustments: { kind: LeaveKind; hours: number; effective: string }[],
  today: string,
): BalanceView | null {
  const rec = hr.people[person]?.current;
  if (!rec) return null;
  const rule = RULES[groupOf(rec)].balances[kind];
  if (!rule) return null;
  const start = String(rec.startDate ?? today);
  const manager = isManager(person, hr);
  const mine = requests.filter((r) => r.person === person && r.kind === kind);
  const taken = mine.filter((r) => r.status === "approved");
  const pending = mine.filter((r) => r.status === "pending").reduce((s, r) => s + r.hours, 0);
  const adj = adjustments.filter((a) => a.kind === kind && a.effective <= today);
  const events: { date: string; hours: number; type: "earn" | "take" | "adjust" | "reset" }[] = [];
  const cap = rule.mode === "monthly" ? rule.capHours : rule.hours;
  if (rule.mode === "monthly") {
    let m = Number(start.slice(8, 10)) <= 15 ? monthKey(start) : nextMonth(monthKey(start));
    while (`${m}-28` <= today && m < monthKey(today)) {
      const years = daysBetween(start, `${m}-28`) / 365.25;
      events.push({ date: `${m}-31`, hours: rule.hoursPerMonth(years, manager), type: "earn" });
      m = nextMonth(m);
    }
  } else {
    for (let y = Number(start.slice(0, 4)); y <= Number(today.slice(0, 4)); y++) {
      const jan = `${y}-01-01`;
      const first = start > jan ? start : jan;
      // In the hire year, the grant is for the months left in the year.
      const months = first === start ? 12 - Number(start.slice(5, 7)) + (Number(start.slice(8, 10)) <= 15 ? 1 : 0) : 12;
      events.push({ date: first, hours: Math.round(((rule.hours * months) / 12) * 100) / 100, type: "reset" });
    }
  }
  for (const r of taken) if (r.start <= today) events.push({ date: r.start, hours: -r.hours, type: "take" });
  for (const a of adj) events.push({ date: a.effective, hours: a.hours, type: "adjust" });
  events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === "reset" ? -1 : 0));
  let bal = 0;
  let earned = 0;
  for (const ev of events) {
    if (ev.type === "reset") {
      bal = ev.hours;
      earned += ev.hours;
    } else if (ev.type === "earn") {
      const room = cap == null ? ev.hours : Math.max(0, Math.min(ev.hours, cap - bal));
      bal += room;
      earned += room;
    } else bal += ev.hours;
  }
  // Leave approved but not yet started comes off what is available now.
  const ahead = taken.filter((r) => r.start > today).reduce((s, r) => s + r.hours, 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const takenTotal = taken.reduce((s, r) => s + r.hours, 0);
  return {
    kind,
    earned: r2(earned),
    taken: r2(takenTotal),
    adjusted: r2(adj.reduce((s, a) => s + a.hours, 0)),
    available: r2(bal - ahead),
    afterPending: r2(bal - ahead - pending),
    capHours: cap,
    atCap: cap != null && rule.mode === "monthly" && bal >= cap - 0.001,
    perMonth: rule.mode === "monthly" ? r2(rule.hoursPerMonth(daysBetween(start, today) / 365.25, manager)) : null,
  };
}

/** What an approver should know about a request. */
export function warningsFor(r: LeaveRequest, hr: HrState, requests: LeaveRequest[], adjustments: { kind: LeaveKind; hours: number; effective: string }[], today: string): string[] {
  const out: string[] = [];
  const rule = RULES[r.group];
  const rec = hr.people[r.person]?.current ?? {};
  const days = r.hours / HOURS_PER_DAY;
  const notice = daysBetween(r.at.slice(0, 10), r.start);
  if (r.kind === "vacation" && notice < rule.notice) out.push(`Asked ${Math.max(0, notice)} days ahead; the policy expects ${rule.notice}.`);
  const start = String(rec.startDate ?? "");
  if (start && rule.noLeaveInProbation && r.kind === "vacation" && daysBetween(start, r.start) < rule.probationDays) out.push(`Starts during the ${rule.probationDays}-day probation, when annual leave cannot be used.`);
  if (r.kind === "sick" && days > rule.certificateAfter && !r.certificate) out.push(`More than ${rule.certificateAfter} days of sick leave without a doctor's certificate.`);
  const max = rule.maxConsecutive[r.kind];
  if (max && workingDays(r.start, r.end, r.office).length > max) out.push(`${TYPES[r.kind]} is at most ${max} days in a row.`);
  if (r.kind === "hajj" && start && daysBetween(start, r.start) < 5 * 365) out.push("Hajj leave needs 5 years' service.");
  if (r.kind === "hajj" && daysBetween(r.start, r.end) + 1 > 45) out.push(`Hajj leave is up to 45 calendar days; this is ${daysBetween(r.start, r.end) + 1}.`);
  if (r.kind === "parental" && r.group === "afghanistan" && daysBetween(r.start, r.end) + 1 > 105) out.push("Maternity leave is 90 days, or 105 with complications.");
  const bal = balanceOf(r.person, r.kind, hr, requests.filter((x) => x.n !== r.n), adjustments, today);
  if (bal && bal.afterPending - r.hours < -0.001) out.push(`More than the balance: ${(bal.afterPending / HOURS_PER_DAY).toFixed(1)} days left before this request.`);
  const overlap = requests.filter((x) => x.n !== r.n && x.person !== r.person && (x.status === "approved" || x.status === "pending") && x.start <= r.end && x.end >= r.start && hr.people[x.person]?.current.supervisor === rec.supervisor);
  if (overlap.length) out.push(`Also away then from the same team: ${overlap.map((x) => String(hr.people[x.person]?.current.name ?? x.person)).join(", ")}.`);
  return out;
}

/** Approved leave by day, for the timesheet prefill and check. */
export function leaveDays(requests: LeaveRequest[], person: string, month: string): Record<string, { type: TsLeave; hours: number; kind: LeaveKind }> {
  const out: Record<string, { type: TsLeave; hours: number; kind: LeaveKind }> = {};
  for (const r of requests.filter((x) => x.person === person && x.status === "approved" && x.start.slice(0, 7) <= month && x.end.slice(0, 7) >= month))
    for (const d of workingDays(r.start, r.end, r.office)) if (d.startsWith(month)) out[d] = { type: ON_TIMESHEET[r.kind], hours: r.half ? HOURS_PER_DAY / 2 : HOURS_PER_DAY, kind: r.kind };
  return out;
}
