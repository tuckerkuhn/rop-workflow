import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { mayPropose, seesAll, type ProposalInput } from "@/lib/hr";
import { foldOnboarding, mayDo, obActionSchema, progress, stepsFor, type Onboarding } from "@/lib/onboarding";
import { people, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, hrBook, loadHr, todayIso } from "@/server/hr-store";

/**
 * Onboarding, from the HR ledger. The new hire sees their own checklist; the supervisor their new
 * team members' (without personal details); HR everyone's. Bank and ID details reach only the
 * person and HR.
 */

async function view(me: string, person: string | null) {
  const { state: hr, entries } = await loadHr();
  const { onboarding, policies } = foldOnboarding(entries, hr);
  const all = seesAll(me, hr);
  const isHr = !!hr.rules?.holders.hr.includes(me);
  const names = Object.fromEntries((await people()).map((u) => [u.id, u.name]));
  for (const p of Object.values(hr.people)) if (typeof p.current.name === "string") names[p.id] = p.current.name;
  const visible = onboarding.filter((o) => all || o.person === me || hr.people[o.person]?.current.supervisor === me);
  const full = (o: Onboarding) => all || o.person === me;
  const detail = (o: Onboarding) => ({
    person: o.person,
    name: names[o.person] ?? o.person,
    title: String(hr.people[o.person]?.current.title ?? ""),
    startDate: String(hr.people[o.person]?.current.startDate ?? ""),
    supervisor: String(hr.people[o.person]?.current.supervisor ?? ""),
    startedBy: o.startedBy,
    at: o.at,
    due: o.due,
    contract: o.contract,
    policies: o.policies,
    progress: progress(o),
    steps: stepsFor(o).map((def) => {
      const d = o.done[def.id];
      // Personal details and the ID file are kept from supervisors.
      const value = d && (full(o) || (d.value.kind !== "details" && d.value.kind !== "upload")) ? d.value : null;
      return { ...def, done: d ? { by: d.by, at: d.at, n: d.n, value } : null, canDo: !d && mayDo(me, def.owner, o.person, hr) && (def.kind !== "record" || !!o.done.details) };
    }),
  });
  const chosen = person ? visible.find((o) => o.person === person) : visible.find((o) => o.person === me);
  return {
    me,
    isHr,
    today: todayIso(),
    names,
    policies,
    mine: onboarding.some((o) => o.person === me),
    list: visible.map((o) => ({ person: o.person, name: names[o.person] ?? o.person, due: o.due, progress: progress(o), mine: stepsFor(o).filter((d) => !o.done[d.id] && mayDo(me, d.owner, o.person, hr)).length })),
    // People HR could start onboarding for: a record, no onboarding yet, started in the last six months or later.
    startable: isHr
      ? Object.values(hr.people)
          .filter((p) => !onboarding.some((o) => o.person === p.id) && p.id !== me && !p.separated && String(p.current.startDate ?? "") >= new Date(Date.now() - 183 * 86400000).toISOString().slice(0, 10))
          .map((p) => ({ id: p.id, name: names[p.id] ?? p.id, startDate: String(p.current.startDate ?? "") }))
      : [],
    open: chosen ? detail(chosen) : null,
  };
}
export type OnboardingView = Awaited<ReturnType<typeof view>>;

