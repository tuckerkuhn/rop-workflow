import { NextResponse } from "next/server";
import { targetDetailsSchema } from "@/lib/target-details";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadTargetDetails, saveTargetDetails } from "@/server/target-details";

type Ctx = { params: Promise<{ code: string }> };

/** Each target's baseline, breakdown, proof documents, budget line, workplan step and place in the quarterly table. Staff read; a plan approver changes. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadTargetDetails(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const parsed = targetDetailsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    const why = await saveTargetDetails(code, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why.error }, { status: why.status });
    return NextResponse.json(await loadTargetDetails(code, v.user));
  });
}
