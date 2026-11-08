import { NextResponse } from "next/server";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadProgressSummary } from "@/server/progress-summary-store";

type Ctx = { params: Promise<{ code: string }> };

/** The top of Progress: what to celebrate and what needs attention. Staff only. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadProgressSummary(code, v.user));
  });
}
