import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { seesAll, toYou, conflictOf, type HrState } from "@/lib/hr";
import { NON_CONTRACT, approversFor, foldTimesheets, lastShares, prefill, tsActionSchema, type FundingSource, type Timesheet } from "@/lib/timesheet";
import { people, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, loadHr, todayIso } from "@/server/hr-store";

/**
 * Timesheets, from the HR ledger. Everyone sees their own; a supervisor sees their team's;
 * people holding an HR role see all, and HR may enter a timesheet for someone without a phone.
 */

async function sources(): Promise<FundingSource[]> {
  const projects = await db.select({ code: s.projects.code, name: s.projects.name }).from(s.projects);
  return [{ id: NON_CONTRACT, label: "General and admin (non-contract)" }, ...projects.filter((p) => p.code).map((p) => ({ id: p.code!, label: p.name }))];
}

const officeOf = (hr: HrState, id: string) => String(hr.people[id]?.current.office ?? "Home Office");

function visibleTo(me: string, hr: HrState): string[] {
  if (seesAll(me, hr)) return Object.keys(hr.people);
  return Object.keys(hr.people).filter((id) => id === me || hr.people[id].current.supervisor === me);
}

async function view(me: string, month: string, person: string | null) {
  const { state: hr, entries, integrity } = await loadHr();
  const { sheets, ignored } = foldTimesheets(entries, hr);
  const names = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  for (const p of Object.values(hr.people)) if (typeof p.current.name === "string") names[p.id] = p.current.name;
  const visible = visibleTo(me, hr).filter((id) => !hr.people[id].separated || hr.people[id].separated!.effective >= `${month}-01`);
  const isHr = !!hr.rules?.holders.hr.includes(me);
  const who = person && visible.includes(person) ? person : visible.includes(me) ? me : (visible[0] ?? null);
  const withApprovers = (t: Timesheet) => {
    const a = approversFor(t, hr);
    const conflict = a.people.includes(me) ? null : conflictOf(me, { subject: t.person, by: t.by, signatures: [], type: "timesheet" }, hr);
    return { ...t, approvers: a.people, via: a.via, canApprove: t.status === "pending" && a.people.includes(me), cannotApprove: conflict ? toYou(conflict).replace("proposed", "submitted") : null };
  };
  const current = who ? sheets.find((t) => t.person === who && t.month === month) : undefined;
  const office = who ? officeOf(hr, who) : "Home Office";
  const src = await sources();
  const shares = who ? (lastShares(sheets, who, office) ?? { [hr.people[who]?.current.office === "Home Office" ? NON_CONTRACT : (src[1]?.id ?? NON_CONTRACT)]: 1 }) : {};
  return {
    me,
    isHr,
    seesAll: seesAll(me, hr),
    month,
    today: todayIso(),
    intact: integrity.ok,
    sources: src,
    names,
    people: visible.map((id) => ({ id, name: names[id] ?? id, office: officeOf(hr, id), title: String(hr.people[id].current.title ?? "") })).sort((a, b) => a.name.localeCompare(b.name)),
    person: who,
    office,
    current: current ? withApprovers(current) : null,
    history: who ? sheets.filter((t) => t.person === who).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 12).map((t) => ({ n: t.n, month: t.month, status: t.status, version: t.version })) : [],
    prefill: who && !current ? prefill(month, office, shares) : null,
    overview: visible.map((id) => {
      const t = sheets.find((x) => x.person === id && x.month === month);
      return { person: id, status: t?.status ?? "missing", n: t?.n ?? null, by: t?.by ?? null, revised: t?.revisedAfterApproval ?? false };
    }),
    waiting: sheets.filter((t) => t.status === "pending" && approversFor(t, hr).people.includes(me)).map((t) => ({ n: t.n, person: t.person, month: t.month, revised: t.revisedAfterApproval })),
    ignored: seesAll(me, hr) ? ignored : [],
  };
}

export type TimesheetView = Awaited<ReturnType<typeof view>>;

const monthOk = (m: string | null) => (m && /^\d{4}-\d{2}$/.test(m) ? m : todayIso().slice(0, 7));

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const q = new URL(req.url).searchParams;
    if (q.has("summary")) {
      const { state: hr, entries } = await loadHr();
      const { sheets } = foldTimesheets(entries, hr);
      const month = todayIso().slice(0, 7);
      const mine = sheets.find((t) => t.person === v.user.id && t.month === month);
      return NextResponse.json({
        hasRecord: !!hr.people[v.user.id],
        month,
        status: mine?.status ?? "missing",
        waiting: sheets.filter((t) => t.status === "pending" && approversFor(t, hr).people.includes(v.user.id)).length,
      });
    }
    return NextResponse.json(await view(v.user.id, monthOk(q.get("month")), q.get("person")));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = tsActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That timesheet is not complete." }, { status: 400 });
    const a = parsed.data;
    const me = v.user.id;
    const { state: hr, entries } = await loadHr();
    const { sheets } = foldTimesheets(entries, hr);
    const fail = (error: string, status = 403) => NextResponse.json({ error }, { status });
    let n: number;
    let month: string;
    let person: string;
    if (a.action === "submit") {
      if (a.person !== me && !hr.rules?.holders.hr.includes(me)) return fail("You can submit your own timesheet. HR enters timesheets for others.");
      if (!hr.people[a.person]) return fail("This person has no HR record yet.");
      if (a.sheet.month > todayIso().slice(0, 7)) return fail("A timesheet can be submitted once its month has started.", 400);
      n = await append(me, "timesheet", a.person, a.sheet);
      month = a.sheet.month;
      person = a.person;
    } else {
      const t = sheets.find((x) => x.n === a.timesheet);
      if (!t || t.status !== "pending") return fail("This timesheet is no longer waiting for approval.", 409);
      const ap = approversFor(t, hr);
      if (!ap.people.includes(me)) {
        const c = conflictOf(me, { subject: t.person, by: t.by, signatures: [], type: "timesheet" }, hr);
        return fail(c ? `You cannot approve this: ${toYou(c).replace("proposed", "submitted")}.` : "This timesheet goes to the person's supervisor.");
      }
      n = a.action === "approve" ? await append(me, "ts-approve", t.person, { timesheet: t.n }) : await append(me, "ts-return", t.person, { timesheet: t.n, note: a.note });
      month = t.month;
      person = t.person;
    }
    const after = await loadHr();
    const bad = foldTimesheets(after.entries, after.state).ignored.find((x) => x.n === n);
    if (bad) return fail(`Recorded as entry ${n} but it does not count: ${bad.why}.`, 409);
    return NextResponse.json({ n, view: await view(me, month, person) });
  });
}
