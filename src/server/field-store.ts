import { CROP_PLAN_KEY, type CropPlan } from "@/lib/crops";
import { EMPTY_FRAMEWORK, FRAMEWORK_KEY, type Framework } from "@/lib/framework";
import { mirrorFarmer } from "@/server/farmer-mirror";
import { loadProjectState, saveProjectState, type Reader } from "@/server/project-state";
import { DEMO_SETUP, FIELD_SETUP_KEY, type FieldSetup } from "@/lib/package";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { canSeePII, type AppUser } from "@/lib/demo";
import { type FieldItem, type Stock } from "@/lib/field";
import { HttpError } from "@/server/guard";

/**
 * Field activities state in Postgres. Each farmer or MEL finding is one `field_items` row.
 * Names never go into `field_items`: they live in `farmer_pii` and are added on the way out,
 * only for people whose role may see them.
 */

export async function projectByCode(code: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (!p) throw new HttpError(404, `There is no project ${code} here. Check the address, or choose the project again from Home.`);
  return p;
}

/**
 * The donor's name as reports print it. One source: the donor entered in setup and Settings (the
 * `donors` table). `projects.donor` is an older column no screen writes; it is read only when a
 * project has no donor entered, or to say which of several donors a single-donor report is for.
 */
export async function donorNameOf(project: { id: string; donor: string | null }): Promise<string | null> {
  const rows = await db.select({ name: s.donors.name }).from(s.donors).where(eq(s.donors.projectId, project.id)).orderBy(asc(s.donors.createdAt));
  const names = [...new Set(rows.map((r) => r.name.trim()).filter(Boolean))];
  if (names.length === 1) return names[0];
  return project.donor ?? (names.length ? names.join(" and ") : null);
}

/**
 * The project's goal as reports and AI drafts read it. One reader: the wording a plan approver
 * gave on the results framework (it carries its source and who worded it); until then, the goal
 * entered in setup.
 */
export async function goalOf(project: { id: string; goal: string | null }): Promise<string | null> {
  const fw = await loadProjectState<Framework>(project.id, FRAMEWORK_KEY, EMPTY_FRAMEWORK);
  return fw.goal?.text?.trim() || project.goal;
}

/** The demo project: its package and season come with it (lib/package DEMO_SETUP). */
export const DEMO_FIELD_PROJECT = "A-2027";

/**
 * A project's input package and season. The demo project has one built in; any other project has
 * one once its manager sets it up in Field activities, and until then has no field workflow.
 */
export async function setupOf(project: { id: string; code: string | null; crop?: string | null }, q?: Reader): Promise<FieldSetup | null> {
  // A draft (pre-filled for a manager to confirm) does not switch Field activities on.
  const stored = await loadProjectState<(FieldSetup & { draft?: boolean }) | null>(project.id, FIELD_SETUP_KEY, null, q);
  const setup = stored?.items?.length && !stored.draft ? stored : project.code === DEMO_FIELD_PROJECT ? DEMO_SETUP : null;
  if (!setup) return null;
  // The crop plan decided at initiation (Set up → Crop) rides along, for planting and its checks.
  const plan = await loadProjectState<CropPlan | null>(project.id, CROP_PLAN_KEY, null, q);
  // The crop is the project's, from its design: asked once, never again for the package.
  const crop = project.crop !== undefined ? project.crop : ((await (q ?? db).select({ crop: s.projects.crop }).from(s.projects).where(eq(s.projects.id, project.id)).limit(1))[0]?.crop ?? null);
  const { plan: _old, ...rest } = setup;
  void _old;
  return { ...rest, ...(crop ? { crop } : {}), ...(plan ? { plan } : {}) };
}
/** Codes of the projects with an input package (not a draft), so Field activities runs on them. */
export async function projectsWithField(): Promise<Set<string>> {
  const rows = await db
    .select({ code: s.projects.code, data: s.projectState.data })
    .from(s.projectState)
    .innerJoin(s.projects, eq(s.projects.id, s.projectState.projectId))
    .where(eq(s.projectState.key, FIELD_SETUP_KEY));
  return new Set(rows.filter((r) => r.code && (r.data as { items?: unknown[]; draft?: boolean } | null)?.items?.length && !(r.data as { draft?: boolean }).draft).map((r) => r.code!));
}

export const setupFor = async (code: string) => setupOf(await projectByCode(code));

export async function saveSetup(code: string, setup: FieldSetup) {
  const project = await projectByCode(code);
  // The crop plan belongs to the project design, not the package: never stored here.
  const { plan: _plan, ...rest } = setup;
  void _plan;
  await saveProjectState(project.id, FIELD_SETUP_KEY, rest);
}

