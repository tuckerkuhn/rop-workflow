import { and, eq } from "drizzle-orm";
import { mirrorFarmer } from "@/server/farmer-mirror";
import { db, schema as s } from "@/db";
import { type AppUser } from "@/lib/demo";
import { addDays, fieldSteps, plantingProblem, trainBlock, type Farmer, type Planting } from "@/lib/field";
import { cropPlanProblem, hectaresFor, type CropPlan } from "@/lib/crops";
import { selectionHold } from "@/lib/selection";
import { HELD_KEY, LEFT_OUT_KEY, TICKED_KEY, heldFarmers } from "@/lib/kobo-setup";
import { selectionOutcomes } from "@/server/selection-store";
import { toSubmission } from "@/server/kobo";
import { appFormOf, hasAnswers, sourceText } from "@/lib/form-record";
import { today } from "@/lib/clock";
import { parseScores, scoreLine } from "@/lib/field-training";
import { projectByCode, setupFor } from "@/server/field-store";
import { HttpError } from "@/server/guard";
import { correctionOwner, correctionTask, countPlantingIn, plantingTarget } from "@/server/distribution";

/**
 * MEL decisions on the review queue. Accepting a Kobo readiness check, training attendance or farm
 * visit is what records it on the farmer: nothing changes in Field activities until a named person
 * accepts it.
 */

const later = (a: string, b: string) => (a > b ? a : b);

/** How a farmer's history names the record: "Kobo KB-12" from KoboCollect, "Form AF-1a2b3c4d" from a form filled in here. */
/** The record a farmer's history line comes from, naming its real source (ISS-15). */
const refOf = (sub: { id: string; source?: string; recorderName?: string }) => (sub.source === "kobo" ? `Kobo ${sub.id}` : `${sourceText(sub.source, sub.recorderName)}, ${sub.id}`);

