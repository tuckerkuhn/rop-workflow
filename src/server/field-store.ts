import { and, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { canSeePII, type AppUser } from "@/lib/demo";
import { type FieldItem, type Stock } from "@/lib/field";

/**
 * Field activities state in Postgres. Each farmer or MEL finding is one `field_items` row.
 * Names never go into `field_items`: they live in `farmer_pii` and are added on the way out,
 * only for people whose role may see them.
 */

export async function projectByCode(code: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (!p) throw new Error(`Project ${code} is not in the database. Run npm run db:seed.`);
  return p;
}

/** Copy of an item safe to store: no name. */
function stripPII(item: FieldItem): FieldItem {
  return item.kind === "farmer" ? { ...item, name: "" } : item;
}

export async function loadField(code: string, user?: AppUser) {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.fieldItems).where(eq(s.fieldItems.projectId, project.id));
  const [stockRow] = await db
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, "stock")))
    .limit(1);

  const names = new Map<string, string>();
  if (canSeePII(user)) {
    const pii = await db
      .select({ code: s.farmers.code, name: s.farmerPii.fullName })
      .from(s.farmerPii)
      .innerJoin(s.farmers, eq(s.farmers.id, s.farmerPii.farmerId))
      .where(eq(s.farmers.projectId, project.id));
    pii.forEach((r) => names.set(r.code, r.name));
  }

  const items = rows
    .map((r) => r.data as FieldItem)
    .map((i) => (i.kind === "farmer" ? { ...i, name: names.get(i.id) ?? "" } : i))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { items, stock: (stockRow?.data as Stock | undefined) ?? null };
}

/** Insert or replace the given items (only the ones that changed are sent). */
export async function saveItems(code: string, items: FieldItem[]) {
  if (!items.length) return;
  const project = await projectByCode(code);
  for (const raw of items) {
    const item = stripPII(raw);
    await db
      .insert(s.fieldItems)
      .values({ organizationId: project.organizationId, projectId: project.id, itemKey: item.id, kind: item.kind, data: item })
      .onConflictDoUpdate({ target: [s.fieldItems.projectId, s.fieldItems.itemKey], set: { data: item, kind: item.kind, updatedAt: new Date() } });
  }
}

export async function saveStock(code: string, stock: Stock) {
  const project = await projectByCode(code);
  await db
    .insert(s.projectState)
    .values({ projectId: project.id, key: "stock", data: stock })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data: stock, updatedAt: new Date() } });
}

/** Farmer code → current step, for the data checker. */
export async function roster(projectId: string) {
  const rows = await db
    .select({ key: s.fieldItems.itemKey, data: s.fieldItems.data })
    .from(s.fieldItems)
    .where(and(eq(s.fieldItems.projectId, projectId), eq(s.fieldItems.kind, "farmer")));
  return Object.fromEntries(rows.map((r) => [r.key, (r.data as FieldItem).step]));
}

/** Farmers for the Kobo farmer list: ID, village and household-head initials. Never names. */
export async function farmerListRows(code: string) {
  const project = await projectByCode(code);
  const farmers = await db.select().from(s.farmers).where(eq(s.farmers.projectId, project.id));
  const active = await db
    .select({ key: s.fieldItems.itemKey, data: s.fieldItems.data })
    .from(s.fieldItems)
    .where(and(eq(s.fieldItems.projectId, project.id), inArray(s.fieldItems.itemKey, farmers.map((f) => f.code).concat("__none__"))));
  const removed = new Set(active.filter((r) => (r.data as FieldItem).step === "removed").map((r) => r.key));
  return farmers
    .filter((f) => !removed.has(f.code) && f.status !== "removed")
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((f) => ({ name: f.code, label: [f.code, f.village, f.householdHeadInitials].filter(Boolean).join(" · ") }));
}
