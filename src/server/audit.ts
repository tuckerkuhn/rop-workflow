import { and, asc, eq, gte, lte } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { projectByCode } from "@/server/field-store";

/**
 * The project's audit trail: one audit_log row per decision or change that matters for an audit
 * (results recorded, accepted or queried, proof added, report edits, AI drafts and release,
 * spending imports, stage sign-offs, procurement calendar approvals, Kobo reviews). `detail.by`
 * is the person (app user id). Written in the same transaction as the change where there is one.
 */

type Exec = Pick<typeof db, "insert">;

/** Who may read the trail: the people who sign things off or review them. */
export const mayViewAudit = (u: AppUser) => u.kind === "employee" && (u.admin || u.project.some((r) => ["plan-approver", "report-release", "monthly-review", "mel-owner"].includes(r)));

export type AuditEvent = { entity: string; entityId: string; action: string; by: string; detail?: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The row for an event. The log's entity id is a database id; things numbered for people (a bill
 * "BL-004", a purchase "PR-2027-016") are filed under their project with the number kept in
 * `detail.ref`, so an entry is never refused for the shape of its id.
 */
export function auditRow(projectId: string, e: AuditEvent) {
  const known = UUID.test(e.entityId);
  return { projectId, entity: e.entity, entityId: known ? e.entityId : projectId, action: e.action, detail: { by: e.by, ...(known ? {} : { ref: e.entityId }), ...(e.detail ?? {}) } };
}

export async function logAudit(exec: Exec, projectId: string, e: AuditEvent) {
  await exec.insert(s.auditLog).values(auditRow(projectId, e));
}

export type AuditRow = { at: string; seq: number | null; entity: string; entityId: string; action: string; by: string | null; detail: Record<string, unknown> };

/** Entries for one project between two dates (inclusive, by calendar day in UTC), oldest first. */
export async function auditTrail(code: string, from: string, to: string): Promise<AuditRow[]> {
  const project = await projectByCode(code);
  const rows = await db
    .select()
    .from(s.auditLog)
    .where(and(eq(s.auditLog.projectId, project.id), gte(s.auditLog.at, new Date(`${from}T00:00:00Z`)), lte(s.auditLog.at, new Date(`${to}T23:59:59.999Z`))))
    .orderBy(asc(s.auditLog.at), asc(s.auditLog.sequence));
  return rows.map((r) => {
    const detail = (r.detail as Record<string, unknown> | null) ?? {};
    const by = typeof detail.by === "string" ? detail.by : typeof detail.person === "string" ? detail.person : null;
    return { at: r.at.toISOString(), seq: r.sequence, entity: r.entity, entityId: r.entityId, action: r.action, by, detail };
  });
}
