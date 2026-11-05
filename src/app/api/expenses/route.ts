import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { seesAll, toYou, type HrState } from "@/lib/hr";
import { exActionSchema, flags, foldExpenses, nextFor, summary, whyNot, type ExpenseReport } from "@/lib/expense";
import type { Line } from "@/lib/payroll";
import { NON_CONTRACT } from "@/lib/timesheet";
import { people, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, hrBook, loadHr, todayIso } from "@/server/hr-store";

/**
 * Expense reports, from the HR ledger. Everyone sees their own; supervisors their team's; people
 * holding an HR role see all. The supervisor approves, Finance accepts, payroll reimburses.
 */

/** Which payroll paid each report, and whether that payroll is approved yet. */
function paidIn(hr: HrState) {
  const out = new Map<number, { run: number; status: string; month: string }>();
  for (const p of hr.proposals)
    if (p.type === "payroll" && (p.status === "approved" || p.status === "pending"))
      for (const l of p.lines as unknown as Line[]) for (const n of l.expenseReports ?? []) out.set(n, { run: p.id, status: p.status, month: p.month });
  return out;
}

async function view(me: string, open: number | null) {
  const { state: hr, entries } = await loadHr();
  const { reports } = foldExpenses(entries, hr);
  const all = seesAll(me, hr);
  const visible = reports.filter((r) => all || r.person === me || hr.people[r.person]?.current.supervisor === me || !!nextFor(r, hr)?.people.includes(me) || r.signatures.some((x) => x.by === me));
  const projects = await db.select({ code: s.projects.code, name: s.projects.name }).from(s.projects);
  const sources = [{ id: NON_CONTRACT, label: "General and admin (non-contract)" }, ...projects.filter((p) => p.code).map((p) => ({ id: p.code!, label: p.name }))];
  const names = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  for (const p of Object.values(hr.people)) if (typeof p.current.name === "string") names[p.id] = p.current.name;
  const paid = paidIn(hr);
  const brief = (r: ExpenseReport) => ({ n: r.n, person: r.person, month: r.report.month, currency: r.report.currency, total: r.total, status: r.status, version: r.version, lines: r.report.lines.length, paid: paid.get(r.n) ?? null });
  const detail = (r: ExpenseReport) => {
    const next = nextFor(r, hr);
    // Only said to someone who would otherwise sign: the supervisor, HR, Finance or the CFO.
    const wouldSign = r.person !== me && (hr.people[r.person]?.current.supervisor === me || !!["hr", "payroll", "cfo"].some((role) => hr.rules?.holders[role as "hr"].includes(me)));
    const conflict = next && !next.people.includes(me) && wouldSign ? whyNot(me, r, hr) : null;
    return { ...r, summary: summary(r.report), flags: flags(r.report), next, canSign: !!next?.people.includes(me), cannotSign: conflict ? toYou(conflict).replace("proposed", "submitted") : null, canWithdraw: r.status === "pending" && r.by === me, paid: paid.get(r.n) ?? null };
  };
  const selected = open ? visible.find((r) => r.n === open) : undefined;
  return {
    me,
    today: todayIso(),
    hasRecord: !!hr.people[me],
    currency: String(hr.people[me]?.current.currency ?? "USD"),
    seesAll: all,
    sources,
    names,
    mine: visible.filter((r) => r.person === me).sort((a, b) => b.report.month.localeCompare(a.report.month)).map(brief),
    waiting: visible.filter((r) => nextFor(r, hr)?.people.includes(me)).map(brief),
    others: visible.filter((r) => r.person !== me && !nextFor(r, hr)?.people.includes(me)).sort((a, b) => b.n - a.n).slice(0, 100).map(brief),
    owed: all ? visible.filter((r) => r.status === "accepted" && !paid.has(r.n)).map(brief) : [],
    open: selected ? detail(selected) : null,
  };
}
export type ExpenseView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const q = new URL(req.url).searchParams;
    if (q.has("summary")) {
      const { state: hr, entries } = await loadHr();
      const { reports } = foldExpenses(entries, hr);
      return NextResponse.json({ hasRecord: !!hr.people[v.user.id], waiting: reports.filter((r) => nextFor(r, hr)?.people.includes(v.user.id)).length, returned: reports.filter((r) => r.person === v.user.id && r.status === "returned").length });
    }
    return NextResponse.json(await view(v.user.id, Number(q.get("open")) || null));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = exActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That report is not complete." }, { status: 400 });
    const a = parsed.data;
    const me = v.user.id;
    const { state: hr, entries } = await loadHr();
    const { reports } = foldExpenses(entries, hr);
    const fail = (error: string, status = 403) => NextResponse.json({ error }, { status });
    let n: number;
    if (a.action === "submit") {
      if (!hr.people[me]) return fail("You have no HR record yet, so expenses cannot be paid to you.");
      const currency = String(hr.people[me].current.currency ?? "USD");
      if (a.report.currency !== currency) return fail(`Your pay is in ${currency}; enter the report in ${currency}.`, 400);
      if (a.report.month > todayIso().slice(0, 7)) return fail("A report can be submitted once its month has started.", 400);
      const current = reports.find((r) => r.person === me && r.report.month === a.report.month);
      if (current && (current.status === "approved" || current.status === "accepted")) return fail("This month's report is already approved. Put anything more in next month's report.", 409);
      const hashes = [...new Set(a.report.lines.flatMap((l) => l.receipts.map((r) => r.hash)))];
      if (hashes.length) {
        const found = await db.select({ hash: s.hrFiles.hash }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), inArray(s.hrFiles.hash, hashes)));
        if (found.length !== hashes.length) return fail("A receipt did not finish uploading. Attach it again.", 400);
      }
      n = await append(me, "expense", me, a.report);
    } else {
      const r = reports.find((x) => x.n === a.report);
      if (!r) return fail("No such report.", 404);
      if (a.action === "withdraw") {
        if (r.by !== me || r.status !== "pending") return fail("Only you can withdraw your report, before anyone signs it.");
        n = await append(me, "ex-withdraw", r.person, { report: r.n });
      } else {
        const next = nextFor(r, hr);
        if (!next?.people.includes(me)) {
          const why = whyNot(me, r, hr);
          return fail(why ? `You cannot sign this: ${toYou(why).replace("proposed", "submitted")}.` : "This report is not waiting for your signature.");
        }
        n = a.action === "approve" ? await append(me, "ex-approve", r.person, { report: r.n }) : await append(me, "ex-return", r.person, { report: r.n, note: a.note });
      }
    }
    const after = await loadHr();
    const bad = foldExpenses(after.entries, after.state).ignored.find((x) => x.n === n);
    if (bad) return fail(`Recorded as entry ${n} but it does not count: ${bad.why}.`, 409);
    return NextResponse.json({ n, view: await view(me, a.action === "submit" ? n : a.report) });
  });
}
