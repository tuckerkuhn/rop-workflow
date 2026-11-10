import { z } from "zod";
import type { Grid } from "@/lib/budget";
import { numberOf, type Bva, type BvaLine } from "@/lib/bva";
import { withoutNames } from "@/lib/personal-text";

/**
 * Spending from any spreadsheet (B3): a QuickBooks, NetSuite or Excel export with one amount per
 * row, a transaction list or a per-account summary. The AI proposes which column holds what
 * (server/spend-map-ai.ts); a person confirms the columns before any row is read. Rows are
 * matched to budget lines by code, then by description (a person ticks each description match),
 * and summed per line per month. Only those totals are kept: memo and description text from the
 * file is never stored, and lines nobody matched keep only their account text, names removed.
 */

export const COLUMN_ROLES = ["code", "description", "amount", "debit", "credit", "date", "currency"] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const mappingSchema = z.object({
  sheet: z.string().max(120).nullable(),
  /** The header row, counted from 0. */
  headerRow: z.number().int().min(0).max(200),
  /** Column index (from 0) per role; null when the file has none. */
  columns: z.object(Object.fromEntries(COLUMN_ROLES.map((r) => [r, z.number().int().min(0).max(400).nullable()])) as Record<ColumnRole, z.ZodNullable<z.ZodNumber>>),
  /** The month the file covers ("2027-01") when it has no date column. */
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .nullable(),
});
export type SpendMapping = z.infer<typeof mappingSchema>;

/** A person's decisions on the preview: description matches they ticked, and where unmatched accounts go. */
export const decisionsSchema = z.object({
  /** Account keys whose description match was confirmed. */
  confirmed: z.array(z.string().max(300)).max(500).default([]),
  /** Account key → budget line code, "skip" (leave out), or "" (keep as not in the budget). */
  assign: z.record(z.string().max(300), z.string().max(60)).default({}),
});
export type Decisions = z.infer<typeof decisionsSchema>;

/** Remembered per project (project_state "spendMapping"). */
export type SavedMapping = { mapping: SpendMapping; signature: string; assign: Record<string, string>; by: string; at: string };

export type BudgetRef = { code: string; description: string; amount: number | null; currency: string };

export type Group = {
  key: string;
  /** What the file calls it: the account code or name, names removed. */
  label: string;
  rows: number;
  total: number;
  months: Record<string, number>;
  /** The budget line it goes to, and how it was found. */
  line: string | null;
  how: "code" | "remembered" | "description" | "assigned" | "skipped" | "none";
};

export type SpendPreview = {
  headers: string[];
  months: string[];
  currency: string;
  groups: Group[];
  rows: number;
  problems: string[];
  notes: string[];
};

const text = (v: unknown) => (v == null ? "" : String(v).replace(/\s+/g, " ").trim());
export const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}.-]+/gu, " ").trim();

/** The header row as one string, to recognise the same export next month. */
export const signatureOf = (headers: string[]) => headers.map((h) => norm(h)).join("|");

/** Headings whose columns name people: their values never go to the AI. */
const PERSONAL = /^(name|employee|vendor|payee|customer|staff|entity|created by|modified by|memo|contact|source name)\b/i;

/** The first rows of a sheet for the AI: cells shortened, people's names removed, name columns blanked. */
export function sampleForAi(grid: Grid, rows = 15): string[][] {
  const out: string[][] = [];
  const hidden = new Set<number>();
  for (const r of grid.slice(0, rows)) {
    const cells = (r ?? []).slice(0, 40).map((c, i) => {
      const t = text(c).slice(0, 60);
      if (hidden.has(i) && t) return "[name]";
      return typeof c === "string" ? withoutNames(t) : t;
    });
    // A heading that names people hides that column's values in the rows below it.
    cells.forEach((c, i) => {
      if (PERSONAL.test(c)) hidden.add(i);
    });
    out.push(cells);
  }
  return out;
}

