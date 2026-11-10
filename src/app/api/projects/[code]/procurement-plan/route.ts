import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { isManager } from "@/lib/procurement-plan";
import { isEmployee, requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { loadBudget, loadWorkplan } from "@/server/plan-store";
import { loadPlan, rebuildPlan } from "@/server/procurement-plan-store";

type Ctx = { params: Promise<{ code: string }> };

/** The procurement calendar, with the budget and workplan it was built from (shown as each item's supporting information). */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => isEmployee(u) && u.procurementAccess !== "none" });
    if (v instanceof NextResponse) return v;
    const [items, budget, workplan] = await Promise.all([loadPlan(code), loadBudget(code), loadWorkplan(code)]);
    return NextResponse.json({ items, budget, workplan });
  });
}

/** Builds or refreshes the calendar from the budget. Items people have approved or changed are kept. */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => isManager(u) || canEditProject(u) || !!u.admin, why: "Only the procurement manager or the project manager can build the procurement calendar." });
    if (v instanceof NextResponse) return v;
    const r = await rebuildPlan(code);
    await audit(code, { entity: "procurement_plan", entityId: crypto.randomUUID(), action: "procurement_plan_rebuilt", by: v.user.id, detail: { added: r.added, removed: r.removed, total: r.items.length } });
    return NextResponse.json({ added: r.added, removed: r.removed, total: r.items.length });
  });
}