/** `refusal(fromKobo, by, form)`: why this person may not decide this record (`by`: who sent or recorded it), or null when they may. */
export async function decide(code: string, evidenceId: string, status: "accepted" | "queried", user: AppUser, note?: string, refusal?: (source: string, by: string | null, form: string | null) => string | null) {
  const project = await projectByCode(code);
  // Who would get a correction, worked out before the transaction opens (server/distribution correctionOwner).
  const [pre] = await db.select({ form: s.evidence.form, by: s.evidence.completedBy }).from(s.evidence).where(and(eq(s.evidence.id, evidenceId), eq(s.evidence.projectId, project.id))).limit(1);
  const agent = pre?.form === "readiness" && status === "accepted" ? await correctionOwner(code, pre.by) : null;
  // A farm visit records planting: a crop counted one by one turns the number planted into hectares
  // from the spacing. The target it counts toward is read here too: reads on a second connection
  // inside the transaction can wait for ever (server/distribution correctionOwner).
  const visit = pre?.form === "visit" && status === "accepted";
  const plan = visit ? ((await setupFor(code))?.plan ?? null) : null;
  const target = visit ? await plantingTarget(code) : null;
  return db.transaction(async (tx) => {
    // Only a record of this project: an id from another project answers as if it did not exist.
    const [row] = await tx.select().from(s.evidence).where(and(eq(s.evidence.id, evidenceId), eq(s.evidence.projectId, project.id))).limit(1);
    if (!row) throw new HttpError(404, "That record is not in this project's review queue. Reload the queue.");
    // Results and updates recorded by hand are decided on the Results page, where the data checks
    // run and nobody accepts their own record unless solo mode allows it.
    if (row.source === "manual" && (row.form === "result" || row.form === "update")) throw new HttpError(409, "This is a recorded result. Accept or query it on the Results page, where its checks are shown.");
    // A form filled in inside the app is field data like a KoboCollect one (lib/kobo-approval fieldRec).
    const why = refusal?.(appFormOf(row) ? "form" : row.source, row.completedBy, row.form);
    if (why) throw new HttpError(403, why);
    if (row.reviewStatus !== "pending") return { already: row.reviewStatus, applied: null as string | null };
    // Distributions are approved by the project manager, from the email link or Home, where the
    // receipt and quantity checks run.
    if (row.form === "distribution") throw new HttpError(409, "The project manager approves input distributions, from the email or from Home, where the goods received and quantity checks are shown.");

    const moves = status === "accepted" && hasAnswers(row) && (row.form === "readiness" || row.form === "training" || row.form === "visit");
    // What holds each farmer left open on a session record accepted for everyone else.
    let heldNow: string[] = [];
    // A farmer waitlisted or left out in Farmer selection is not moved along by a field form:
    // enforced here, not only by the Field activities page. Sending the form back stays open.
    if (moves) {
      const sub = toSubmission(row);
      const outcomes = await selectionOutcomes(row.projectId, tx);
      const ids = sub.farmers ?? [sub.farmerId || row.farmerCode];
      const stopped = ids.map((id) => ({ id, why: selectionHold(outcomes, id) })).filter((h): h is { id: string; why: string } => !!h.why);
      const holds = stopped.map((h) => h.why);
      // A training session record names many farmers. One held farmer no longer holds up the
      // others (decision P, 25 Nov 2026): everyone else is recorded, and the held farmer stays open
      // on the record, to be recorded once selected or left out. A record about one farmer, or a
      // session whose farmers are all held, has nobody to record and is refused as before.
      if (holds.length && sub.farmers && holds.length < ids.length) {
        const p = (row.payload ?? {}) as Record<string, unknown>;
        const out = new Set(stopped.map((h) => h.id));
        // The tick list keeps only the farmers recorded now, so nothing counts a held farmer.
        row.payload = { ...p, [TICKED_KEY]: p[TICKED_KEY] ?? p.farmers, farmers: sub.farmers.filter((id) => !out.has(id)).join(" "), [HELD_KEY]: [...out].join(" ") };
        await tx.update(s.evidence).set({ payload: row.payload, updatedAt: new Date() }).where(eq(s.evidence.id, evidenceId));
        heldNow = holds;
      } else if (holds.length === 1) throw new HttpError(409, `${holds[0]}. Select them first, or send this form back.`);
      else if (holds.length) throw new HttpError(409, `${holds.length} farmers on this record are held in Farmer selection: ${holds.slice(0, 6).join("; ")}${holds.length > 6 ? `; and ${holds.length - 6} more` : ""}. Select them first, or send this form back.`);
    }

    await tx
      .update(s.evidence)
      .set({ reviewStatus: status, reviewedBy: user.id, reviewedAt: new Date(), queryNote: status === "queried" ? (note ?? null) : null, updatedAt: new Date() })
      .where(eq(s.evidence.id, evidenceId));

    let applied: string | null = null;
    if (moves && row.form === "readiness") applied = await applyReadiness(tx, row, user, { ...project, code }, agent);
    else if (moves && row.form === "training") applied = await applyTraining(tx, row, user);
    else if (moves && row.form === "visit") {
      const v = await applyVisit(tx, row, user, plan);
      applied = v.summary;
      // Planting recorded from KoboCollect counts toward a target that counts at planting, the same
      // as it did when planting was entered by hand: once per farmer, waiting for MEL on the Results
      // page. In this transaction: the planting and its count are saved together or not at all.
      const counted = v.planted && target ? await countPlantingIn(tx, target, v.planted, user) : null;
      if (counted) applied = `${applied} ${counted.already ? "Already counted toward the target: not counted again." : "Counted toward the target, waiting for MEL on the Results page."}`;
    }

    if (heldNow.length && applied) applied = `${applied} ${heldSentence(heldNow)}`;
    await tx.insert(s.auditLog).values({
      projectId: row.projectId,
      entity: "evidence",
      entityId: row.id,
      action: status,
      detail: { by: user.id, form: row.form, farmer: row.farmerCode, ...(row.form === "training" && toSubmission(row).farmers ? { farmers: toSubmission(row).farmers } : {}), ...(heldNow.length ? { held: heldFarmers((row.payload ?? {}) as Record<string, unknown>) } : {}), note: note ?? null, applied },
    });
    return { already: null, applied };
  });
}

