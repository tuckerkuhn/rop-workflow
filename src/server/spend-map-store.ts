import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema as s } from "@/db";
import type { Grid } from "@/lib/budget";
import { parseCsv } from "@/lib/results-import";
import { readWorkbook as readSheets } from "@/lib/read-sheet";
import { COLUMN_ROLES, sampleForAi, signatureOf, type BudgetRef, type SavedMapping, type SpendMapping } from "@/lib/spend-map";
import { ROP_VOICE } from "@/lib/voice";
import { draftStructured } from "@/server/ai-structured";
import { asIs } from "@/server/ai";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";

/**
 * Spending from any spreadsheet (lib/spend-map.ts): reading the file, the AI's proposed columns,
 * and the mapping a person confirmed, remembered per project (project_state "spendMapping").
 */

export type Sheet = { name: string; grid: Grid };

/** An .xlsx or .csv file as sheets of plain values. Null when it is neither. */
export async function readSpendFile(buf: Buffer, name: string): Promise<Sheet[] | null> {
  if (/\.csv$/i.test(name)) {
    const src = buf.toString("utf8").replace(/^﻿/, "");
    return [{ name: name.replace(/\.csv$/i, ""), grid: parseCsv(src) }];
  }
  try {
    const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    return (await readSheets(ab)).filter((x) => x.grid.some((r) => r?.some((c) => c !== null && c !== "")));
  } catch {
    return null;
  }
}

/** The sheet asked for, or the one with the most rows. */
export function pickSheet(sheets: Sheet[], name: string | null): Sheet | null {
  if (name) return sheets.find((x) => x.name === name) ?? null;
  return [...sheets].sort((a, b) => b.grid.length - a.grid.length)[0] ?? null;
}

export async function budgetRefs(code: string): Promise<{ budget: BudgetRef[]; currency: string }> {
  const project = await projectByCode(code);
  const rows = await db
    .select({ code: s.budgetLines.code, description: s.budgetLines.description, amount: s.budgetLines.amount, currency: s.budgetLines.currency })
    .from(s.budgetLines)
    .where(eq(s.budgetLines.projectId, project.id))
    .orderBy(asc(s.budgetLines.sort));
  const budget = rows.map((r) => ({ ...r, amount: r.amount === null ? null : Number(r.amount) }));
  // The budget's main currency: the one most of its lines are in.
  const tally = new Map<string, number>();
  for (const b of budget) tally.set(b.currency, (tally.get(b.currency) ?? 0) + 1);
  const currency = [...tally.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "USD";
  return { budget: budget.filter((b) => b.currency === currency), currency };
}

export async function loadSpendMapping(code: string): Promise<SavedMapping | null> {
  const project = await projectByCode(code);
  const [row] = await db
    .select()
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, "spendMapping")))
    .limit(1);
  return (row?.data as SavedMapping | undefined) ?? null;
}

/** The saved mapping, when this sheet has the same header row as last time (the same export). */
export function rememberedFor(saved: SavedMapping | null, sheet: Sheet): SpendMapping | null {
  if (!saved) return null;
  for (let r = 0; r < Math.min(sheet.grid.length, 40); r++) {
    const headers = (sheet.grid[r] ?? []).map((c) => (c == null ? "" : String(c)));
    if (signatureOf(headers) === saved.signature) return { ...saved.mapping, sheet: saved.mapping.sheet === null ? null : sheet.name, headerRow: r };
  }
  return null;
}

const proposal = z.object({
  headerRow: z.number().int().describe("The row number (as given, counted from 1) with the column headings."),
  ...Object.fromEntries(COLUMN_ROLES.map((r) => [r, z.number().int().describe(`The column (counted from 0) for ${r}, or -1 when there is none.`)])),
  reason: z.string().describe("One plain sentence, under 30 words, on how the file is laid out. Name columns by their heading, not their number."),
}) as z.ZodObject<{ headerRow: z.ZodNumber; reason: z.ZodString } & Record<(typeof COLUMN_ROLES)[number], z.ZodNumber>>;

const SYSTEM = [
  "You read the first rows of a spending export from an accounting system (QuickBooks, NetSuite, Xero or a hand-made Excel sheet) for a donor-funded agriculture project.",
  "Say which row holds the column headings and which column holds each of these:",
  "code: the budget line or account (a code such as A-111 or 6100, or the account name when there is no code column);",
  "description: a description of the account or the transaction;",
  "amount: the amount spent in one column (signed or positive);",
  "debit and credit: only when the amount is split into separate debit and credit columns (then amount is -1);",
  "date: the transaction date or the month;",
  "currency: a column naming the currency, when there is one.",
  "Use -1 for anything the file does not have. Never pick a running balance, a quantity or a budget column as the amount. Values shown as [name] were hidden because they name people.",
  ROP_VOICE,
].join(" ");

/** The AI's proposed columns, checked against the sheet. Only the first rows go, with people's names removed. */
export async function proposeMapping(code: string, sheet: Sheet, file: string, by: string): Promise<{ mapping: SpendMapping; reason: string; model: string }> {
  const project = await projectByCode(code);
  const rows = sampleForAi(sheet.grid);
  const { out, model } = await draftStructured({
    job: "spendColumns",
    by,
    projectId: project.id,
    system: SYSTEM,
    task: "Propose the header row and the columns.",
    facts: asIs({ sheet: sheet.name, rows: rows.map((cells, i) => ({ row: i + 1, cells: Object.fromEntries(cells.map((c, j) => [j, c]).filter(([, c]) => c !== "")) })) }, "the first rows only, already through sampleForAi: columns that name people are blanked and names in other cells replaced"),
    schema: proposal,
    effort: "low",
    maxTokens: 4000,
  });
  const width = Math.max(0, ...sheet.grid.slice(0, 40).map((r) => r?.length ?? 0));
  // Rows go to the AI counted from 1, as the screen shows them; columns from 0.
  const headerRow = out.headerRow >= 1 && out.headerRow <= Math.min(sheet.grid.length, 40) ? out.headerRow - 1 : 0;
  const col = (i: number) => (Number.isInteger(i) && i >= 0 && i < width ? i : null);
  const columns = Object.fromEntries(COLUMN_ROLES.map((r) => [r, col(out[r])])) as SpendMapping["columns"];
  if (columns.amount !== null) columns.debit = columns.credit = null;
  const mapping: SpendMapping = { sheet: sheet.name, headerRow, columns, month: null };
  await logAudit(db, project.id, { entity: "actuals", entityId: project.id, action: "spend_mapping_proposed", by, detail: { file, sheet: sheet.name, model, mapping } });
  return { mapping, reason: out.reason.slice(0, 240), model };
}

/** Remembers the confirmed columns and account assignments; logs when they changed. */
export async function saveSpendMapping(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], projectId: string, prev: SavedMapping | null, next: SavedMapping, file: string) {
  const changed = !prev || JSON.stringify({ ...prev.mapping, headerRow: 0 }) !== JSON.stringify({ ...next.mapping, headerRow: 0 }) || prev.signature !== next.signature || JSON.stringify(prev.assign) !== JSON.stringify(next.assign);
  if (changed) await logAudit(tx, projectId, { entity: "actuals", entityId: projectId, action: "spend_mapping_confirmed", by: next.by, detail: { file, mapping: next.mapping, assigned: Object.keys(next.assign).length } });
  await tx
    .insert(s.projectState)
    .values({ projectId, key: "spendMapping", data: next })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data: next, updatedAt: new Date() } });
}
