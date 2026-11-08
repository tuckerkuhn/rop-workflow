import { z } from "zod";
import { DEFAULT_PAYOUT, type Entry, type HrState, type Payout, type PayoutGroup } from "@/lib/hr";
import { balanceOf, groupOf, type LeaveKind, type LeaveRequest } from "@/lib/leave";
import { HOURS_PER_DAY } from "@/lib/timesheet";
import { AVERAGE_DAYS } from "@/lib/payroll";

/**
 * Offboarding: what has to happen when someone leaves, once their leaving is approved in the HR
 * record. Each step is an entry in the HR ledger, done by the person who owns it: the supervisor
 * for the handover and the last timesheet, HR for equipment, access and the exit interview,
 * payroll for the final pay (with unused leave worked out from the HR setting). Nothing is
 * started by hand: an approved departure starts it.
 */

export type OffOwner = "supervisor" | "hr" | "payroll";
export type OffStep = { id: string; title: string; help: string; owner: OffOwner; needsNote: boolean };

export const OFF_STEPS: OffStep[] = [
  { id: "handover", title: "Handover", help: "Work, files and contacts handed over; where they are now (SharePoint folder, who took over each activity).", owner: "supervisor", needsNote: true },
  { id: "timesheet", title: "Last timesheet approved", help: "The final month's timesheet, up to the last day, approved so the last pay and charges are right.", owner: "supervisor", needsNote: false },
  { id: "equipment", title: "Equipment and ID card returned", help: "Laptop, phone, vehicle, keys and the ROP ID card; note anything not returned and what was agreed.", owner: "hr", needsNote: true },
  { id: "access", title: "Email, SharePoint and app access closed", help: "IT closes the email account and SharePoint; an administrator deactivates the person in Settings → People on the last day.", owner: "hr", needsNote: true },
  { id: "finalPay", title: "Final pay worked out", help: "Pay to the last day, unused annual leave as the HR setting says, less advances. Goes into the leaver's last payroll.", owner: "payroll", needsNote: true },
  { id: "exit", title: "Exit interview", help: "Why they are leaving and what could be better. Write \"declined\" if they did not want one.", owner: "hr", needsNote: true },
];
export const OFF_OWNER_LABEL: Record<OffOwner, string> = { supervisor: "Supervisor", hr: "HR", payroll: "Payroll" };

export const offActionSchema = z.object({
  person: z.string().regex(/^[a-z0-9-]{2,40}$/),
  step: z.enum(OFF_STEPS.map((s) => s.id) as [string, ...string[]]),
  note: z.string().trim().max(1500).default(""),
});
export type OffAction = z.infer<typeof offActionSchema>;

export type OffDone = { by: string; at: string; n: number; note: string };
export type Offboarding = { person: string; effective: string; reason: string; done: Record<string, OffDone> };

export function mayDoOff(u: string, owner: OffOwner, person: string, hr: HrState): boolean {
  if (u === person) return false;
  if (owner === "hr") return !!hr.rules?.holders.hr.includes(u);
  if (owner === "payroll") return !!hr.rules?.holders.payroll.includes(u);
  return hr.people[person]?.current.supervisor === u;
}

/** Everyone whose departure is approved, with the steps done so far. Entries that break a rule are skipped. */
export function foldOffboarding(entries: Entry[], hr: HrState): Offboarding[] {
  const list = new Map<string, Offboarding>();
  for (const p of Object.values(hr.people)) if (p.separated) list.set(p.id, { person: p.id, effective: p.separated.effective, reason: p.separated.reason, done: {} });
  for (const e of [...entries].sort((a, b) => a.n - b.n)) {
    if (e.kind !== "offboard-step" || !e.subject) continue;
    const o = list.get(e.subject);
    const d = offActionSchema.safeParse({ person: e.subject, ...(e.data as object) });
    if (!o || !d.success) continue;
    const def = OFF_STEPS.find((s) => s.id === d.data.step)!;
    if (o.done[def.id] || !mayDoOff(e.actor, def.owner, o.person, hr) || (def.needsNote && d.data.note.length < 3)) continue;
    o.done[def.id] = { by: e.actor, at: e.at, n: e.n, note: d.data.note };
  }
  return [...list.values()].sort((a, b) => a.effective.localeCompare(b.effective));
}

/** Annual leave owed on the last day, from the HR setting for the person's group. */
export function leavePayout(
  person: string,
  hr: HrState,
  requests: LeaveRequest[],
  adjustments: { kind: LeaveKind; hours: number; effective: string }[],
  lastDay: string,
): { group: string; rule: Payout; days: number; paidDays: number; dailyRate: number | null; amount: number | null; currency: string; note: string } {
  const rec = hr.people[person]?.current ?? {};
  const g = groupOf(rec);
  const rule = g === "none" ? { rule: "none" as const, capDays: null, source: "Consultants do not earn paid leave" } : (hr.rules?.leavePayout?.[g as PayoutGroup] ?? DEFAULT_PAYOUT[g as PayoutGroup]);
  const bal = balanceOf(person, "vacation", hr, requests, adjustments, lastDay);
  const days = bal ? Math.max(0, Math.round((bal.available / HOURS_PER_DAY) * 100) / 100) : 0;
  const paidDays = rule.rule === "pays" ? (rule.capDays == null ? days : Math.min(days, rule.capDays)) : 0;
  const pay = Number(rec.pay ?? 0);
  const basis = String(rec.payBasis ?? "Month");
  // A working day, as payroll counts it: a month's pay over the average working days, a day's pay, or eight hours.
  const dailyRate = pay > 0 ? Math.round((basis === "Month" ? pay / AVERAGE_DAYS : basis === "Day" ? pay : pay * HOURS_PER_DAY) * 100) / 100 : null;
  const amount = rule.rule === "pays" && dailyRate !== null ? Math.round(paidDays * dailyRate * 100) / 100 : rule.rule === "none" ? 0 : null;
  const note =
    rule.rule === "unset"
      ? `HR has not set whether unused leave is paid out for this group (${rule.source}). Set it in the authority table before the final pay.`
      : rule.rule === "none"
        ? `Unused leave is not paid out (${rule.source}).`
        : `${paidDays} of ${days} days unused${rule.capDays != null && days > rule.capDays ? `, capped at ${rule.capDays}` : ""} × ${dailyRate ?? "?"} a day (${rule.source}).`;
  return { group: g, rule, days, paidDays, dailyRate, amount, currency: String(rec.currency ?? "USD"), note };
}
