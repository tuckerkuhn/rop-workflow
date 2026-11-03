import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { isPlan, type Plan } from "@/lib/plans";
import type { Viewer } from "@/server/auth";

/** Which plan an organization is on. Screens check features with useFeature; this supplies the plan. */

async function firstOrganization() {
  const [org] = await db.select().from(s.organizations).orderBy(asc(s.organizations.createdAt)).limit(1);
  return org ?? null;
}

/**
 * The plan of the signed-in person's organization. Demo sign-in has no staff row, so it uses the
 * first organization (the pilot has one).
 */
export async function planFor(viewer: Viewer | null): Promise<Plan> {
  let org = null;
  if (viewer?.actorStaffId) {
    const [row] = await db
      .select({ plan: s.organizations.plan })
      .from(s.staff)
      .innerJoin(s.organizations, eq(s.organizations.id, s.staff.organizationId))
      .where(eq(s.staff.id, viewer.actorStaffId))
      .limit(1);
    org = row ?? null;
  } else org = await firstOrganization();
  return isPlan(org?.plan) ? org.plan : "free";
}

/** Sets an organization's plan by name, or the only organization when no name is given. */
export async function setPlan(plan: Plan, name?: string) {
  const orgs = await db.select().from(s.organizations);
  const org = name ? orgs.find((o) => o.name === name) : orgs.length === 1 ? orgs[0] : null;
  if (!org) throw new Error(name ? `No organization called "${name}".` : `There are ${orgs.length} organizations; name one with --org.`);
  await db.update(s.organizations).set({ plan, updatedAt: new Date() }).where(eq(s.organizations.id, org.id));
  return org.name;
}

export const listPlans = async () => (await db.select({ name: s.organizations.name, plan: s.organizations.plan }).from(s.organizations)).map((o) => `${o.name}: ${o.plan}`);
