import { NextResponse } from "next/server";
import { z } from "zod";
import { STAGES, type Stage } from "@/lib/demo";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { changeStage, mayChangeStage, stageHistory } from "@/server/stage-store";

type Ctx = { params: Promise<{ code: string }> };

/** The project's stage history; plan approvers move it on (leaving Design signs off the plan and budget). */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ history: await stageHistory(code), mayChange: mayChangeStage(v.user) });
  });
}

const bodySchema = z.object({ to: z.enum(STAGES as unknown as [Stage, ...Stage[]]), note: z.string().trim().max(1000).optional() });

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: mayChangeStage, why: "Only a plan approver can sign off a stage." });
    if (v instanceof NextResponse) return v;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Choose a stage." }, { status: 400 });
    const r = await changeStage(code, parsed.data.to, v.user, parsed.data.note ?? null);
    if ("error" in r) return NextResponse.json(r, { status: 400 });
    return NextResponse.json({ ...r, history: await stageHistory(code), mayChange: true });
  });
}
