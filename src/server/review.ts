import { and, eq } from "drizzle-orm";
import { mirrorFarmer } from "@/server/farmer-mirror";
import { db, schema as s } from "@/db";
import { type AppUser } from "@/lib/demo";
import { addDays, fieldSteps, plantingProblem, type Farmer, type Planting } from "@/lib/field";
import { hectaresFor, type CropPlan } from "@/lib/crops";
import { toSubmission } from "@/server/kobo";
import { today } from "@/lib/clock";
import { projectByCode, setupFor } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { correctionOwner, correctionTask, countPlanting } from "@/server/distribution";

/**
 * MEL decisions on the review queue. Accepting a Kobo readiness check, training attendance or farm
 * visit is what records it on the farmer: nothing changes in Field activities until a named person
 * accepts it.
 */

const later = (a: string, b: string) => (a > b ? a : b);

/** `refusal(fromKobo, by)`: why this person may not decide this record (`by`: who sent or recorded it), or null when they may. */
export async function decide(code: string, evidenceId: string, status: "accepted" | "queried", user: AppUser, note?: string, refusal?: (fromKobo: boolean, by: string | null) => string | null) {
  const project = await projectByCode(code);
  // Who would get a correction, worked out before the transaction opens (server/distribution correctionOwner).
  const [pre] = await db.select({ form: s.evidence.form, by: s.evidence.completedBy }).from(s.evidence).where(and(eq(s.evidence.id, evidenceId), eq(s.evidence.projectId, project.id))).limit(1);
  const agent = pre?.form === "readiness" && status === "accepted" ? await correctionOwner(code, pre.by) : null;
  // A farm visit records planting: a crop counted one by one turns the number planted into hectares from the spacing.
  const plan = pre?.form === "visit" && status === "accepted" ? ((await setupFor(code))?.plan ?? null) : null;
  // The farmer whose planting an accepted visit recorded, counted toward the target once the decision is saved.
  let planted: Farmer | null = null;
  const decided = await db.transaction(async (tx) => {
    // Only a record of this project: an id from another project answers as if it did not exist.
    const [row] = await tx.select().from(s.evidence).where(and(eq(s.evidence.id, evidenceId), eq(s.evidence.projectId, project.id))).limit(1);
    if (!row) throw new HttpError(404, "That record is not in this project's review queue. Reload the queue.");
    // Results and updates recorded by hand are decided on the Results page, where the data checks
    // run and nobody accepts their own record unless solo mode allows it.
    if (row.source === "manual" && (row.form === "result" || row.form === "update")) throw new HttpError(409, "This is a recorded result. Accept or query it on the Results page, where its checks are shown.");
    const why = refusal?.(row.source === "kobo", row.completedBy);
    if (why) throw new HttpError(403, why);
    if (row.reviewStatus !== "pending") return { already: row.reviewStatus, applied: null as string | null };
    // Distributions are approved by the project manager, from the email link or Home, where the
    // receipt and quantity checks run.
    if (row.form === "distribution") throw new HttpError(409, "The project manager approves input distributions, from the email or from Home, where the goods received and quantity checks are shown.");

    await tx
      .update(s.evidence)
      .set({ reviewStatus: status, reviewedBy: user.id, reviewedAt: new Date(), queryNote: status === "queried" ? (note ?? null) : null, updatedAt: new Date() })
      .where(eq(s.evidence.id, evidenceId));

    let applied: string | null = null;
    if (status === "accepted" && row.source === "kobo" && row.form === "readiness") {
      applied = await applyReadiness(tx, row, user, { ...project, code }, agent);
    } else if (status === "accepted" && row.source === "kobo" && (row.form === "training" || row.form === "visit")) {
      if (row.form === "training") applied = await applyTraining(tx, row, user);
      else {
        const v = await applyVisit(tx, row, user, plan);
        applied = v.summary;
        planted = v.planted;
      }
    }

    await tx.insert(s.auditLog).values({
      projectId: row.projectId,
      entity: "evidence",
      entityId: row.id,
      action: status,
      detail: { by: user.id, form: row.form, farmer: row.farmerCode, note: note ?? null, applied },
    });
    return { already: null, applied };
  });
  // Planting recorded from KoboCollect counts toward a target that counts at planting, the same
  // as it did when planting was entered by hand: once per farmer, waiting for MEL on the Results page.
  const p = planted as Farmer | null;
  if (!p) return decided;
  const counted = await countPlanting(code, p, user);
  if (!counted) return decided;
  return { ...decided, applied: `${decided.applied} ${counted.already ? "Already counted toward the target: not counted again." : "Counted toward the target, waiting for MEL on the Results page."}` };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Writes the readiness check and moves the farmer's step. Returns a one-line summary. */
async function applyReadiness(tx: Tx, row: typeof s.evidence.$inferSelect, user: AppUser, project: { id: string; organizationId: string | null; code: string }, agent: string | null): Promise<string> {
  const sub = toSubmission(row);
  const ready = sub.fields.result === "Yes";
  if (!sub.fields.result) return "No Yes/No result on the form; nothing recorded";
  const issue = sub.fields.issue || null;
  const code = sub.farmerId;

  const [farmer] = await tx.select().from(s.farmers).where(and(eq(s.farmers.projectId, row.projectId), eq(s.farmers.code, code))).limit(1);
  const [item] = await tx.select().from(s.fieldItems).where(and(eq(s.fieldItems.projectId, row.projectId), eq(s.fieldItems.itemKey, code))).limit(1);
  if (!farmer || !item) return `Farmer ${code} is not on the roster; result kept on the submission only`;

  // The readiness check itself, on the farmer's plot.
  const [plot] = await tx.select().from(s.plots).where(eq(s.plots.farmerId, farmer.id)).limit(1);
  let checkId: string | null = null;
  if (plot) {
    const [check] = await tx
      .insert(s.readinessChecks)
      .values({ plotId: plot.id, visitDate: sub.date || today(), ready, issue, evidenceId: row.id })
      .returning({ id: s.readinessChecks.id });
    checkId = check.id;
  }

  // Move the farmer through Field activities.
  const f = item.data as Farmer;
  const from = f.step;
  const kbo = `${sub.id}, accepted by ${user.name}`;
  // The app runs on a fixed demo date; real visits are dated today. Count the 7 days from
  // whichever is later so a real No isn't overdue the moment it arrives.
  const deadline = addDays(later(sub.date || today(), today()), 7);
  const checks = { ...f.checks, "verify.joint": sub.fields.both_present === "Yes", "verify.form": true, "verify.photo": sub.photo };
  let next: Farmer = f;
  let summary: string;

  // A readiness visit at "Prepare the plot" counts too: field visits are recorded only in
  // KoboCollect, so the visit itself is what says the land is ready to be checked.
  if (from === "verify" || from === "prepare") {
    next = ready
      ? { ...f, step: "distribute", checks }
      : { ...f, step: "correct", checks, deadline, correction: issue ?? "Not recorded on the form" };
    summary = ready ? "Readiness: Yes. Moved to distribution." : `Readiness: No. Correction opened, deadline ${deadline}.`;
    if (!ready && checkId) await tx.insert(s.corrections).values({ readinessCheckId: checkId, requiredAction: issue ?? "Not recorded on the form", deadline });
    // The extension agent gets it as a task with the deadline, so it shows on their Home and in Tasks.
    if (!ready) await correctionTask(tx, project, code, issue ?? "Not recorded on the form", deadline, row.id, user.id, agent);
  } else if (from === "correct") {
    next = ready ? { ...f, step: "distribute", checks } : { ...f, step: "removal", checks };
    summary = ready ? "Recheck: Yes. Moved to distribution." : "Recheck: No. Sent to the project manager to remove or extend.";
  } else {
    summary = `Readiness ${ready ? "Yes" : "No"} recorded; farmer was at "${fieldSteps[from]?.title ?? from}", so the step did not move.`;
  }

  next = {
    ...next,
    timeline: [...f.timeline, { date: sub.date || today(), who: "mel", what: `${summary.split(".")[0]}${issue && !ready ? `: ${issue}` : ""} (Kobo ${kbo})`, at: new Date().toISOString() }],
  };
  await tx.update(s.fieldItems).set({ data: next, updatedAt: new Date() }).where(eq(s.fieldItems.id, item.id));
  await mirrorFarmer(tx, row.projectId, next);
  return summary;
}

/** The farmer's Field activities record, or null when the farmer is not on this project's list. */
async function farmerItem(tx: Tx, projectId: string, code: string) {
  const [item] = await tx.select().from(s.fieldItems).where(and(eq(s.fieldItems.projectId, projectId), eq(s.fieldItems.itemKey, code))).limit(1);
  return item ?? null;
}

async function saveFarmer(tx: Tx, id: string, f: Farmer, date: string, what: string) {
  const next: Farmer = { ...f, timeline: [...f.timeline, { date, who: "mel", what, at: new Date().toISOString() }] };
  const [saved] = await tx.update(s.fieldItems).set({ data: next, updatedAt: new Date() }).where(eq(s.fieldItems.id, id)).returning({ projectId: s.fieldItems.projectId });
  if (saved) await mirrorFarmer(tx, saved.projectId, next);
}

/**
 * Training attendance (kobo/build_field_forms.py). Attended: ticks "attended" and "register" on the
 * Train step and moves the farmer on to Prepare the plot, as "Record training" does, but only when
 * the step's other checks (enrolled, contribution paid) already hold. Otherwise it is recorded and
 * the farmer stays where they are.
 */
async function applyTraining(tx: Tx, row: typeof s.evidence.$inferSelect, user: AppUser): Promise<string> {
  const sub = toSubmission(row);
  const code = sub.farmerId;
  const item = await farmerItem(tx, row.projectId, code);
  if (!item) return `Farmer ${code} is not on the farmer list; attendance kept on the submission only`;
  const f = item.data as Farmer;
  const date = sub.date || today();
  const kbo = `Kobo ${sub.id}, accepted by ${user.name}`;
  const session = sub.fields.session || "training";
  if (sub.fields.attended !== "Yes") {
    await saveFarmer(tx, item.id, f, date, `Did not attend ${session.toLowerCase()} (${kbo})`);
    return "Not attended: noted on the farmer's record; the step did not move.";
  }
  const register = sub.fields.register ? `, register ${sub.fields.register}` : "";
  if (f.step !== "train") {
    await saveFarmer(tx, item.id, f, date, `Attended ${session.toLowerCase()}${register} (${kbo})`);
    return `Attendance recorded; farmer was at "${fieldSteps[f.step]?.title ?? f.step}", so the step did not move.`;
  }
  const checks = { ...f.checks, "train.attended": true, "train.register": true };
  const blocked = !f.enrolled ? "not enrolled" : !f.contributionPaid ? "contribution not yet paid" : null;
  if (blocked) {
    await saveFarmer(tx, item.id, { ...f, checks }, date, `Attended ${session.toLowerCase()}${register}; stays at Train: ${blocked} (${kbo})`);
    return `Attendance recorded. Stays at Train: ${blocked}.`;
  }
  await saveFarmer(tx, item.id, { ...f, checks, step: "prepare" }, date, `Training recorded: ${session.toLowerCase()}${register} (${kbo})`);
  return "Training recorded. Moved to Prepare the plot.";
}

/**
 * The planting record a farm visit carries: the date planted (the visit date when not given), and
 * the hectares: worked out from the number planted for a crop counted one by one (lib/crops), else
 * the area typed on the form. A visit from the form before it asked the area falls back to the
 * farmer's plot, and `assumed` says so on the record.
 */
export function plantingFromVisit(fields: Record<string, string>, visitDate: string, plot: number, plan: CropPlan | null | undefined): { planting: Planting; assumed: boolean } {
  const date = fields.planting_date || visitDate;
  const count = fields.count ? Number(fields.count) : undefined;
  const fromCount = count !== undefined && Number.isFinite(count) ? hectaresFor(count, plan) : null;
  const typed = fields.area ? Number(fields.area) : undefined;
  const area = typed !== undefined && Number.isFinite(typed) ? typed : undefined;
  const hectares = fromCount ?? area ?? plot;
  return { planting: { date, hectares, ...(count !== undefined && Number.isFinite(count) ? { count } : {}) }, assumed: fromCount === null && area === undefined };
}

/**
 * Farm visit after planting (kobo/build_field_forms.py). Planted at the trained spacing: ticks the
 * Plant checks and writes the planting record (date and area), completing the farmer's season path;
 * decide() then counts it toward a target that counts at planting. Not planted, or not as trained,
 * or a planting record that does not hold up (lib/field plantingProblem): what needs follow-up goes
 * on the record and the farmer stays at Plant.
 */
async function applyVisit(tx: Tx, row: typeof s.evidence.$inferSelect, user: AppUser, plan: CropPlan | null): Promise<{ summary: string; planted: Farmer | null }> {
  const sub = toSubmission(row);
  const code = sub.farmerId;
  const item = await farmerItem(tx, row.projectId, code);
  if (!item) return { summary: `Farmer ${code} is not on the farmer list; visit kept on the submission only`, planted: null };
  const f = item.data as Farmer;
  const date = sub.date || today();
  const kbo = `Kobo ${sub.id}, accepted by ${user.name}`;
  const purpose = (sub.fields.purpose || "Farm visit").toLowerCase();
  const issue = sub.fields.issue;
  const ok = sub.fields.planted === "Yes" && sub.fields.spacing === "Yes";
  if (f.step !== "plant") {
    await saveFarmer(tx, item.id, f, date, `Farm visit, ${purpose}${issue ? `: ${issue}` : ""} (${kbo})`);
    return { summary: `Visit recorded; farmer was at "${fieldSteps[f.step]?.title ?? f.step}", so the step did not move.`, planted: null };
  }
  const checks = { ...f.checks, "plant.followup": true, "plant.manner": ok };
  if (!ok) {
    const what = sub.fields.planted === "Yes" ? "planted, not as trained" : "not yet planted";
    await saveFarmer(tx, item.id, { ...f, checks }, date, `Farm visit, ${purpose}: ${what}${issue ? `. To follow up: ${issue}` : ""} (${kbo})`);
    return { summary: `Visit recorded: ${what}. Stays at Plant for follow-up.`, planted: null };
  }
  const { planting, assumed } = plantingFromVisit(sub.fields, date, f.hectares, plan);
  // Checked as a hand-entered record was: a date, not after the visit, a count above zero, within the plot.
  // Not against the handout date: a KoboCollect distribution is dated the day it was approved, often
  // days after the goods went out. The visit date stands for "today", so a real visit is not refused
  // against the app's fixed demo date.
  const problem = plantingProblem({ ...f, planting, photos: [], timeline: [] }, later(date, today()));
  if (problem) {
    await saveFarmer(tx, item.id, { ...f, checks }, date, `Farm visit, ${purpose}: planted at the trained spacing, but the planting record was not saved: ${problem} Send a corrected farm visit from KoboCollect (${kbo})`);
    return { summary: `Visit recorded. Planting not recorded: ${problem} Stays at Plant.`, planted: null };
  }
  const area = `${planting.count !== undefined ? `${planting.count.toLocaleString("en-US")} ${plan?.unit ?? "plants"}, ` : ""}${planting.hectares} of ${f.hectares} ha${assumed ? " (area not on the form: the farmer's plot)" : ""}`;
  const next: Farmer = { ...f, checks, planting, step: "complete" };
  await saveFarmer(tx, item.id, next, date, `Planting recorded on ${planting.date}, ${area}, at the trained spacing (${kbo})`);
  return { summary: "Planting recorded. Season path complete.", planted: next };
}
