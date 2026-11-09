import { NextResponse } from "next/server";
import type { AppUser } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { evidenceIndex, trackingTable } from "@/server/outputs";

/**
 * ?kind=tracking&year=2026: the indicator tracking table (Excel), for anyone on the project.
 * ?kind=evidence&q=2026-Q3: the evidence annex's index, for the MEL owner and programme leads only:
 * its files include attendance sheets with full names. The browser zips the files from it.
 */

const mayEvidence = (u: AppUser) => u.kind === "employee" && (u.admin || u.project.some((r) => ["mel-owner", "report-release", "plan-approver", "monthly-review"].includes(r)));

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const q = new URL(req.url).searchParams;
    const kind = q.get("kind");
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" && (kind !== "evidence" || mayEvidence(u)), why: "Only the MEL owner and programme leads download the evidence annex: it holds attendance sheets with names." });
    if (v instanceof NextResponse) return v;
    if (kind === "tracking") {
      const year = Number(q.get("year"));
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return NextResponse.json({ error: "Choose a year." }, { status: 400 });
      const buf = await trackingTable(code, year);
      return new NextResponse(new Uint8Array(buf), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${code}-tracking-${year}.xlsx"` } });
    }
    if (kind === "evidence") {
      const quarter = q.get("q") ?? "";
      if (!/^\d{4}-Q[1-4]$/.test(quarter)) return NextResponse.json({ error: "Choose a quarter." }, { status: 400 });
      return NextResponse.json(await evidenceIndex(code, quarter));
    }
    return NextResponse.json({ error: "Unknown output." }, { status: 400 });
  });
}
