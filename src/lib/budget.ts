import { z } from "zod";

/**
 * Budget and workplan, entered when a project starts: read from the donor's spreadsheets
 * (any layout: the columns are guessed, then a person confirms them) or typed in by hand.
 * They feed the procurement calendar.
 */

export type Cell = string | number | null;
/** One sheet as rows of cells, row 0 first. */
export type Grid = Cell[][];

export const text = (c: Cell | undefined) => (c == null ? "" : String(c)).replace(/\s+/g, " ").trim();
export function num(c: Cell | undefined): number | null {
  if (typeof c === "number") return Number.isFinite(c) ? c : null;
  const s = text(c).replace(/[,\s]/g, "");
  if (!s || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null;
  return Number(s);
}
const round2 = (n: number) => Math.round(n * 100) / 100;

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n: number) => String(n).padStart(2, "0");
/** First day of the month `months` after `start` (YYYY-MM-DD). */
export function addMonths(start: string, months: number) {
  const y = Number(start.slice(0, 4));
  const m = Number(start.slice(5, 7)) - 1 + months;
  return `${y + Math.floor(m / 12)}-${pad((((m % 12) + 12) % 12) + 1)}-01`;
}

/** Last day of the quarter that starts on `start`. */
export const quarterEnd = (start: string) => new Date(Date.parse(`${addMonths(start, 3)}T00:00:00Z`) - 86400000).toISOString().slice(0, 10);

/**
 * The quarter a header names, as its first day: "Oct-Dec'26", "Jan - Mar 2027", "Q1 2027",
 * "2027 Q1". Null for anything else, including whole-period headers like "Oct 2026 - Jun 2027".
 */
export function quarterStart(header: string): string | null {
  const h = header.toLowerCase();
  const range = h.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*[-–]\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s*['’]?\s*(\d{4}|\d{2})\b/);
  if (range) {
    const a = MONTHS.indexOf(range[1]);
    const b = MONTHS.indexOf(range[2]);
    const span = (b - a + 12) % 12;
    if (span < 1 || span > 3) return null;
    let year = Number(range[3]);
    if (year < 100) year += 2000;
    if (a > b) year -= 1; // "Nov-Jan'27" starts in 2026
    return `${year}-${pad(a + 1)}-01`;
  }
  const q = h.match(/\bq([1-4])\s*[-/ ]?\s*(20\d\d)\b/) ?? h.match(/\b(20\d\d)\s*[-/ ]?\s*q([1-4])\b/);
  if (q) {
    const [quarter, year] = q[1].length === 4 ? [Number(q[2]), Number(q[1])] : [Number(q[1]), Number(q[2])];
    return `${year}-${pad((quarter - 1) * 3 + 1)}-01`;
  }
  return null;
}

/** The row, in the first 30, whose cells match the most of `patterns` (at least `min`). */
function headerRow(grid: Grid, patterns: RegExp[], min = 3) {
  let best = -1;
  let score = min - 1;
  grid.slice(0, 30).forEach((row, i) => {
    const cells = row.map(text);
    const n = patterns.filter((p) => cells.some((c) => p.test(c))).length;
    if (n > score) {
      score = n;
      best = i;
    }
  });
  return best;
}

/** Each column's header text: the header row plus the two rows under it, where those hold words, not numbers. */
function headers(grid: Grid, row: number) {
  const width = Math.max(...grid.slice(row, row + 3).map((r) => r.length), 0);
  return Array.from({ length: width }, (_, c) =>
    [0, 1, 2]
      .map((k) => grid[row + k]?.[c])
      .filter((v) => typeof v === "string" && num(v) === null)
      .map(text)
      .join(" ")
      .trim(),
  );
}

const pick = (heads: string[], patterns: RegExp[], skip: (h: string) => boolean = () => false, taken: number[] = []) => {
  for (const p of patterns) {
    const i = heads.findIndex((h, c) => !taken.includes(c) && p.test(h) && !skip(h));
    if (i >= 0) return i;
  }
  return undefined;
};

const CURRENCIES = ["AFN", "USD", "EUR", "GBP", "IQD", "LBP", "ILS", "VND", "KHR", "MMK", "ETB", "RWF", "UGX", "KES", "TZS", "GTQ", "HNL", "MXN", "COP", "PEN", "CHF"];
const currencyIn = (s: string) => CURRENCIES.find((c) => new RegExp(`\\b${c}\\b`, "i").test(s)) ?? null;

/* ---------------- Budget ---------------- */

export const BUDGET_KINDS = ["program", "personnel", "operations"] as const;
export type BudgetKind = (typeof BUDGET_KINDS)[number];

export const BUDGET_FIELDS = ["code", "activity", "description", "unit", "quantity", "unitCost", "total", "spent"] as const;
export type BudgetField = (typeof BUDGET_FIELDS)[number];
export type BudgetColumns = Partial<Record<BudgetField, number>> & { quarters: { col: number; start: string }[] };

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().min(-1e13).max(1e13);

export const budgetLineSchema = z.object({
  code: z.string().trim().min(1).max(40),
  /** Workplan activity number, e.g. "1.2.1". */
  activityCode: z.string().max(20).nullable(),
  activity: z.string().max(300).nullable(),
  description: z.string().trim().min(1).max(500),
  unit: z.string().max(60).nullable(),
  quantity: z.number().min(0).max(1e9).nullable(),
  unitCost: money.nullable(),
  total: money,
  spent: money.nullable(),
  /** Planned spending by quarter: first day of the quarter → amount. */
  schedule: z.record(isoDate, money),
  kind: z.enum(BUDGET_KINDS),
  /** Bought through procurement, so it goes on the procurement calendar. */
  procure: z.boolean(),
});
export type BudgetLine = z.infer<typeof budgetLineSchema>;

export const budgetSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  lines: z.array(budgetLineSchema).max(2000),
});
export type Budget = z.infer<typeof budgetSchema>;

