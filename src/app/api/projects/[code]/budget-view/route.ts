import { NextResponse } from "next/server";
import { mayExplainOverspend } from "@/lib/overspend";
import { isEmployee, requireViewer } from "@/server/auth";
import { loadBudgetView } from "@/server/budget-view-store";
import { mayImport } from "@/server/actuals-store";
import { handle } from "@/server/guard";
import { budgetCeiling } from "@/server/project-origin";

type Ctx = { params: Promise<{ code: string }> };

/** Budget against actual by activity for the current phase. Staff only. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    // mayImport: whether this person sees the spending import at the top of Budget.
    // ceiling: the saved budget's total against the award ceiling from the won proposal, when there is one.
    return NextResponse.json({ ...(await loadBudgetView(code, mayExplainOverspend(v.user))), mayImport: await mayImport(v.user), ceiling: await budgetCeiling(code) });
  });
}