/** What the person who accepted is told about the farmers left open on the record. */
const heldSentence = (holds: string[]) =>
  `${holds.length === 1 ? "1 farmer is" : `${holds.length} farmers are`} not recorded and ${holds.length === 1 ? "stays" : "stay"} open on this record: ${holds.slice(0, 6).join("; ")}${holds.length > 6 ? `; and ${holds.length - 6} more` : ""}. Select them first, or leave them out.`;

/**
 * A farmer left open on an accepted session record because Farmer selection held them (decision P).
 * "record": once they are selected, their attendance is recorded as it was for the others, and
 * they join the record's tick list, so they count from now on. "leave_out": they come off the
 * record for good and nothing is recorded for them. Decided by whoever may accept the record.
 */
export async function settleHeld(code: string, evidenceId: string, farmer: string, action: "record" | "leave_out", user: AppUser, refusal?: (source: string, by: string | null, form: string | null) => string | null) {
  const project = await projectByCode(code);
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.evidence).where(and(eq(s.evidence.id, evidenceId), eq(s.evidence.projectId, project.id))).for("update").limit(1);
    if (!row || row.form !== "training") throw new HttpError(404, "That record is not in this project's review queue. Reload the queue.");
    // A form filled in inside the app is field data like a KoboCollect one (lib/kobo-approval fieldRec).
    const why = refusal?.(appFormOf(row) ? "form" : row.source, row.completedBy, row.form);
    if (why) throw new HttpError(403, why);
    const p = (row.payload ?? {}) as Record<string, unknown>;
    const held = heldFarmers(p);
    if (row.reviewStatus !== "accepted" || !held.includes(farmer)) return { already: true, applied: null as string | null };
    const rest = held.filter((id) => id !== farmer).join(" ");
    let applied: string;
    if (action === "record") {
      const hold = selectionHold(await selectionOutcomes(row.projectId, tx), farmer);
      if (hold) throw new HttpError(409, `${hold}. Select them first, or leave them out.`);
      const ticked = typeof p.farmers === "string" ? p.farmers.split(/\s+/).filter(Boolean) : [];
      const payload = { ...p, farmers: [...new Set([...ticked, farmer])].join(" "), [HELD_KEY]: rest };
      await tx.update(s.evidence).set({ payload, updatedAt: new Date() }).where(eq(s.evidence.id, row.id));
      const out = await trainOne(tx, row.projectId, toSubmission({ ...row, payload }), farmer, true, user, payload);
      applied = `${farmer}: ${out.summary}`;
    } else {
      const left = typeof p[LEFT_OUT_KEY] === "string" ? `${p[LEFT_OUT_KEY]} ${farmer}` : farmer;
      await tx.update(s.evidence).set({ payload: { ...p, [HELD_KEY]: rest, [LEFT_OUT_KEY]: left }, updatedAt: new Date() }).where(eq(s.evidence.id, row.id));
      applied = `${farmer} is left out of this record. Nothing was recorded for them.`;
    }
    await tx.insert(s.auditLog).values({ projectId: row.projectId, entity: "evidence", entityId: row.id, action: action === "record" ? "held_farmer_recorded" : "held_farmer_left_out", detail: { by: user.id, form: row.form, farmer, applied } });
    return { already: false, applied };
  });
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
  const kbo = `${refOf(sub)}, accepted by ${user.name}`;
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
    timeline: [...f.timeline, { date: sub.date || today(), who: "mel", what: `${summary.split(".")[0]}${issue && !ready ? `: ${issue}` : ""} (${kbo})`, at: new Date().toISOString() }],
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
 *
 * A session record (one record, its farmers ticked) does this for each farmer ticked, in the same
 * transaction, and says in one summary how many moved, who stays and why.
 */
