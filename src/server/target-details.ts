import { and, asc, eq, isNull } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { BREAKDOWNS, detailChanges, linkProblem, nextDetails, type ConfirmLinks, type StoredDetails, type TargetDetailsPatch } from "@/lib/target-details";
import { suggestLinks } from "@/lib/link-suggest";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { MEASURES_KEY, measureOf, type Measure } from "@/lib/measure";
import { loadMeasures } from "@/server/measures";
import { updateProjectState } from "@/server/project-state";

/** Target details (lib/target-details): read for the screen, and saved one target at a time with an audit row. */

/** The same people who word the results framework: a plan approver or an administrator. */
const mayEdit = (u: AppUser) => u.kind === "employee" && (!!u.admin || u.project.includes("plan-approver"));

const stored = (r: typeof s.indicators.$inferSelect): StoredDetails => ({
  baseline: r.baseline === null ? null : Number(r.baseline),
  disaggregation: r.disaggregation ?? null,
  verification: r.verification,
  budgetRef: r.budgetRef,
  workplanCode: r.workplanCode,
  inQuarterlyReport: r.inQuarterlyReport,
});

async function choices(projectId: string) {
  const lines = await db.select({ code: s.budgetLines.code, description: s.budgetLines.description, activityCode: s.budgetLines.activityCode }).from(s.budgetLines).where(eq(s.budgetLines.projectId, projectId)).orderBy(asc(s.budgetLines.sort));
  const steps = await db.select({ code: s.workplanItems.code, title: s.workplanItems.title, activityCode: s.workplanItems.activityCode, indicator: s.workplanItems.indicator }).from(s.workplanItems).where(eq(s.workplanItems.projectId, projectId)).orderBy(asc(s.workplanItems.sort));
  // A consortium workplan can list a step once per partner: one choice per code.
  const seen = new Set<string>();
  return { budgetLines: lines, workplan: steps.filter((w) => !seen.has(w.code) && seen.add(w.code)) };
}

export async function loadTargetDetails(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id)).orderBy(asc(s.indicators.position));
  const measures = await loadMeasures(project.id);
  const plan = await choices(project.id);
  return {
    project: { code, name: project.name },
    can: { edit: mayEdit(u) },
    targets: rows.map((r) => {
      const d = stored(r);
      return {
        code: r.code,
        donorCode: r.donorCode,
        name: r.name,
        unit: r.unit,
        baseline: d.baseline,
        breakdown: BREAKDOWNS.filter((b) => d.disaggregation?.includes(b)),
        /** Breakdowns saved for this target that the screen does not offer; they are kept. */
        otherBreakdowns: (d.disaggregation ?? []).filter((x) => !(BREAKDOWNS as readonly string[]).includes(x)),
        verification: d.verification ?? "",
        budgetRef: d.budgetRef ?? "",
        workplanCode: d.workplanCode ?? "",
        inQuarterlyReport: d.inQuarterlyReport,
        /** How its results become its figure (lib/measure): saved, or its default. */
        measure: measureOf(measures, r),
      };
    }),
    ...plan,
    /** Suggested workplan items and budget lines for targets without them (lib/link-suggest). A person confirms each. */
    suggestions: suggestLinks(rows, plan.workplan, plan.budgetLines),
  };
}
export type TargetDetailsView = Awaited<ReturnType<typeof loadTargetDetails>>;

