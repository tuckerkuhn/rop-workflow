import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { budgetView, type BudgetView } from "@/lib/budget-view";
import { overspentLines } from "@/lib/qpr";
import { quarterOf, totalsOf } from "@/lib/results";
import { loadActuals } from "@/server/actuals-store";
import { projectByCode } from "@/server/field-store";
import { loadQpr, spendFor } from "@/server/qpr-store";
import { loadResults } from "@/server/results-store";

/** Budget against actual for the project's current phase, from its budget lines and Finance's latest import. */
export type Explain = { quarter: string; released: boolean; /** Whether this person may write the report's text. */ mayWrite: boolean; lines: Record<string, string> };

export async function loadBudgetView(code: string, mayWrite = false): Promise<BudgetView & { imported: { file: string; by: string; at: string } | null; beforeOverhead: boolean; explain: Explain | null }> {
  const project = await projectByCode(code);
  const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id)).orderBy(asc(s.budgetLines.sort));
  const actuals = await loadActuals(code);
  const startMonth = (project.startDate ?? "0000-00").slice(0, 7);
  // This phase's import: the latest one whose months reach the project's start (earlier phases share codes with other meanings).
  const current = [...actuals.imports].reverse().find((i) => (i.months.at(-1) ?? "") >= startMonth) ?? null;
  const indicators = await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id)).orderBy(asc(s.indicators.position));
  const results = await loadResults(code);
  const to = current?.months.at(-1) ? `${current.months.at(-1)}-31` : new Date().toISOString().slice(0, 10);
  const from = project.startDate ?? "0000-01-01";
  const priorYear = String(Number(from.slice(0, 4)) - 1);
  const view = budgetView({
    lines: lines.map((l) => ({ code: l.code, description: l.description, activityCode: l.activityCode, activity: l.activity, kind: l.kind, currency: l.currency, amount: l.amount === null ? null : Number(l.amount), schedule: (l.schedule as Record<string, number>) ?? {} })),
    imported: (current?.lines ?? []).filter((l) => !l.currency).map((l) => ({ code: l.code, description: l.description, budget: l.budget, actual: l.actual, months: l.months })),
    months: current?.months ?? [],
    currency: current?.currency ?? lines[0]?.currency ?? "USD",
    start: project.startDate,
    end: project.endDate,
    results: indicators
      .filter((i) => i.source === "results" && i.budgetRef)
      .map((i) => ({
        indicator: i.code,
        donorCode: i.donorCode ?? i.code,
        name: i.name,
        unit: i.unit,
        budgetRef: i.budgetRef,
        achieved: totalsOf(results.filter((r) => r.indicator === i.code), from, to).value,
        // This phase's target: the whole agreement's less what was due before the phase began.
        target: Number(i.target) - Number((i.forecast as Record<string, number>)?.[priorYear] ?? 0),
      })),
  });
  // The lines the quarterly report asks a reason for (lib/qpr overspentLines), with the reason saved so
  // far, for the quarter the latest import ends in. Typed here or on the report, it is one saved text.
  const last = current?.months.at(-1);
  let explain: Explain | null = null;
  if (last) {
    // The reasons are an extra on this page: if they cannot be worked out, the budget still shows.
    try {
      const quarter = quarterOf(`${last}-15`);
      const saved = await loadQpr(code, quarter);
      explain = { quarter, released: !!saved.released, mayWrite, lines: Object.fromEntries(overspentLines(await spendFor(code, quarter, lines), saved).map((l) => [l.code, l.explanation])) };
    } catch {
      explain = null;
    }
  }
  return { ...view, explain, imported: current ? { file: current.file.name, by: current.by, at: current.at } : null, beforeOverhead: true };
}
