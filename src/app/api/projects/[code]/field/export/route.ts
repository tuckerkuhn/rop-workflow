import { NextResponse } from "next/server";
import { fieldSteps } from "@/lib/field";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { farmerTable, recordTable, toCsv, type FieldRecord } from "@/lib/field-data";
import { collectorOf } from "@/lib/kobo-approval";
import { formLabel, perFarmer, type SubmissionForm } from "@/lib/project";
import { onProject, people } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { toSubmission } from "@/server/kobo";
import { koboApprovalFor } from "@/server/kobo-approval";
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
    if (new URL(req.url).searchParams.get("table") === "records") return recordsFile(code, v.user.id);
    // Loaded without a viewer, so names are never read at all.
    const { items } = await loadField(code);
    const given = (await listDistributions(code)).map((d) => ({ farmerId: d.farmerId, date: d.date, status: d.status, items: d.items }));
    const table = farmerTable(items, given, (step) => fieldSteps[step]?.title ?? step);
    await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "farmer_table_downloaded", by: v.user.id, detail: { farmers: table.rows.length } });
    return new NextResponse(`﻿${toCsv(table)}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${code}-farmers-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  });
}

const FORMS: SubmissionForm[] = ["training", "readiness", "visit", "distribution"];

/**
 * The field records table (lib/field-data recordTable): one row per training attendance, readiness
 * check, farm visit and distribution, by farmer number. Read from the records themselves, so a
 * record counts here exactly as it does in the review queue.
 */
async function recordsFile(code: string, by: string) {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.evidence).where(and(eq(s.evidence.projectId, project.id), inArray(s.evidence.form, FORMS)));
  const rule = await koboApprovalFor(code);
  const team = (await people()).filter((u) => onProject(u, code));
  // A training session record gives one row for each farmer ticked, so the table still joins to the farmer table by farmer number.
  const records: FieldRecord[] = rows.flatMap((r) => perFarmer([toSubmission(r)]).map((sub) => ({ r, sub }))).map(({ r, sub }) => {
    const fromKobo = r.source === "kobo";
    return {
      id: sub.id || r.id,
      form: r.form ?? "",
      farmerId: r.farmerCode ?? sub.farmerId ?? "",
      date: sub.date || (r.completedAt ?? r.createdAt).toISOString().slice(0, 10),
      source: fromKobo ? "KoboCollect" : sub.source === "app" ? "App" : "Sample",
      // The person when the KoboCollect account is matched to one; otherwise the account as sent.
      collector: (fromKobo ? collectorOf(r.completedBy, rule, team) : null) ?? r.completedBy ?? "",
      status: r.reviewStatus,
      removed: !!r.koboRemovedAt,
      decidedBy: r.reviewedBy ?? "",
      decidedOn: r.reviewedAt ? r.reviewedAt.toISOString().slice(0, 10) : "",
      photo: !!sub.photo,
      fields: Object.fromEntries(Object.entries(sub.fields ?? {}).filter(([, a]) => typeof a === "string").map(([k, a]) => [k, a.slice(0, 300)])),
    };
  });
  const table = recordTable(records, (f) => formLabel[f as SubmissionForm] ?? f);
  await audit(code, { entity: "field", entityId: crypto.randomUUID(), action: "field_records_downloaded", by, detail: { records: table.rows.length } });
  return new NextResponse(`\uFEFF${toCsv(table)}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${code}-field-records-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
}
