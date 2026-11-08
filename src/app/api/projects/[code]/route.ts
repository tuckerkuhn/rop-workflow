import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { projectDesignSchema } from "@/lib/project-setup";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { checkPlanChange, logPlanChange } from "@/server/plan-guard";
import { projectDesign, updateProject } from "@/server/project-store";

type Ctx = { params: Promise<{ code: string }> };

/** The project design, to edit in setup. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const design = await projectDesign(code);
    return design ? NextResponse.json(design) : NextResponse.json({ error: "This project is kept in the browser only." }, { status: 404 });
  });
}

export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only the project manager and plan approvers can change the project design." });
    if (v instanceof NextResponse) return v;
    const parsed = projectDesignSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid project." }, { status: 400 });
    const blocked = await checkPlanChange(code, v.user, req);
    if (blocked) return blocked;
    const before = await projectDesign(code);
    if (!(await updateProject(code, parsed.data))) return NextResponse.json({ error: "No such project." }, { status: 404 });
    // What changed, indicator by indicator, so the trail shows targets moved outside the monthly review.
    const was = new Map((before?.indicators ?? []).map((i) => [i.code, i]));
    const changed = parsed.data.indicators.filter((i) => !i.code || !was.has(i.code) || was.get(i.code)!.target !== i.target || was.get(i.code)!.name !== i.name || JSON.stringify(was.get(i.code)!.forecast ?? {}) !== JSON.stringify(i.forecast ?? {})).map((i) => i.code ?? `new: ${i.name}`);
    const removed = [...was.keys()].filter((c) => !parsed.data.indicators.some((i) => i.code === c));
    await logPlanChange(code, v.user, req, "design", { indicators: { before: was.size, after: parsed.data.indicators.length, changed, removed } });
    return NextResponse.json({ ok: true });
  });
}
