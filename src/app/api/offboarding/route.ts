import { NextResponse } from "next/server";
import { foldOffboarding, mayDoOff, offActionSchema, OFF_OWNER_LABEL, OFF_STEPS } from "@/lib/offboarding";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { append, loadHr } from "@/server/hr-store";
import { offboardingView } from "@/server/offboarding-view";

/** Leavers' checklists and contracts ending soon. Each step done is a ledger entry. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await offboardingView(v.user.id));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = offActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const a = parsed.data;
    const me = v.user.id;
    const { state: hr, entries } = await loadHr();
    const o = foldOffboarding(entries, hr).find((x) => x.person === a.person);
    if (!o) return NextResponse.json({ error: "This person's leaving has not been approved in the HR record." }, { status: 404 });
    const def = OFF_STEPS.find((s) => s.id === a.step)!;
    if (!mayDoOff(me, def.owner, o.person, hr)) return NextResponse.json({ error: `${OFF_OWNER_LABEL[def.owner]} does this step.` }, { status: 403 });
    if (o.done[def.id]) return NextResponse.json({ error: "Already done." }, { status: 409 });
    if (def.needsNote && a.note.length < 3) return NextResponse.json({ error: "Write what was done." }, { status: 400 });
    await append(me, "offboard-step", o.person, { step: a.step, note: a.note });
    return NextResponse.json(await offboardingView(me));
  });
}
