import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { donorReport } from "@/server/donor-view-store";
import { handle } from "@/server/guard";

/** One released quarterly report as the donor sees it, with their money as that report gave it. A quarter with no release answers as not found: a draft is never shown here. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string; quarter: string }> }) {
  const { code, quarter } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    const report = /^\d{4}-Q[1-4]$/.test(quarter) ? await donorReport(code, quarter, v.user, { asked: new URL(req.url).searchParams.get("donor"), record: !v.viewingAs }) : null;
    return report ? NextResponse.json(report) : NextResponse.json({ error: "No report has been released for this quarter." }, { status: 404 });
  });
}
