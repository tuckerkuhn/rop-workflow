import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, schema as s } from "@/db";
import { readIce, type Bva } from "@/lib/bva";
import { projectByCode } from "@/server/field-store";

/**
 * Imported budget against actual, kept as project_state "actuals": the latest import in full,
 * and a short history of every import (who, when, which file and its fingerprint, the totals).
 * The workbook itself is not stored: its ledger sheets name staff.
 */

export type Imported = Bva & { file: { name: string; hash: string; sharepointUrl: string | null }; by: string; at: string };
/** One import per phase of the agreement (e.g. Apr–Dec 2025 and Jan 2026 onward); `current` is the latest. */
export type ActualsState = { imports: Imported[]; current: Imported | null; history: { file: Imported["file"]; by: string; at: string; months: string[]; actual: number }[] };

export async function loadActuals(code: string): Promise<ActualsState> {
  const project = await projectByCode(code);
  const [row] = await db
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, "actuals")))
    .limit(1);
  const data = (row?.data as Partial<ActualsState> | undefined) ?? {};
  const imports = data.imports ?? (data.current ? [data.current] : []);
  imports.sort((a, b) => (a.months[0] ?? "").localeCompare(b.months[0] ?? ""));
  return { imports, current: imports.at(-1) ?? null, history: data.history ?? [] };
}

/** Reads the ICE sheet from an uploaded workbook. Never throws on bad content: it lists the problems. */
export async function readWorkbook(buf: Buffer): Promise<Bva> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    return { sheet: "", currency: "AFN", months: [], monthLabels: {}, lines: [], totals: { costs: null, overhead: null, grand: null }, rate: null, problems: ["This is not an Excel workbook (.xlsx) the app can read."], notes: [] };
  }
  const sheets = [...wb.worksheets].sort((a, b) => Number(/ice report|budget vs actual/i.test(b.name)) - Number(/ice report|budget vs actual/i.test(a.name)));
  let first: Bva | null = null;
  for (const ws of sheets) {
    if (/^exp gl|^gl\b|gl report|^jan|^feb|^mar|^apr|^may|^jun|^jul|^aug|^sep|^oct|^nov|^dec/i.test(ws.name)) continue; // ledger sheets: never read
    const rows: unknown[][] = [];
    ws.eachRow({ includeEmpty: true }, (row, n) => {
      const vals = row.values as unknown[];
      rows[n - 1] = vals.slice(1);
    });
    for (let i = 0; i < rows.length; i++) rows[i] ??= [];
    const out = readIce(rows, ws.name);
    if (!out.problems.length) return out;
    first ??= out;
  }
  return first ?? { sheet: "", currency: "AFN", months: [], monthLabels: {}, lines: [], totals: { costs: null, overhead: null, grand: null }, rate: null, problems: ["No sheet with budget against actual (an \"ICE Report\" sheet) was found."], notes: [] };
}

export const fingerprint = (buf: Buffer) => createHash("sha256").update(buf).digest("hex");

/**
 * Saves an import: the lines' spending to date on the budget, and the months for the reports.
 * Returns the budget lines the workbook has that the app's budget does not, and the reverse.
 */
export async function saveActuals(code: string, bva: Bva, file: Imported["file"], by: string) {
  const project = await projectByCode(code);
  const budget = await db.select({ id: s.budgetLines.id, code: s.budgetLines.code }).from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id));
  const known = new Map(budget.map((b) => [b.code, b.id]));
  // An import from an earlier phase (before the project's start) shares line codes with different meanings: it never touches the budget.
  const startMonth = (project.startDate ?? "0000-00").slice(0, 7);
  const thisPhase = (bva.months.at(-1) ?? "") >= startMonth;
  const notInBudget = thisPhase ? bva.lines.filter((l) => !known.has(l.code)).map((l) => l.code) : [];
  const notInFile = thisPhase ? budget.filter((b) => !bva.lines.some((l) => l.code === b.code)).map((b) => b.code) : [];
  const at = new Date().toISOString();
  await db.transaction(async (tx) => {
    if (thisPhase)
      for (const l of bva.lines) {
        const id = known.get(l.code);
        if (id && !l.currency) await tx.update(s.budgetLines).set({ spent: String(Math.round(l.actual * 100) / 100), updatedAt: new Date() }).where(eq(s.budgetLines.id, id));
      }
    const prev = await loadActuals(code);
    // The new import replaces any import whose months overlap it (the same phase, a later month).
    const overlaps = (a: string[], b: string[]) => a.some((m) => b.includes(m));
    const imports = [...prev.imports.filter((i) => !overlaps(i.months, bva.months)), { ...bva, file, by, at }];
    const data: Omit<ActualsState, "current"> = {
      imports,
      history: [...prev.history, { file, by, at, months: bva.months, actual: bva.totals.grand?.actual ?? bva.lines.reduce((t, l) => t + l.actual, 0) }].slice(-36),
    };
    await tx
      .insert(s.projectState)
      .values({ projectId: project.id, key: "actuals", data })
      .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
  });
  return { notInBudget, notInFile };
}