/** Excel day numbers, ISO text, "10/03/2026" (month first when no day is above 12, as US exports write it), "Oct 2026", "2026-10". */
export function monthOfCell(v: unknown, dayFirst: boolean): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 7);
  const t = text(v);
  let m = t.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?(?:[T ].*)?$/);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? `${m[1]}-${m[2].padStart(2, "0")}` : null;
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (m) {
    const month = Number(dayFirst ? m[2] : m[1]);
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, "0")}` : null;
  }
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = t.match(/^([A-Za-z]{3,9})[\s'-]*(\d{2}|\d{4})$/);
  if (m) {
    const k = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    return k >= 0 ? `${m[2].length === 2 ? `20${m[2]}` : m[2]}-${String(k + 1).padStart(2, "0")}` : null;
  }
  return null;
}

/** Day first when any date in the column has a first number above 12. */
function dayFirstIn(cells: unknown[]): boolean {
  return cells.some((c) => {
    const m = text(c).match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}$/);
    return !!m && Number(m[1]) > 12;
  });
}

const STOP = new Set("and the for of to in on at with from by a an all other costs cost expenses expense".split(" "));
const words = (s: string) => new Set(norm(s).split(" ").filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w)));
function similarity(a: string, b: string) {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / Math.min(x.size, y.size);
}
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A budget line whose code is in the account text, the longest code first (A-111 before A-11). */
export function byCode(texts: string[], budget: BudgetRef[]): string | null {
  const codes = [...budget].sort((a, b) => b.code.length - a.code.length);
  for (const t of texts) {
    if (!t) continue;
    for (const b of codes) if (norm(t) === norm(b.code) || new RegExp(`(^|[^\\p{L}\\p{N}])${escape(b.code)}($|[^\\p{L}\\p{N}.-]|\\.(?!\\d))`, "iu").test(t)) return b.code;
  }
  return null;
}

/** The budget line whose description is clearly the same thing: most words of the shorter one in common. */
export function byDescription(texts: string[], budget: BudgetRef[]): string | null {
  let best: { code: string; score: number } | null = null;
  for (const t of texts) {
    const plain = t.replace(/^[\d\s.:·-]+/, "");
    if (!plain) continue;
    for (const b of budget) {
      const score = norm(plain) === norm(b.description) ? 1 : similarity(plain, b.description);
      if (score >= 0.75 && words(plain).size >= 1 && (!best || score > best.score)) best = { code: b.code, score };
    }
  }
  return best?.code ?? null;
}

/**
 * Reads the rows with a confirmed mapping and groups them by account. Rows without an amount,
 * total rows ("Total for 6100") and blank rows are skipped. Nothing is matched yet.
 */
export function readRows(grid: Grid, m: SpendMapping, projectCurrency: string): { headers: string[]; groups: Omit<Group, "line" | "how">[]; texts: Map<string, string[]>; rows: number; months: string[]; currency: string; problems: string[]; notes: string[] } {
  const problems: string[] = [];
  const notes: string[] = [];
  const headers = (grid[m.headerRow] ?? []).map(text);
  const c = m.columns;
  const at = (r: unknown[], i: number | null) => (i === null ? null : r[i]);
  if (c.amount === null && c.debit === null) problems.push("Choose the column with the amount (or the debit column).");
  if (c.code === null && c.description === null) problems.push("Choose the column with the account or budget line (or its description).");
  if (c.date === null && !m.month) problems.push("The file has no date column: choose the month it covers.");
  const body = grid.slice(m.headerRow + 1);
  const dayFirst = c.date !== null && dayFirstIn(body.map((r) => (r ?? [])[c.date!]));
  const groups = new Map<string, Omit<Group, "line" | "how">>();
  const texts = new Map<string, string[]>();
  const currencies = new Set<string>();
  let skippedTotals = 0;
  let noAmount = 0;
  let badDates = 0;
  let rows = 0;
  if (!problems.length)
    for (const raw of body) {
      const r = raw ?? [];
      const code = text(at(r, c.code));
      const desc = text(at(r, c.description));
      if (!code && !desc) continue;
      if (/^total\b/i.test(code) || /^total\b/i.test(desc)) {
        skippedTotals++;
        continue;
      }
      const amount = c.amount !== null ? numberOf(at(r, c.amount)) : (numberOf(at(r, c.debit)) ?? 0) - (numberOf(at(r, c.credit)) ?? 0);
      if (amount === null || (c.amount === null && amount === 0 && numberOf(at(r, c.debit)) === null && numberOf(at(r, c.credit)) === null)) {
        noAmount++;
        continue;
      }
      const month = c.date !== null ? monthOfCell(at(r, c.date), dayFirst) : m.month;
      if (!month) {
        badDates++;
        continue;
      }
      if (c.currency !== null) {
        const cur = text(at(r, c.currency)).toUpperCase();
        if (cur) currencies.add(cur);
      }
      // One group per account: the code when there is one (descriptions on a ledger are memos that vary by row).
      const key = norm(code || desc).slice(0, 200);
      const g = groups.get(key) ?? { key, label: (code ? code : withoutNames(desc)).slice(0, 80), rows: 0, total: 0, months: {} };
      g.rows++;
      g.total = Math.round((g.total + amount) * 100) / 100;
      g.months[month] = Math.round(((g.months[month] ?? 0) + amount) * 100) / 100;
      groups.set(key, g);
      const t = texts.get(key) ?? [code, desc];
      texts.set(key, t);
      rows++;
    }
  if (badDates) problems.push(`${badDates} ${badDates === 1 ? "row has a date" : "rows have dates"} the app could not read. Check the date column.`);
  if (currencies.size > 1) problems.push(`The rows are in more than one currency (${[...currencies].join(", ")}). Export one currency at a time.`);
  const currency = [...currencies][0] ?? projectCurrency;
  if (currency !== projectCurrency) problems.push(`The file is in ${currency}, but the project's budget is in ${projectCurrency}.`);
  if (!problems.length && !rows) problems.push("No rows with an amount were found under the header row.");
  if (skippedTotals) notes.push(`${skippedTotals} total ${skippedTotals === 1 ? "row was" : "rows were"} skipped; the app adds up the rows itself.`);
  if (noAmount) notes.push(`${noAmount} ${noAmount === 1 ? "row has" : "rows have"} no amount and ${noAmount === 1 ? "was" : "were"} skipped.`);
  const months = [...new Set([...groups.values()].flatMap((g) => Object.keys(g.months)))].sort();
  return { headers, groups: [...groups.values()], texts, rows, months, currency, problems, notes };
}

