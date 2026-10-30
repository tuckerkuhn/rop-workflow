import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { ORG_ID, PROJECT } from "@/lib/demo";
import { SEASON, seedField, seedStock, type Farmer } from "@/lib/field";
import { seedSubmissions } from "@/lib/project";

/**
 * Demo project A-2027 in the database: the same fictional farmers, findings, stock and sample
 * review-queue records the app showed from browser storage. Sample records are stored with
 * source "manual" so they are never mistaken for Kobo data.
 */

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => `${w[0].toUpperCase()}.`)
    .join("");

/** Wipes the whole database and loads the demo project. Development databases only. */
export async function seedDatabase() {
  await db.execute(sql`
    truncate table audit_log, management_actions, finding_sources, mel_findings,
      field_visits, input_distributions, expenditures, corrections, readiness_checks,
      training_attendance, activities, evidence, field_items, project_state, farmer_pii, plots,
      seasons, farmers, budget_lines, crops, dev_logic_nodes, project_members, projects, staff, organizations
    restart identity cascade
  `);

  const [org] = await db.insert(s.organizations).values({ name: "Roots of Peace (demo)" }).returning();
  const [project] = await db
    .insert(s.projects)
    .values({ organizationId: org.id, code: PROJECT.id, name: PROJECT.name, country: "AF", donor: PROJECT.award, startDate: "2026-10-01", endDate: "2027-11-30" })
    .returning();
  const [season] = await db.insert(s.seasons).values({ projectId: project.id, name: SEASON.name, startDate: "2027-01-01", endDate: "2027-10-31" }).returning();
  const [crop] = await db.insert(s.crops).values({ name: SEASON.crop }).returning();

  const farmers = seedField().filter((i): i is Farmer => i.kind === "farmer");
  for (const [k, f] of farmers.entries()) {
    const [row] = await db
      .insert(s.farmers)
      .values({
        organizationId: org.id,
        projectId: project.id,
        code: f.id,
        village: f.community,
        householdHeadInitials: initials(f.name),
        status: f.step === "removed" ? "removed" : "enrolled",
        contributionPaid: f.contributionPaid,
        enrolledOn: f.enrolledOn,
      })
      .returning();
    await db.insert(s.farmerPii).values({ farmerId: row.id, fullName: f.name });
    await db.insert(s.plots).values({ farmerId: row.id, seasonId: season.id, cropId: crop.id, code: `P-${String(k + 1).padStart(4, "0")}`, areaHa: String(f.hectares) });
  }

  await loadDemoState(project.id, org.id);
  return { project: project.code, farmers: farmers.length };
}

/** Restores the demo state of an existing project. Real Kobo submissions are kept and go back to pending. */
export async function resetDemo(code: string) {
  const [project] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
  if (!project) throw new Error(`Project ${code} is not in the database. Run npm run db:seed.`);

  const plotIds = (
    await db
      .select({ id: s.plots.id })
      .from(s.plots)
      .innerJoin(s.farmers, eq(s.farmers.id, s.plots.farmerId))
      .where(eq(s.farmers.projectId, project.id))
  ).map((p) => p.id);
  if (plotIds.length) {
    const checks = (await db.select({ id: s.readinessChecks.id }).from(s.readinessChecks).where(inArray(s.readinessChecks.plotId, plotIds))).map((c) => c.id);
    if (checks.length) await db.delete(s.corrections).where(inArray(s.corrections.readinessCheckId, checks));
    await db.delete(s.readinessChecks).where(inArray(s.readinessChecks.plotId, plotIds));
  }
  await db.delete(s.fieldItems).where(eq(s.fieldItems.projectId, project.id));
  await db.delete(s.projectState).where(eq(s.projectState.projectId, project.id));
  await db.delete(s.evidence).where(and(eq(s.evidence.projectId, project.id), ne(s.evidence.source, "kobo")));
  await db
    .update(s.evidence)
    .set({ reviewStatus: "pending", reviewedBy: null, reviewedAt: null, queryNote: null })
    .where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.source, "kobo")));

  await loadDemoState(project.id, project.organizationId);
}

async function loadDemoState(projectId: string, organizationId: string) {
  const field = seedField();
  await db.insert(s.fieldItems).values(
    field.map((i) => ({
      organizationId,
      projectId,
      itemKey: i.id,
      kind: i.kind,
      // Names never go into field_items.
      data: i.kind === "farmer" ? { ...i, name: "", orgId: ORG_ID } : i,
    })),
  );
  await db.insert(s.projectState).values({ projectId, key: "stock", data: seedStock() });
  const subs = seedSubmissions(field);
  await db.insert(s.evidence).values(
    subs.map((sub) => ({
      organizationId,
      projectId,
      source: "manual" as const,
      form: sub.form,
      farmerCode: sub.farmerId,
      completedBy: sub.enumerator,
      completedAt: new Date(`${sub.date}T09:00:00Z`),
      payload: sub,
      reviewStatus: sub.status,
      reviewedBy: sub.decidedBy ?? null,
      reviewedAt: sub.decidedOn ? new Date(`${sub.decidedOn}T12:00:00Z`) : null,
    })),
  );
}
