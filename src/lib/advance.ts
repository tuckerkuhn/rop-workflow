import { z } from "zod";
import type { Entry, HrState } from "@/lib/hr";
import { actedFor, type AwayState } from "@/lib/delegation";
import { receiptSchema } from "@/lib/expense";

/**
 * Advances (review round 1, MF-02; Q3 audit finding 1). A person asks for an advance for a
 * purpose; their supervisor approves; Finance pays it to that person only (never a colleague or a
 * supplier), recording how and when. From the day it is paid it has an age, and a settlement
 * deadline: 15 days on UN-funded projects, the travel policy in Guatemala, 30 days otherwise
 * (decision D-04; the project's rule `advanceSettlementDays`). The holder settles with receipts;
 * Finance accepts the settlement; what was not spent is returned, or recovered from pay.
 *
 * Every step is an entry in the HR ledger, like expense reports. Kinds: "adv-request",
 * "adv-approve", "adv-pay", "adv-settle", "adv-accept", "adv-return", "adv-recover".
 */

export const DEFAULT_SETTLE_DAYS = 30;
const iso = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const requestSchema = z.object({
  amount: z.number().positive("Enter the amount.").max(1e8),
  currency: z.enum(["USD", "AFN", "GTQ"]),
  purpose: z.string().trim().min(5, "Say what the advance is for.").max(500),
  /** The project it is spent for, or the general fund. */
  source: z.string().regex(/^[A-Za-z0-9-]{2,40}$/),
  neededBy: iso,
});
export const paySchema = z.object({ advance: z.number().int().positive(), paidOn: iso, method: z.enum(["bank", "cash", "mobile"]), reference: z.string().trim().min(2, "Give the bank or receipt reference.").max(200), payee: z.string().regex(/^[a-z0-9-]{2,40}$/) });
export const settleSchema = z.object({
  advance: z.number().int().positive(),
  lines: z.array(z.object({ date: iso, description: z.string().trim().min(2).max(300), amount: z.number().min(0).max(1e8), receipts: z.array(receiptSchema).max(10), noReceipt: z.string().trim().max(300).optional() })).max(100),
  /** Cash handed back to Finance with the settlement. */
  returned: z.number().min(0).max(1e8),
});
export const advActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("request"), request: requestSchema }),
  z.object({ action: z.literal("approve"), advance: z.number().int().positive() }),
  z.object({ action: z.literal("pay"), payment: paySchema }),
  z.object({ action: z.literal("settle"), settlement: settleSchema }),
  z.object({ action: z.literal("accept"), advance: z.number().int().positive() }),
  z.object({ action: z.literal("return"), advance: z.number().int().positive(), note: z.string().trim().min(3).max(1000) }),
  /** Finance recovers what was not spent and not returned, from the holder's pay. */
  z.object({ action: z.literal("recover"), advance: z.number().int().positive(), amount: z.number().positive().max(1e8) }),
]);
export type AdvAction = z.infer<typeof advActionSchema>;

export type AdvStatus = "requested" | "approved" | "paid" | "settling" | "settled";
export type Advance = {
  n: number;
  person: string;
  at: string;
  request: z.infer<typeof requestSchema>;
  status: AdvStatus;
  approvedBy?: string;
  paid?: { on: string; method: string; reference: string; by: string };
  settlement?: z.infer<typeof settleSchema> & { at: string };
  returnedNote?: string;
  acceptedBy?: string;
  recovered: number;
};
export type AdvIgnored = { n: number; kind: string; why: string };

const r2 = (x: number) => Math.round(x * 100) / 100;
const isFinance = (u: string, hr: HrState) => !!(hr.rules?.holders.finance?.includes(u) || hr.rules?.holders.payroll?.includes(u));
const supervisorOf = (p: string, hr: HrState) => hr.people[p]?.current.supervisor as string | undefined;

/** Spent on the settlement's receipts. */
export const spentOf = (a: Advance) => r2((a.settlement?.lines ?? []).reduce((t, l) => t + l.amount, 0));
/** Still owed back: the advance less what was spent, returned and recovered. Never below zero. */
export const owedOf = (a: Advance) => (a.status === "settled" || a.status === "settling" ? Math.max(0, r2(a.request.amount - spentOf(a) - (a.settlement?.returned ?? 0) - a.recovered)) : 0);

