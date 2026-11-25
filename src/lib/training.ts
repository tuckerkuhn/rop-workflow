import { z } from "zod";
import { fold, type Entry, type HrState } from "@/lib/hr";
import { receiptSchema } from "@/lib/expense";
import type { Onboarding } from "@/lib/onboarding";

/**
 * The training log, kept in the HR ledger like onboarding: each training given, each person's
 * priorities for the year, and a withdrawal when a record was made in error (nothing is erased).
 *
 * It carries out the Staff Training Policy: induction within 30 days of starting; a refresher on
 * anti-fraud and on the donors' rules at least once a year; up to three development priorities a
 * year agreed at the appraisal; and a log per person (date, topic, delivered by, hours and proof)
 * that a donor or auditor can be shown. The onboarding induction, confirmed by the supervisor,
 * counts as the induction.
 */

export const KINDS = {
  induction: "Induction",
  "anti-fraud": "Anti-fraud, anti-corruption and conflict of interest",
  "donor-rules": "A donor's rules",
  safeguarding: "Safeguarding (PSEA)",
  "finance-procurement": "Finance, procurement or compliance",
  other: "Other skills",
} as const;
export type Kind = keyof typeof KINDS;
export const KIND_KEYS = Object.keys(KINDS) as Kind[];

/** How it was given, in the policy's order of preference. */
export const METHODS = {
  coaching: "On-the-job coaching",
  "home-office": "Mentoring or a session from the Home Office",
  "free-course": "A free course or webinar from a donor or partner",
  "project-funded": "Paid from a project budget, with the donor's approval",
  "paid-external": "Other paid training, approved by the CEO first",
} as const;
export type Method = keyof typeof METHODS;
export const METHOD_KEYS = Object.keys(METHODS) as Method[];

const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const personId = z.string().regex(/^[a-z0-9-]{2,40}$/);

export const recordSchema = z
  .object({
    date: iso,
    kind: z.enum(KIND_KEYS as [Kind, ...Kind[]]),
    topic: z.string().trim().min(3).max(200),
    /** For a donor's rules: which donor. */
    donor: z.string().trim().max(120).optional(),
    deliveredBy: z.string().trim().min(2).max(120),
    method: z.enum(METHOD_KEYS as [Method, ...Method[]]),
    hours: z.number().min(0.25).max(200),
    /** The attendance sheet or certificate. */
    proof: receiptSchema.optional(),
    /** Paid external training: the day the CEO approved it, before it took place. */
    ceoApproved: iso.optional(),
  })
  .refine((r) => r.kind !== "donor-rules" || !!r.donor?.trim(), { message: "Name the donor whose rules were covered.", path: ["donor"] })
  .refine((r) => r.method !== "paid-external" || (!!r.ceoApproved && r.ceoApproved <= r.date), { message: "Paid external training needs the CEO's approval, dated before the training.", path: ["ceoApproved"] });
export type RecordInput = z.infer<typeof recordSchema>;

export const prioritySchema = z.object({ what: z.string().trim().min(3).max(200), how: z.string().trim().min(3).max(200) });
export const planSchema = z.object({ year: z.number().int().min(2020).max(2100), priorities: z.array(prioritySchema).min(1).max(3) });
export type PlanInput = z.infer<typeof planSchema>;

export const voidSchema = z.object({ record: z.number().int().positive(), why: z.string().trim().min(5).max(300) });
/** The day the training policy took effect: the log is read from then. */
export const startSchema = z.object({ effective: iso });

export const trainingActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("record"), person: personId, record: recordSchema }),
  z.object({ action: z.literal("plan"), person: personId, plan: planSchema }),
  z.object({ action: z.literal("start"), effective: iso }),
  z.object({ action: z.literal("void"), person: personId, record: z.number().int().positive(), why: z.string().trim().min(5).max(300) }),
]);
export type TrainingAction = z.infer<typeof trainingActionSchema>;

export type TrainingRecord = RecordInput & {
  n: number;
  person: string;
  by: string;
  at: string;
  /** Recorded by the person themselves: it needs its proof. */
  self: boolean;
  /** From the onboarding checklist, not typed here. */
  fromOnboarding?: boolean;
  voided?: { by: string; at: string; why: string };
};
export type Plan = PlanInput & { person: string; by: string; at: string; n: number };
export type TrainingIgnored = { n: number; kind: string; actor: string; why: string };

