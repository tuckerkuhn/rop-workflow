import { seesAll, type HrState } from "@/lib/hr";
import { foldLeave, type LeaveKind } from "@/lib/leave";
import { foldOffboarding, leavePayout, mayDoOff, OFF_STEPS } from "@/lib/offboarding";
import { people } from "@/server/auth";
import { loadHr, todayIso } from "@/server/hr-store";

/** How far ahead contract ends are flagged. */
export const RENEWAL_DAYS = 60;

function adjustmentsOf(hr: HrState, person: string) {
  return hr.proposals
    .filter((p) => p.type === "leave-adjust" && p.status === "approved" && p.subject === person)
    .map((p) => {
      const a = p as { leave: LeaveKind; hours: number; effective: string };
      return { kind: a.leave, hours: a.hours, effective: a.effective };
    });
}

/**
 * Leavers and contracts ending, for one viewer. HR, payroll and the other HR roles see everyone;
 * a supervisor sees their own team. Final pay figures are shown only to HR roles.
 */
export async function offboardingView(me: string) {
  const { state: hr, entries } = await loadHr();
  const { requests } = foldLeave(entries, hr);
  const today = todayIso();
  const all = seesAll(me, hr);
  const names = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  for (const p of Object.values(hr.people)) if (typeof p.current.name === "string") names[p.id] = p.current.name;
  const visible = (person: string) => all || hr.people[person]?.current.supervisor === me;
  const leavers = foldOffboarding(entries, hr)
    .filter((o) => visible(o.person))
    // Finished more than 90 days ago: out of the list.
    .filter((o) => OFF_STEPS.some((s) => !o.done[s.id]) || o.effective >= new Date(Date.now() - 90 * 86400000).toISOString().slice(0, 10))
    .map((o) => ({
      person: o.person,
      name: names[o.person] ?? o.person,
      title: String(hr.people[o.person]?.current.title ?? ""),
      effective: o.effective,
      reason: all ? o.reason : "",
      // HR roles see every note; a supervisor sees the notes of their own two steps only (final
      // pay, the exit interview and equipment notes stay with HR).
      steps: OFF_STEPS.map((def) => {
        const d = o.done[def.id];
        const showNote = all || def.owner === "supervisor";
        return { ...def, done: d ? { ...d, note: showNote ? d.note : "", byName: names[d.by] ?? d.by } : null, canDo: !d && mayDoOff(me, def.owner, o.person, hr) };
      }),
      payout: all ? leavePayout(o.person, hr, requests, adjustmentsOf(hr, o.person), o.effective) : null,
    }));
  const soon = new Date(Date.now() + RENEWAL_DAYS * 86400000).toISOString().slice(0, 10);
  const renewals = Object.values(hr.people)
    .filter((p) => !p.separated && typeof p.current.contractEnd === "string" && p.current.contractEnd && p.current.contractEnd <= soon && visible(p.id))
    .map((p) => ({ person: p.id, name: names[p.id] ?? p.id, title: String(p.current.title ?? ""), contractEnd: String(p.current.contractEnd), overdue: String(p.current.contractEnd) < today, supervisor: names[String(p.current.supervisor ?? "")] ?? "" }))
    .sort((a, b) => a.contractEnd.localeCompare(b.contractEnd));
  return { me, today, isHr: !!hr.rules?.holders.hr.includes(me), seesAll: all, leavers, renewals, renewalDays: RENEWAL_DAYS };
}
export type OffboardingView = Awaited<ReturnType<typeof offboardingView>>;
