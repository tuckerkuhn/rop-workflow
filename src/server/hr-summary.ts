import { foldExpenses } from "@/lib/expense";
import type { HrState } from "@/lib/hr";
import { balanceOf, foldLeave, type LeaveKind } from "@/lib/leave";
import { foldOnboarding, progress } from "@/lib/onboarding";
import { foldTimesheets } from "@/lib/timesheet";
import { loadHr, todayIso } from "@/server/hr-store";
import { loadAway } from "@/server/away-store";

/**
 * The person's own HR admin for the Home card, in one answer: what the four `?summary=1` answers
 * (timesheets, expenses, onboarding, leave) gave the card, computed the same way from one read of
 * the HR ledger. Only the person's own records: nothing about anyone else.
 */
export type HrSummary = {
  timesheet: { hasRecord: boolean; month: string; status: string };
  expenses: { hasRecord: boolean; returned: number };
  leave: { hasRecord: boolean; annualDays: number | null; returned: number };
  onboarding: { mine: { done: number; total: number } | null };
};

/** As in api/leave: approved balance adjustments for a person. */
function adjustmentsOf(hr: HrState, person: string) {
  return hr.proposals
    .filter((p) => p.type === "leave-adjust" && p.status === "approved" && p.subject === person)
    .map((p) => {
      const a = p as { leave: LeaveKind; hours: number; effective: string };
      return { kind: a.leave, hours: a.hours, effective: a.effective };
    });
}

export async function hrSummary(me: string): Promise<HrSummary> {
  const { state: hr, entries } = await loadHr();
  const today = todayIso();
  const month = today.slice(0, 7);
  const hasRecord = !!hr.people[me];

  const { sheets } = foldTimesheets(entries, hr, await loadAway().catch(() => null));
  const sheet = sheets.find((t) => t.person === me && t.month === month);

  const { reports } = foldExpenses(entries, hr);

  const { requests } = foldLeave(entries, hr);
  // api/leave lists the balances of the person's group and picks "vacation"; balanceOf is null when the group has none.
  const annual = hasRecord ? balanceOf(me, "vacation", hr, requests, adjustmentsOf(hr, me), today) : null;

  const own = foldOnboarding(entries, hr).onboarding.find((o) => o.person === me);

  return {
    timesheet: { hasRecord, month, status: sheet?.status ?? "missing" },
    expenses: { hasRecord, returned: reports.filter((r) => r.person === me && r.status === "returned").length },
    leave: { hasRecord, annualDays: annual ? Math.round((annual.available / 8) * 10) / 10 : null, returned: requests.filter((r) => r.person === me && r.status === "returned").length },
    onboarding: { mine: own ? progress(own) : null },
  };
}
