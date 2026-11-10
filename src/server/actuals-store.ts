import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, schema as s } from "@/db";
import { readIce, type Bva, type BvaLine } from "@/lib/bva";
import type { AppUser } from "@/lib/demo";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { holdsRole } from "@/server/hr-store";

/**
 * Imported budget against actual, kept as project_state "actuals": the latest import in full,
 * and a short history of every import (who, when, which file and its fingerprint, the totals).
 * The workbook itself is not stored: its ledger sheets name staff.
 */

export type Imported = Bva & { file: { name: string; hash: string; sharepointUrl: string | null }; by: string; at: string; /** "spreadsheet": read with a confirmed column mapping (lib/spend-map.ts); otherwise Finance's ICE workbook. */ source?: "ice" | "spreadsheet" };

/** Finance, or whoever holds the NetSuite import role on the project. */
export async function mayImport(u: AppUser) {
  return u.kind === "employee" && (u.project.includes("finance-import") || (await holdsRole(u.id, "finance")));
}

/**
 * A monthly file added to this phase's earlier import: its months replace the same months there
 * and the rest are kept, so spending to date is the sum of every month imported.
 */
export function mergeMonths(prev: Bva, next: Bva): Bva {
  const fresh = new Set(next.months);
  const lines = new Map<string, BvaLine>();
  for (const l of prev.lines) {
    const months = Object.fromEntries(Object.entries(l.months).filter(([m]) => !fresh.has(m)));
    lines.set(l.code, { ...l, months });
  }
  for (const l of next.lines) {
    const old = lines.get(l.code);
    lines.set(l.code, old ? { ...old, budget: old.budget || l.budget, months: { ...old.months, ...l.months } } : { ...l });
  }
  const sum = (o: Record<string, number>) => Math.round(Object.values(o).reduce((t, v) => t + v, 0) * 100) / 100;
  const all = [...lines.values()].map((l) => ({ ...l, actual: sum(l.months) }));
  const local = all.filter((l) => !l.currency);
  const months: Record<string, number> = {};
  for (const l of local) for (const [m, v] of Object.entries(l.months)) months[m] = Math.round(((months[m] ?? 0) + v) * 100) / 100;
  const costs = { budget: local.reduce((t, l) => t + l.budget, 0), actual: sum(months), months };
  const overhead = prev.totals.overhead;
  const x = overhead && prev.rate ? prev.rate : 0;
  const grand = overhead && x ? { budget: costs.budget + overhead.budget * x, actual: costs.actual + overhead.actual * x, months: Object.fromEntries(Object.entries(months).map(([m, v]) => [m, v + (overhead.months[m] ?? 0) * x])) } : costs;
  const allMonths = [...new Set([...prev.months.filter((m) => !fresh.has(m)), ...next.months])].sort();
  return {
    ...next,
    months: allMonths,
    monthLabels: { ...prev.monthLabels, ...next.monthLabels },
    lines: all,
    totals: { costs, overhead, grand },
    rate: prev.rate,
    notes: [...next.notes, `Added to the earlier import (${prev.months[0] ?? ""} to ${prev.months.at(-1) ?? ""}); this file's months replace the same months there.`, ...(overhead ? ["Overhead in US dollars is kept from the earlier import."] : [])],
  };
}
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
export async function saveActuals(code: string, imported: Bva, file: Imported["file"], by: string, opts: { source?: "ice" | "spreadsheet"; detail?: Record<string, unknown>; also?: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], projectId: string) => Promise<void> } = {}) {
  const project = await projectByCode(code);
  let bva = imported;
  const budget = await db.select({ id: s.budgetLines.id, code: s.budgetLines.code }).from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id));
  const known = new Map(budget.map((b) => [b.code, b.id]));
  // An import from an earlier phase (before the project's start) shares line codes with different meanings: it never touches the budget.
  const startMonth = (project.startDate ?? "0000-00").slice(0, 7);
  const thisPhase = (bva.months.at(-1) ?? "") >= startMonth;
  // A spreadsheet import (often one month) adds to this phase's earlier import rather than replacing it.
  if (opts.source === "spreadsheet" && thisPhase) {
    const earlier = [...(await loadActuals(code)).imports].reverse().find((i) => (i.months.at(-1) ?? "") >= startMonth);
    if (earlier) bva = mergeMonths(earlier, bva);
  }
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
    const imports = [...prev.imports.filter((i) => !overlaps(i.months, bva.months)), { ...bva, file, by, at, ...(opts.source ? { source: opts.source } : {}) }];
    const data: Omit<ActualsState, "current"> = {
      imports,
      history: [...prev.history, { file, by, at, months: bva.months, actual: bva.totals.grand?.actual ?? bva.lines.reduce((t, l) => t + l.actual, 0) }].slice(-36),
    };
    const g = bva.totals.grand;
    await logAudit(tx, project.id, {
      entity: "actuals",
      entityId: project.id,
      action: "actuals_imported",
      by,
      detail: { file: file.name, hash: file.hash, sharepointUrl: file.sharepointUrl, months: bva.months, period: `${bva.months[0] ?? ""} to ${bva.months.at(-1) ?? ""}`, budget: g?.budget ?? null, actual: g?.actual ?? null, currency: bva.currency, source: opts.source ?? "ice", ...(opts.detail ?? {}) },
    });
    if (opts.also) await opts.also(tx, project.id);
    await tx
      .insert(s.projectState)
      .values({ projectId: project.id, key: "actuals", data })
      .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data, updatedAt: new Date() } });
  });
  return { notInBudget, notInFile };
}