const isHr = (u: string, hr: HrState) => !!hr.rules?.holders.hr.includes(u);
const supervises = (u: string, person: string, hr: HrState) => hr.people[person]?.current.supervisor === u;

/** Operations (HR) and the supervisor record training for someone; a person may record their own, with its proof. */
export function mayRecord(u: string, person: string, hr: HrState): boolean {
  return !!hr.people[person] && (u === person || isHr(u, hr) || supervises(u, person, hr));
}
/** The year's priorities are agreed at the appraisal and written by the supervisor or HR. */
export function mayPlan(u: string, person: string, hr: HrState): boolean {
  return !!hr.people[person] && u !== person && (isHr(u, hr) || supervises(u, person, hr));
}

export function foldTraining(entries: Entry[], hr: HrState, onboarding: Onboarding[] = []): { records: TrainingRecord[]; plans: Plan[]; logStart: string; ignored: TrainingIgnored[] } {
  let logStart = "";
  const records = new Map<number, TrainingRecord>();
  const plans = new Map<string, Plan>();
  const ignored: TrainingIgnored[] = [];
  // Each entry is judged by who held which role when it was written, not today: a record made by
  // a former supervisor or HR holder stays. Today's state is tried first; the past is folded only
  // when it fails, once per entry.
  const past = new Map<number, HrState>();
  const at = (e: Entry) => {
    let st = past.get(e.n);
    if (!st) past.set(e.n, (st = fold(entries.filter((x) => x.n < e.n), e.at.slice(0, 10))));
    return st;
  };
  // People missing from the past state (hired by a later entry, or a test's state) keep today's record.
  const allowed = (e: Entry, check: (h: HrState) => boolean) => {
    if (check(hr)) return true;
    const then = at(e);
    return check({ ...then, people: { ...hr.people, ...then.people } });
  };
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (e.kind === "training-start") {
      const d = startSchema.safeParse(e.data);
      if (!d.success) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "unreadable" });
      else if (!allowed(e, (h) => isHr(e.actor, h))) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "only HR sets the day the policy took effect" });
      else logStart = d.data.effective;
    } else if (e.kind === "training") {
      const d = recordSchema.safeParse(e.data);
      if (!d.success || !e.subject) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "unreadable" });
      else if (!allowed(e, (h) => mayRecord(e.actor, e.subject!, h))) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "only the person, their supervisor or HR records training" });
      else if (e.actor === e.subject && !d.data.proof) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "training a person records for themselves needs its proof" });
      else records.set(e.n, { ...d.data, n: e.n, person: e.subject, by: e.actor, at: e.at, self: e.actor === e.subject });
    } else if (e.kind === "training-plan") {
      const d = planSchema.safeParse(e.data);
      if (!d.success || !e.subject) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "unreadable" });
      else if (!allowed(e, (h) => mayPlan(e.actor, e.subject!, h))) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "the supervisor or HR writes the year's priorities" });
      // A later plan for the same year replaces the earlier one; both stay in the ledger.
      else plans.set(`${e.subject}:${d.data.year}`, { ...d.data, person: e.subject, by: e.actor, at: e.at, n: e.n });
    } else if (e.kind === "training-void") {
      const d = voidSchema.safeParse(e.data);
      const r = d.success ? records.get(d.data.record) : undefined;
      if (!d.success || !r) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "no such training record" });
      else if (r.voided) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "already withdrawn" });
      else if (e.actor !== r.by && !allowed(e, (h) => isHr(e.actor, h))) ignored.push({ n: e.n, kind: e.kind, actor: e.actor, why: "only who recorded it, or HR, withdraws a record" });
      else r.voided = { by: e.actor, at: e.at, why: d.data.why };
    }
  }
  // The supervisor's confirmation of the induction in onboarding is the induction.
  const fromOnboarding: TrainingRecord[] = onboarding.flatMap((o) => {
    const d = o.done.induction;
    if (!d) return [];
    const note = d.value.kind === "confirm" && d.value.note ? `: ${d.value.note}` : "";
    return [{ n: d.n, person: o.person, by: d.by, at: d.at, self: false, fromOnboarding: true, date: d.at.slice(0, 10), kind: "induction" as Kind, topic: `Project induction, confirmed in onboarding${note}`.slice(0, 200), deliveredBy: d.by, method: "coaching" as Method, hours: 0.25 }];
  });
  return { records: [...records.values(), ...fromOnboarding].sort((a, b) => b.date.localeCompare(a.date) || b.n - a.n), plans: [...plans.values()], logStart, ignored };
}

