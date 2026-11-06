import { NextResponse } from "next/server";
import { isEmployee, requireViewer } from "@/server/auth";
import { loadBudgetView } from "@/server/budget-view-store";
import { handle } from "@/server/guard";

type Ctx = { params: Promise<{ code: string }> };

/** Budget against actual by activity for the current phase. Staff only. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadBudgetView(code));
  });
}
