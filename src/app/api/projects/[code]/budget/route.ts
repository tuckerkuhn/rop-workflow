import { NextResponse } from "next/server";
import { budgetSchema } from "@/lib/budget";
import { canEditProject } from "@/lib/demo";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadBudget, saveBudget } from "@/server/plan-store";

type Ctx = { params: Promise<{ code: string }> };

/** The project budget. Staff only. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadBudget(code));
  });
}

/** Replaces the budget with the reviewed lines. */
export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only the project manager and plan approvers can change the budget." });
    if (v instanceof NextResponse) return v;
    const parsed = budgetSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return NextResponse.json({ error: `The budget could not be saved: ${i?.path.join(" ")} ${i?.message ?? ""}`.trim() }, { status: 400 });
    }
    const codes = parsed.data.lines.map((l) => l.code);
    const dup = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dup) return NextResponse.json({ error: `Line code ${dup} is used twice. Each line needs its own code.` }, { status: 400 });
    await saveBudget(code, parsed.data);
    return NextResponse.json({ ok: true });
  });
}
