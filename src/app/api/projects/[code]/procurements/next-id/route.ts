import { NextResponse } from "next/server";
import { realToday } from "@/lib/clock";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { nextProcurementId } from "@/server/procurement-store";

/**
 * GET: the next free purchase number for the year, one of a kind across the organization. The
 * screen asks for it when a request is started; the save checks it again (procurements PUT), so
 * two people who ask at the same moment cannot both keep it. `?year=2027` for a project whose
 * records run on another year; otherwise this year.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.procurementAccess === "edit", why: "You can view Procurement but not start a request." });
    if (v instanceof NextResponse) return v;
    const asked = new URL(req.url).searchParams.get("year") ?? "";
    const year = /^20\d{2}$/.test(asked) ? asked : realToday().slice(0, 4);
    return NextResponse.json({ id: await nextProcurementId(code, year) });
  });
}
