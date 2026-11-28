import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { HttpError } from "@/server/guard";
import { orgIdForPerson } from "@/server/org-settings-store";
import { lastExport } from "@/server/records-export";
import { storeMode } from "@/server/file-store";

/**
 * ISS-25: the backup plan, confirmed by an administrator: the database service's daily backups are
 * on (its paid plan) and the weekly export is kept. Confirmed again every 90 days, so it is never
 * assumed for years.
 */
const KEY = "backup-plan";
export const RECONFIRM_DAYS = 90;
export type BackupPlan = { confirmedBy: string; byName: string; at: string; dailyBackups: boolean; note: string };

export async function backupStatus(orgId: string | null) {
  const [row] = orgId ? await db.select().from(s.organizationState).where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, KEY))).limit(1) : [];
  const plan = (row?.data as BackupPlan | undefined) ?? null;
  const age = plan ? Math.floor((Date.now() - Date.parse(plan.at)) / 86_400_000) : null;
  return { plan, due: !plan || (age ?? 0) >= RECONFIRM_DAYS, exportKept: storeMode() === "supabase", lastExport: await lastExport() };
}

export async function confirmBackupPlan(u: AppUser, dailyBackups: boolean, note: string) {
  if (!u.admin) throw new HttpError(403, "Only an administrator confirms the backup plan.");
  const org = await orgIdForPerson(u.id);
  if (!org) throw new HttpError(409, "No organization is set up yet.");
  const data: BackupPlan = { confirmedBy: u.id, byName: u.name, at: new Date().toISOString(), dailyBackups, note };
  await db
    .insert(s.organizationState)
    .values({ organizationId: org, key: KEY, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
  await db.insert(s.auditLog).values({ projectId: null, entity: "system", entityId: crypto.randomUUID(), action: "backup_plan_confirmed", detail: { by: u.id, dailyBackups, note } });
  return backupStatus(org);
}
