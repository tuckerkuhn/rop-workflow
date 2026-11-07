import { NextResponse } from "next/server";
import { lensActionSchema } from "@/lib/lens-review";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { actOnLensReview, loadLensReview, mayRunLensReview } from "@/server/lens-review-store";

type Ctx = { params: Promise<{ code: string }> };
export const maxDuration = 120;

/** The plan's latest lens review. Staff read it; plan approvers, reviewers, MEL and project managers run it and decide findings. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ review: await loadLensReview(code), mayRun: mayRunLensReview(v.user), aiReady: !!process.env.ANTHROPIC_API_KEY });
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const parsed = lensActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    const error = await actOnLensReview(code, parsed.data, v.user);
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json({ review: await loadLensReview(code), mayRun: mayRunLensReview(v.user), aiReady: !!process.env.ANTHROPIC_API_KEY });
  });
}
