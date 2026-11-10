import { and, asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { BREAKDOWNS, detailChanges, linkProblem, nextDetails, type StoredDetails, type TargetDetailsPatch } from "@/lib/target-details";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";

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
  const lines = await db.select({ code: s.budgetLines.code, description: s.budgetLines.description }).from(s.budgetLines).where(eq(s.budgetLines.projectId, projectId)).orderBy(asc(s.budgetLines.sort));
  const steps = await db.select({ code: s.workplanItems.code, title: s.workplanItems.title }).from(s.workplanItems).where(eq(s.workplanItems.projectId, projectId)).orderBy(asc(s.workplanItems.sort));
  // A consortium workplan can list a step once per partner: one choice per code.
  const seen = new Set<string>();
  return { budgetLines: lines, workplan: steps.filter((w) => !seen.has(w.code) && seen.add(w.code)) };
}

export async function loadTargetDetails(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const rows = await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id)).orderBy(asc(s.indicators.position));
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
      };
    }),
    ...(await choices(project.id)),
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
  const changes = detailChanges(before, after);
  if (!Object.keys(changes).length) return null;
  await db.transaction(async (tx) => {
    await tx
      .update(s.indicators)
      .set({ baseline: after.baseline === null ? null : String(after.baseline), disaggregation: after.disaggregation, verification: after.verification, budgetRef: after.budgetRef, workplanCode: after.workplanCode, inQuarterlyReport: after.inQuarterlyReport, updatedAt: new Date() })
      .where(mine);
    await logAudit(tx, project.id, { entity: "indicator", entityId: row.id, action: "target_details_set", by: u.id, detail: { code: row.code, donorCode: row.donorCode, changes } });
  });
  return null;
}
