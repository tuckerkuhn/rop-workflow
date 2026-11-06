/**
 * Imports Finance's budget against actual from a SharePoint text export of the workbook, for when
 * the .xlsx itself cannot be downloaded (the Microsoft 365 connector returns sheets as text: one
 * tab-separated line per row, "[N empty rows]" for gaps, then a "Formulas:" list).
 *
 * The rows go through the same reader as an uploaded workbook (readIce), so the same checks apply:
 * line totals must add up to the sheet's own total rows, or nothing is saved. Only the named
 * sheet is read; the monthly ledger sheets, which name staff, are never touched.
 *
 *   npx tsx --env-file=.env.local src/db/import-bva-text.ts <export.txt> --project ACRP-2026 \
 *     --sheet "Budget Vs Actual" --name "<file name>" --url "<SharePoint link>" --by tucker [--apply]
 *
 * Dry run by default: shows months, totals and problems. --apply saves it like an upload would.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readIce } from "@/lib/bva";
import { saveActuals } from "@/server/actuals-store";

const arg = (k: string) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > 0 ? process.argv[i + 1] : undefined;
};

/** The named sheet's rows, as the reader expects them: one array of cell values per row. */
export function rowsFromExport(text: string, sheet: string): unknown[][] {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((l) => l.startsWith(`## Sheet: ${sheet} `) || l === `## Sheet: ${sheet}`);
  if (start < 0) throw new Error(`No sheet "${sheet}" in the export.`);
  const rows: unknown[][] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## Sheet:") || line.startsWith("Formulas:")) break;
    const gap = line.match(/^\[(\d+) empty rows?\]$/);
    if (gap) {
      for (let i = 0; i < Number(gap[1]); i++) rows.push([]);
      continue;
    }
    rows.push(line.split("\t").map((c) => (c.trim() === "" ? null : c)));
  }
  while (rows.length && !rows.at(-1)!.some((c) => c !== null)) rows.pop();
  return rows;
}

async function main() {
  const path = process.argv[2];
  const code = arg("project");
  const sheet = arg("sheet") ?? "Budget Vs Actual";
  const name = arg("name");
  const by = arg("by");
  if (!path || !code || !name || !by) throw new Error("Usage: import-bva-text.ts <export.txt> --project CODE --sheet NAME --name FILE --url LINK --by USER [--apply]");
  const text = readFileSync(path, "utf8");
  const bva = readIce(rowsFromExport(text, sheet), sheet);
  const t = bva.totals;
  console.log(`Sheet "${bva.sheet}", ${bva.currency}; ${bva.lines.length} budget lines; months ${bva.months[0]} to ${bva.months.at(-1)}`);
  console.log(`  costs: budget ${t.costs?.budget ?? "-"}, actual ${t.costs?.actual ?? "-"}`);
  console.log(`  overhead: budget ${t.overhead?.budget ?? "-"}, actual ${t.overhead?.actual ?? "-"} ${t.overhead?.currency ?? ""}`);
  console.log(`  grand total: budget ${t.grand?.budget ?? "-"}, actual ${t.grand?.actual ?? "-"}`);
  if (t.grand) console.log(`  by month: ${bva.months.map((m) => `${m} ${t.grand!.months[m] ?? 0}`).join(", ")}`);
  for (const n of bva.notes) console.log(`  note: ${n}`);
  for (const p of bva.problems) console.log(`  PROBLEM: ${p}`);
  if (bva.problems.length) throw new Error("Not imported: fix the problems above.");
  if (!process.argv.includes("--apply")) return console.log("Dry run: add --apply to import.");
  // The fingerprint is of the text export, not the workbook (which was not downloaded).
  const file = { name, hash: createHash("sha256").update(text).digest("hex"), sharepointUrl: arg("url") ?? null };
  const r = await saveActuals(code, bva, file, by);
  console.log(`Imported. Lines in the file but not the budget: ${r.notInBudget.join(", ") || "none"}. In the budget but not the file: ${r.notInFile.join(", ") || "none"}.`);
}

if (process.argv[1]?.endsWith("import-bva-text.ts"))
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