/* ---------------- What is due ---------------- */

export const INDUCTION_DAYS = 30;
export const REFRESHER_DAYS = 365;

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

export type Due = { state: "done" | "due" | "overdue" | "unknown"; by: string; last: string };
export type Standing = {
  person: string;
  induction: Due;
  antiFraud: Due;
  donorRules: Due;
  plan: { year: number; agreed: boolean };
  hoursThisYear: number;
  last: string;
  overdue: number;
};

/**
 * Where one person stands under the policy today. Induction is due 30 days after starting; the two
 * refreshers a year after the last one (the induction covers both, as the policy's induction does).
 * Someone who started before the log and has nothing recorded is "unknown", not overdue: the log
 * starts when the policy does.
 */
export function standing(person: string, startDate: string, records: TrainingRecord[], plans: Plan[], today: string, logStart?: string): Standing {
  const mine = records.filter((r) => r.person === person && !r.voided);
  const lastOf = (kinds: Kind[]) => mine.filter((r) => kinds.includes(r.kind)).map((r) => r.date).sort().pop() ?? "";
  const started = startDate || "";
  const firstDue = started ? addDays(started, INDUCTION_DAYS) : "";
  // Before the log started, missing history is not a finding.
  const inScope = !!started && !!logStart && started >= logStart;
  const due = (last: string, every: number | null): Due => {
    if (last) {
      if (every === null) return { state: "done", by: "", last };
      const by = addDays(last, every);
      return { state: by < today ? "overdue" : by <= addDays(today, 30) ? "due" : "done", by, last };
    }
    if (!inScope) {
      // An older hand with no record: the refresher is due from the day the log started.
      if (every !== null && logStart) {
        const by = addDays(logStart, every);
        return { state: by < today ? "overdue" : "due", by, last: "" };
      }
      return { state: "unknown", by: "", last: "" };
    }
    return { state: firstDue < today ? "overdue" : "due", by: firstDue, last: "" };
  };
  const induction = due(lastOf(["induction"]), null);
  const antiFraud = due(lastOf(["anti-fraud", "induction"]), REFRESHER_DAYS);
  const donorRules = due(lastOf(["donor-rules", "induction"]), REFRESHER_DAYS);
  const year = Number(today.slice(0, 4));
  const agreed = plans.some((p) => p.person === person && p.year === year);
  const hoursThisYear = Math.round(mine.filter((r) => r.date.startsWith(String(year))).reduce((s, r) => s + r.hours, 0) * 100) / 100;
  return {
    person,
    induction,
    antiFraud,
    donorRules,
    plan: { year, agreed },
    hoursThisYear,
    last: mine.map((r) => r.date).sort().pop() ?? "",
    overdue: [induction, antiFraud, donorRules].filter((d) => d.state === "overdue").length,
  };
}

/** The log as a spreadsheet, for a donor or auditor: one row per training, withdrawn ones marked. */
export function logRows(records: TrainingRecord[], name: (id: string) => string): { headers: string[]; rows: string[][] } {
  return {
    headers: ["Person", "Date", "Training", "Topic", "Donor", "Delivered by", "How", "Hours", "Proof", "Recorded by", "Recorded on", "Withdrawn"],
    rows: records.map((r) => [
      name(r.person),
      r.date,
      KINDS[r.kind],
      r.topic,
      r.donor ?? "",
      r.fromOnboarding ? name(r.deliveredBy) : r.deliveredBy,
      METHODS[r.method],
      r.fromOnboarding ? "" : String(r.hours),
      r.proof ? r.proof.name : r.fromOnboarding ? "Onboarding checklist" : "",
      name(r.by),
      r.at.slice(0, 10),
      r.voided ? `${r.voided.at.slice(0, 10)}: ${r.voided.why}` : "",
    ]),
  };
}
