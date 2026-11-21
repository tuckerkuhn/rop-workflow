import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { daysFromDemo, realToday, shiftDates } from "@/lib/clock";
import { NEW_PROJECT, ORG_ID, PROJECT } from "@/lib/demo";
import { sampleProposal } from "@/lib/funding-proposals-sample";
import { KOBO_APPROVAL_KEY, NEW_PROJECT_KOBO_APPROVAL, type KoboApproval } from "@/lib/kobo-approval";
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
import { rebuildPlan } from "@/server/procurement-plan-store";
import { saveProjectState } from "@/server/project-state";
import { seedDonors, seedIndicators } from "@/server/progress-store";
import { seedWorkItems } from "@/server/work-store";
import { seedDemoReport } from "@/server/demo-report";

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
    // Fully set up and running: its plan is signed off, so nobody is asked to sign it off again.
    .values({ organizationId: org.id, code: PROJECT.id, name: PROJECT.name, country: "AF", donor: PROJECT.award, startDate: "2026-10-01", endDate: "2028-12-31", stage: "Execute" })
    .returning();
  // The second demo project: just won, still to be set up (lib/demo NEW_PROJECT).
  await resetNewProject(org.id);
  // Who can start proposals in the demo: the executive head and programme management by role
  // type, and three people by name, so the demo's lead account can open it.
  await db
    .insert(s.organizationState)
    .values({ organizationId: org.id, key: "proposal-core", data: { roles: ["ceo", "management"], people: ["peter", "marcus", "diego"] } })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data: { roles: ["ceo", "management"], people: ["peter", "marcus", "diego"] }, updatedAt: new Date() } });
  // One fictional proposal a week from its deadline (lib/funding-proposals-sample).
  await db
    .insert(s.organizationState)
    .values({ organizationId: org.id, key: "funding-proposals", data: { items: [sampleProposal(new Date().toISOString().slice(0, 10))] } })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data: { items: [sampleProposal(new Date().toISOString().slice(0, 10))] }, updatedAt: new Date() } });
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
  // The finished demo project is running; the just-won one goes back to having nothing set up.
  await db.update(s.projects).set({ stage: "Execute", updatedAt: new Date() }).where(eq(s.projects.id, project.id));
  await resetNewProject(project.organizationId);
}

/**
 * The demo's second project (lib/demo NEW_PROJECT) as it is on the day it is won: there, with
 * nothing set up. Made when missing; when present its setup, targets and field records are
 * cleared, but only while it is still the fictional sandbox this file made.
 */
export async function resetNewProject(organizationId: string) {
  const [p] = await db.select().from(s.projects).where(eq(s.projects.code, NEW_PROJECT.id)).limit(1);
  const named = (projectId: string) => db.insert(s.projectState).values({ projectId, key: KOBO_APPROVAL_KEY, data: NEW_PROJECT_KOBO_APPROVAL });
  if (!p) {
    const [made] = await db.insert(s.projects).values({ organizationId, code: NEW_PROJECT.id, name: NEW_PROJECT.name, country: NEW_PROJECT.country, donor: NEW_PROJECT.award, crop: NEW_PROJECT.crop, startDate: NEW_PROJECT.startDate, endDate: NEW_PROJECT.endDate, stage: "Design", kind: "sandbox" }).returning();
    await named(made.id);
    return;
  }
  if (p.kind !== "sandbox") return;
  await db.delete(s.projectState).where(eq(s.projectState.projectId, p.id));
  await db.delete(s.fieldItems).where(eq(s.fieldItems.projectId, p.id));
  await db.delete(s.indicators).where(eq(s.indicators.projectId, p.id));
  // Like any project made from now on: one named approver for KoboCollect data, still to be chosen.
  await named(p.id);
}

async function loadDemoState(projectId: string, organizationId: string) {
  // The story starts from today: every date in the sample data moves by the same number of days
  // (lib/clock shiftDates), so its history is in the past and its deadlines are just ahead.
  const days = daysFromDemo(realToday());
  const subs = shiftDates(seedSubmissions(seedField()), days);
  // A farmer whose distribution still waits for the project manager stays at "distribute" until
  // it is approved (server/distribution), as on a real project.
  const waiting = new Set(subs.filter((x) => x.form === "distribution" && x.status === "pending").map((x) => x.farmerId));
  const field = shiftDates(seedField(), days).map((i) => (i.kind === "farmer" && i.step === "plant" && waiting.has(i.id) ? { ...i, step: "distribute" } : i));
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
  // Who approves KoboCollect data here: one named person, the Director of MEL, with the MEL officer as stand-in.
  const approval: KoboApproval = { who: "named", person: "rahima", standIn: "omar" };
  await db.insert(s.projectState).values({ projectId, key: KOBO_APPROVAL_KEY, data: approval });
  await seedProcurementRows(projectId, organizationId, days);
  await seedWorkItems(projectId, organizationId, days);
  await seedIndicators(projectId);
  await seedDesign(projectId);
  // Report deadlines name calendar months and years ("Monthly report: February"), so they stay as written.
  await seedDonors(projectId, organizationId);
  await seedResults(projectId, organizationId, subs);
  const rows = await db.insert(s.evidence).values(
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
  ).returning({ id: s.evidence.id, form: s.evidence.form, farmerCode: s.evidence.farmerCode, reviewStatus: s.evidence.reviewStatus });
  // Those farmers wait at "distribute" on their own record, as distribution.prepare marks them.
  for (const r of rows.filter((x) => x.form === "distribution" && x.reviewStatus === "pending" && x.farmerCode)) {
    const [item] = await db.select().from(s.fieldItems).where(and(eq(s.fieldItems.projectId, projectId), eq(s.fieldItems.itemKey, r.farmerCode!))).limit(1);
    if (item && (item.data as Farmer).step === "distribute") await db.update(s.fieldItems).set({ data: { ...(item.data as Farmer), awaiting: { id: r.id, status: "pending" } } }).where(eq(s.fieldItems.id, item.id));
  }
  // What each donor funds, and the last ended quarter's report released, so a donor's account opens on something real.
  await seedDemoReport(projectId);
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
  // The procurement calendar, built from the budget as the procurement manager would with one
  // tap, so the finished demo project opens with every part of its plan in place.
  await rebuildPlan(project.code);
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