export function foldAdvances(entries: Entry[], hr: HrState, away?: AwayState | null): { advances: Advance[]; ignored: AdvIgnored[] } {
  const advances = new Map<number, Advance>();
  const ignored: AdvIgnored[] = [];
  const no = (e: Entry, why: string) => ignored.push({ n: e.n, kind: e.kind, why });
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (!e.kind.startsWith("adv-")) continue;
    const d = e.data as Record<string, unknown>;
    if (e.kind === "adv-request") {
      const p = requestSchema.safeParse(d);
      if (!p.success || !e.subject) no(e, "unreadable");
      else if (e.actor !== e.subject) no(e, "a person asks for their own advance");
      // R2-14: one open advance per person. One not yet settled, or settled with money still owed, comes first.
      else if ([...advances.values()].some((x) => x.person === e.subject && (["requested", "approved", "paid", "settling"].includes(x.status) || owedOf(x) > 0))) no(e, "settle the open advance, and pay back what is owed, before asking for another");
      else advances.set(e.n, { n: e.n, person: e.subject, at: e.at, request: p.data, status: "requested", recovered: 0 });
      continue;
    }
    const a = advances.get(Number(d.advance));
    if (!a) {
      no(e, "no such advance");
      continue;
    }
    if (e.kind === "adv-approve") {
      const sup = supervisorOf(a.person, hr);
      if (a.status !== "requested") no(e, "not waiting for approval");
      else if (e.actor === a.person) no(e, "nobody approves their own advance");
      // The supervisor's delegate approves while they are away (R2-16, MF-01).
      // A delegate's approval carries whom it was for, checked against time away when written (R2-16).
      else if (!(e.actor === sup || (!!sup && (d.onBehalfOf === sup || (d.onBehalfOf === undefined && actedFor(away, e.actor, sup, e.at.slice(0, 10))))) || (!sup && hr.rules?.holders.hr.includes(e.actor)))) no(e, "the supervisor approves (HR when there is none), or the person acting for them while they are away");
      else if (hr.relations.some((r) => (r.a === e.actor && r.b === a.person) || (r.b === e.actor && r.a === a.person))) no(e, "a declared relation: someone else approves");
      else Object.assign(a, { status: "approved", approvedBy: e.actor });
    } else if (e.kind === "adv-pay") {
      const p = paySchema.safeParse(d);
      if (!p.success) no(e, "unreadable");
      else if (a.status !== "approved") no(e, "not approved yet");
      else if (!isFinance(e.actor, hr)) no(e, "Finance pays advances");
      // R2-09: Finance never pays their own advance; another Finance person does.
      else if (e.actor === a.person) no(e, "another Finance person pays your own advance");
      else if (p.data.payee !== a.person) no(e, "an advance is paid only to the person who holds it");
      else Object.assign(a, { status: "paid", paid: { on: p.data.paidOn, method: p.data.method, reference: p.data.reference, by: e.actor } });
    } else if (e.kind === "adv-settle") {
      const p = settleSchema.safeParse(d);
      if (!p.success) no(e, "unreadable");
      else if (e.actor !== a.person) no(e, "the holder settles their own advance");
      else if (a.status !== "paid") no(e, "not paid, or already settling");
      else Object.assign(a, { status: "settling", settlement: { ...p.data, at: e.at }, returnedNote: undefined });
    } else if (e.kind === "adv-accept") {
      if (a.status !== "settling") no(e, "no settlement waiting");
      else if (!isFinance(e.actor, hr) || e.actor === a.person) no(e, "Finance accepts a settlement, never the holder's own");
      else Object.assign(a, { status: "settled", acceptedBy: e.actor });
    } else if (e.kind === "adv-return") {
      if (a.status !== "settling") no(e, "no settlement waiting");
      else if (!isFinance(e.actor, hr)) no(e, "Finance returns a settlement");
      else Object.assign(a, { status: "paid", returnedNote: String(d.note ?? ""), settlement: undefined });
    } else if (e.kind === "adv-recover") {
      if (a.status !== "settled") no(e, "recovered only once the settlement is accepted");
      else if (!isFinance(e.actor, hr)) no(e, "Finance recovers");
      else a.recovered = r2(a.recovered + Number(d.amount ?? 0));
    } else no(e, "unknown kind of entry");
  }
  return { advances: [...advances.values()], ignored };
}

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Its age in days since paid, the day it must be settled by, and whether that day has passed. */
export function ageOf(a: Advance, today: string, settleDays = DEFAULT_SETTLE_DAYS) {
  if (!a.paid) return null;
  const due = addDays(a.paid.on, settleDays);
  return { days: days(a.paid.on, today), due, overdue: a.status === "paid" && today > due };
}

/** A settlement's arithmetic, in words, for Finance before accepting: spent plus returned must not exceed the advance. */
export function settlementProblem(a: Advance, s: z.infer<typeof settleSchema>): string | null {
  const spent = r2(s.lines.reduce((t, l) => t + l.amount, 0));
  if (r2(spent + s.returned) > a.request.amount) return `Spent ${spent} and returned ${s.returned} come to more than the advance of ${a.request.amount}. Put the extra in an expense report instead.`;
  const missing = s.lines.findIndex((l) => !l.receipts.length && (l.noReceipt ?? "").length < 5);
  if (missing >= 0) return `Line ${missing + 1}: attach the receipt, or say why there is none.`;
  return null;
}
