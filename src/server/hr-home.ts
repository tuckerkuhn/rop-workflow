import { seesAll } from "@/lib/hr";
import { foldLeave } from "@/lib/leave";
import { foldOnboarding, progress } from "@/lib/onboarding";
import { foldTimesheets } from "@/lib/timesheet";
import { people } from "@/server/auth";
import { waitingFor } from "@/server/hr-view";
import { loadHr, todayIso } from "@/server/hr-store";
import { offboardingView } from "@/server/offboarding-view";

/**
 * Home for HR staff: are our people set up, paid and covered? Staff on record, this month's
 * timesheets and payroll, contracts ending, who is starting, leaving and away, and what is
 * waiting for this person. Counts and names only; no pay.
 */
export async function loadHrHome(me: string) {
  const { state: hr, entries, integrity } = await loadHr();
  if (!seesAll(me, hr)) return null;
  const today = todayIso();
  const month = today.slice(0, 7);
  const names = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  for (const p of Object.values(hr.people)) if (typeof p.current.name === "string") names[p.id] = p.current.name;
  const active = Object.values(hr.people).filter((p) => !p.separated || p.separated.effective >= today);

  // Timesheets this month: who has not submitted, and who is waiting for approval.
  const { sheets } = foldTimesheets(entries, hr);
  const thisMonth = sheets.filter((t) => t.month === month);
  const missing = active.filter((p) => !thisMonth.some((t) => t.person === p.id)).map((p) => names[p.id] ?? p.id);
  const pendingSheets = thisMonth.filter((t) => t.status === "pending").length;

  // This month's payroll, per pay group.
  const payroll = (["Home Office", "Afghanistan"] as const).map((group) => {
    const runs = hr.proposals.filter((p) => p.type === "payroll" && (p as { month: string }).month === month && (p as { group: string }).group === group);
    const main = runs.find((r) => !(r as { supplemental: boolean }).supplemental && r.status !== "rejected" && r.status !== "withdrawn");
    return { group, status: main ? main.status : "not_prepared" };
  });

  // Away now: approved leave covering today.
  const { requests } = foldLeave(entries, hr);
  const away = requests.filter((r) => r.status === "approved" && r.start <= today && r.end >= today).map((r) => ({ name: names[r.person] ?? r.person, until: r.end }));
  const leaveWaiting = requests.filter((r) => r.status === "pending").length;

  // Starting (onboarding open) and leaving, contracts ending.
  const { onboarding } = foldOnboarding(entries, hr);
  const starting = onboarding.filter((o) => progress(o).done < progress(o).total).map((o) => ({ name: names[o.person] ?? o.person, ...progress(o), due: o.due }));
  const off = await offboardingView(me);

  const waiting = waitingFor(me, hr);
  return {
    month,
    intact: integrity.ok,
    staff: active.length,
    timesheets: { missing, pending: pendingSheets, submitted: thisMonth.length, total: active.length },
    payroll,
    away,
    leaveWaiting,
    starting,
    leaving: off.leavers.filter((l) => l.steps.some((s) => !s.done)).map((l) => ({ name: l.name, effective: l.effective, open: l.steps.filter((s) => !s.done).length })),
    renewals: off.renewals,
    renewalDays: off.renewalDays,
    waiting,
    myLeavingSteps: off.leavers.reduce((n, l) => n + l.steps.filter((s) => s.canDo).length, 0),
  };
}
export type HrHomeView = NonNullable<Awaited<ReturnType<typeof loadHrHome>>>;
