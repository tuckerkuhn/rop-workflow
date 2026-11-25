import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { periodOfSlug } from "@/lib/period-report";
import { donorPeriodReport, donorReport } from "@/server/donor-view-store";
import { handle } from "@/server/guard";

/**
 * One released quarterly report as the donor sees it, with their money as that report gave it, or
 * a released annual or final report ("annual-2026", "final"). One with no release answers as not
 * found: a draft is never shown here.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string; quarter: string }> }) {
  const { code, quarter } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    const opts = { asked: new URL(req.url).searchParams.get("donor"), record: !v.viewingAs };
    // "annual-2026" or "final": a released annual or final report, the same way.
    const report = /^\d{4}-Q[1-4]$/.test(quarter) ? await donorReport(code, quarter, v.user, opts) : periodOfSlug(quarter) ? await donorPeriodReport(code, quarter, v.user, opts) : null;
    return report ? NextResponse.json(report) : NextResponse.json({ error: "No report has been released for this period." }, { status: 404 });
  });
}
