import { NextResponse } from "next/server";
import { fieldSteps } from "@/lib/field";
import { farmerTable, toCsv } from "@/lib/field-data";
import { requireViewer } from "@/server/auth";
import { listDistributions } from "@/server/distribution";
import { loadField } from "@/server/field-store";
import { audit, handle } from "@/server/guard";

/**
 * The farmer table as a spreadsheet file (lib/field-data): one row per farmer, by number, with
 * each step's date, how readiness went and what they received. Never a name, whoever asks.
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" && u.fieldAccess !== "none", why: "Only staff who can see Field activities can download the farmer table." });
    if (v instanceof NextResponse) return v;
    // Loaded without a viewer, so names are never read at all.
    const { items } = await loadField(code);
    const given = (await listDistributions(code)).map((d) => ({ farmerId: d.farmerId, date: d.date, status: d.status, items: d.items }));
    const table = farmerTable(items, given, (step) => fieldSteps[step]?.title ?? step);
    await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "farmer_table_downloaded", by: v.user.id, detail: { farmers: table.rows.length } });
    return new NextResponse(`﻿${toCsv(table)}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${code}-farmers-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  });
}
