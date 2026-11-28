import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { advActionSchema, ageOf, DEFAULT_SETTLE_DAYS, foldAdvances, owedOf, settlementProblem, spentOf, type Advance } from "@/lib/advance";
import { seesAll, type HrState } from "@/lib/hr";
import { people, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, hrBook, loadHr, todayIso, wouldNotCount } from "@/server/hr-store";
import { projectRules } from "@/server/policy-store";

/**
 * Advances (lib/advance, MF-02), from the HR ledger. Everyone sees their own; a supervisor their
 * team's; Finance and HR all. The supervisor approves, Finance pays the holder, the holder settles
 * with receipts by the project's deadline, Finance accepts and recovers what is still owed.
 */

const isFinance = (u: string, hr: HrState) => !!(hr.rules?.holders.finance?.includes(u) || hr.rules?.holders.payroll?.includes(u));

/** Days to settle for each funding source: the project's rule (15 on UN-funded projects), else 30. */
async function settleDays(sources: string[]) {
  const out: Record<string, number> = {};
  for (const src of [...new Set(sources)]) {
    const v = await projectRules(src)
      .then((r) => r.lines.find((l) => l.key === "advanceSettlementDays")?.value)
      .catch(() => undefined);
    out[src] = typeof v === "number" && v > 0 ? v : DEFAULT_SETTLE_DAYS;
  }
  return out;
}

async function view(me: string) {
  const { state: hr, entries } = await loadHr();
  const { advances } = foldAdvances(entries, hr);
  const all = seesAll(me, hr) || isFinance(me, hr);
  const visible = advances.filter((a) => all || a.person === me || hr.people[a.person]?.current.supervisor === me);
  const limits = await settleDays(visible.map((a) => a.request.source));
  const names = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  const today = todayIso();
  const row = (a: Advance) => {
    const days = limits[a.request.source] ?? DEFAULT_SETTLE_DAYS;
    const sup = hr.people[a.person]?.current.supervisor;
    const can = {
      approve: a.status === "requested" && a.person !== me && (sup === me || (!sup && !!hr.rules?.holders.hr.includes(me))),
      pay: a.status === "approved" && isFinance(me, hr),
      settle: a.status === "paid" && a.person === me,
      accept: a.status === "settling" && isFinance(me, hr) && a.person !== me,
      recover: a.status === "settled" && owedOf(a) > 0 && isFinance(me, hr),
    };
    return { ...a, name: names[a.person] ?? a.person, settleDays: days, age: ageOf(a, today, days), spent: spentOf(a), owed: owedOf(a), problem: a.settlement ? settlementProblem(a, a.settlement) : null, can };
  };
  const rows = visible.map(row).sort((x, y) => y.n - x.n);
  return {
    me,
    today,
    hasRecord: !!hr.people[me],
    finance: isFinance(me, hr),
    mine: rows.filter((r) => r.person === me),
    waiting: rows.filter((r) => Object.values(r.can).some(Boolean) && !r.can.settle),
    overdue: rows.filter((r) => r.age?.overdue),
    others: rows.filter((r) => r.person !== me).slice(0, 100),
  };
}
export type AdvanceView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await view(v.user.id), { headers: { "Cache-Control": "private, no-store" } });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = advActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const a = parsed.data;
    const me = v.user.id;
    const { state: hr, entries } = await loadHr();
    const fail = (error: string, status = 403) => NextResponse.json({ error }, { status });
    let n: number;
    if (a.action === "request") {
      if (!hr.people[me]) return fail("You have no HR record yet, so an advance cannot be paid to you.");
      // One open advance at a time: the last is settled before the next is paid.
      const open = foldAdvances(entries, hr).advances.find((x) => x.person === me && x.status !== "settled");
      if (open) return fail(`Settle advance #${open.n} (${open.request.purpose}) before asking for another.`, 409);
      const why = wouldNotCount(entries, (x) => foldAdvances(x, hr).ignored, me, "adv-request", me, a.request);
      if (why) return fail(`Not recorded: ${why}.`, 409);
      n = await append(me, "adv-request", me, a.request);
    } else {
      const id = a.action === "pay" ? a.payment.advance : a.action === "settle" ? a.settlement.advance : a.advance;
      const adv = foldAdvances(entries, hr).advances.find((x) => x.n === id);
      if (!adv) return fail("No such advance.", 404);
      if (a.action === "settle") {
        const problem = settlementProblem(adv, a.settlement);
        if (problem) return fail(problem, 400);
        const hashes = [...new Set(a.settlement.lines.flatMap((l) => l.receipts.map((r) => r.hash)))];
        if (hashes.length) {
          const found = await db.select({ hash: s.hrFiles.hash }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), inArray(s.hrFiles.hash, hashes)));
          if (found.length !== hashes.length) return fail("A receipt did not finish uploading. Attach it again.", 400);
        }
      }
      if (a.action === "pay" && a.payment.payee !== adv.person) return fail("An advance is paid only to the person who holds it.", 400);
      if (a.action === "recover" && a.amount > owedOf(adv)) return fail(`Only ${owedOf(adv)} is still owed on this advance.`, 400);
      const kind = { approve: "adv-approve", pay: "adv-pay", settle: "adv-settle", accept: "adv-accept", return: "adv-return", recover: "adv-recover" }[a.action];
      const data = a.action === "pay" ? a.payment : a.action === "settle" ? a.settlement : a.action === "return" ? { advance: a.advance, note: a.note } : a.action === "recover" ? { advance: a.advance, amount: a.amount } : { advance: a.advance };
      const why = wouldNotCount(entries, (x) => foldAdvances(x, hr).ignored, me, kind, adv.person, data);
      if (why) return fail(`Not recorded: ${why}.`, 409);
      n = await append(me, kind, adv.person, data);
    }
    const after = await loadHr();
    const bad = foldAdvances(after.entries, after.state).ignored.find((x) => x.n === n);
    if (bad) return fail(`Recorded as entry ${n} but it does not count: ${bad.why}.`, 409);
    return NextResponse.json({ n, view: await view(me) });
  });
}
