import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { LENSES, lensDraftSchema, type LensAction, type LensReview } from "@/lib/lens-review";
import { draftStructured } from "@/server/ai-structured";
import { asIs } from "@/server/ai";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { ROP_VOICE } from "@/lib/voice";

/** The project's latest lens review (project_state "lens-review"). See lib/lens-review.ts. */

const KEY = "lens-review";

export const mayRunLensReview = (u: AppUser) => u.kind === "employee" && (u.admin || u.project.some((r) => ["plan-approver", "monthly-review", "mel-owner"].includes(r)) || u.field.includes("manager"));

export async function loadLensReview(code: string): Promise<LensReview | null> {
  const project = await projectByCode(code);
  const [row] = await db
    .select({ data: s.projectState.data })
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, KEY)))
    .limit(1);
  return (row?.data as LensReview | undefined) ?? null;
}

async function save(projectId: string, data: LensReview, audit: { action: string; by: string; detail: Record<string, unknown> }) {
  await db.transaction(async (tx) => {
    await tx
      .insert(s.projectState)
      .values({ projectId, key: KEY, data })
      .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
    await logAudit(tx, projectId, { entity: "lens_review", entityId: projectId, ...audit });
  });
}

export const LENS_SYSTEM = `You review the plan of a donor-funded agriculture and livelihoods project run by Roots of Peace (ROP), through a set of reviewer lenses. ROP works with smallholder farmers, agribusinesses and communities, often in fragile places.

Rules:
- Judge only the plan given: its goal, indicators and targets, budget by activity, and workplan. Name the specific indicator, activity or budget line a finding is about.
- A gap is something missing, weak or inconsistent in this plan, not general advice. If the plan holds up through a lens, return no findings for it.
- Never invent facts about the place, the donor or the partners. Where a judgement needs a fact the plan does not give, ask for it in questions instead of assuming.
- Suggestions are concrete changes to the plan (a target, an indicator, a disaggregation, a budget line, a step in the workplan), small enough to act on.
- Severity: high when the gap could stop the project delivering or being funded; medium when it weakens results or reporting; low for improvements.
- Plain English, short sentences, no marketing language.

${ROP_VOICE}`;

/** What the lens review reads: the plan as stored. */
export async function lensFacts(project: Awaited<ReturnType<typeof projectByCode>>) {
  const indicators = await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id)).orderBy(asc(s.indicators.position));
  const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id));
  const workplan = await db.select().from(s.workplanItems).where(eq(s.workplanItems.projectId, project.id));
  const ours = workplan.some((w) => w.org === "ROP") ? workplan.filter((w) => w.org === "ROP") : workplan;
  const budget = new Map<string, { activity: string; total: number; currency: string; lines: number }>();
  for (const l of lines) {
    const k = l.activityCode ?? "not linked";
    const b = budget.get(k) ?? { activity: l.activity ?? k, total: 0, currency: l.currency, lines: 0 };
    b.total += Number(l.amount ?? 0);
    b.lines += 1;
    budget.set(k, b);
  }
  return {
    project: { name: project.name, country: project.country, crop: project.crop, goal: project.goal, donor: project.donor, start: project.startDate, end: project.endDate, stage: project.stage },
    indicators: indicators.map((i) => ({ code: i.donorCode ?? i.code, name: i.name, unit: i.unit, level: i.level, theme: i.theme, whole_target: Number(i.target), running_totals_by_year: i.forecast, disaggregation: i.disaggregation, means_of_verification: i.verification })),
    budget_by_activity: [...budget.entries()].map(([code, b]) => ({ activity: code, name: b.activity, total: Math.round(b.total), currency: b.currency, lines: b.lines })),
    workplan: ours.map((w) => ({ code: w.code, activity: w.title, quarters: w.active, unit: w.unit, targets_by_quarter: w.targets })),
    lenses: LENSES.map((l) => ({ id: l.id, lens: l.label, asks: l.asks })),
  };
}

export async function actOnLensReview(code: string, a: LensAction, u: AppUser): Promise<string | null> {
  if (!mayRunLensReview(u)) return "Only plan approvers, monthly reviewers, MEL and project managers can run the lens review.";
  const project = await projectByCode(code);
  const now = new Date().toISOString();

  if (a.action === "decide") {
    const review = await loadLensReview(code);
    const f = review?.lenses.flatMap((l) => l.findings).find((x) => x.id === a.id);
    if (!review || !f) return "No such finding.";
    if (f.decision) return "This finding has already been decided.";
    f.decision = { action: a.decision, note: a.note, by: u.id, at: now };
    await save(project.id, review, { action: a.decision === "act" ? "lens_finding_acted" : "lens_finding_dismissed", by: u.id, detail: { gap: f.gap, severity: f.severity, note: a.note } });
    return null;
  }

  const facts = await lensFacts(project);
  try {
    const { out, model } = await draftStructured({ job: "lensReview", by: u.id, projectId: project.id, system: LENS_SYSTEM, task: "Review this plan through each lens, in the order given.", facts: asIs(facts, "the plan, its indicators, budget by activity and workplan; no record about a person"), schema: lensDraftSchema, effort: "medium", maxTokens: 32000 });
    const review: LensReview = {
      at: now,
      by: u.id,
      model,
      lenses: LENSES.map((l) => {
        const found = out.lenses.find((x) => x.lens === l.id);
        return { lens: l.id, summary: found?.summary ?? "", findings: (found?.findings ?? []).map((f) => ({ ...f, id: randomUUID() })) };
      }),
      questions: out.questions,
    };
    const count = review.lenses.reduce((t, l) => t + l.findings.length, 0);
    await save(project.id, review, { action: "lens_review_run", by: u.id, detail: { model, findings: count, high: review.lenses.flatMap((l) => l.findings).filter((f) => f.severity === "high").length } });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