async function filesExist(hashes: string[]) {
  if (!hashes.length) return true;
  const found = await db.select({ hash: s.hrFiles.hash }).from(s.hrFiles).where(and(eq(s.hrFiles.book, hrBook()), inArray(s.hrFiles.hash, hashes)));
  return found.length === new Set(hashes).size;
}

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const q = new URL(req.url).searchParams;
    const out = await view(v.user.id, q.get("person"));
    if (q.has("summary"))
      return NextResponse.json({ mine: out.mine ? (out.list.find((l) => l.person === v.user.id)?.progress ?? null) : null, todo: out.list.filter((l) => l.person !== v.user.id).reduce((n, l) => n + l.mine, 0) });
    return NextResponse.json(out);
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = obActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const a = parsed.data;
    const me = v.user.id;
    const { state: hr, entries } = await loadHr();
    const { onboarding } = foldOnboarding(entries, hr);
    const isHr = !!hr.rules?.holders.hr.includes(me);
    const fail = (error: string, status = 403) => NextResponse.json({ error }, { status });
    let n: number;
    let person: string | null = null;
    if (a.action === "policy") {
      if (!isHr) return fail("Only HR publishes policies.");
      if (!(await filesExist([a.file.hash]))) return fail("The file did not finish uploading.", 400);
      n = await append(me, "policy", null, { id: a.id, title: a.title, version: a.version, file: a.file });
    } else if (a.action === "start") {
      if (!isHr || a.person === me) return fail("HR starts onboarding for someone else.");
      if (!hr.people[a.person]) return fail("Add the person's record first.");
      if (onboarding.some((o) => o.person === a.person)) return fail("Onboarding has already started.", 409);
      if (!(await filesExist([a.contract.hash]))) return fail("The contract did not finish uploading.", 400);
      n = await append(me, "onboard-start", a.person, { due: a.due, contract: a.contract });
      person = a.person;
    } else {
      const o = onboarding.find((x) => x.person === a.person);
      if (!o) return fail("No onboarding for this person.", 404);
      const def = stepsFor(o).find((d) => d.id === a.step);
      if (!def || def.kind !== a.value.kind) return fail("Not a step of this onboarding.", 400);
      if (!mayDo(me, def.owner, o.person, hr)) return fail(def.owner === "self" ? "Only the new hire does this step." : def.owner === "hr" ? "HR does this step." : "The supervisor does this step.");
      if (o.done[def.id]) return fail("Already done.", 409);
      let value = a.value;
      // Refused here rather than written and then ignored.
      if (value.kind === "acknowledge" && o.policies.find((p) => p.id === def.policy)?.file.hash !== value.file) return fail("This is not the version of the policy you were given. Reload the page.", 409);
      if (value.kind === "sign") {
        if (value.file !== o.contract.hash) return fail("This is not your contract. Reload the page.", 409);
        const name = String(hr.people[o.person]?.current.name ?? "");
        if (value.typedName.trim().toLowerCase() !== name.trim().toLowerCase()) return fail(`Type your name exactly as in your record: ${name}.`, 400);
      }
      if (value.kind === "upload" && !(await filesExist([value.file.hash]))) return fail("The file did not finish uploading.", 400);
      if (value.kind === "record") {
        // HR turns the new hire's details into proposals; the bank account is a pay change for the CFO and the CEO.
        const d = o.done.details?.value;
        if (d?.kind !== "details") return fail("The new hire has not given their details yet.", 409);
        const today = todayIso();
        const reason = "Given by the new hire during onboarding.";
        const made: number[] = [];
        const proposals: ProposalInput[] = [
          { type: "update", subject: o.person, effective: today, fields: { phone: d.details.phone, emergencyContact: d.details.emergencyContact }, reason },
          { type: "update", subject: o.person, effective: today, fields: { bankAccount: d.details.bankAccount }, reason },
        ];
        for (const p of proposals) {
          const why = mayPropose(me, p, hr);
          if (why) return fail(why);
        }
        for (const p of proposals) made.push(await append(me, "propose", o.person, p));
        value = { kind: "record", proposals: made };
      }
      n = await append(me, "onboard-step", o.person, { step: def.id, value });
      person = o.person;
    }
    const after = await loadHr();
    const bad = foldOnboarding(after.entries, after.state).ignored.find((x) => x.n === n);
    if (bad) return fail(`Recorded as entry ${n} but it does not count: ${bad.why}.`, 409);
    return NextResponse.json({ n, view: await view(me, person) });
  });
}
