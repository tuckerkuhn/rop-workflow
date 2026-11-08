import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { DRAFT_RUN_LAYOUT, type RunLayout } from "@/lib/payroll";

/** Payroll's own settings (the ADP RUN file layout), with every change kept. One per organization. */
type Settings = { run: RunLayout; history: { at: string; by: string; byName: string; reason: string; run: RunLayout }[] };
const KEY = "payroll-settings";

export async function loadPayrollSettings(orgId: string): Promise<Settings> {
  const [row] = await db
    .select()
    .from(s.organizationState)
    .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, KEY)))
    .limit(1);
  const d = (row?.data as Partial<Settings> | undefined) ?? {};
  return { run: { ...DRAFT_RUN_LAYOUT, ...(d.run ?? {}), codes: { ...DRAFT_RUN_LAYOUT.codes, ...(d.run?.codes ?? {}) } }, history: d.history ?? [] };
}

export async function saveRunLayout(orgId: string, run: RunLayout, who: { id: string; name: string }, reason: string) {
  const cur = await loadPayrollSettings(orgId);
  const data: Settings = { run, history: [...cur.history, { at: new Date().toISOString().slice(0, 10), by: who.id, byName: who.name, reason, run }] };
  await db
    .insert(s.organizationState)
    .values({ organizationId: orgId, key: KEY, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}
