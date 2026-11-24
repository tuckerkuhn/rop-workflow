import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { seesAll } from "@/lib/hr";
import { foldOnboarding } from "@/lib/onboarding";
import { foldTraining, logRows, mayPlan, mayRecord, standing, trainingActionSchema } from "@/lib/training";
import { people, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, hrBook, loadHr, todayIso } from "@/server/hr-store";

/**
 * The training log (lib/training), from the HR ledger. Operations (HR) and the organization's
 * leaders see everyone; a supervisor their team; everyone their own.
 */

async function view(me: string, person: string | null) {
  const { state: hr, entries } = await loadHr();
  const { onboarding } = foldOnboarding(entries, hr);
  const { records, plans, logStart } = foldTraining(entries, hr, onboarding);
  const all = seesAll(me, hr);
  const isHr = !!hr.rules?.holders.hr.includes(me);
  const today = todayIso();
  const names = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  for (const p of Object.values(hr.people)) if (typeof p.current.name === "string") names[p.id] = p.current.name;
  const active = Object.values(hr.people).filter((p) => !p.separated || p.separated.effective > today);
  const visible = active.filter((p) => all || p.id === me || p.current.supervisor === me);
  const rows = visible
    .map((p) => ({
      person: p.id,
      name: names[p.id] ?? p.id,
      title: String(p.current.title ?? ""),
      office: String(p.current.office ?? ""),
      startDate: String(p.current.startDate ?? ""),
      standing: standing(p.id, String(p.current.startDate ?? ""), records, plans, today, logStart || undefined),
    }))
    .sort((a, b) => b.standing.overdue - a.standing.overdue || a.name.localeCompare(b.name));
  // Someone not on this person's list opens their own log instead.
  const chosen = rows.find((r) => r.person === person) ?? rows.find((r) => r.person === me) ?? rows[0] ?? null;
  const year = Number(today.slice(0, 4));
  return {
    me,
    isHr,
    seesAll: all,
    today,
    logStart,
    names,
    rows,
    open: chosen
      ? {
          ...chosen,
          supervisor: String(hr.people[chosen.person]?.current.supervisor ?? ""),
          records: records.filter((r) => r.person === chosen.person).map((r) => ({ ...r, mayVoid: !r.fromOnboarding && !r.voided && (r.by === me || isHr) })),
          plan: plans.find((p) => p.person === chosen.person && p.year === year) ?? null,
          lastPlan: plans.find((p) => p.person === chosen.person && p.year === year - 1) ?? null,
          canRecord: mayRecord(me, chosen.person, hr),
          canPlan: mayPlan(me, chosen.person, hr),
        }
      : null,
  };
}
export type TrainingView = Awaited<ReturnType<typeof view>>;

async function fileExists(hash: string) {
  const found = await db.select({ hash: s.hrFiles.hash }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), inArray(s.hrFiles.hash, [hash])));
  return found.length === 1;
}

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const q = new URL(req.url).searchParams;
    if (q.has("log")) {
      // The whole log of the people this person may see, for a donor or auditor.
      const { state: hr, entries } = await loadHr();
      const { records } = foldTraining(entries, hr, foldOnboarding(entries, hr).onboarding);
      const out = await view(v.user.id, null);
      const seen = new Set(out.rows.map((r) => r.person));
      return NextResponse.json(logRows(records.filter((r) => seen.has(r.person)), (id) => out.names[id] ?? id));
    }
    return NextResponse.json(await view(v.user.id, q.get("person")));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = trainingActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const a = parsed.data;
    const me = v.user.id;
    const { state: hr, entries } = await loadHr();
    const isHr = !!hr.rules?.holders.hr.includes(me);
    const fail = (error: string, status = 403) => NextResponse.json({ error }, { status });
    let n: number;
    let person: string | null = null;
    if (a.action === "start") {
      if (!isHr) return fail("Only HR sets the day the training policy took effect.");
      if (a.effective > todayIso()) return fail("The policy cannot take effect in the future here: set it on the day it does.", 400);
      n = await append(me, "training-start", null, { effective: a.effective });
    } else if (a.action === "record") {
      if (!hr.people[a.person]) return fail("There is no HR record for this person.", 404);
      if (!mayRecord(me, a.person, hr)) return fail("Only the person, their supervisor or HR records training.");
      if (a.record.date > todayIso()) return fail("Record training once it has taken place.", 400);
      if (a.person === me && !a.record.proof) return fail("Attach the attendance sheet or certificate: training you record for yourself needs its proof.", 400);
      if (a.record.proof && !(await fileExists(a.record.proof.hash))) return fail("The file did not finish uploading.", 400);
      n = await append(me, "training", a.person, a.record);
      person = a.person;
    } else if (a.action === "plan") {
      if (!mayPlan(me, a.person, hr)) return fail("The supervisor or HR writes the year's priorities, agreed with the person at the appraisal.");
      n = await append(me, "training-plan", a.person, a.plan);
      person = a.person;
    } else {
      const { records } = foldTraining(entries, hr);
      const r = records.find((x) => x.n === a.record && x.person === a.person);
      if (!r) return fail("No such training record.", 404);
      if (r.voided) return fail("Already withdrawn.", 409);
      if (r.by !== me && !isHr) return fail("Only who recorded it, or HR, withdraws a record.");
      n = await append(me, "training-void", a.person, { record: a.record, why: a.why });
      person = a.person;
    }
    const after = await loadHr();
    const bad = foldTraining(after.entries, after.state).ignored.find((x) => x.n === n);
    if (bad) return fail(`Recorded as entry ${n} but it does not count: ${bad.why}.`, 409);
    return NextResponse.json({ n, view: await view(me, person) });
  });
}
