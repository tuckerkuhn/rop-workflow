/**
 * Synthetic seed data: one fictional project and season run through
 * workflow steps 1-7. No real farmer information. Run with `npm run db:seed`.
 */
import { faker } from "@faker-js/faker";
import { sql } from "drizzle-orm";
import { db, schema as s } from "./index";

faker.seed(42); // deterministic output

const FARMER_COUNT = 20;

async function main() {
  // Clear everything so the seed can be re-run (dev databases only).
  await db.execute(sql`
    truncate table audit_log, management_actions, finding_sources, mel_findings,
      field_visits, input_distributions, expenditures, corrections, readiness_checks,
      training_attendance, activities, evidence, plots, seasons, farmers, budget_lines,
      crops, dev_logic_nodes, project_members, projects, staff, organizations
    restart identity cascade
  `);

  const [org] = await db.insert(s.organizations).values({ name: "ROP (synthetic)" }).returning();

  const [pm, ext, mel] = await db
    .insert(s.staff)
    .values([
      { organizationId: org.id, fullName: "Pat Manager", email: "pm@example.org" },
      { organizationId: org.id, fullName: "Eli Extension", email: "ext@example.org" },
      { organizationId: org.id, fullName: "Mo Evaluator", email: "mel@example.org" },
    ])
    .returning();

  const [project] = await db
    .insert(s.projects)
    .values({
      organizationId: org.id,
      name: "Demo Smallholder Maize Project",
      country: "KE",
      donor: "Fictional Foundation",
      startDate: "2027-01-01",
      endDate: "2028-12-31",
    })
    .returning();

  await db.insert(s.projectMembers).values([
    { projectId: project.id, staffId: pm.id, role: "project_manager" },
    { projectId: project.id, staffId: ext.id, role: "extension_agent" },
    { projectId: project.id, staffId: mel.id, role: "mel_officer" },
  ]);

  // Development logic: need -> activity -> output -> outcome
  const [need] = await db
    .insert(s.devLogicNodes)
    .values({ projectId: project.id, level: "need", statement: "Low maize yields from poor land preparation and late planting" })
    .returning();
  const [logicActivity] = await db
    .insert(s.devLogicNodes)
    .values({ projectId: project.id, parentId: need.id, level: "activity", statement: "Crop-stage training and readiness-gated input distribution" })
    .returning();
  const [output] = await db
    .insert(s.devLogicNodes)
    .values({ projectId: project.id, parentId: logicActivity.id, level: "output", statement: "Plots prepared to spec and planted on time", indicator: "% plots passing readiness on first visit" })
    .returning();
  await db.insert(s.devLogicNodes).values({
    projectId: project.id,
    parentId: output.id,
    level: "outcome",
    statement: "Increased maize yield per hectare",
    indicator: "kg/ha vs baseline",
  });

  const [maize] = await db.insert(s.crops).values({ name: "Maize", variety: "Demo hybrid" }).returning();

  const [trainingBudget, inputsBudget] = await db
    .insert(s.budgetLines)
    .values([
      { projectId: project.id, code: "1.1", description: "Farmer training", amount: "5000" },
      { projectId: project.id, code: "2.1", description: "Farm input packages", amount: "20000" },
    ])
    .returning();

  // Step 1: plan the season
  const [season] = await db
    .insert(s.seasons)
    .values({
      projectId: project.id,
      name: "2027 Long Rains",
      startDate: "2027-02-01",
      endDate: "2027-08-31",
      melQuestions: [
        "What share of plots pass readiness on the first visit?",
        "Do farmers who attend land-prep training pass readiness more often?",
        "Are inputs distributed before the planting window closes?",
      ],
    })
    .returning();

  const [training, readinessActivity, distribution, planting] = await db
    .insert(s.activities)
    .values([
      { seasonId: season.id, type: "training", title: "Land preparation & planting training", devLogicNodeId: logicActivity.id, budgetLineId: trainingBudget.id, ownerId: ext.id, plannedStart: "2027-02-10", plannedEnd: "2027-02-12", completedOn: "2027-02-12" },
      { seasonId: season.id, type: "readiness_check", title: "Plot readiness verification", devLogicNodeId: output.id, ownerId: mel.id, plannedStart: "2027-03-01", plannedEnd: "2027-03-07" },
      { seasonId: season.id, type: "input_distribution", title: "Input package distribution", budgetLineId: inputsBudget.id, ownerId: pm.id, plannedStart: "2027-03-08", plannedEnd: "2027-03-12" },
      { seasonId: season.id, type: "planting", title: "Planting follow-up visits", devLogicNodeId: output.id, ownerId: ext.id, plannedStart: "2027-03-15", plannedEnd: "2027-04-15" },
    ])
    .returning();

  // Farmers (enrolled = joined + contribution paid) and their plots (step 3)
  const farmerRows = await db
    .insert(s.farmers)
    .values(
      Array.from({ length: FARMER_COUNT }, (_, i) => ({
        projectId: project.id,
        code: `F-${String(i + 1).padStart(4, "0")}`,
        fullName: faker.person.fullName(),
        phone: faker.phone.number({ style: "international" }),
        village: faker.helpers.arrayElement(["Village A", "Village B", "Village C"]),
        status: "enrolled" as const,
        contributionPaid: true,
        contributionPaidOn: "2027-01-20",
        enrolledOn: "2027-01-25",
        baselineCompletedOn: i % 5 === 0 ? null : "2027-02-05", // baseline is not a gate
      })),
    )
    .returning();

  const plotRows = await db
    .insert(s.plots)
    .values(
      farmerRows.map((f, i) => ({
        farmerId: f.id,
        seasonId: season.id,
        cropId: maize.id,
        code: `P-${String(i + 1).padStart(4, "0")}`,
        areaHa: faker.number.float({ min: 0.2, max: 1.5, fractionDigits: 2 }).toString(),
        latitude: faker.location.latitude({ min: -1.5, max: 0.5, precision: 6 }).toString(),
        longitude: faker.location.longitude({ min: 36, max: 38, precision: 6 }).toString(),
      })),
    )
    .returning();

  // Step 2: training attendance (most attend)
  await db.insert(s.trainingAttendance).values(
    farmerRows.map((f, i) => ({ activityId: training.id, farmerId: f.id, attended: i % 7 !== 3 })),
  );

  // Step 4: readiness checks. Plots 3, 8, 14 fail first visit.
  const failing = new Set([3, 8, 14]);
  for (const [i, plot] of plotRows.entries()) {
    const [ev] = await db
      .insert(s.evidence)
      .values({
        projectId: project.id,
        source: i % 4 === 0 ? "paper" : "kobo",
        koboSubmissionUuid: i % 4 === 0 ? null : faker.string.uuid(),
        completedBy: ext.fullName,
        completedAt: new Date("2027-03-02T09:00:00Z"),
        location: plot.code,
        originalStoredAt: i % 4 === 0 ? "Field office binder 1" : null,
      })
      .returning();

    const ready = !failing.has(i);
    const [check] = await db
      .insert(s.readinessChecks)
      .values({
        plotId: plot.id,
        visitDate: "2027-03-02",
        extensionAgentId: ext.id,
        melOfficerId: mel.id,
        ready,
        issue: ready ? null : faker.helpers.arrayElement(["Plot not cleared", "Ridges not to spec", "Wrong plot size"]),
        evidenceId: ev.id,
      })
      .returning();

    let passingCheckId = ready ? check.id : null;

    // Step 5b: correction path. Plot 14 is never fixed and the farmer is removed.
    if (!ready) {
      const fixed = i !== 14;
      const [correction] = await db
        .insert(s.corrections)
        .values({
          readinessCheckId: check.id,
          requiredAction: `Fix: ${check.issue}`,
          deadline: "2027-03-09",
          communicatedById: ext.id,
          status: fixed ? "resolved" : "unresolved_removed",
          removalConfirmedById: fixed ? null : pm.id,
        })
        .returning();

      const [recheck] = await db
        .insert(s.readinessChecks)
        .values({
          plotId: plot.id,
          correctionId: correction.id,
          visitDate: "2027-03-09",
          extensionAgentId: ext.id,
          melOfficerId: mel.id,
          ready: fixed,
          issue: fixed ? null : check.issue,
        })
        .returning();

      if (fixed) {
        passingCheckId = recheck.id;
      } else {
        await db
          .update(s.farmers)
          .set({ status: "removed", removedOn: "2027-03-10", removalReason: "Readiness not met by correction deadline" })
          .where(sql`${s.farmers.id} = ${plot.farmerId}`);
        await db.insert(s.auditLog).values({
          projectId: project.id,
          actorId: pm.id,
          entity: "farmer",
          entityId: plot.farmerId,
          action: "removed",
          detail: { correctionId: correction.id },
        });
      }
    }

    // Step 5a: distribute inputs to farmers who passed, linked to expenditure
    if (passingCheckId) {
      const [exp] = await db
        .insert(s.expenditures)
        .values({ budgetLineId: inputsBudget.id, description: `Input package ${plot.code}`, amount: "85.00", spentOn: "2027-03-05" })
        .returning();
      await db.insert(s.inputDistributions).values({
        plotId: plot.id,
        readinessCheckId: passingCheckId,
        activityId: distribution.id,
        distributedOn: failing.has(i) ? "2027-03-11" : "2027-03-08",
        recordedById: pm.id,
        items: [
          { item: "Maize seed", unit: "kg", quantity: 10 },
          { item: "DAP fertilizer", unit: "kg", quantity: 50 },
        ],
        expenditureId: exp.id,
      });

      // Step 6: planting follow-up
      await db.insert(s.fieldVisits).values({
        plotId: plot.id,
        activityId: planting.id,
        visitDate: "2027-03-25",
        visitType: "planting",
        visitedById: ext.id,
        measures: { planted_on_time: i % 6 !== 0, spacing_correct: i % 5 !== 0 },
      });
    }
  }

  // Step 7: MEL finding and management action
  const [finding] = await db
    .insert(s.melFindings)
    .values({
      seasonId: season.id,
      devLogicNodeId: output.id,
      title: "Readiness first-pass rate 85%",
      summary: "17 of 20 plots passed on the first visit; 2 of 3 fixed after correction; 1 farmer removed. Most failures were in farmers who missed land-prep training.",
      status: "validated",
      validatedById: mel.id,
      validatedAt: new Date("2027-03-15T12:00:00Z"),
    })
    .returning();

  await db.insert(s.managementActions).values({
    findingId: finding.id,
    title: "Add make-up land-prep session for farmers who miss training",
    ownerId: ext.id,
    dueDate: "2027-09-15",
    appliesToSeasonId: season.id,
    replaces: "New: no existing make-up training process",
  });

  console.log(`Seeded: ${farmerRows.length} farmers, ${plotRows.length} plots, readiness activity ${readinessActivity.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
