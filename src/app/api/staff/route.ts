import { NextResponse } from "next/server";
import { selfChangeProblem, staffActionSchema } from "@/lib/access";
import { ROLE_LABEL } from "@/lib/hr";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadHr } from "@/server/hr-store";
import { addPerson, canCreateAccounts, changeLog, createAccount, invitePerson, listPeople, PeopleError, setActive, updatePerson } from "@/server/people-admin";

/**
 * People and roles: administrators add people, give and take away roles, turn access off, and
 * create sign-in accounts. Nobody changes their own roles. Every change is logged.
 */

const isAdmin = { allow: (u: { admin?: boolean; kind: string }) => u.kind === "employee" && !!u.admin, why: "Only administrators manage people and roles." };

async function view(me: string) {
  const people = await listPeople();
  const { state } = await loadHr();
  const names = Object.fromEntries(people.map((p) => [p.id, p.name]));
  const holders = state.rules
    ? (Object.entries(state.rules.holders) as [keyof typeof ROLE_LABEL, string[]][]).map(([role, ids]) => ({ role, label: ROLE_LABEL[role], people: ids.map((x) => names[x] ?? x) }))
    : [];
  return {
    me,
    demoMode: process.env.DEMO_SIGN_IN === "1",
    canCreateAccounts: canCreateAccounts(),
    people,
    holders,
    log: await changeLog(),
  };
}
export type PeopleView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, isAdmin);
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await view(v.user.id));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { ...isAdmin, write: true });
    if (v instanceof NextResponse) return v;
    const parsed = staffActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return NextResponse.json({ error: i ? `${i.path.join(".") || "Form"}: ${i.message}` : "Check the form." }, { status: 400 });
    }
    const a = parsed.data;
    const by = { id: v.actor.id, staffId: v.actorStaffId };
    try {
      let notice = "";
      if (a.action === "add") {
        const id = await addPerson(a.person, by);
        notice = `${a.person.name} added.`;
        if (a.person.email && canCreateAccounts()) notice += ` ${await createAccount(id, by)}.`;
      } else if (a.action === "update") {
        const before = (await listPeople()).find((p) => p.id === a.id);
        if (!before) return NextResponse.json({ error: "No such person." }, { status: 404 });
        if (a.id === v.actor.id) {
          const problem = selfChangeProblem(before, a.person);
          if (problem) return NextResponse.json({ error: problem }, { status: 403 });
        }
        const changes = await updatePerson(a.id, a.person, by);
        notice = changes.length ? `Saved: ${changes.join("; ")}.` : "Nothing changed.";
      } else if (a.action === "active") {
        if (a.id === v.actor.id) return NextResponse.json({ error: "You cannot turn off your own access." }, { status: 403 });
        await setActive(a.id, a.active, by);
        notice = a.active ? "Access turned back on." : "Access turned off. Their records and history stay.";
      } else if (a.action === "invite") {
        if (a.id === v.actor.id) return NextResponse.json({ error: "You are already signed in." }, { status: 400 });
        notice = `Done: ${await invitePerson(a.id, { ...by, name: v.actor.name }, new URL(req.url).origin)}.`;
      } else {
        notice = `Done: ${await createAccount(a.id, by)}.`;
      }
      return NextResponse.json({ ...(await view(v.user.id)), notice });
    } catch (e) {
      if (e instanceof PeopleError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  });
}