/** Matches each account to a budget line: chosen now, then remembered from earlier imports, then by code, then by description. */
export function matchGroups(read: ReturnType<typeof readRows>, budget: BudgetRef[], remembered: Record<string, string>, decisions: Decisions): Group[] {
  const codes = new Set(budget.map((b) => b.code));
  return read.groups.map((g) => {
    const texts = read.texts.get(g.key) ?? [g.label];
    const chosen = decisions.assign[g.key];
    if (chosen === "skip") return { ...g, line: null, how: "skipped" };
    if (chosen && codes.has(chosen)) return { ...g, line: chosen, how: "assigned" };
    if (chosen === "") return { ...g, line: null, how: "none" };
    const kept = remembered[g.key];
    if (kept === "skip") return { ...g, line: null, how: "skipped" };
    if (kept && codes.has(kept)) return { ...g, line: kept, how: "remembered" };
    const code = byCode(texts, budget);
    if (code) return { ...g, line: code, how: "code" };
    const d = byDescription(texts, budget);
    if (d) return { ...g, line: d, how: "description" };
    return { ...g, line: null, how: "none" };
  });
}

/** Description matches nobody ticked count as not matched. */
export const counts = (g: Group, confirmed: Set<string>) => g.line !== null && (g.how !== "description" || confirmed.has(g.key));

/** The import in the same shape as Finance's workbook, so the budget view and reports read it unchanged. */
export function toBva(read: ReturnType<typeof readRows>, groups: Group[], budget: BudgetRef[], confirmed: Set<string>, fileName: string): Bva {
  const byLine = new Map<string, BvaLine>();
  const notes = [...read.notes];
  for (const g of groups) {
    if (g.how === "skipped") continue;
    const matched = counts(g, confirmed);
    const b = matched ? budget.find((x) => x.code === g.line) : undefined;
    // Accounts nobody matched keep the file's code (or "?" and its name) so pre-flight lists them.
    const code = b ? b.code : `?${g.label}`.slice(0, 60);
    const line = byLine.get(code) ?? { code, description: b ? b.description : g.label, budget: b?.amount ?? 0, actual: 0, months: {} };
    line.actual = Math.round((line.actual + g.total) * 100) / 100;
    for (const [m, v] of Object.entries(g.months)) line.months[m] = Math.round(((line.months[m] ?? 0) + v) * 100) / 100;
    byLine.set(code, line);
  }
  const lines = [...byLine.values()];
  const months: Record<string, number> = {};
  for (const l of lines) for (const [m, v] of Object.entries(l.months)) months[m] = Math.round(((months[m] ?? 0) + v) * 100) / 100;
  const totals = { budget: lines.reduce((t, l) => t + l.budget, 0), actual: Math.round(lines.reduce((t, l) => t + l.actual, 0) * 100) / 100, months };
  notes.push("The file has no budget column: each line's budget is the project's own budget in the app.");
  const label = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
  return { sheet: fileName, currency: read.currency, months: read.months, monthLabels: Object.fromEntries(read.months.map((m) => [m, label(m)])), lines, totals: { costs: totals, overhead: null, grand: totals }, rate: null, problems: [...read.problems], notes };
}

const HEADS: [ColumnRole, RegExp][] = [
  ["code", /^(account( no\.?| number| code)?|gl( account| code)?|budget line|line( code)?|item no\.?|code|split)$/i],
  ["description", /^(description|memo( ?\/ ?description)?|account name|line description|details?)$/i],
  ["amount", /^(amount|net amount|amount \(.*\)|total amount|actual|spent|value|net)$/i],
  ["debit", /^debit( amount)?$/i],
  ["credit", /^credit( amount)?$/i],
  ["date", /^(date|transaction date|txn date|posting date|period|month|accounting period)$/i],
  ["currency", /^(currency|curr\.?|ccy)$/i],
];

/** Columns guessed from their headings, used when the AI cannot be reached. */
export function guessMapping(grid: Grid, sheet: string | null): SpendMapping {
  let best = { row: 0, hits: 0 };
  for (let r = 0; r < Math.min(grid.length, 30); r++) {
    const hits = (grid[r] ?? []).filter((c) => HEADS.some(([, re]) => re.test(text(c)))).length;
    if (hits > best.hits) best = { row: r, hits };
  }
  const head = (grid[best.row] ?? []).map(text);
  const columns = Object.fromEntries(COLUMN_ROLES.map((role) => [role, null])) as SpendMapping["columns"];
  for (const [role, re] of HEADS) {
    const i = head.findIndex((h, j) => re.test(h) && !Object.values(columns).includes(j));
    if (i >= 0) columns[role] = i;
  }
  if (columns.amount !== null) columns.debit = columns.credit = null;
  return { sheet, headerRow: best.row, columns, month: null };
}
