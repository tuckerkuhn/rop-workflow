import type { Cell, Grid } from "@/lib/budget";

/**
 * Reads every sheet of an Excel file into rows of plain values. Formulas give their last
 * calculated result; when the file has none saved, simple formulas (cell references, SUM,
 * + − × ÷) are worked out here. Merged cells give their value in the first cell only.
 */
export async function readWorkbook(data: ArrayBuffer): Promise<{ name: string; grid: Grid }[]> {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  return wb.worksheets.map((ws) => {
    const grid: Grid = [];
    const pending: { r: number; c: number; formula: string }[] = [];
    // Some sheets claim thousands of empty columns; only the first 400 are read.
    ws.eachRow({ includeEmpty: true }, (row, r) => {
      const out: Cell[] = [];
      row.eachCell({ includeEmpty: false }, (cell, c) => {
        if (c > 400) return;
        if (cell.isMerged && cell.master.address !== cell.address) return;
        const v = cell.value as unknown;
        // A formula with no saved result; copied (shared) formulas give their own translated text.
        const noResult = !!v && typeof v === "object" && ("formula" in v || "sharedFormula" in v) && (v as { result?: unknown }).result === undefined;
        const f = noResult ? (cell.formula ?? null) : null;
        if (f) pending.push({ r: r - 1, c: c - 1, formula: f });
        out[c - 1] = f ? null : plain(v);
      });
      grid[r - 1] = Array.from(out, (x) => x ?? null);
    });
    const full = Array.from(grid, (r) => r ?? []);
    // Formulas may refer to other unsaved formulas: a few passes settle them.
    for (let pass = 0; pass < 3 && pending.length; pass++)
      for (const p of pending) {
        const v = evaluate(p.formula, full);
        if (v !== null) full[p.r][p.c] = v;
      }
    return { name: ws.name, grid: full };
  });
}

function plain(v: unknown): Cell {
  if (v == null) return null;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "TRUE" : "FALSE";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as { result?: unknown; richText?: { text: string }[]; text?: string; error?: string };
    if ("result" in o) return plain(o.result);
    if (o.richText) return o.richText.map((t) => t.text).join("");
    if (typeof o.text === "string") return o.text;
    if (o.error) return null;
  }
  return null;
}

const colIndex = (letters: string) => [...letters.toUpperCase()].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
const ref = (s: string) => {
  const m = s.replace(/\$/g, "").match(/^([A-Z]{1,3})(\d+)$/i);
  return m ? { c: colIndex(m[1]), r: Number(m[2]) - 1 } : null;
};
const valueAt = (grid: Grid, r: number, c: number) => {
  const v = grid[r]?.[c];
  return typeof v === "number" ? v : 0;
};

/** Works out a simple formula; null when it uses anything else (other sheets, functions other than SUM). */
export function evaluate(formula: string, grid: Grid): number | null {
  let expr = formula.replace(/^=/, "").replace(/\s+/g, "");
  if (/!/.test(expr)) return null;
  expr = expr.replace(/SUM\(([^()]*)\)/gi, (_, args: string) => {
    let total = 0;
    for (const part of args.split(",")) {
      const [a, b] = part.split(":").map(ref);
      if (a && b) for (let r = Math.min(a.r, b.r); r <= Math.max(a.r, b.r); r++) for (let c = Math.min(a.c, b.c); c <= Math.max(a.c, b.c); c++) total += valueAt(grid, r, c);
      else if (a) total += valueAt(grid, a.r, a.c);
      else if (/^-?\d*\.?\d+$/.test(part)) total += Number(part);
      else return "NaN";
    }
    return String(total);
  });
  expr = expr.replace(/\$?[A-Z]{1,3}\$?\d+/gi, (m) => {
    const p = ref(m);
    return p ? `(${valueAt(grid, p.r, p.c)})` : "NaN";
  });
  if (!/^[\d.+\-*/()eE]+$/.test(expr)) return null;
  const v = arithmetic(expr);
  return v !== null && Number.isFinite(v) ? v : null;
}

/** + − × ÷ and brackets, without eval. */
function arithmetic(src: string): number | null {
  let i = 0;
  const peek = () => src[i];
  const number = (): number | null => {
    const m = src.slice(i).match(/^\d*\.?\d+(e[+-]?\d+)?/i);
    if (!m) return null;
    i += m[0].length;
    return Number(m[0]);
  };
  const factor = (): number | null => {
    if (peek() === "+") return i++, factor();
    if (peek() === "-") {
      i++;
      const f = factor();
      return f === null ? null : -f;
    }
    if (peek() === "(") {
      i++;
      const v = sum();
      if (peek() !== ")") return null;
      i++;
      return v;
    }
    return number();
  };
  const product = (): number | null => {
    let v = factor();
    while (v !== null && (peek() === "*" || peek() === "/")) {
      const op = src[i++];
      const f = factor();
      if (f === null) return null;
      v = op === "*" ? v * f : v / f;
    }
    return v;
  };
  const sum = (): number | null => {
    let v = product();
    while (v !== null && (peek() === "+" || peek() === "-")) {
      const op = src[i++];
      const p = product();
      if (p === null) return null;
      v = op === "+" ? v + p : v - p;
    }
    return v;
  };
  const v = sum();
  return i === src.length ? v : null;
}
