import { NextResponse } from "next/server";
import type { AppUser } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { db } from "@/db";
import { parseReport } from "@/lib/preflight";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { trackingTable } from "@/server/outputs";
import { packIndex, type PackKind } from "@/server/proof";

/**
 * ?kind=tracking&year=2026: the indicator tracking table (Excel), for anyone on the project.
 * ?kind=pack&pack=donor|audit&report=qpr|annual&period=2026-Q3: the evidence pack's index
 * (lib/evidence); the browser zips the files from it. The donor pack is for the MEL owner and
 * programme leads; the audit pack, which holds attendance sheets with names and Finance's figures,
 * for administrators and the MEL owner. Every pack downloaded is in the audit log.
 */

const mayEvidence = (u: AppUser) => u.kind === "employee" && (u.admin || u.project.some((r) => ["mel-owner", "report-release", "plan-approver", "monthly-review"].includes(r)));
const mayAudit = (u: AppUser) => u.kind === "employee" && (u.admin || u.project.includes("mel-owner"));

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const kind = q.get("kind");
    const pack = (q.get("pack") === "audit" ? "audit" : "donor") as PackKind;
    const v = await requireViewer(req, {
      allow: (u) => u.kind === "employee" && (kind !== "pack" || (pack === "audit" ? mayAudit(u) : mayEvidence(u))),
      why: pack === "audit" ? "Only administrators and the MEL owner download the audit pack: it holds attendance sheets with names and Finance's figures." : "Only the MEL owner and programme leads download the evidence pack.",
    });
    if (v instanceof NextResponse) return v;
    if (kind === "tracking") {
      const year = Number(q.get("year"));
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Choose a year." }, { status: 400 });
      const buf = await trackingTable(code, year);
      return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${code}-tracking-${year}.xlsx"` } });
    }
    if (kind === "pack") {
      const r = parseReport(q.get("report"), q.get("period"));
      if (!r || r.kind === "face") return NextResponse.json({ error: "Choose a quarterly or annual report." }, { status: 400 });
      const idx = await packIndex(code, r, pack);
      const project = await projectByCode(code);
      await logAudit(db, project.id, { entity: "report", entityId: project.id, action: `evidence_pack_${pack}`, by: v.actor.id, detail: { report: r.kind, period: r.kind === "qpr" ? r.quarter : r.year, figures: idx.entries.length } });
      return NextResponse.json(idx);
    }
    return NextResponse.json({ error: "Unknown output." }, { status: 400 });
  });
}
