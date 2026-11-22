import { NextResponse } from "next/server";
import { feedbackAction } from "@/lib/feedback";
import { requireViewer } from "@/server/auth";
import { actOnFeedback, loadFeedback } from "@/server/feedback-store";
import { handle } from "@/server/guard";

type Ctx = { params: Promise<{ code: string }> };
const WHY = "The feedback and complaints log is for project staff.";

/** The project's feedback and complaints log. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: WHY });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadFeedback(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: WHY });
    if (v instanceof NextResponse) return v;
    const parsed = feedbackAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const why = await actOnFeedback(code, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    return NextResponse.json(await loadFeedback(code, v.user));
  });
}