export type BudgetParse = { headerRow: number; headers: string[]; columns: BudgetColumns; currency: string; lines: BudgetLine[]; warnings: string[]; /** Each line's row in the sheet (1-based), for its source. */ rows: number[] };

const BUDGET_GUESS: Record<Exclude<BudgetField, "activity">, RegExp[]> = {
  code: [/^item\s*(no|#|code|number)/i, /^(budget\s*)?line\s*(no|#|code)?$/i, /^(code|ref|no\.?|#)$/i, /\bcode\b/i],
  description: [/descri/i, /^item$/i, /^(cost\s*)?item\b/i, /particular/i],
  unit: [/^unit(s)?(\s*of\s*measure(ment)?)?$/i, /^unit\b(?!.*(price|cost|rate))/i, /\buom\b/i],
  quantity: [/quantit/i, /^qty/i, /\bno\.?\s*of\s*units\b/i],
  unitCost: [/unit\s*(price|cost)/i, /\brate\b/i, /unit\s*value/i],
  total: [/revised\s*budget/i, /total\s*budget/i, /^budget\b/i, /^total\b/i, /amount/i],
  spent: [/actual/i, /expend/i, /\bspent\b/i],
};
const notTotal = (h: string) => /actual|expend|remain|percent|%|differ|variance|projection/i.test(h);

/** Guesses which column holds what. A person confirms or changes the guess before anything is saved. */
export function guessBudgetColumns(grid: Grid): { row: number; heads: string[]; columns: BudgetColumns } | null {
  const row = headerRow(grid, [BUDGET_GUESS.description[0], BUDGET_GUESS.quantity[0], BUDGET_GUESS.unitCost[0], /total|amount|budget/i, BUDGET_GUESS.code[0], /^unit$/i]);
  if (row < 0) return null;
  const heads = headers(grid, row);
  const columns: BudgetColumns = { quarters: [] };
  const taken: number[] = [];
  for (const f of ["code", "description", "quantity", "unitCost", "spent", "total", "unit"] as const) {
    const c = pick(heads, BUDGET_GUESS[f], f === "total" ? notTotal : f === "unit" ? (h) => /price|cost/i.test(h) : undefined, taken);
    if (c !== undefined) {
      columns[f] = c;
      taken.push(c);
    }
  }
  // Several unit-cost columns (one per currency): keep the one whose quantity × unit cost best matches the total.
  const costCols = heads.map((h, c) => (BUDGET_GUESS.unitCost.some((p) => p.test(h)) ? c : -1)).filter((c) => c >= 0);
  if (costCols.length > 1 && columns.quantity !== undefined && columns.total !== undefined) {
    const fit = (c: number) => {
      const r = grid
        .slice(row + 1)
        .map((x) => {
          const q = num(x[columns.quantity!]);
          const u = num(x[c]);
          const t = num(x[columns.total!]);
          return q && u && t ? Math.abs(Math.log(t / (q * u))) : null;
        })
        .filter((v): v is number => v !== null && Number.isFinite(v))
        .sort((a, b) => a - b);
      return r.length ? r[Math.floor(r.length / 2)] : Infinity;
    };
    columns.unitCost = costCols.reduce((a, b) => (fit(b) < fit(a) ? b : a));
  }
  // The activity column often has no header: find it by its contents ("Activity 1.1.1 …").
  const width = heads.length;
  let bestActivity = -1;
  let bestHits = 1;
  for (let c = 0; c < width; c++) {
    if (taken.includes(c)) continue;
    const hits = grid.slice(row + 1).filter((x) => /^activity\s*\d/i.test(text(x[c]))).length + (/^activit/i.test(heads[c]) ? 2 : 0);
    if (hits > bestHits) {
      bestHits = hits;
      bestActivity = c;
    }
  }
  if (bestActivity >= 0) columns.activity = bestActivity;
  for (let c = 0; c < width; c++) {
    const start = quarterStart(heads[c]);
    if (start && !taken.includes(c)) columns.quarters.push({ col: c, start });
  }
  return { row, heads, columns };
}

/** Reads the budget lines using the given columns (or the guess). */
export function parseBudget(grid: Grid, override?: { row?: number; columns?: BudgetColumns; currency?: string }): BudgetParse | null {
  const guess = guessBudgetColumns(grid);
  if (!guess && override?.row === undefined) return null;
  const row = override?.row ?? guess!.row;
  const heads = guess && guess.row === row ? guess.heads : headers(grid, row);
  const columns = override?.columns ?? guess!.columns;
  const warnings: string[] = [];
  if (columns.description === undefined) warnings.push("No description column was found. Choose it below.");
  if (columns.total === undefined) warnings.push("No total column was found. Choose it below.");

  const preamble = grid.slice(0, row + 3).flat().map(text).join(" ");
  const currency = override?.currency ?? currencyIn(heads[columns.unitCost ?? -1] ?? "") ?? currencyIn(preamble) ?? "USD";

  const lines: BudgetLine[] = [];
  const rows: number[] = [];
  let section = "";
  let activityCode: string | null = null;
  let activity: string | null = null;
  const at = (r: Cell[], f: BudgetField) => (columns[f] === undefined ? null : r[columns[f]!]);
  const firstRow = row + 1 + (grid.slice(row + 1, row + 3).every((r) => r.every((c) => num(c) === null)) ? 2 : 0);

  for (let i = firstRow; i < grid.length; i++) {
    const r = grid[i];
    const code = text(at(r, "code"));
    const description = text(at(r, "description"));
    const total = num(at(r, "total"));
    const label = `${code} ${description}`.trim();
    if (/^(total|grand total)\b/i.test(code) || /^grand total\b/i.test(description)) break;
    if (/sub-?\s*total|^total\b/i.test(label)) continue;

    const act = text(at(r, "activity"));
    const m = act.match(/activity\s*([\d.]*\d)\s*:?\s*(.*)/i);
    // An activity column of bare numbers ("1.1.1"): that row's own activity, not a section heading.
    const bare = m ? null : act.match(/^(\d+(?:\.\d+)+)\s*:?\s*(.*)$/);
    if (m) {
      activityCode = m[1];
      activity = m[2] || null;
    }
    // A row of words only, such as "Output 1.2: …" or "3. Personnel": a new section.
    if (total === null && r.every((c) => num(c) === null || text(c) === "")) {
      const words = r.map(text).filter(Boolean).join(" ");
      if (words) {
        section = words;
        if (!m) {
          activityCode = null;
          activity = null;
        }
      }
      continue;
    }
    if (total === null || !(code || description)) continue;

    const unit = text(at(r, "unit")) || null;
    const kind: BudgetKind = /personnel|salar|staff|human resource/i.test(section) || /\bLOE\b|person.?days?|man.?days?|work.?days?/i.test(unit ?? "") || /^(LAB|PER|SAL|HR)-/i.test(code)
      ? "personnel"
      : /operation|admin|overhead|office|indirect/i.test(section) || /^(OPS|OPR|ADM)-/i.test(code)
        ? "operations"
        : "program";
    const schedule: Record<string, number> = {};
    for (const q of columns.quarters) {
      const v = num(r[q.col]);
      if (v) schedule[q.start] = round2((schedule[q.start] ?? 0) + v);
    }
    rows.push(i + 1);
    lines.push({
      code: (code || `L-${lines.length + 1}`).slice(0, 40),
      activityCode: bare ? bare[1] : (activityCode ?? code.match(/-(\d+\.\d+\.\d+)/)?.[1] ?? null),
      activity: bare ? bare[2] || null : activity,
      description: (description || code).slice(0, 500),
      unit,
      quantity: num(at(r, "quantity")),
      unitCost: (() => {
        const u = num(at(r, "unitCost"));
        return u === null ? null : round2(u);
      })(),
      total: round2(total),
      spent: (() => {
        const s = num(at(r, "spent"));
        return s === null ? null : round2(s);
      })(),
      schedule,
      kind,
      // Lines revised to zero need no purchase.
      procure: kind !== "personnel" && total > 0 && !/bank|charge|fee|miscellan|exchange|tax|depreciation|contingenc/i.test(description),
    });
  }
  const seen = new Set<string>();
  for (const l of lines) {
    if (seen.has(l.code)) warnings.push(`Line code ${l.code} appears more than once.`);
    seen.add(l.code);
  }
  if (!columns.quarters.length) warnings.push("No quarterly columns were found, so the calendar will use the workplan dates.");
  return { headerRow: row, headers: heads, columns, currency, lines, warnings, rows };
}

/* ---------------- Workplan ---------------- */

export const workplanItemSchema = z.object({
  /** Sub-activity number, e.g. "1.2.1.3"; activity number when there is none. */
  code: z.string().trim().min(1).max(30),
  activityCode: z.string().max(20).nullable(),
  activity: z.string().max(300).nullable(),
  title: z.string().trim().min(1).max(500),
  indicator: z.string().max(500).nullable(),
  unit: z.string().max(120).nullable(),
  /** Who delivers it, e.g. "ROP", "FAO". Consortium workplans list every partner. */
  org: z.string().max(60).nullable(),
  /** Targets by quarter (first day of the quarter). */
  targets: z.record(isoDate, z.number().min(0).max(1e12)),
  /** Quarters with work planned, including those marked X with no number. */
  active: z.array(isoDate).max(80),
  start: isoDate.nullable(),
  end: isoDate.nullable(),
  remark: z.string().max(1000).nullable(),
});
export type WorkplanItem = z.infer<typeof workplanItemSchema>;
export const workplanSchema = z.object({ items: z.array(workplanItemSchema).max(2000) });

export type WorkplanParse = { items: WorkplanItem[]; relative: boolean; quarters: number; warnings: string[] };

const isOurs = (org: string | null) => !!org && /\b(rop|roots of peace)\b/i.test(org);
export const ourWork = (items: WorkplanItem[]) => (items.some((i) => isOurs(i.org)) ? items.filter((i) => isOurs(i.org)) : items);

/**
 * Reads a workplan with quarterly columns. Quarters given as "Year 1 · Q1" are placed from
 * `year1Start` (the first day of the project's Year 1); calendar quarters ("Q1 2027") are used as they are.
 */
export function parseWorkplan(grid: Grid, year1Start: string): WorkplanParse | null {
  const row = headerRow(grid, [/^activit/i, /sub.?activ/i, /indicator/i, /^unit/i, /^(org|partner|implement|responsib)/i, /^q[1-4]$/i], 2);
  if (row < 0) return null;
  const top = Array.from(grid[row], text);
  const below = Array.from(grid[row + 1] ?? [], text);
  const width = Math.max(top.length, below.length);
  while (top.length < width) top.push("");
  while (below.length < width) below.push("");
  const col = (patterns: RegExp[]) => {
    for (const p of patterns) {
      const i = top.findIndex((h) => p.test(h));
      if (i >= 0) return i;
    }
    return -1;
  };
  const c = {
    activity: col([/^activit(y|ies)$/i, /^activit/i]),
    sub: col([/sub.?activ/i]),
    indicator: col([/indicator/i]),
    unit: col([/^unit/i]),
    org: col([/^(org|partner|implement|responsib|lead)/i]),
    remark: col([/remark|comment|note/i]),
  };
  const quarters: { col: number; start: string }[] = [];
  let relative = false;
  for (let k = 0; k < width; k++) {
    const own = quarterStart(`${top[k]} ${below[k]}`) ?? quarterStart(below[k]);
    if (own) {
      quarters.push({ col: k, start: own });
      continue;
    }
    const q = (below[k] || top[k]).match(/^q\s*([1-4])$/i);
    if (!q) continue;
    let year = 1;
    for (let j = k; j >= 0; j--) {
      const y = top[j].match(/(?:year|yr|y)\s*(\d+)/i);
      if (y) {
        year = Number(y[1]);
        break;
      }
    }
    relative = true;
    quarters.push({ col: k, start: addMonths(year1Start, (year - 1) * 12 + (Number(q[1]) - 1) * 3) });
  }
  const warnings: string[] = [];
  if (!quarters.length) warnings.push("No quarterly columns were found. Add start and end dates by hand.");

  const items: WorkplanItem[] = [];
  let activityCode: string | null = null;
  let activity: string | null = null;
  let sub: { code: string; title: string } | null = null;
  let indicator: string | null = null;
  let unit: string | null = null;
  const get = (r: Cell[], k: number) => (k < 0 ? "" : text(r[k]));

  for (let i = row + (below.some((b) => /^q\s*[1-4]$/i.test(b)) ? 2 : 1); i < grid.length; i++) {
    const r = grid[i];
    const a = get(r, c.activity);
    if (a) {
      const m = a.match(/activity\s*([\d.]*\d)\s*:?\s*(.*)/i);
      activityCode = m?.[1] ?? null;
      activity = (m?.[2] || a).slice(0, 300);
      sub = null;
    }
    const s = get(r, c.sub);
    if (s) {
      const m = s.match(/^([\d.]*\d)\s*[:.-]?\s*(.*)/);
      sub = { code: m?.[1] ?? `${activityCode ?? "?"}.${items.length + 1}`, title: (m?.[2] || s).slice(0, 500) };
      indicator = get(r, c.indicator) || null;
      unit = get(r, c.unit) || null;
    } else {
      // Merged cells: indicator and unit carry down within a sub-activity.
      if (get(r, c.indicator)) indicator = get(r, c.indicator);
      if (get(r, c.unit)) unit = get(r, c.unit);
    }
    const org = get(r, c.org) || null;
    if (!org || !(sub || activityCode)) continue;
    if (/^none$/i.test(indicator ?? "")) indicator = null;

    const targets: Record<string, number> = {};
    const active: string[] = [];
    for (const q of quarters) {
      const raw = text(r[q.col]);
      const v = num(r[q.col]);
      if (v !== null && v > 0) {
        targets[q.start] = (targets[q.start] ?? 0) + v;
        if (!active.includes(q.start)) active.push(q.start);
      } else if (/^x$/i.test(raw) && !active.includes(q.start)) active.push(q.start);
    }
    active.sort();
    items.push({
      code: (sub?.code ?? activityCode!).slice(0, 30),
      activityCode,
      activity,
      title: sub?.title || activity || sub?.code || "",
      indicator: indicator?.slice(0, 500) ?? null,
      unit: unit?.slice(0, 120) ?? null,
      org: org.slice(0, 60),
      targets,
      active,
      start: active[0] ?? null,
      end: active.length ? quarterEnd(active[active.length - 1]) : null,
      remark: get(r, c.remark).slice(0, 1000) || null,
    });
  }
  return { items, relative, quarters: quarters.length, warnings };
}

/** Words two descriptions share, for linking a budget line to the workplan sub-activity it pays for. */
function overlap(a: string, b: string) {
  const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
  const x = words(a);
  const y = words(b);
  let n = 0;
  x.forEach((w) => y.has(w) && n++);
  return n / Math.max(1, Math.min(x.size, y.size));
}

/** The workplan item a budget line most likely pays for: same activity number, closest wording. */
export function workplanFor(line: Pick<BudgetLine, "activityCode" | "description">, items: WorkplanItem[]): WorkplanItem | null {
  const same = items.filter((i) => line.activityCode && (i.activityCode === line.activityCode || i.code.startsWith(`${line.activityCode}.`)));
  const best = same.map((i) => ({ i, s: overlap(line.description, i.title) })).sort((a, b) => b.s - a.s)[0];
  return best && best.s >= 0.3 ? best.i : null;
}
