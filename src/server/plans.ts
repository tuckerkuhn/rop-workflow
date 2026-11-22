import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { effectivePlan, isPlan, trialActive, trialEnd, type Plan } from "@/lib/plans";
import type { Viewer } from "@/server/auth";

/** Which plan an organization is on. Screens check features with useFeature; this supplies the plan. */

async function firstOrganization() {
  const [org] = await db.select({ plan: s.organizations.plan, trialEndsAt: s.organizations.trialEndsAt }).from(s.organizations).orderBy(asc(s.organizations.createdAt)).limit(1);
  return org ?? null;
}

async function orgOf(viewer: Viewer | null) {
  if (!viewer?.actorStaffId) return firstOrganization();
  const [row] = await db
    .select({ plan: s.organizations.plan, trialEndsAt: s.organizations.trialEndsAt })
    .from(s.staff)
    .innerJoin(s.organizations, eq(s.organizations.id, s.staff.organizationId))
    .where(eq(s.staff.id, viewer.actorStaffId))
    .limit(1);
  return row ?? null;
}

/**
 * The plan of the signed-in person's organization, with what a running trial adds: the paid plan's
 * features while it runs (`plan` is then "paid") and when it ends. Demo sign-in has no staff row,
 * so it uses the first organization (the pilot has one).
 */
export async function planDetails(viewer: Viewer | null): Promise<{ plan: Plan; trialEndsAt: string | null }> {
  const org = await orgOf(viewer);
  const base: Plan = isPlan(org?.plan) ? org.plan : "free";
  const trial = base !== "paid" && trialActive(org?.trialEndsAt) ? org!.trialEndsAt!.toISOString() : null;
  return { plan: effectivePlan(base, trial), trialEndsAt: trial };
}

/** The plan whose features are on for the signed-in person's organization (the paid plan during a trial). */
export async function planFor(viewer: Viewer | null): Promise<Plan> {
  return (await planDetails(viewer)).plan;
}

async function pick(name?: string) {
  const orgs = await db.select().from(s.organizations);
  const org = name ? orgs.find((o) => o.name === name) : orgs.length === 1 ? orgs[0] : null;
  if (!org) throw new Error(name ? `No organization called "${name}".` : `There are ${orgs.length} organizations; name one with --org, or use --all.`);
  return org;
}

/** Sets an organization's plan by name, or the only organization when no name is given. */
export async function setPlan(plan: Plan, name?: string) {
  const org = await pick(name);
  await db.update(s.organizations).set({ plan, updatedAt: new Date() }).where(eq(s.organizations.id, org.id));
  return org.name;
}

/**
 * Starts a free trial of the paid plan for `months` from now: one organization by name, the only
 * one, or every organization (`all`). A later end already given is kept; returns who has it until when.
 */
export async function startTrial(months: number, target: { name?: string; all?: boolean } = {}, now = new Date()) {
  const orgs = target.all ? await db.select().from(s.organizations) : [await pick(target.name)];
  const end = trialEnd(now, months);
  const out: { name: string; until: string }[] = [];
  for (const o of orgs) {
    const until = o.trialEndsAt && o.trialEndsAt > end ? o.trialEndsAt : end;
    await db.update(s.organizations).set({ trialEndsAt: until, updatedAt: new Date() }).where(eq(s.organizations.id, o.id));
    out.push({ name: o.name, until: until.toISOString() });
  }
  return out;
}

/** Ends a trial now (the organization keeps the plan it is on). */
export async function endTrial(target: { name?: string; all?: boolean } = {}) {
  const orgs = target.all ? await db.select().from(s.organizations) : [await pick(target.name)];
  for (const o of orgs) await db.update(s.organizations).set({ trialEndsAt: null, updatedAt: new Date() }).where(eq(s.organizations.id, o.id));
  return orgs.map((o) => o.name);
}

export const listPlans = async () =>
  (await db.select({ name: s.organizations.name, plan: s.organizations.plan, trialEndsAt: s.organizations.trialEndsAt }).from(s.organizations)).map(
    (o) => `${o.name}: ${o.plan}${o.trialEndsAt ? (trialActive(o.trialEndsAt) ? `, paid-plan trial until ${o.trialEndsAt.toISOString().slice(0, 10)}` : `, trial ended ${o.trialEndsAt.toISOString().slice(0, 10)}`) : ""}`,
  );
