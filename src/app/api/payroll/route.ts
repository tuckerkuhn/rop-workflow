import { NextResponse } from "next/server";
import { z } from "zod";
import { db, schema as s } from "@/db";
import { mayPropose, nextSigners, rolesOf, seesAll, toYou, conflictOf, warningsFor, type HrState, type Proposal } from "@/lib/hr";
import { GROUPS, PAID_BY, adjustmentSchema, differences, register, totals, type Group, type Line } from "@/lib/payroll";
import { NON_CONTRACT, daysIn, foldTimesheets, weekday, WORK_WEEK } from "@/lib/timesheet";
import { foldExpenses, toPayroll, unpaid, type ExpenseReport } from "@/lib/expense";
import { people, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, loadHr, todayIso } from "@/server/hr-store";

/**
 * Monthly payroll per pay group. The server works out every line from the HR record and the
 * approved timesheets; the preparer only adds adjustments, each with a reason. The run goes into
 * the HR ledger and is signed by the CFO and the CEO (or whoever the rules name).
 * Only people holding an HR role see payroll.
 */

const monthOk = (m: string | null) => (m && /^\d{4}-\d{2}$/.test(m) ? m : todayIso().slice(0, 7));
const groupOk = (g: string | null): Group => (GROUPS as readonly string[]).includes(g ?? "") ? (g as Group) : "Home Office";

/** The last working day of the month in the group's office: the usual pay date. */
const payDay = (month: string, group: Group) => [...daysIn(month)].reverse().find((d) => (WORK_WEEK[group] ?? WORK_WEEK["Home Office"]).includes(weekday(d)))!;

/** Accepted expense reports not yet in a payroll that is approved or waiting, for people in this group. */
function owed(hr: HrState, reports: ExpenseReport[], people: string[]) {
  const paidIn = new Set<number>();
  for (const p of hr.proposals) if (p.type === "payroll" && (p.status === "approved" || p.status === "pending")) for (const l of p.lines as unknown as Line[]) for (const n of l.expenseReports ?? []) paidIn.add(n);
  return toPayroll(unpaid(reports, paidIn).filter((r) => people.includes(r.person)));
}

async function view(me: string, month: string, group: Group) {
  const { state: hr, entries } = await loadHr();
  const { sheets } = foldTimesheets(entries, hr);
  const { reports } = foldExpenses(entries, hr);
  const projects = await db.select({ code: s.projects.code, name: s.projects.name }).from(s.projects);
  const sources: Record<string, string> = { [NON_CONTRACT]: "General and admin (non-contract)" };
  for (const p of projects) if (p.code) sources[p.code] = p.name;
  const runs = hr.proposals.filter((p): p is Proposal & { type: "payroll" } => p.type === "payroll" && p.month === month && p.group === group).sort((a, b) => b.id - a.id);
  const groupPeople = Object.keys(hr.people).filter((id) => String(hr.people[id].current.office) === group);
  const now = register(hr, sheets, group, month, {}, false, owed(hr, reports, groupPeople));
  const names: Record<string, string> = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  for (const p of Object.values(hr.people)) names[p.id] = String(p.current.name ?? p.id);
  return {
    me,
    month,
    group,
    paidBy: PAID_BY[group],
    payDate: payDay(month, group),
    canPrepare: rolesOf(me, hr).includes("payroll"),
    names,
    sources,
    draft: now,
    draftTotals: totals(now),
    runs: runs.map((r) => {
      const lines = r.lines as unknown as Line[];
      const next = nextSigners(r, hr);
      const conflict = next && !next.people.includes(me) ? conflictOf(me, r, hr) : null;
      const again = register(hr, sheets, group, month, Object.fromEntries(lines.map((l) => [l.person, { bonus: l.bonus, retro: l.retro, vacationPayout: l.vacationPayout, medicalReimb: l.medicalReimb, expenses: l.expenses, advance: l.advance, note: l.note ?? undefined }])), r.supplemental, toPayroll(reports.filter((x) => lines.some((l) => (l.expenseReports ?? []).includes(x.n)))));
      return {
        id: r.id,
        at: r.at,
        by: r.by,
        status: r.status,
        supplemental: r.supplemental,
        payDate: r.effective,
        reason: r.reason,
        roles: r.roles,
        signatures: r.signatures,
        closedBy: r.closedBy ?? null,
        lines,
        totals: totals(lines),
        warnings: warningsFor(r, hr),
        // Anything that would come out differently today: a revised timesheet or record, or a changed calculation.
        changedSince: r.status === "rejected" || r.status === "withdrawn" ? [] : differences(lines, again),
        next,
        canSign: !!next?.people.includes(me),
        cannotSign: conflict ? toYou(conflict) : null,
        canWithdraw: r.status === "pending" && r.by === me,
      };
    }),
  };
}
export type PayrollView = Awaited<ReturnType<typeof view>>;

const gate = (hr: HrState, me: string) => seesAll(me, hr);

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const { state } = await loadHr();
    if (!gate(state, v.user.id)) return NextResponse.json({ error: "Payroll is open to people holding an HR role." }, { status: 403 });
    const q = new URL(req.url).searchParams;
    return NextResponse.json(await view(v.user.id, monthOk(q.get("month")), groupOk(q.get("group"))));
  });
}

const prepareSchema = z.object({
  action: z.enum(["prepare", "preview"]),
  month: z.string().regex(/^\d{4}-\d{2}$/),
  group: z.enum(GROUPS),
  payDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  supplemental: z.boolean(),
  adjustments: z.record(z.string().regex(/^[a-z0-9-]{2,40}$/), adjustmentSchema),
  reason: z.string().trim().max(2000),
});

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = prepareSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That payroll is not complete." }, { status: 400 });
    const a = parsed.data;
    const me = v.user.id;
    const { state: hr, entries } = await loadHr();
    const { reports } = foldExpenses(entries, hr);
    if (!gate(hr, me)) return NextResponse.json({ error: "Payroll is open to people holding an HR role." }, { status: 403 });
    const { sheets } = foldTimesheets(entries, hr);
    if (a.month > todayIso().slice(0, 7)) return NextResponse.json({ error: "A payroll can be prepared once its month has started." }, { status: 400 });
    // The server works out every amount; only the adjustments come from the preparer.
    const groupPeople = Object.keys(hr.people).filter((id) => String(hr.people[id].current.office) === a.group);
    const lines = register(hr, sheets, a.group, a.month, a.adjustments, a.supplemental, owed(hr, reports, groupPeople));
    // Preview: the same calculation, written nowhere.
    if (a.action === "preview") return NextResponse.json({ lines, totals: totals(lines) });
    if (!lines.length) return NextResponse.json({ error: a.supplemental ? "Enter at least one adjustment, or wait for an accepted expense report." : "Nobody is in this payroll." }, { status: 400 });
    if (a.reason.length < 3) return NextResponse.json({ error: "Say what this payroll covers." }, { status: 400 });
    const proposal = { type: "payroll" as const, subject: null, effective: a.payDate, month: a.month, group: a.group, supplemental: a.supplemental, lines, reason: a.reason };
    const why = mayPropose(me, proposal, hr);
    if (why) return NextResponse.json({ error: why }, { status: 403 });
    const n = await append(me, "propose", null, proposal);
    const after = await loadHr();
    const bad = after.state.ignored.find((x) => x.n === n);
    if (bad) return NextResponse.json({ error: `Recorded as entry ${n} but it does not count: ${bad.why}.` }, { status: 409 });
    return NextResponse.json({ n, view: await view(me, a.month, a.group) });
  });
}
