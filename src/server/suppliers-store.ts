import { and, eq } from "drizzle-orm";
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
