import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { users, type AppUser } from "@/lib/demo";
import { applyAction, askKey, buildPlan, unplannedItem, type AskInput, type PlanAction, type PlanItem } from "@/lib/procurement-plan";
import { projectByCode } from "@/server/field-store";
import { loadBudget, loadWorkplan } from "@/server/plan-store";
import { today } from "@/lib/clock";
import { updateProjectState } from "@/server/project-state";

/** The procurement calendar in Postgres, one `procurement_plan` row per item. */

export async function loadPlan(code: string): Promise<PlanItem[]> {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.procurementPlan).where(eq(s.procurementPlan.projectId, project.id)).orderBy(asc(s.procurementPlan.startBy), asc(s.procurementPlan.planKey));
  return rows.map((r) => r.data as PlanItem);
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function write(tx: Tx, projectId: string, items: PlanItem[]) {
  const lines = await tx.select({ id: s.budgetLines.id, code: s.budgetLines.code }).from(s.budgetLines).where(eq(s.budgetLines.projectId, projectId));
  const lineId = new Map(lines.map((l) => [l.code, l.id]));
  for (const i of items) {
    const values = { budgetLineId: (i.budgetCode && lineId.get(i.budgetCode)) || null, status: i.status, startBy: i.startBy, techLead: i.techLead, data: i };
    await tx
      .insert(s.procurementPlan)
      .values({ projectId, planKey: i.key, ...values })
      .onConflictDoUpdate({ target: [s.procurementPlan.projectId, s.procurementPlan.planKey], set: { ...values, updatedAt: new Date() } });
  }
}

/** Builds or refreshes the plan from the saved budget and workplan. */
export async function rebuildPlan(code: string, people: AppUser[] = users) {
  const project = await projectByCode(code);
  const [budget, workplan, existing] = await Promise.all([loadBudget(code), loadWorkplan(code), loadPlan(code)]);
  const { items, removed } = buildPlan({ lines: budget.lines, currency: budget.currency, workplan, projectStart: project.startDate ?? today(), people, existing });
  await db.transaction(async (tx) => {
    if (removed.length) await tx.delete(s.procurementPlan).where(and(eq(s.procurementPlan.projectId, project.id), inArray(s.procurementPlan.planKey, removed)));
    await write(tx, project.id, items);
  });
  return { items, added: items.filter((i) => !existing.some((e) => e.key === i.key)).length, removed: removed.length };
}

/** Approve, send back, reopen or change one item. Returns the item, or the reason it was refused. */
export async function actOnPlan(code: string, key: string, action: PlanAction, user: AppUser, people: AppUser[] = users) {
  const project = await projectByCode(code);
  const [row] = await db
    .select()
    .from(s.procurementPlan)
    .where(and(eq(s.procurementPlan.projectId, project.id), eq(s.procurementPlan.planKey, key)))
    .limit(1);
  if (!row) return { error: "No such plan item.", status: 404 };
  const rows = (await loadWorkplan(code)).map((w) => w.code);
  const out = applyAction(row.data as PlanItem, action, user, people, today(), rows);
  if (typeof out === "string") return { error: out, status: 403 };
  await db.transaction(async (tx) => {
    await write(tx, project.id, [out]);
    await tx.insert(s.auditLog).values({ projectId: project.id, action: `plan_${action.action}`, entity: "procurement_plan", entityId: row.id, detail: { key, person: user.id, ...action } });
  });
  return { item: out };
}

/** Numbers the items asked for outside the calendar, kept with the row locked so two asks never share a number. */
const ASK_COUNTER = "procurement-plan-asks";

/**
 * Asks for a purchase that is not on the calendar. It goes on the calendar as a draft marked as not
 * planned (and urgent when it is), for the same two approvals as any other item; recorded in the
 * audit trail. Returns the item, or the reason it was refused.
 */
export async function askForUnplanned(code: string, input: AskInput, user: AppUser, people: AppUser[] = users) {
  const project = await projectByCode(code);
  const [budget, workplan] = await Promise.all([loadBudget(code), loadWorkplan(code)]);
  return updateProjectState<{ count: number }, { item: PlanItem } | { error: string; status: number }>(project.id, ASK_COUNTER, { count: 0 }, async (cur, tx) => {
    // Past the counter and past any key already in use, so a number is never taken twice.
    const used = await tx.select({ key: s.procurementPlan.planKey }).from(s.procurementPlan).where(eq(s.procurementPlan.projectId, project.id));
    const n = Math.max(cur.count, ...used.filter((r) => r.key.startsWith("UP-")).map((r) => Number(r.key.slice(3)) || 0)) + 1;
    const out = unplannedItem(input, { line: budget.lines.find((l) => l.code === input.budgetCode), currency: budget.currency, workplan, people, user, today: today(), key: askKey(n) });
    if (typeof out === "string") return { data: null, result: { error: out, status: 400 } };
    await write(tx, project.id, [out]);
    const [row] = await tx
      .select({ id: s.procurementPlan.id })
      .from(s.procurementPlan)
      .where(and(eq(s.procurementPlan.projectId, project.id), eq(s.procurementPlan.planKey, out.key)))
      .limit(1);
    await tx.insert(s.auditLog).values({ projectId: project.id, action: "plan_asked_unplanned", entity: "procurement_plan", entityId: row.id, detail: { key: out.key, person: user.id, ...input, urgent: out.unplanned!.urgent } });
    return { data: { count: n }, result: { item: out } };
  });
}
