import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";

/**
 * Administrators: the organization's project records as one JSON file, a copy kept outside the
 * database (docs/BACKUP-AND-RECOVERY.md). Personal records are left out on purpose: participants'
 * names and phones (farmer_pii), the HR book and its files, and the encrypted KoboToolbox tokens.
 * Those are covered by the database's own backups.
 */
const TABLES = {
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
  kobo_forms: s.koboForms,
  kobo_mappings: s.koboMappings,
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

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => !!u.admin, why: "Only administrators export the records." });
    if (v instanceof NextResponse) return v;
    const out: Record<string, unknown[]> = {};
    for (const [name, table] of Object.entries(TABLES)) out[name] = await db.select().from(table);
    const at = new Date().toISOString();
    const counts = Object.fromEntries(Object.entries(out).map(([k, rows]) => [k, rows.length]));
    await db.insert(s.auditLog).values({ projectId: null, entity: "system", entityId: randomUUID(), action: "records_exported", detail: { by: v.actor.id, counts } });
    return new NextResponse(JSON.stringify({ exportedAt: at, by: v.actor.id, leftOut: ["farmer_pii", "hr_ledger", "hr_files", "kobo_connections"], counts, tables: out }), {
      headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="rop-workflow-export-${at.slice(0, 10)}.json"`, "Cache-Control": "no-store" },
    });
  });
}
