import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { Budget, BudgetLine, WorkplanItem } from "@/lib/budget";
import { projectByCode } from "@/server/field-store";

/** The project's budget and workplan in Postgres. */

const n = (v: string | null) => (v === null ? null : Number(v));

export async function loadBudget(code: string): Promise<Budget> {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id)).orderBy(asc(s.budgetLines.sort), asc(s.budgetLines.code));
  return {
    currency: rows[0]?.currency ?? "USD",
    lines: rows.map(
      (r): BudgetLine => ({
        code: r.code,
        activityCode: r.activityCode,
        activity: r.activity,
        description: r.description,
        unit: r.unit,
        quantity: n(r.quantity),
        unitCost: n(r.unitCost),
        total: n(r.amount) ?? 0,
        spent: n(r.spent),
        schedule: (r.schedule ?? {}) as Record<string, number>,
        kind: r.kind as BudgetLine["kind"],
        procure: r.procure,
      }),
    ),
  };
}

/**
 * Replaces the budget. Lines keep their database id when their code is unchanged, so links
 * to them (procurement plan, spending) survive a re-upload.
 */
export async function saveBudget(code: string, budget: Budget) {
  const project = await projectByCode(code);
  // Once Finance's spending has been imported, that import is the one source of "spent to date":
  // a "spent" column in a re-uploaded budget file is not allowed to put older figures back.
  const [imported] = await db.select({ id: s.projectState.id }).from(s.projectState).where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, "actuals"))).limit(1);
  await db.transaction(async (tx) => {
    const codes = budget.lines.map((l) => l.code);
    const gone = await tx
      .select({ id: s.budgetLines.id })
      .from(s.budgetLines)
      .where(and(eq(s.budgetLines.projectId, project.id), codes.length ? notInArray(s.budgetLines.code, codes) : undefined));
    if (gone.length) {
      const ids = gone.map((g) => g.id);
      const used =
        (await tx.select({ id: s.activities.id }).from(s.activities).where(inArray(s.activities.budgetLineId, ids)).limit(1)).length +
        (await tx.select({ id: s.expenditures.id }).from(s.expenditures).where(inArray(s.expenditures.budgetLineId, ids)).limit(1)).length;
      if (used) throw new Error("Some budget lines you removed already have activities or spending recorded against them. Keep those lines.");
      await tx.delete(s.budgetLines).where(inArray(s.budgetLines.id, ids));
    }
    for (const [i, l] of budget.lines.entries()) {
      const values = {
        description: l.description,
        amount: String(l.total),
        currency: budget.currency,
        activityCode: l.activityCode,
        activity: l.activity,
        unit: l.unit,
        quantity: l.quantity === null ? null : String(l.quantity),
        unitCost: l.unitCost === null ? null : String(l.unitCost),
        spent: l.spent === null ? null : String(l.spent),
        schedule: l.schedule,
        kind: l.kind,
        procure: l.procure,
        sort: i,
      };
      const { spent, ...rest } = values;
      await tx
        .insert(s.budgetLines)
        .values({ projectId: project.id, code: l.code, ...rest, spent: imported ? null : spent })
        .onConflictDoUpdate({ target: [s.budgetLines.projectId, s.budgetLines.code], set: { ...rest, ...(imported ? {} : { spent }), updatedAt: new Date() } });
    }
  });
}

export async function loadWorkplan(code: string): Promise<WorkplanItem[]> {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.workplanItems).where(eq(s.workplanItems.projectId, project.id)).orderBy(asc(s.workplanItems.sort));
  return rows.map((r) => ({
    code: r.code,
    activityCode: r.activityCode,
    activity: r.activity,
    title: r.title,
    indicator: r.indicator,
    unit: r.unit,
    org: r.org || null,
    targets: (r.targets ?? {}) as Record<string, number>,
    active: (r.active ?? []) as string[],
    start: r.startDate,
    end: r.endDate,
    remark: r.remark,
  }));
}

/** Replaces the workplan. */
export async function saveWorkplan(code: string, items: WorkplanItem[]) {
  const project = await projectByCode(code);
  await db.transaction(async (tx) => {
    await tx.delete(s.workplanItems).where(eq(s.workplanItems.projectId, project.id));
    if (items.length)
      await tx.insert(s.workplanItems).values(
        items.map((i, k) => ({
          projectId: project.id,
          code: i.code,
          activityCode: i.activityCode,
          activity: i.activity,
          title: i.title,
          indicator: i.indicator,
          unit: i.unit,
          org: i.org ?? "",
          targets: i.targets,
          active: i.active,
          startDate: i.start,
          endDate: i.end,
          remark: i.remark,
          sort: k,
        })),
      );
  });
}
