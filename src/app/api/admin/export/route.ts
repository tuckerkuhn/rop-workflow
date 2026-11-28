import { NextResponse } from "next/server";
import { buildExport } from "@/server/records-export";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";

/**
 * Administrators: the organization's project records as one JSON file, a copy kept outside the
 * database (docs/BACKUP-AND-RECOVERY.md). Personal records are left out on purpose: participants'
 * names and phones (farmer_pii), the HR book and its files, and the encrypted KoboToolbox tokens.
 * Those are covered by the database's own backups.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => !!u.admin, why: "Only administrators export the records." });
    if (v instanceof NextResponse) return v;
    const { at, json } = await buildExport(v.actor.id);
    return new NextResponse(json, {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="rop-workflow-export-${at.slice(0, 10)}.json"`, "Cache-Control": "no-store" },
    });
  });
}
