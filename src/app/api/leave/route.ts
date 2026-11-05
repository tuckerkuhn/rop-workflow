import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { conflictOf, seesAll, toYou, type HrState } from "@/lib/hr";
import { GROUP_LABEL, LEAVE_KINDS, RULES, TYPES, balanceOf, foldLeave, groupOf, hoursOf, lvActionSchema, nextSigner, warningsFor, type LeaveKind, type LeaveRequest } from "@/lib/leave";
import { people, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, hrBook, loadHr, todayIso } from "@/server/hr-store";

/**
 * Leave, from the HR ledger. Everyone sees their own balances and requests; supervisors their
 * team's requests; people holding an HR role everyone's balances. Balance adjustments are HR
 * proposals (lib/hr.ts "leave-adjust"), approved by a second HR officer.
 */

function adjustmentsOf(hr: HrState, person: string) {
  return hr.proposals
    .filter((p) => p.type === "leave-adjust" && p.status === "approved" && p.subject === person)
    .map((p) => {
      const a = p as { leave: LeaveKind; hours: number; effective: string };
      return { kind: a.leave, hours: a.hours, effective: a.effective };
    });
}

function balancesFor(person: string, hr: HrState, requests: LeaveRequest[], today: string) {
  const rec = hr.people[person]?.current;
  if (!rec) return [];
  const group = groupOf(rec);
  return (Object.keys(RULES[group].balances) as LeaveKind[]).map((k) => balanceOf(person, k, hr, requests, adjustmentsOf(hr, person), today)!).filter(Boolean);
}

async function view(me: string) {
  const { state: hr, entries } = await loadHr();
  const { requests } = foldLeave(entries, hr);
  const today = todayIso();
  const all = seesAll(me, hr);
  const names = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  for (const p of Object.values(hr.people)) if (typeof p.current.name === "string") names[p.id] = p.current.name;
  const rec = hr.people[me]?.current;
  const group = rec ? groupOf(rec) : "none";
  const team = (id: string) => hr.people[id]?.current.supervisor === me;
  const detail = (r: LeaveRequest) => {
    const next = nextSigner(r, hr);
    const why = next && !next.people.includes(me) && (team(r.person) || all) && r.person !== me ? conflictOf(me, { subject: r.person, by: r.by, signatures: [], type: "leave" }, hr) : null;
    return {
      ...r,
      days: r.hours / 8,
      warnings: next?.people.includes(me) || all ? warningsFor(r, hr, requests, adjustmentsOf(hr, r.person), today) : [],
      next,
      canSign: !!next?.people.includes(me),
      cannotSign: why ? toYou(why) : null,
      canCancel: (r.person === me && (r.status === "pending" || (r.status === "approved" && r.start > today))) || (all && !!hr.rules?.holders.hr.includes(me) && r.person !== me && (r.status === "pending" || r.status === "approved")),
    };
  };
  return {
    me,
    today,
    hasRecord: !!rec,
    isHr: !!hr.rules?.holders.hr.includes(me),
    seesAll: all,
    group,
    groupLabel: GROUP_LABEL[group],
    office: String(rec?.office ?? "Home Office"),
    kinds: RULES[group].kinds.map((k) => ({ id: k, label: TYPES[k] })),
    notes: RULES[group].notes,
    names,
    balances: rec ? balancesFor(me, hr, requests, today) : [],
    mine: requests.filter((r) => r.person === me).sort((a, b) => b.start.localeCompare(a.start)).map(detail),
    waiting: requests.filter((r) => nextSigner(r, hr)?.people.includes(me)).map(detail),
    // Who is away, for planning: the team for supervisors, everyone for HR roles.
    calendar: requests
      .filter((r) => (r.status === "approved" || r.status === "pending") && r.end >= today && (all || team(r.person) || r.person === me))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((r) => ({ n: r.n, person: r.person, kind: r.kind, start: r.start, end: r.end, status: r.status, days: r.hours / 8 })),
    everyone: all
      ? Object.values(hr.people)
          .filter((p) => !p.separated)
          .map((p) => ({ id: p.id, name: names[p.id] ?? p.id, group: GROUP_LABEL[groupOf(p.current)], balances: balancesFor(p.id, hr, requests, today) }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [],
    allKinds: LEAVE_KINDS.map((k) => ({ id: k, label: TYPES[k] })),
  };
}
export type LeaveView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    if (new URL(req.url).searchParams.has("summary")) {
      const out = await view(v.user.id);
      const annual = out.balances.find((b) => b.kind === "vacation");
      return NextResponse.json({ hasRecord: out.hasRecord, annualDays: annual ? Math.round((annual.available / 8) * 10) / 10 : null, waiting: out.waiting.length, returned: out.mine.filter((r) => r.status === "returned").length });
    }
    return NextResponse.json(await view(v.user.id));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = lvActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That request is not complete." }, { status: 400 });
    const a = parsed.data;
    const me = v.user.id;
    const { state: hr, entries } = await loadHr();
    const { requests } = foldLeave(entries, hr);
    const fail = (error: string, status = 403) => NextResponse.json({ error }, { status });
    let n: number;
    if (a.action === "request") {
      const rec = hr.people[me]?.current;
      if (!rec) return fail("You have no HR record yet.");
      const group = groupOf(rec);
      if (!RULES[group].kinds.includes(a.request.kind)) return fail(`${TYPES[a.request.kind]} does not apply to ${GROUP_LABEL[group]}.`, 400);
      const office = String(rec.office ?? "Home Office");
      if (!hoursOf(a.request, office)) return fail("Those dates are all weekends or public holidays.", 400);
      const clash = requests.find((r) => r.person === me && (r.status === "pending" || r.status === "approved") && r.start <= a.request.end && r.end >= a.request.start);
      if (clash) return fail(`You already have ${TYPES[clash.kind].toLowerCase()} from ${clash.start} to ${clash.end}.`, 409);
      if (a.request.certificate) {
        const [f] = await db.select({ hash: s.hrFiles.hash }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), eq(s.hrFiles.hash, a.request.certificate.hash))).limit(1);
        if (!f) return fail("The certificate did not finish uploading.", 400);
      }
      n = await append(me, "leave", me, a.request);
    } else {
      const r = requests.find((x) => x.n === a.request);
      if (!r) return fail("No such request.", 404);
      if (a.action === "cancel") {
        const today = todayIso();
        const mine = r.person === me && (r.status === "pending" || (r.status === "approved" && r.start > today));
        const hrCancel = !!hr.rules?.holders.hr.includes(me) && r.person !== me && (r.status === "pending" || r.status === "approved");
        if (!mine && !hrCancel) return fail(r.person === me ? "Leave that has started can only be cancelled by HR." : "Only the person or HR cancels leave.");
        n = await append(me, "lv-cancel", r.person, { request: r.n });
      }
      else {
        const next = nextSigner(r, hr);
        if (!next?.people.includes(me)) {
          const why = conflictOf(me, { subject: r.person, by: r.by, signatures: [], type: "leave" }, hr);
          return fail(why ? `You cannot approve this: ${toYou(why).replace("proposed", "asked for")}.` : "This request is not waiting for you.");
        }
        n = a.action === "approve" ? await append(me, "lv-approve", r.person, { request: r.n }) : await append(me, "lv-return", r.person, { request: r.n, note: a.note });
      }
    }
    const after = await loadHr();
    const bad = foldLeave(after.entries, after.state).ignored.find((x) => x.n === n);
    if (bad) return fail(`Recorded as entry ${n} but it does not count: ${bad.why}.`, 409);
    return NextResponse.json({ n, view: await view(me) });
  });
}
