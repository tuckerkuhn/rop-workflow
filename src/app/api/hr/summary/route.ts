import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { hrSummary } from "@/server/hr-summary";

/**
 * The signed-in person's own timesheet, expenses, leave and onboarding status for the Home card,
 * in one request instead of four. Same audience as those routes (staff); only the person's own records.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await hrSummary(v.user.id));
  });
}
