/**
 * Budget against actual, from the workbook Finance sends UNDP each month with the FACE form
 * (sheet "ICE Report": one row per budget line, one column per month's actual spending, then
 * total budget and total actual). Only that sheet is read: the ledger sheets in the same
 * workbook name staff on payroll lines and are never stored.
 */

export type BvaLine = { code: string; description: string; budget: number; actual: number; months: Record<string, number> };
export type Bva = {
  sheet: string;
  currency: string;
  /** Months with actuals, e.g. ["2026-02", "2026-03", …]; a Jan–Feb column is filed under February. */
  months: string[];
  monthLabels: Record<string, string>;
  lines: BvaLine[];
  /** From the workbook's own total rows, to check the import against. */
  totals: { costs: { budget: number; actual: number } | null; overhead: { budget: number; actual: number; currency: string } | null; grand: { budget: number; actual: number } | null };
  /** Problems found while reading; an import with any is refused. */
  problems: string[];
  /** Things to know that do not stop the import. */
  notes: string[];
};

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "Jul'26 Actual" → "2026-07"; "Jan-Feb'26 Actual" → "2026-02"; "March'26 Actual" → "2026-03". */
export function monthOf(header: string): string | null {
  const m = header.replace(/\s+/g, " ").trim().match(/^([A-Za-z]+)(?:\s*-\s*([A-Za-z]+))?\s*'\s*(\d{2})\s+Actual$/i);
  if (!m) return null;
  const last = MONTHS[(m[2] ?? m[1]).slice(0, 3).toLowerCase()];
  const first = MONTHS[m[1].slice(0, 3).toLowerCase()];
  if (!last || !first) return null;
  return `20${m[3]}-${String(last).padStart(2, "0")}`;
}

/** A cell value as a number: numbers, formula results, "(36,620)", "-", "$8,011". */
export function numberOf(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return v;
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; error?: unknown };
    if ("error" in o && o.error) return null;
    if ("result" in o) return numberOf(o.result);
    if (o.richText) return numberOf(o.richText.map((t) => t.text).join(""));
    return null;
  }
  const s = String(v).trim();
  if (/^-+$/.test(s)) return 0;
  const neg = /^\(.*\)$/.test(s);
  const n = Number(s.replace(/[()$,\s%]/g, ""));
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const textOf = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string };
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (o.text) return String(o.text);
    if ("result" in o) return textOf(o.result);
  }
  return String(v);
};

const LINE = /^(PRG|LAB|OPS)-[0-9A-Z.]+$/i;

