import { NextResponse } from "next/server";
import { activityAction } from "@/lib/activities";
import { requireViewer } from "@/server/auth";
import { actOnActivity, loadActivities } from "@/server/activities-store";
import { handle } from "@/server/guard";

type Ctx = { params: Promise<{ code: string }> };

/** ROP's workplan activities as executed: status, owner, dates, blockers and tasks. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Activities are for project staff." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadActivities(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: "Activities are for project staff." });
    if (v instanceof NextResponse) return v;
    const parsed = activityAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const why = await actOnActivity(code, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    return NextResponse.json(await loadActivities(code, v.user));
  });
}
