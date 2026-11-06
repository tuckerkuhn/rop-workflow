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

export async function logAudit(exec: Exec, projectId: string, e: AuditEvent) {
  await exec.insert(s.auditLog).values({ projectId, entity: e.entity, entityId: e.entityId, action: e.action, detail: { by: e.by, ...(e.detail ?? {}) } });
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