/** Reads the rows of the ICE sheet (an array of rows, each an array of cell values from column 1). */
export function readIce(rows: unknown[][], sheet: string): Bva {
  const problems: string[] = [];
  const notes: string[] = [];
  const cells = rows.map((r) => r.map(textOf));
  // The first header row names "Item No." and "Total Budget"; month columns may sit on the row below it.
  const hi = cells.findIndex((r) => r.some((c) => /^item no\.?$/i.test(c.trim())) && r.some((c) => /^total budget$/i.test(c.trim())));
  if (hi < 0) return { sheet, currency: "AFN", months: [], monthLabels: {}, lines: [], totals: { costs: null, overhead: null, grand: null }, problems: [`Sheet "${sheet}" has no header row with "Item No." and "Total Budget".`], notes };
  const head = cells[hi];
  const sub = cells[hi + 1] ?? [];
  const col = (re: RegExp, row = head) => row.findIndex((c) => re.test(c.trim()));
  const codeCol = col(/^item no\.?$/i);
  const descCol = col(/^item description$/i);
  const budgetCol = col(/^total budget$/i);
  // The overall actual is the "Total Actual Expenditures" right after "Total Budget" (each quarter also has one).
  const actualCol = head.findIndex((c, i) => i > budgetCol && /^total actual expenditures$/i.test(c.trim()));
  if (actualCol < 0) problems.push(`No "Total Actual Expenditures" column after "Total Budget" in "${sheet}".`);
  const monthCols: { i: number; month: string; label: string }[] = [];
  for (const row of [head, sub])
    row.forEach((c, i) => {
      const m = monthOf(c);
      if (m) monthCols.push({ i, month: m, label: c.replace(/\s*Actual$/i, "").trim() });
    });
  if (!monthCols.length) problems.push(`No monthly "… Actual" columns in "${sheet}".`);
  const currency = head.some((c) => /AFN/.test(c)) ? "AFN" : "USD";

  const lines: BvaLine[] = [];
  const seen = new Set<string>();
  let costs: Bva["totals"]["costs"] = null;
  let overhead: Bva["totals"]["overhead"] = null;
  let grand: Bva["totals"]["grand"] = null;
  for (let r = hi + 2; r < rows.length; r++) {
    const raw = rows[r];
    const code = (cells[r][codeCol] ?? "").trim();
    const val = (i: number) => (i >= 0 ? numberOf(raw[i]) : null);
    if (LINE.test(code)) {
      if (seen.has(code)) {
        problems.push(`${code} appears twice.`);
        continue;
      }
      seen.add(code);
      const months: Record<string, number> = {};
      for (const m of monthCols) {
        const v = val(m.i);
        if (v) months[m.month] = Math.round(v * 100) / 100;
      }
      const budget = val(budgetCol) ?? 0;
      const actual = val(actualCol) ?? 0;
      const sum = Object.values(months).reduce((t, v) => t + v, 0);
      // Rounding: up to half a unit for each month, plus one.
      if (Math.abs(sum - actual) > monthCols.length * 0.5 + 1) problems.push(`${code}: the monthly actuals add up to ${Math.round(sum).toLocaleString("en-US")}, but its total actual is ${Math.round(actual).toLocaleString("en-US")}.`);
      lines.push({ code, description: (cells[r][descCol] ?? "").trim(), budget, actual, months });
    } else if (/^total costs$/i.test(code)) costs = { budget: val(budgetCol) ?? 0, actual: val(actualCol) ?? 0 };
    else if (/^required usd/i.test(code)) overhead = { budget: val(budgetCol) ?? 0, actual: val(actualCol) ?? 0, currency: "USD" };
    else if (/^total$/i.test(code)) grand = { budget: val(budgetCol) ?? 0, actual: val(actualCol) ?? 0 };
  }
  if (!lines.length) problems.push(`No budget lines (PRG-, LAB-, OPS-) found in "${sheet}".`);
  if (costs) {
    const a = lines.reduce((t, l) => t + l.actual, 0);
    const b = lines.reduce((t, l) => t + l.budget, 0);
    if (Math.abs(a - costs.actual) > lines.length) problems.push(`The lines' actuals add up to ${Math.round(a).toLocaleString("en-US")}, but the workbook's total costs say ${Math.round(costs.actual).toLocaleString("en-US")}.`);
    if (Math.abs(b - costs.budget) > lines.length) notes.push(`The lines' budgets add up to ${Math.round(b).toLocaleString("en-US")}; the workbook's total costs row says ${Math.round(costs.budget).toLocaleString("en-US")}.`);
  } else notes.push('No "Total Costs" row, so the import could not be checked against the workbook\'s own total.');
  const months = [...new Set(monthCols.map((m) => m.month))].sort();
  const monthLabels = Object.fromEntries(monthCols.map((m) => [m.month, m.label]));
  return { sheet, currency, months, monthLabels, lines, totals: { costs, overhead, grand }, problems, notes };
}

/** Spending in a date range (months "2026-07" to "2026-09"), by line and in total. */
export function spentIn(bva: Pick<Bva, "lines">, fromMonth: string, toMonth: string) {
  const byLine: Record<string, number> = {};
  for (const l of bva.lines) byLine[l.code] = Object.entries(l.months).reduce((t, [m, v]) => (m >= fromMonth && m <= toMonth ? t + v : t), 0);
  return { byLine, total: Object.values(byLine).reduce((t, v) => t + v, 0) };
}
