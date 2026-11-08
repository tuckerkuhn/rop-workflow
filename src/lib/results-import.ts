import type { Grid } from "@/lib/budget";
import { resultSchema, type ResultInput } from "@/lib/results";

/**
 * Reads results from a spreadsheet: one row per result, with a header row. Columns are found by
 * their headings; the indicator may be the app's code (IND-3) or the donor's (1.1.1.4). Every
 * row is checked as if typed into the form, and nothing is saved until every row passes.
 */

export const IMPORT_COLUMNS = ["Indicator", "Date", "Value", "Women", "Men", "Young people", "Women-led", "Men-led", "Province", "District", "What was done", "Proof link", "Proof title"];
export const TEMPLATE_CSV = `${IMPORT_COLUMNS.join(",")}\nIND-7,2026-09-30,45,20,25,18,,,Kandahar,Arghandab,"Post-harvest handling training for 45 farmers at the Arghandab collection centre",https://rootsofpeace.sharepoint.com/...,Attendance sheet\n`;

const find = (head: string[], ...patterns: RegExp[]) => {
  for (const p of patterns) {
    const i = head.findIndex((h) => p.test(h));
    if (i >= 0) return i;
  }
  return -1;
};
const text = (v: unknown) => (v == null ? "" : String(v).trim());
const num = (v: unknown) => {
  const t = text(v).replace(/,/g, "");
  return t === "" ? undefined : Number(t);
};
/** Excel dates arrive as ISO text (read-sheet) or as day numbers; CSV as text in several forms. */
function isoDate(v: unknown): string | null {
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  const t = text(v);
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  // Day first, as ROP's Afghan and UN sheets write dates.
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return null;
}

/** Splits CSV text into rows, honouring quoted fields. */
export function parseCsv(src: string): Grid {
  const rows: string[][] = [[]];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      rows[rows.length - 1].push(cell);
      cell = "";
    }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      rows[rows.length - 1].push(cell);
      cell = "";
      rows.push([]);
    } else cell += c;
  }
  rows[rows.length - 1].push(cell);
  return rows.filter((r) => r.some((x) => x.trim()));
}

export type ImportRow = { row: number; result: ResultInput | null; errors: string[] };

export function readResults(grid: Grid, indicators: { code: string; donorCode: string | null }[], today: string): { rows: ImportRow[]; missing: string[] } {
  const h = grid.findIndex((r) => r.some((c) => /indicator/i.test(text(c))) && r.some((c) => /^value|^achieved|^number/i.test(text(c))));
  if (h < 0) return { rows: [], missing: ["a header row with Indicator and Value"] };
  const head = grid[h].map((c) => text(c).toLowerCase());
  const col = {
    indicator: find(head, /^indicator/),
    date: find(head, /^date/, /achieved on/, /when/),
    value: find(head, /^value/, /^achieved/, /^number/),
    women: find(head, /^women$/, /^female/, /^women\b(?!-?led)/),
    men: find(head, /^men$/, /^male/, /^men\b(?!-?led)/),
    youth: find(head, /young|youth/),
    womenLed: find(head, /women.?led/, /female.?led/),
    menLed: find(head, /men.?led/, /male.?led/),
    province: find(head, /province/),
    district: find(head, /district/),
    note: find(head, /what was done/, /^note/, /description/, /narrative/),
    link: find(head, /proof link/, /^link/, /url/, /sharepoint/),
    title: find(head, /proof title/, /document/, /proof$/),
  };
  const missing = (["indicator", "date", "value", "note"] as const).filter((k) => col[k] < 0).map((k) => ({ indicator: "Indicator", date: "Date", value: "Value", note: "What was done" })[k]);
  if (missing.length) return { rows: [], missing };
  const byCode = new Map<string, string>();
  for (const i of indicators) {
    byCode.set(i.code.toUpperCase(), i.code);
    if (i.donorCode) byCode.set(i.donorCode.toUpperCase(), i.code);
  }
  const at = (r: unknown[], i: number) => (i >= 0 ? r[i] : null);
  const rows: ImportRow[] = [];
  grid.slice(h + 1).forEach((r, k) => {
    if (!r.some((c) => text(c))) return;
    const errors: string[] = [];
    const indRaw = text(at(r, col.indicator)).toUpperCase().split(/\s/)[0];
    const indicator = byCode.get(indRaw);
    if (!indicator) errors.push(`Indicator "${text(at(r, col.indicator))}" is not one this project records`);
    const date = isoDate(at(r, col.date));
    if (!date) errors.push("Date not understood (use 2026-09-30)");
    else if (date > today) errors.push("Date is in the future");
    const link = text(at(r, col.link));
    const candidate = {
      indicator: indicator ?? "IND-0",
      date: date ?? "",
      value: num(at(r, col.value)),
      female: num(at(r, col.women)),
      male: num(at(r, col.men)),
      youth: num(at(r, col.youth)),
      womenLed: num(at(r, col.womenLed)),
      menLed: num(at(r, col.menLed)),
      province: text(at(r, col.province)) || undefined,
      district: text(at(r, col.district)) || undefined,
      note: text(at(r, col.note)),
      files: [],
      links: link ? [{ url: link, title: text(at(r, col.title)) || "Proof" }] : [],
      noFile: link ? undefined : "Imported without a proof link: to be linked",
    };
    const parsed = resultSchema.safeParse(candidate);
    if (!parsed.success) for (const issue of parsed.error.issues) if (!(issue.path[0] === "indicator" && !indicator) && !(issue.path[0] === "date" && !date)) errors.push(`${issue.path.join(".") || "Row"}: ${issue.message}`);
    if (candidate.female !== undefined && candidate.male !== undefined && candidate.female + candidate.male === 0) errors.push("Women and men are both 0: leave them blank if the result is not about people");
    rows.push({ row: h + k + 2, result: errors.length || !parsed.success ? null : parsed.data, errors });
  });
  return { rows, missing: [] };
}

/** The same result already recorded: same indicator, date, value and place. */
export const sameResult = (a: Pick<ResultInput, "indicator" | "date" | "value" | "district">, b: Pick<ResultInput, "indicator" | "date" | "value" | "district">) =>
  a.indicator === b.indicator && a.date === b.date && a.value === b.value && (a.district ?? "").toLowerCase() === (b.district ?? "").toLowerCase();
