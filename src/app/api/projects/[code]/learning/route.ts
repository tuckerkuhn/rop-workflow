import { NextResponse } from "next/server";
import { learningAction } from "@/lib/learning";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { actOnLearning, loadLearning } from "@/server/learning-store";

type Ctx = { params: Promise<{ code: string }> };

/** Lessons learned and the project close-out checklist. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Lessons and close-out are for project staff." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadLearning(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: "Lessons and close-out are for project staff." });
    if (v instanceof NextResponse) return v;
    const parsed = learningAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const why = await actOnLearning(code, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    return NextResponse.json(await loadLearning(code, v.user));
  });
}
