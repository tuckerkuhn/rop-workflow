import { NextResponse } from "next/server";
import { mayWriteReport } from "@/lib/qpr";
import { isEmployee, requireViewer } from "@/server/auth";
import { loadBudgetView } from "@/server/budget-view-store";
import { mayImport } from "@/server/actuals-store";
import { handle } from "@/server/guard";

type Ctx = { params: Promise<{ code: string }> };

/** Budget against actual by activity for the current phase. Staff only. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    // mayImport: whether this person sees the spending import at the top of Budget.
    return NextResponse.json({ ...(await loadBudgetView(code, mayWriteReport(v.user))), mayImport: await mayImport(v.user) });
  });
}
