import { and, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { SupplierRegister } from "@/lib/suppliers";

/** The supplier register: one organization_state document per organization. */
const KEY = "suppliers";

export async function loadSuppliers(orgId: string): Promise<SupplierRegister> {
  const [row] = await db
    .select()
    .from(s.organizationState)
    .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, KEY)))
    .limit(1);
  return { suppliers: [], ...((row?.data as Partial<SupplierRegister> | undefined) ?? {}) };
}

export async function saveSuppliers(orgId: string, data: SupplierRegister) {
  await db
    .insert(s.organizationState)
    .values({ organizationId: orgId, key: KEY, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
/**
 * Read, change and write the register as one step: the row is locked while the change is made,
 * so two changes at once cannot overwrite each other (a screening match is never lost).
 */
export async function updateSuppliers<T>(orgId: string, change: (reg: SupplierRegister) => T | Promise<T>, next: (result: T) => SupplierRegister | null): Promise<T> {
  return db.transaction(async (tx: Tx) => {
    await tx.execute(sql`select 1 from organization_state where organization_id = ${orgId} and key = ${KEY} for update`);
    const [row] = await tx
      .select()
      .from(s.organizationState)
      .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, KEY)))
      .limit(1);
    const reg: SupplierRegister = { suppliers: [], ...((row?.data as Partial<SupplierRegister>) ?? {}) };
    const result = await change(reg);
    const data = next(result);
    if (data)
      await tx
        .insert(s.organizationState)
        .values({ organizationId: orgId, key: KEY, data })
        .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
    return result;
  });
}
