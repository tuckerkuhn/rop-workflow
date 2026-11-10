import { and, desc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { STAGES, type AppUser, type Stage } from "@/lib/demo";
import { projectByCode } from "@/server/field-store";

/**
 * A database project's stage. It moves forward one stage at a time, and only with a plan
 * approver's sign-off; going back needs a reason. Every change is an audit_log entry, so the
 * project's stage history is the audit trail. Leaving Design is the plan and budget sign-off:
 * the entry records what was signed (indicators and budget total at that moment).
 */

export type StageChange = { from: Stage; to: Stage; by: string; at: string; note: string | null; signedOff?: { indicators: number; budget: Record<string, number> } };

export const mayChangeStage = (u: AppUser) => u.kind === "employee" && u.project.includes("plan-approver");

export async function stageHistory(code: string): Promise<StageChange[]> {
  const project = await projectByCode(code);
  const rows = await db
    .select({ detail: s.auditLog.detail, at: s.auditLog.at })
    .from(s.auditLog)
    .where(and(eq(s.auditLog.projectId, project.id), eq(s.auditLog.entity, "project"), eq(s.auditLog.action, "stage_changed")))
    .orderBy(desc(s.auditLog.at));
  return rows.map((r) => ({ ...(r.detail as Omit<StageChange, "at">), at: r.at.toISOString() }));
}

export async function changeStage(code: string, to: Stage, u: AppUser, note: string | null): Promise<{ error: string } | { stage: Stage }> {
  const project = await projectByCode(code);
  const from = (STAGES as readonly string[]).includes(project.stage) ? (project.stage as Stage) : "Design";
  const step = STAGES.indexOf(to) - STAGES.indexOf(from);
  if (step === 0) return { error: `The project is already in ${to}.` };
  if (step > 1) return { error: `Move one stage at a time: ${from} goes to ${STAGES[STAGES.indexOf(from) + 1]} next.` };
  if (step < 0 && (note ?? "").trim().length < 10) return { error: "Going back a stage needs a reason." };
  let signedOff: StageChange["signedOff"];
  if (from === "Design" && to === "Execute") {
    const inds = await db.select({ id: s.indicators.id }).from(s.indicators).where(eq(s.indicators.projectId, project.id));
    const lines = await db.select({ amount: s.budgetLines.amount, currency: s.budgetLines.currency }).from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id));
    if (!inds.length) return { error: "Add the targets in setup before signing off the plan." };
    if (!lines.length) return { error: "Add the budget in setup before signing off the plan." };
    const budget: Record<string, number> = {};
    for (const l of lines) budget[l.currency] = Math.round((budget[l.currency] ?? 0) + Number(l.amount));
    signedOff = { indicators: inds.length, budget };
  }
  const detail: Omit<StageChange, "at"> = { from, to, by: u.id, note: note?.trim() || null, ...(signedOff ? { signedOff } : {}) };
  await db.transaction(async (tx) => {
    await tx.update(s.projects).set({ stage: to, updatedAt: new Date() }).where(eq(s.projects.id, project.id));
    await tx.insert(s.auditLog).values({ projectId: project.id, entity: "project", entityId: project.id, action: "stage_changed", detail });
  });
  return { stage: to };
}
