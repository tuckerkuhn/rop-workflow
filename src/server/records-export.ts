import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { keepFile, storeMode } from "@/server/file-store";

/**
 * The organization's project records as one JSON file, a copy kept outside the database
 * (docs/BACKUP-AND-RECOVERY.md). Personal records are left out on purpose: participants' names
 * and phones (farmer_pii), the HR book and its files. Those are covered by the database's own backups.
 */
export const LEFT_OUT = ["farmer_pii", "hr_ledger", "hr_files"];

export const TABLES = {
  organizations: s.organizations,
  staff: s.staff,
  projects: s.projects,
  project_members: s.projectMembers,
  dev_logic_nodes: s.devLogicNodes,
  crops: s.crops,
  budget_lines: s.budgetLines,
  workplan_items: s.workplanItems,
  farmers: s.farmers,
  seasons: s.seasons,
  plots: s.plots,
  evidence: s.evidence,
  field_items: s.fieldItems,
  procurements: s.procurements,
  procurement_plan: s.procurementPlan,
  project_state: s.projectState,
  organization_state: s.organizationState,
  indicators: s.indicators,
  donors: s.donors,
  work_items: s.workItems,
  activities: s.activities,
  training_attendance: s.trainingAttendance,
  readiness_checks: s.readinessChecks,
  corrections: s.corrections,
  expenditures: s.expenditures,
  input_distributions: s.inputDistributions,
  field_visits: s.fieldVisits,
  mel_findings: s.melFindings,
  finding_sources: s.findingSources,
  management_actions: s.managementActions,
  audit_log: s.auditLog,
} as const;


export async function buildExport(by: string) {
  const out: Record<string, unknown[]> = {};
  for (const [name, table] of Object.entries(TABLES)) out[name] = await db.select().from(table);
  const at = new Date().toISOString();
  const counts = Object.fromEntries(Object.entries(out).map(([k, rows]) => [k, rows.length]));
  await db.insert(s.auditLog).values({ projectId: null, entity: "system", entityId: randomUUID(), action: "records_exported", detail: { by, counts } });
  return { at, json: JSON.stringify({ exportedAt: at, by, leftOut: LEFT_OUT, counts, tables: out }), counts };
}

/**
 * ISS-25: the weekly export, run by the scheduled job. Kept in file storage when it is switched on
 * (server/file-store); otherwise the run is recorded as not kept, so Settings, Health says so.
 */
export async function scheduledExport() {
  if (storeMode() !== "supabase") {
    await db.insert(s.auditLog).values({ projectId: null, entity: "system", entityId: randomUUID(), action: "records_export_not_kept", detail: { why: "File storage is off (PROOF_FILE_STORE): download the records from Settings, Health instead." } });
    return { kept: false as const };
  }
  const e = await buildExport("scheduled");
  const path = `exports/rop-workflow-export-${e.at.slice(0, 10)}.json`;
  await keepFile(path, Buffer.from(e.json), "application/json");
  return { kept: true as const, path, counts: e.counts };
}

/** The last scheduled export and whether it was kept: for Settings, Health. */
export async function lastExport() {
  const [mine] = await db
    .select({ at: s.auditLog.at, action: s.auditLog.action })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.entity, "system"), inArray(s.auditLog.action, ["records_exported", "records_export_not_kept"])))
    .orderBy(desc(s.auditLog.at))
    .limit(1);
  return mine ? { at: mine.at.toISOString(), kept: mine.action === "records_exported" } : null;
}
