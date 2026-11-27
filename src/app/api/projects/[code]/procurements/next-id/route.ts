import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { nextProcurementId } from "@/server/procurement-store";

/**
 * GET: the next free purchase number for this project (PR-A2027-004): the project's code is in the
 * number, so it is one of a kind across the organization. The screen asks for it when a request is
 * started; the save takes it first (procurements PUT), so of two people who ask at the same moment
 * only one keeps it and the other is told.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.procurementAccess === "edit", why: "You can view Procurement but not start a request." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ id: await nextProcurementId(code) });
  });
}
