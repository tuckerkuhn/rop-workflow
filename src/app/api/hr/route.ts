import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { actionSchema, conflictOf, mayPropose, nextSigners, ROLE_LABEL, seesAll, toYou, type HrAction } from "@/lib/hr";
import { people, requireViewer } from "@/server/auth";
import { eligibleSigners } from "@/server/hr-signers";
import { handle } from "@/server/guard";
import { append, isSampleBook, loadHr } from "@/server/hr-store";
import { viewFor, waitingFor } from "@/server/hr-view";

/** The HR record as this person may see it. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const { book, entries, state, integrity } = await loadHr();
    // Home only needs the counts.
    if (new URL(req.url).searchParams.has("summary"))
      return NextResponse.json({ waiting: waitingFor(v.user.id, state), hrRole: seesAll(v.user.id, state), hasRecord: !!state.people[v.user.id], intact: integrity.ok });
    const view = viewFor(v.user.id, state, entries, integrity, await people(), book, isSampleBook());
    // Before the book starts: who may be named in its authority table (on the live site, only people who can sign in).
    return NextResponse.json(state.rules ? view : { ...view, eligible: await eligibleSigners() });
  });
}

const slug = (name: string) =>
  `${name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24) || "person"}-${randomBytes(2).toString("hex")}`;

/**
 * One action, written as one ledger entry. The same checks run again whenever the ledger is
 * read, so an entry that slips past these (two people signing at once) is shown as ignored.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = actionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That change is not complete." }, { status: 400 });
    const me = v.user.id;
    const a: HrAction = parsed.data;
    const { state } = await loadHr();
    const fail = (error: string, status = 403) => NextResponse.json({ error }, { status });

    let n: number;
    switch (a.action) {
      case "propose": {
        const p = a.proposal.type === "hire" ? { ...a.proposal, subject: slug(String(a.proposal.fields.name ?? "")) } : a.proposal;
        const why = mayPropose(me, p, state);
        if (why) return fail(why);
        n = await append(me, "propose", p.subject, p);
        break;
      }
      case "approve":
      case "reject": {
        const p = state.proposals.find((x) => x.id === a.proposal);
        if (!p || p.status !== "pending") return fail("This change is no longer waiting for a signature.", 409);
        const next = nextSigners(p, state)!;
        if (!next.people.includes(me)) {
          const conflict = conflictOf(me, p, state);
          return fail(conflict ? `You cannot sign this: ${toYou(conflict)}.` : `This step is for the ${ROLE_LABEL[next.fellBack ? "board" : next.role]}.`);
        }
        n =
          a.action === "approve"
            ? await append(me, "approve", p.subject, { proposal: p.id, step: p.signatures.length, as: next.fellBack ? "board" : next.role })
            : await append(me, "reject", p.subject, { proposal: p.id, note: a.note });
        break;
      }
      case "withdraw": {
        const p = state.proposals.find((x) => x.id === a.proposal);
        if (!p || p.status !== "pending" || p.by !== me) return fail("Only the person who proposed a pending change can withdraw it.");
        n = await append(me, "withdraw", p.subject, { proposal: p.id });
        break;
      }
      case "declare": {
        if (a.a === a.b) return fail("Choose two different people.", 400);
        const isHr = state.rules?.holders.hr.includes(me);
        if (me !== a.a && me !== a.b && !isHr) return fail("You can declare people you are related to. HR records links between others.");
        n = await append(me, "declare", a.a, { a: a.a, b: a.b, relation: a.relation });
        break;
      }
    }

    const after = await loadHr();
    const ignored = after.state.ignored.find((x) => x.n === n);
    if (ignored) return fail(`Recorded as entry ${n} but it does not count: ${ignored.why}.`, 409);
    return NextResponse.json({ n, view: viewFor(me, after.state, after.entries, after.integrity, await people(), after.book, isSampleBook()) });
  });
}