/** Saves one target's details. Returns why not, or null when saved. */
export async function saveTargetDetails(code: string, a: TargetDetailsPatch, u: AppUser): Promise<{ status: number; error: string } | null> {
  if (!mayEdit(u)) return { status: 403, error: "Only a plan approver changes a target's details." };
  const project = await projectByCode(code);
  const mine = and(eq(s.indicators.projectId, project.id), eq(s.indicators.code, a.indicator));
  const [row] = await db.select().from(s.indicators).where(mine).limit(1);
  if (!row) return { status: 404, error: "That target is not in this project." };
  const { budgetLines, workplan } = await choices(project.id);
  const before = stored(row);
  // A link already saved is not refused again; only a new one must be in the plan.
  const why = linkProblem({ budgetRef: a.budgetRef === (before.budgetRef ?? "") ? "" : a.budgetRef, workplanCode: a.workplanCode === (before.workplanCode ?? "") ? "" : a.workplanCode }, budgetLines.map((l) => l.code), workplan.map((w) => w.code));
  if (why) return { status: 400, error: why };
  const after = nextDetails(before, a);
  const changes: Record<string, { from: unknown; to: unknown }> = detailChanges(before, after);
  const details = Object.keys(changes).length > 0;
  // The measure is kept in the project's "measures" document (lib/measure), read and changed with its row locked.
  await updateProjectState<Record<string, unknown>, void>(project.id, MEASURES_KEY, {}, async (doc, tx) => {
    const was: Measure = measureOf(doc, row);
    const measure = a.measure && a.measure !== was ? a.measure : null;
    if (measure) changes.measure = { from: was, to: measure };
    if (!details && !measure) return { data: null, result: undefined };
    if (details)
      await tx
        .update(s.indicators)
        .set({ baseline: after.baseline === null ? null : String(after.baseline), disaggregation: after.disaggregation, verification: after.verification, budgetRef: after.budgetRef, workplanCode: after.workplanCode, inQuarterlyReport: after.inQuarterlyReport, updatedAt: new Date() })
        .where(mine);
    await logAudit(tx, project.id, { entity: "indicator", entityId: row.id, action: "target_details_set", by: u.id, detail: { code: row.code, donorCode: row.donorCode, changes } });
    return { data: measure ? { ...doc, [row.code]: measure } : null, result: undefined };
  });
  return null;
}

/**
 * Fills the links a person confirmed from the suggestions ("Use this", "Use all suggestions"). Same
 * permission and audit row as saving by hand. Only an empty link is filled: one set by hand in the
 * meantime is left as it is. All or nothing: one link not in the plan saves none.
 */
export async function confirmLinks(code: string, a: ConfirmLinks, u: AppUser): Promise<{ status: number; error: string } | null> {
  if (!mayEdit(u)) return { status: 403, error: "Only a plan approver changes a target's details." };
  const project = await projectByCode(code);
  const rows = await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id));
  const { budgetLines, workplan } = await choices(project.id);
  const todo: { row: (typeof rows)[number]; set: { workplanCode?: string; budgetRef?: string }; changes: Record<string, { from: unknown; to: unknown }> }[] = [];
  for (const l of a.links) {
    const row = rows.find((r) => r.code === l.indicator);
    if (!row) return { status: 404, error: `Target ${l.indicator} is not in this project.` };
    const set = { ...(l.workplanCode && !row.workplanCode ? { workplanCode: l.workplanCode } : {}), ...(l.budgetRef && !row.budgetRef ? { budgetRef: l.budgetRef } : {}) };
    const why = linkProblem({ budgetRef: set.budgetRef ?? "", workplanCode: set.workplanCode ?? "" }, budgetLines.map((x) => x.code), workplan.map((x) => x.code));
    if (why) return { status: 400, error: why };
    const changes = Object.fromEntries(Object.entries(set).map(([k, to]) => [k, { from: null, to }]));
    if (Object.keys(changes).length) todo.push({ row, set, changes });
  }
  await db.transaction(async (tx) => {
    for (const { row, set, changes } of todo) {
      // Still empty when written: a link set by hand a moment ago is not replaced. Nothing is logged for it.
      const done = await tx
        .update(s.indicators)
        .set({ ...set, updatedAt: new Date() })
        .where(and(eq(s.indicators.id, row.id), ...(set.workplanCode ? [isNull(s.indicators.workplanCode)] : []), ...(set.budgetRef ? [isNull(s.indicators.budgetRef)] : [])))
        .returning({ id: s.indicators.id });
      if (done.length) await logAudit(tx, project.id, { entity: "indicator", entityId: row.id, action: "target_details_set", by: u.id, detail: { code: row.code, donorCode: row.donorCode, changes, from: "suggestion" } });
    }
  });
  return null;
}