async function applyTraining(tx: Tx, row: typeof s.evidence.$inferSelect, user: AppUser): Promise<string> {
  const sub = toSubmission(row);
  if (!sub.farmers) return (await trainOne(tx, row.projectId, sub, sub.farmerId, sub.fields.attended === "Yes", user, row.payload)).summary;
  if (!sub.farmers.length) return "No farmer is ticked on this record; nothing recorded.";
  const got: { id: string; out: Trained }[] = [];
  for (const id of sub.farmers) got.push({ id, out: await trainOne(tx, row.projectId, sub, id, true, user, row.payload) });
  const of = (kind: Trained["kind"]) => got.filter((g) => g.out.kind === kind);
  const list = (ids: string[]) => `${ids.slice(0, 6).join(", ")}${ids.length > 6 ? ` and ${ids.length - 6} more` : ""}`;
  const [moved, stays, noted, missing] = [of("moved"), of("stays"), of("noted"), of("missing")];
  const n = sub.farmers.length;
  return [
    `Training recorded for ${n} ${n === 1 ? "farmer" : "farmers"}.`,
    moved.length ? `${moved.length} moved to Prepare the plot.` : "",
    stays.length ? `${stays.length} ${stays.length === 1 ? "stays" : "stay"} at Train: ${stays.slice(0, 6).map((g) => `${g.id} (${g.out.why})`).join(", ")}${stays.length > 6 ? ` and ${stays.length - 6} more` : ""}.` : "",
    noted.length ? `${noted.length} already past Train, attendance noted: ${list(noted.map((g) => g.id))}.` : "",
    missing.length ? `Not on the farmer list, kept on this record only: ${list(missing.map((g) => g.id))}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** What accepting attendance did for one farmer. `why`: what keeps a farmer at Train. */
type Trained = { kind: "missing" | "absent" | "noted" | "stays" | "moved"; summary: string; why?: string };

async function trainOne(tx: Tx, projectId: string, sub: ReturnType<typeof toSubmission>, code: string, attended: boolean, user: AppUser, payload: unknown): Promise<Trained> {
  const item = await farmerItem(tx, projectId, code);
  if (!item) return { kind: "missing", summary: `Farmer ${code} is not on the farmer list; attendance kept on the submission only` };
  const f = item.data as Farmer;
  const date = sub.date || today();
  const kbo = `${refOf(sub)}, accepted by ${user.name}`;
  const session = sub.fields.session || "training";
  if (!attended) {
    await saveFarmer(tx, item.id, f, date, `Did not attend ${session.toLowerCase()} (${kbo})`);
    return { kind: "absent", summary: "Not attended: noted on the farmer's record; the step did not move." };
  }
  const register = sub.fields.register ? `, register ${sub.fields.register}` : "";
  // MF-09: the session, its curriculum and this farmer's scores go on their record.
  const p = (payload ?? {}) as Record<string, unknown>;
  const outOf = typeof p.score_max === "string" && p.score_max ? Number(p.score_max) : undefined;
  const score = parseScores(typeof p.scores === "string" ? p.scores : "", [code], outOf).scores[0];
  const curriculum = typeof p.curriculum === "string" && p.curriculum ? p.curriculum : undefined;
  const scored = score ? `; ${scoreLine(score, outOf)}` : "";
  const trainings = [...(f.trainings ?? []), { date, session, ...(curriculum ? { curriculum } : {}), ...(score?.pre !== undefined ? { pre: score.pre } : {}), ...(score?.post !== undefined ? { post: score.post } : {}), ...(score && outOf ? { outOf } : {}), ref: refOf(sub) }];
  const withTraining = (x: Farmer): Farmer => ({ ...x, trainings });
  if (f.step !== "train") {
    await saveFarmer(tx, item.id, withTraining(f), date, `Attended ${session.toLowerCase()}${register}${scored} (${kbo})`);
    return { kind: "noted", summary: `Attendance recorded; farmer was at "${fieldSteps[f.step]?.title ?? f.step}", so the step did not move.` };
  }
  const checks = { ...f.checks, "train.attended": true, "train.register": true };
  // The Train rule shared with enrolment, the contribution and selection (lib/field leaveTrain).
  const blocked = trainBlock(f);
  if (blocked) {
    await saveFarmer(tx, item.id, withTraining({ ...f, checks }), date, `Attended ${session.toLowerCase()}${register}${scored}; stays at Train: ${blocked} (${kbo})`);
    return { kind: "stays", summary: `Attendance recorded. Stays at Train: ${blocked}.`, why: blocked };
  }
  await saveFarmer(tx, item.id, withTraining({ ...f, checks, step: "prepare" }), date, `Training recorded: ${session.toLowerCase()}${register}${scored} (${kbo})`);
  return { kind: "moved", summary: "Training recorded. Moved to Prepare the plot." };
}

/**
 * The planting record a farm visit carries: the date planted (the visit date when not given), and
 * the hectares: worked out from the number planted for a crop counted one by one (lib/crops), else
 * the area typed on the form. A visit from the form before it asked either falls back to the
 * farmer's plot, and `assumed` says so on the record. A number planted that cannot be turned into
 * hectares (a crop planned by area, or no spacing) with no area typed is never taken as the whole
 * plot: `problem` says what to send instead, and nothing is recorded.
 */
export function plantingFromVisit(fields: Record<string, string>, visitDate: string, plot: number, plan: CropPlan | null | undefined): { planting: Planting; assumed: boolean } | { problem: string } {
  const date = fields.planting_date || visitDate;
  const n = fields.count ? Number(fields.count) : undefined;
  const count = n !== undefined && Number.isFinite(n) ? n : undefined;
  const fromCount = count !== undefined ? hectaresFor(count, plan) : null;
  const typed = fields.area ? Number(fields.area) : undefined;
  const area = typed !== undefined && Number.isFinite(typed) ? typed : undefined;
  if (count !== undefined && fromCount === null && area === undefined)
    return {
      problem:
        !plan || plan.by === "area"
          ? "The visit gave a number planted, but this crop is planned by area: record the area planted."
          : `The visit gave a number planted, but the crop plan cannot turn it into hectares (${cropPlanProblem(plan) ?? "no spacing"}): record the area planted, or the project manager completes the crop plan.`,
    };
  const hectares = fromCount ?? area ?? plot;
  return { planting: { date, hectares, ...(count !== undefined ? { count } : {}) }, assumed: fromCount === null && area === undefined };
}

/**
 * Farm visit after planting (kobo/build_field_forms.py). Planted at the trained spacing: ticks the
 * Plant checks and writes the planting record (date and area), completing the farmer's season path;
 * decide() counts it toward a target that counts at planting in the same transaction. Not planted, or not as trained,
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
  const kbo = `${refOf(sub)}, accepted by ${user.name}`;
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
  const from = plantingFromVisit(sub.fields, date, f.hectares, plan);
  if ("problem" in from) {
    await saveFarmer(tx, item.id, { ...f, checks }, date, `Farm visit, ${purpose}: planted at the trained spacing, but the planting record was not saved: ${from.problem} Send a corrected farm visit (${kbo})`);
    return { summary: `Visit recorded. Planting not recorded: ${from.problem} Stays at Plant.`, planted: null };
  }
  const { planting, assumed } = from;
  // Checked as a hand-entered record was: a date, not after the visit, a count above zero, within the plot.
  // Not against the handout date: a KoboCollect distribution is dated the day it was approved, often
  // days after the goods went out. The visit date stands for "today", so a real visit is not refused
  // against the app's fixed demo date.
  const problem = plantingProblem({ ...f, planting, photos: [], timeline: [] }, later(date, today()));
  if (problem) {
    await saveFarmer(tx, item.id, { ...f, checks }, date, `Farm visit, ${purpose}: planted at the trained spacing, but the planting record was not saved: ${problem} Send a corrected farm visit (${kbo})`);
    return { summary: `Visit recorded. Planting not recorded: ${problem} Stays at Plant.`, planted: null };
  }
  const area = `${planting.count !== undefined ? `${planting.count.toLocaleString("en-US")} ${plan?.unit ?? "plants"}, ` : ""}${planting.hectares} of ${f.hectares} ha${assumed ? " (area not on the form: the farmer's plot)" : ""}`;
  const next: Farmer = { ...f, checks, planting, step: "complete" };
  await saveFarmer(tx, item.id, next, date, `Planting recorded on ${planting.date}, ${area}, at the trained spacing (${kbo})`);
  return { summary: "Planting recorded. Season path complete.", planted: next };
}
