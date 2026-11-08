import { NextResponse } from "next/server";
import { workplanSchema } from "@/lib/budget";
import { canEditProject } from "@/lib/demo";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { checkPlanChange, logPlanChange } from "@/server/plan-guard";
import { loadWorkplan, saveWorkplan } from "@/server/plan-store";

type Ctx = { params: Promise<{ code: string }> };

/** The project workplan. Staff only. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ items: await loadWorkplan(code) });
  });
}

/** Replaces the workplan with the reviewed items. */
export async function PUT(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only the project manager and plan approvers can change the workplan." });
    if (v instanceof NextResponse) return v;
    const parsed = workplanSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) {
      const i = parsed.error.issues[0];
      return NextResponse.json({ error: `The workplan could not be saved: ${i?.path.join(" ")} ${i?.message ?? ""}`.trim() }, { status: 400 });
    }
    const keys = parsed.data.items.map((i) => `${i.code}|${i.org ?? ""}`);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) return NextResponse.json({ error: `${dup.replace("|", " for ")} is listed twice.` }, { status: 400 });
    const blocked = await checkPlanChange(code, v.user, req);
    if (blocked) return blocked;
    const before = await loadWorkplan(code);
    await saveWorkplan(code, parsed.data.items);
    await logPlanChange(code, v.user, req, "workplan", { items: { before: before.length, after: parsed.data.items.length } });
    return NextResponse.json({ ok: true });
  });
}
