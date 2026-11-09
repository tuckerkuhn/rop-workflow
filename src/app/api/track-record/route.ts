import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { holdsRole } from "@/server/hr-store";
import { trackRecord } from "@/server/track-record";

/** ROP's track record for proposals: programme leads, management and administrators. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const u = v.user;
    const lead = u.admin || u.project.some((r) => ["plan-approver", "report-release"].includes(r)) || (await holdsRole(u.id, "ceo")) || (await holdsRole(u.id, "management"));
    if (!lead) return NextResponse.json({ error: "The track record is for programme leads and management." }, { status: 403 });
    return NextResponse.json(await trackRecord(u));
  });
}
