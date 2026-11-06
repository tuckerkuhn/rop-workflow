/**
 * Budget against actual by activity, for the project's current phase.
 *
 * Two budgets meet here. The approved budget is the one in Finance's workbook (the donor's
 * cost estimate, line by line). The revised budget is the project's budget lines in the app,
 * typically Finance's latest revision: spending to date plus a schedule for the quarters left.
 * Spent is Finance's actual to date from the latest import. So for each line:
 * - spent against approved (overspent when above it);
 * - forecast at completion = spent + what the schedule still plans (from the month after the
 *   last import), against approved (a revision above approved needs the donor's agreement);
 * - spending pace: share of approved spent against share of the phase's time gone, flagged when
 *   far behind (often delivery is late) or far ahead.
 * Lines in Finance's file but not the budget, or the reverse, are listed so they can be mapped.
 */

export type BudgetLineIn = { code: string; description: string; activityCode: string | null; activity: string | null; kind: string; currency: string; amount: number | null; schedule: Record<string, number> };
export type ImportLineIn = { code: string; description: string; budget: number; actual: number; months: Record<string, number> };
export type ResultIn = { indicator: string; donorCode: string; name: string; unit: string; budgetRef: string | null; achieved: number; target: number };

export type Flag = { level: "stop" | "check"; text: string };

export type LineView = {
  code: string;
  description: string;
  kind: string;
  approved: number | null;
  revised: number | null;
  spent: number;
  /** Spent in the latest import's months, by month ("2026-07"). */
  months: Record<string, number>;
  remainingPlanned: number;
  forecast: number;
  spentPct: number | null;
  forecastPct: number | null;
  results: ResultIn[];
  flags: Flag[];
};

export type ActivityView = { code: string; name: string; approved: number; revised: number; spent: number; forecast: number; spentPct: number | null; forecastPct: number | null; lines: LineView[]; flags: number };

export type BudgetView = {
  currency: string;
  period: { from: string; to: string } | null;
  /** Share of the phase's time gone at the end of the last imported month (0–1). */
  timeGone: number | null;
  totals: { approved: number; revised: number; spent: number; forecast: number };
  activities: ActivityView[];
  notInBudget: { code: string; description: string; actual: number }[];
  notInFile: { code: string; description: string }[];
};

const pct = (a: number, b: number | null) => (b ? Math.round((a / b) * 1000) / 10 : null);
const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const monthEnd = (m: string) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

/** Thresholds: a forecast or spend this far above approved, or pace this far from time, is flagged. */
export const LIMITS = { overPct: 0.5, revisionPct: 10, behindPts: 25, aheadPts: 25 } as const;

export function budgetView(args: { lines: BudgetLineIn[]; imported: ImportLineIn[]; months: string[]; currency: string; start: string | null; end: string | null; results: ResultIn[] }): BudgetView {
  const { lines, imported, months, currency, start, end, results } = args;
  const last = months.at(-1) ?? null;
  const asOf = last ? monthEnd(last) : null;
  const timeGone = start && end && asOf ? Math.min(1, Math.max(0, (Date.parse(asOf) - Date.parse(start)) / (Date.parse(end) - Date.parse(start)))) : null;
  const byCode = new Map(imported.map((l) => [l.code, l]));

  const views: (LineView & { activityCode: string; activity: string })[] = lines.map((l) => {
    const imp = byCode.get(l.code);
    const approved = imp ? imp.budget : null;
    const spent = imp?.actual ?? 0;
    // Planned from the month after the last import: the quarters not yet reported on.
    const remainingPlanned = Object.entries(l.schedule ?? {})
      .filter(([q]) => !last || q.slice(0, 7) > last)
      .reduce((t, [, v]) => t + Number(v), 0);
    const forecast = spent + remainingPlanned;
    const flags: Flag[] = [];
    if (approved !== null && spent > approved * (1 + LIMITS.overPct / 100))
      flags.push({ level: "stop", text: `Spent ${fmt(spent)} of ${fmt(approved)} approved (${pct(spent, approved)}%): explain the overspend or the approved realignment.` });
    else if (approved !== null && forecast > approved * (1 + LIMITS.revisionPct / 100))
      flags.push({ level: "check", text: `Forecast ${fmt(forecast)} is ${pct(forecast - approved, approved)}% above the ${fmt(approved)} approved: check the donor has agreed the revision.` });
    const mine = results.filter((r) => r.budgetRef === l.code);
    // Spending ahead of time is expected when the work it pays for is done.
    const delivered = mine.length > 0 && mine.every((r) => r.target > 0 && r.achieved >= r.target);
    if (approved && timeGone !== null && approved > 0) {
      const pace = (spent / approved) * 100 - timeGone * 100;
      if (pace < -LIMITS.behindPts && remainingPlanned < approved - spent) flags.push({ level: "check", text: `${pct(spent, approved)}% spent with ${Math.round(timeGone * 100)}% of the time gone, and the remaining plan does not use the rest: is delivery late, or is the money to be reallocated?` });
      else if (pace > LIMITS.aheadPts && spent < approved && !delivered) flags.push({ level: "check", text: `${pct(spent, approved)}% spent with ${Math.round(timeGone * 100)}% of the time gone: check the rest of the year is covered.` });
    }
    return {
      code: l.code,
      description: l.description,
      kind: l.kind,
      activityCode: l.activityCode ?? "—",
      activity: l.activity ?? (l.activityCode ? `Activity ${l.activityCode}` : "Not linked to an activity"),
      approved,
      revised: l.amount,
      spent,
      months: imp?.months ?? {},
      remainingPlanned,
      forecast,
      spentPct: pct(spent, approved),
      forecastPct: pct(forecast, approved),
      results: mine,
      flags,
    };
  });

  const groups = new Map<string, typeof views>();
  for (const v of views) groups.set(v.activityCode, [...(groups.get(v.activityCode) ?? []), v]);
  const sum = (list: typeof views, k: "spent" | "forecast") => list.reduce((t, l) => t + l[k], 0);
  const activities: ActivityView[] = [...groups.entries()]
    .sort(([a], [b]) => (a === "—" ? 1 : b === "—" ? -1 : a.localeCompare(b, undefined, { numeric: true })))
    .map(([code, list]) => {
      const approved = list.reduce((t, l) => t + (l.approved ?? 0), 0);
      return {
        code,
        name: list[0].activity,
        approved,
        revised: list.reduce((t, l) => t + (l.revised ?? 0), 0),
        spent: sum(list, "spent"),
        forecast: sum(list, "forecast"),
        spentPct: pct(sum(list, "spent"), approved),
        forecastPct: pct(sum(list, "forecast"), approved),
        lines: list.map((l) => {
          const { activityCode, activity, ...rest } = l;
          void activityCode;
          void activity;
          return rest;
        }),
        flags: list.reduce((t, l) => t + l.flags.length, 0),
      };
    });

  const known = new Set(lines.map((l) => l.code));
  return {
    currency,
    period: months.length ? { from: months[0], to: months.at(-1)! } : null,
    timeGone,
    totals: {
      approved: activities.reduce((t, a) => t + a.approved, 0),
      revised: activities.reduce((t, a) => t + a.revised, 0),
      spent: activities.reduce((t, a) => t + a.spent, 0),
      forecast: activities.reduce((t, a) => t + a.forecast, 0),
    },
    activities,
    notInBudget: imported.filter((l) => !known.has(l.code)).map((l) => ({ code: l.code, description: l.description, actual: l.actual })),
    notInFile: lines.filter((l) => !byCode.has(l.code)).map((l) => ({ code: l.code, description: l.description })),
  };
}
