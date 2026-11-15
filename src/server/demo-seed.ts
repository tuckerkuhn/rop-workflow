import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { daysFromDemo, realToday, shiftDates } from "@/lib/clock";
import { ORG_ID, PROJECT } from "@/lib/demo";
import { DEMO_SETUP, FIELD_SETUP_KEY } from "@/lib/package";
import { SEASON, seedField, seedStock, type Farmer } from "@/lib/field";
import { seedProcurements } from "@/lib/procurement";
import { seedSubmissions, type Submission } from "@/lib/project";
import { seedStaff } from "@/server/staff";
import { DEMO_PROOF, demoActivities, demoBudget, demoFramework, demoResults, demoSpending, demoWorkplan } from "@/lib/demo-design";
import type { ResultInput } from "@/lib/results";
import { samplePdf } from "@/lib/sample-files";
import { saveFile } from "@/server/hr-files";
import { FRAMEWORK_KEY } from "@/lib/framework";
import { saveActuals } from "@/server/actuals-store";
import { saveBudget, saveWorkplan } from "@/server/plan-store";
import { saveProjectState } from "@/server/project-state";
import { seedDonors, seedIndicators } from "@/server/progress-store";
import { seedWorkItems } from "@/server/work-store";

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
    truncate table audit_log, work_items, donors, indicators, management_actions, finding_sources, mel_findings,
      field_visits, input_distributions, expenditures, corrections, readiness_checks,
      training_attendance, activities, evidence, field_items, project_state, farmer_pii, plots,
      seasons, farmers, budget_lines, crops, dev_logic_nodes, project_members, projects, staff, organizations
    restart identity cascade
  `);

  const [org] = await db.insert(s.organizations).values({ name: "Roots of Peace (demo)" }).returning();
  const [project] = await db
    .insert(s.projects)
    .values({ organizationId: org.id, code: PROJECT.id, name: PROJECT.name, country: "AF", donor: PROJECT.award, startDate: "2026-10-01", endDate: "2028-12-31" })
    .returning();
  const [season] = await db.insert(s.seasons).values({ projectId: project.id, name: SEASON.name, startDate: "2027-01-01", endDate: "2027-10-31" }).returning();
  const [crop] = await db.insert(s.crops).values({ name: SEASON.crop }).returning();

  const farmers = shiftDates(seedField(), daysFromDemo(realToday())).filter((i): i is Farmer => i.kind === "farmer");
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
  await seedStaff();
  return { project: project.code, farmers: farmers.length };
}

/** Restores the demo state of an existing project. Real Kobo submissions are kept and go back to pending. */
export async function resetDemo(code: string) {
  // A second lock, for scripts: only the demo project is ever reset.
  if (code !== "A-2027") throw new Error(`${code} is a real project: its records cannot be reset.`);
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
  await db.delete(s.workItems).where(eq(s.workItems.projectId, project.id));
  await db.delete(s.donors).where(eq(s.donors.projectId, project.id));
  await db.delete(s.indicators).where(eq(s.indicators.projectId, project.id));
  await db.delete(s.projectState).where(eq(s.projectState.projectId, project.id));
  await db.delete(s.procurements).where(eq(s.procurements.projectId, project.id));
  await db.delete(s.evidence).where(and(eq(s.evidence.projectId, project.id), ne(s.evidence.source, "kobo")));
  await db
    .update(s.evidence)
    .set({ reviewStatus: "pending", reviewedBy: null, reviewedAt: null, queryNote: null })
    .where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.source, "kobo")));

  await loadDemoState(project.id, project.organizationId);
}

async function loadDemoState(projectId: string, organizationId: string) {
  // The story starts from today: every date in the sample data moves by the same number of days
  // (lib/clock shiftDates), so its history is in the past and its deadlines are just ahead.
  const days = daysFromDemo(realToday());
  const field = shiftDates(seedField(), days);
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
  // The package with its planting window moved too; without this the window would stay in March 2027.
  // Its season is named for the year the window now falls in ("2027 Spring" would read oddly in another year).
  const setup = shiftDates(DEMO_SETUP, days);
  await db.insert(s.projectState).values({ projectId, key: FIELD_SETUP_KEY, data: days && setup.windowEnd ? { ...setup, season: `${setup.windowEnd.slice(0, 4)} season` } : setup });
  await seedProcurementRows(projectId, organizationId, days);
  await seedWorkItems(projectId, organizationId, days);
  await seedIndicators(projectId);
  await seedDesign(projectId);
  // Report deadlines name calendar months and years ("Monthly report: February"), so they stay as written.
  await seedDonors(projectId, organizationId);
  const subs = shiftDates(seedSubmissions(seedField()), days);
  await seedResults(projectId, organizationId, subs);
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

/**
 * The demo project's design (lib/demo-design): the framework's wording, the budget, the workplan
 * with its owners, and the spending Finance has sent. Without it the demo had field work and
 * purchases with no plan behind them, and Progress, Budget and Activities opened empty.
 */
async function seedDesign(projectId: string) {
  const [project] = await db.select({ code: s.projects.code, startDate: s.projects.startDate }).from(s.projects).where(eq(s.projects.id, projectId)).limit(1);
  if (!project?.code) return;
  const today = realToday();
  await saveBudget(project.code, demoBudget(today));
  await saveWorkplan(project.code, demoWorkplan(today));
  await saveProjectState(projectId, FRAMEWORK_KEY, demoFramework(today));
  await saveProjectState(projectId, "activities", demoActivities(today));
  const spending = demoSpending(project.startDate ?? today, today);
  if (spending) await saveActuals(project.code, spending, { name: "Sample spending (fictional).xlsx", hash: "demo", sharepointUrl: null }, "demo");
}

/**
 * A result for each sample field record that counts toward a target (lib/demo-design), each with
 * its own fictional one-page document as its proof. Accepted records are accepted results; the ones
 * that arrived this week wait for MEL.
 */
async function seedResults(projectId: string, organizationId: string, subs: Submission[]) {
  // Each record gets its own one-page document: records that share a file are flagged as a possible double count.
  const proof: Record<string, ResultInput["files"][number]> = {};
  for (const sub of subs) {
    const title = `${DEMO_PROOF[sub.form]}: ${sub.farmerId}, ${sub.date}`;
    proof[sub.id] = await saveFile(samplePdf(`${title} (fictional sample)`, ["Project: A-2027, a fictional maize project", "Place: Village B (fictional)", "This document is invented for training. It records no real person."]), `${title} (sample).pdf`, "application/pdf", "demo");
  }
  const rows = demoResults(subs, proof);
  if (!rows.length) return;
  await db.insert(s.evidence).values(
    rows.map((r) => ({
      organizationId,
      projectId,
      source: "manual" as const,
      form: "result",
      reviewStatus: r.status,
      completedBy: r.by,
      completedAt: new Date(`${r.payload.date}T12:00:00Z`),
      location: "Village B",
      payload: r.payload,
      reviewedBy: r.reviewedBy,
      reviewedAt: r.reviewedOn ? new Date(`${r.reviewedOn}T12:00:00Z`) : null,
    })),
  );
}

/** The demo procurements. Also used once to fill a project that had them only in browsers. */
export async function seedProcurementRows(projectId: string, organizationId: string | null, days = 0) {
  await db
    .insert(s.procurements)
    .values(shiftDates(seedProcurements(), days).map((p) => ({ organizationId, projectId, procKey: p.id, step: p.step, data: p })))
    .onConflictDoNothing();
}
