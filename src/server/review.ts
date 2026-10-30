import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { TODAY, type AppUser } from "@/lib/demo";
import { addDays, fieldSteps, type Farmer } from "@/lib/field";
import { toSubmission } from "@/server/kobo";

/**
 * MEL decisions on the review queue. Accepting a Kobo readiness check is what records the
 * Yes/No on the farmer: nothing changes in Field activities until a named person accepts it.
 */

const later = (a: string, b: string) => (a > b ? a : b);

export async function decide(evidenceId: string, status: "accepted" | "queried", user: AppUser, note?: string) {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(s.evidence).where(eq(s.evidence.id, evidenceId)).limit(1);
    if (!row) throw new Error("That submission is not in the database.");
    if (row.reviewStatus !== "pending") return { already: row.reviewStatus, applied: null as string | null };

    await tx
      .update(s.evidence)
      .set({ reviewStatus: status, reviewedBy: user.id, reviewedAt: new Date(), queryNote: status === "queried" ? (note ?? null) : null, updatedAt: new Date() })
      .where(eq(s.evidence.id, evidenceId));

    let applied: string | null = null;
    if (status === "accepted" && row.source === "kobo" && row.form === "readiness") {
      applied = await applyReadiness(tx, row, user);
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
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Writes the readiness check and moves the farmer's step. Returns a one-line summary. */
async function applyReadiness(tx: Tx, row: typeof s.evidence.$inferSelect, user: AppUser): Promise<string> {
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
      .values({ plotId: plot.id, visitDate: sub.date || TODAY, ready, issue, evidenceId: row.id })
      .returning({ id: s.readinessChecks.id });
    checkId = check.id;
  }

  // Move the farmer through Field activities.
  const f = item.data as Farmer;
  const from = f.step;
  const kbo = `${sub.id}, accepted by ${user.name}`;
  // The app runs on a fixed demo date; real visits are dated today. Count the 7 days from
  // whichever is later so a real No isn't overdue the moment it arrives.
  const deadline = addDays(later(sub.date || TODAY, TODAY), 7);
  const checks = { ...f.checks, "verify.joint": sub.fields.both_present === "Yes", "verify.form": true, "verify.photo": sub.photo };
  let next: Farmer = f;
  let summary: string;

  if (from === "verify") {
    next = ready
      ? { ...f, step: "distribute", checks }
      : { ...f, step: "correct", checks, deadline, correction: issue ?? "Not recorded on the form" };
    summary = ready ? "Readiness: Yes. Moved to distribution." : `Readiness: No. Correction opened, deadline ${deadline}.`;
    if (!ready && checkId) await tx.insert(s.corrections).values({ readinessCheckId: checkId, requiredAction: issue ?? "Not recorded on the form", deadline });
  } else if (from === "correct") {
    next = ready ? { ...f, step: "distribute", checks } : { ...f, step: "removal", checks };
    summary = ready ? "Recheck: Yes. Moved to distribution." : "Recheck: No. Sent to the project manager to remove or extend.";
  } else {
    summary = `Readiness ${ready ? "Yes" : "No"} recorded; farmer was at "${fieldSteps[from]?.title ?? from}", so the step did not move.`;
  }

  next = {
    ...next,
    timeline: [...f.timeline, { date: sub.date || TODAY, who: "mel", what: `${summary.split(".")[0]}${issue && !ready ? `: ${issue}` : ""} (Kobo ${kbo})` }],
  };
  await tx.update(s.fieldItems).set({ data: next, updatedAt: new Date() }).where(eq(s.fieldItems.id, item.id));
  return summary;
}
