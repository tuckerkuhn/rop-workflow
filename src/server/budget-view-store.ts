import { asc, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { budgetView, LIMITS, type BudgetView } from "@/lib/budget-view";
import { projectRules } from "@/server/policy-store";
import type { OverspendReason } from "@/lib/overspend";
import { overspentLines, withLineReasons } from "@/lib/qpr";
import { loadLineReasons } from "@/server/overspend-store";
import { quarterOf } from "@/lib/results";
import { measured, RESULT_SOURCES } from "@/lib/measure";
import { measuresFor } from "@/server/measures";
import { loadActuals } from "@/server/actuals-store";
import { ledgerSpent } from "@/server/ledger-spent";
import { projectByCode } from "@/server/field-store";
import { loadQpr, spendFor } from "@/server/qpr-store";
import { loadResults } from "@/server/results-store";
import { early } from "@/server/early";
import { oncePerRequest } from "@/server/request-memo";

/** Budget against actual for the project's current phase, from its budget lines and Finance's latest import. */
export type Explain = { quarter: string; /** Whether this person may give the reason (they write the report's text). */ mayWrite: boolean; lines: Record<string, { reason: OverspendReason | null; note: string; text: string }> };

export function loadBudgetView(code: string, mayWrite = false): Promise<BudgetView & { imported: { file: string; by: string; at: string } | null; beforeOverhead: boolean; explain: Explain | null }> {
  // Built once per read-only request (server/request-memo): the monthly review and the summary both ask.
  return oncePerRequest(`budget-view:${code}:${mayWrite}`, () => readBudgetView(code, mayWrite));
}

async function readBudgetView(code: string, mayWrite: boolean): Promise<BudgetView & { imported: { file: string; by: string; at: string } | null; beforeOverhead: boolean; explain: Explain | null }> {
  const project = await projectByCode(code);
  // Started together and awaited below where each is used: none depends on another.
  const actualsLater = early(loadActuals(code));
  const indicatorsLater = early(db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id)).orderBy(asc(s.indicators.position)));
  const resultsLater = early(loadResults(code));
  const rulesLater = early(projectRules(code));
  const ledgerLater = early(ledgerSpent(project.id));
  const measureLater = early(measuresFor(project.id));
  const lines = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id)).orderBy(asc(s.budgetLines.sort));
  const actuals = await actualsLater;
  const startMonth = (project.startDate ?? "0000-00").slice(0, 7);
  // This phase's import: the latest one whose months reach the project's start (earlier phases share codes with other meanings).
  const current = [...actuals.imports].reverse().find((i) => (i.months.at(-1) ?? "") >= startMonth) ?? null;
  const indicators = await indicatorsLater;
  const results = await resultsLater;
  const measureOf = await measureLater;
  const to = current?.months.at(-1) ? `${current.months.at(-1)}-31` : new Date().toISOString().slice(0, 10);
  const from = project.startDate ?? "0000-01-01";
  const priorYear = String(Number(from.slice(0, 4)) - 1);
  // The donor's budget flexibility, from the agreement in policy; ROP's starting value when it sets none.
  const revisionPct = Number((await rulesLater).values.budgetRevisionPct) || LIMITS.revisionPct;
  // Spent from the ledger when the project has posted spending there; otherwise Finance's import as before.
  const ledger = await ledgerLater;
  const view = budgetView({
    ledger,
    revisionPct,
    lines: lines.map((l) => ({ code: l.code, description: l.description, activityCode: l.activityCode, activity: l.activity, kind: l.kind, currency: l.currency, amount: l.amount === null ? null : Number(l.amount), schedule: (l.schedule as Record<string, number>) ?? {} })),
    imported: (current?.lines ?? []).filter((l) => !l.currency).map((l) => ({ code: l.code, description: l.description, budget: l.budget, actual: l.actual, months: l.months })),
    months: ledger ? [...new Set([...(current?.months ?? []), ...ledger.months])].sort() : (current?.months ?? []),
    currency: current?.currency ?? lines[0]?.currency ?? "USD",
    start: project.startDate,
    end: project.endDate,
    results: indicators
      .filter((i) => RESULT_SOURCES.includes(i.source) && i.budgetRef)
      .map((i) => ({
        indicator: i.code,
        donorCode: i.donorCode ?? i.code,
        name: i.name,
        unit: i.unit,
        budgetRef: i.budgetRef,
        // The same figure as the reports (lib/measure): a sum, or a survey's figure.
        achieved: measured({ baseline: i.baseline === null ? null : Number(i.baseline), unit: i.unit }, results.filter((r) => r.indicator === i.code), measureOf(i), from, to).value,
        // This phase's target: the whole agreement's less what was due before the phase began.
        target: Number(i.target) - Number((i.forecast as Record<string, number>)?.[priorYear] ?? 0),
      })),
  });
  // The lines the quarterly report asks a reason for (lib/qpr overspentLines), to the end of the quarter
  // the latest import ends in, with each line's reason. The reason belongs to the line (server/overspend-store):
  // given here or on the report, it is the same one.
  const last = current?.months.at(-1);
  let explain: Explain | null = null;
  if (last) {
    // The reasons are an extra on this page: if they cannot be worked out, the budget still shows.
    try {
      const quarter = quarterOf(`${last}-15`);
      const saved = await loadQpr(code, quarter);
      const current = withLineReasons({ ...saved, released: undefined }, await loadLineReasons(project.id));
      explain = { quarter, mayWrite, lines: Object.fromEntries(overspentLines(await spendFor(code, quarter, lines), current).map((l) => [l.code, { reason: l.reason, note: l.note, text: l.explanation }])) };
    } catch {
      explain = null;
    }
  }
  return { ...view, explain, imported: current ? { file: current.file.name, by: current.by, at: current.at } : null, beforeOverhead: true };
}
