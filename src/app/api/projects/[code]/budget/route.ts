import { NextResponse } from "next/server";
import { budgetSchema } from "@/lib/budget";
import { canEditProject } from "@/lib/demo";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { checkPlanChange, logPlanChange } from "@/server/plan-guard";
import { isManager } from "@/lib/procurement-plan";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { db } from "@/db";
import { z } from "zod";
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
    const blocked = await checkPlanChange(code, v.user, req);
    if (blocked) return blocked;
    const before = await loadBudget(code);
    const total = (b: { lines: { total: number }[] }) => Math.round(b.lines.reduce((t, l) => t + Number(l.total ?? 0), 0));
    await saveBudget(code, parsed.data);
    await logPlanChange(code, v.user, req, "budget", { lines: { before: before.lines.length, after: parsed.data.lines.length }, total: { before: total(before), after: total(parsed.data) }, currency: parsed.data.currency });
    return NextResponse.json({ ok: true });
  });
}

const procureSchema = z.object({ procure: z.record(z.string(), z.boolean()) });

/**
 * Which lines are bought through procurement ("Procure"), and nothing else. It moves no money, so it
 * is not a plan change for the monthly review: the project manager or the procurement manager sets
 * it from the procurement calendar, and each change goes in the audit trail.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => canEditProject(u) || isManager(u), why: "Only the project manager and the procurement manager choose which budget lines are bought." });
    if (v instanceof NextResponse) return v;
    const parsed = procureSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Say which lines to mark, as { procure: { code: true } }." }, { status: 400 });
    const budget = await loadBudget(code);
    const unknown = Object.keys(parsed.data.procure).filter((c) => !budget.lines.some((l) => l.code === c));
    if (unknown.length) return NextResponse.json({ error: `No budget line ${unknown.join(", ")} on this project.` }, { status: 400 });
    const changed = budget.lines.filter((l) => l.code in parsed.data.procure && l.procure !== parsed.data.procure[l.code]);
    if (!changed.length) return NextResponse.json({ ok: true, changed: 0 });
    await saveBudget(code, { ...budget, lines: budget.lines.map((l) => (l.code in parsed.data.procure ? { ...l, procure: parsed.data.procure[l.code] } : l)) });
    const project = await projectByCode(code);
    await logAudit(db, project.id, { entity: "plan", entityId: project.id, action: "budget_procure_marked", by: v.user.id, detail: { lines: changed.map((l) => ({ code: l.code, procure: parsed.data.procure[l.code] })) } });
    return NextResponse.json({ ok: true, changed: changed.length });
  });
}