/** Copy of an item safe to store: no name. */
function stripPII(item: FieldItem): FieldItem {
  return item.kind === "farmer" ? { ...item, name: "" } : item;
}

/** Farmers' names by farmer number, only for people allowed to see participants' names; empty for anyone else. */
export async function farmerNames(projectId: string, user?: AppUser | null): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (!canSeePII(user)) return names;
  const pii = await db
    .select({ code: s.farmers.code, name: s.farmerPii.fullName })
    .from(s.farmerPii)
    .innerJoin(s.farmers, eq(s.farmers.id, s.farmerPii.farmerId))
    .where(eq(s.farmers.projectId, projectId));
  pii.forEach((r) => names.set(r.code, r.name));
  return names;
}

export async function loadField(code: string, user?: AppUser) {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.fieldItems).where(eq(s.fieldItems.projectId, project.id));
  const [stockRow] = await db
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, "stock")))
    .limit(1);

  const names = await farmerNames(project.id, user);

  const items = rows
    .map((r) => ({ ...(r.data as FieldItem), rev: r.updatedAt.toISOString() }) as FieldItem)
    .map((i): FieldItem => (i.kind === "farmer" ? { ...i, name: names.get(i.id) ?? "" } : i))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { items, stock: (stockRow?.data as Stock | undefined) ?? null, setup: await setupOf(project) };
}

/** What is stored for an item: no name (farmer_pii holds it) and no version stamp. */
const storable = (raw: FieldItem): FieldItem => {
  const { rev: _rev, ...item } = stripPII(raw);
  void _rev;
  return item as FieldItem;
};

/**
 * Saves items edited in the browser, each only if it is still the version the browser read (`rev`).
 * A record changed since (a Kobo record accepted, a distribution approved, someone else's save) is
 * refused whole, so a stale page never writes over newer work. All or nothing; returns the new
 * versions.
 */
export async function saveEdited(code: string, items: FieldItem[]): Promise<Record<string, string>> {
  const project = await projectByCode(code);
  const revs: Record<string, string> = {};
  await db.transaction(async (tx) => {
    for (const raw of items) {
      const item = storable(raw);
      const now = new Date();
      const where = and(eq(s.fieldItems.projectId, project.id), eq(s.fieldItems.itemKey, item.id));
      const [updated] = raw.rev
        ? await tx
            .update(s.fieldItems)
            .set({ data: item, kind: item.kind, updatedAt: now })
            .where(and(where, sql`date_trunc('milliseconds', ${s.fieldItems.updatedAt}) = ${raw.rev}::timestamptz`))
            .returning({ at: s.fieldItems.updatedAt })
        : await tx
            .insert(s.fieldItems)
            .values({ organizationId: project.organizationId, projectId: project.id, itemKey: item.id, kind: item.kind, data: item, updatedAt: now })
            .onConflictDoNothing()
            .returning({ at: s.fieldItems.updatedAt });
      if (!updated) throw new HttpError(409, `${item.kind === "farmer" ? `Farmer ${item.id}` : `Finding ${item.id}`} was changed by someone else since you opened this page, so your change was not saved. The page now shows the latest; make your change again.`);
      await mirrorFarmer(tx, project.id, item);
      revs[item.id] = updated.at.toISOString();
    }
  });
  return revs;
}

/** Insert or replace the given items, whatever version is stored (seeding, imports, tests). */
export async function saveItems(code: string, items: FieldItem[]) {
  if (!items.length) return;
  const project = await projectByCode(code);
  for (const raw of items) {
    const item = storable(raw);
    await db
      .insert(s.fieldItems)
      .values({ organizationId: project.organizationId, projectId: project.id, itemKey: item.id, kind: item.kind, data: item })
      .onConflictDoUpdate({ target: [s.fieldItems.projectId, s.fieldItems.itemKey], set: { data: item, kind: item.kind, updatedAt: new Date() } });
    await mirrorFarmer(db, project.id, item);
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
  const hectares = new Map(active.filter((r) => (r.data as FieldItem).kind === "farmer").map((r) => [r.key, (r.data as { hectares?: number }).hectares ?? null]));
  // The village comes from the working record (server/farmer-mirror): it is the one kept up to date.
  const village = new Map(active.map((r) => [r.key, (r.data as { community?: string }).community || null]));
  return farmers
    .filter((f) => !removed.has(f.code) && f.status !== "removed")
    .sort((a, b) => a.code.localeCompare(b.code))
    .map((f) => ({ name: f.code, label: [f.code, village.get(f.code) ?? f.village, f.householdHeadInitials].filter(Boolean).join(" · "), hectares: hectares.get(f.code) ?? null }));
}
