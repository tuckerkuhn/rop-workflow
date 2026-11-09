import { and, asc, eq } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db, schema as s } from "@/db";
import { activityOf, yearShare } from "@/lib/qpr";
import { proofCount, quarterOf, quarterRange } from "@/lib/results";
import { projectByCode } from "@/server/field-store";
import { loadResults } from "@/server/results-store";

/**
 * Outputs donors and auditors ask for, built from the same accepted results as the reports:
 * the indicator tracking table (Excel) and the evidence annex's index (zipped in the browser).
 */

async function indicatorsOf(code: string) {
  const project = await projectByCode(code);
  const rows = await db
    .select()
    .from(s.indicators)
    .where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.source, "results")))
    .orderBy(asc(s.indicators.position));
  return { project, rows };
}

/** The indicator tracking table for a year: targets, each quarter's accepted results, the year and the life of the project. */
export async function trackingTable(code: string, year: number): Promise<Buffer> {
  const { project, rows } = await indicatorsOf(code);
  const results = (await loadResults(code)).filter((r) => r.status === "accepted");
  const wb = new ExcelJS.Workbook();
  wb.creator = "ROP Workflow";
  const ws = wb.addWorksheet(`Tracking ${year}`, { views: [{ state: "frozen", ySplit: 4 }] });
  ws.addRow([`${project.name}: indicator tracking table, ${year}`]).font = { bold: true, size: 13 };
  ws.addRow([`From results accepted by MEL, as of ${new Date().toISOString().slice(0, 10)}. Each figure is the sum of its records; the Records sheet lists them.`]).font = { italic: true, color: { argb: "FF555555" } };
  ws.addRow([]);
  const head = ws.addRow(["Code", "Activity", "Indicator", "Unit", "Baseline", `Target ${year}`, "Q1", "Q2", "Q3", "Q4", `Total ${year}`, `% of ${year} target`, `Women ${year}`, `Men ${year}`, "Total to date", "Life-of-project target", "Records", "Records with proof"]);
  head.font = { bold: true };
  head.eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFDFE9E3" } }));
  for (const i of rows) {
    const mine = results.filter((r) => r.indicator === i.code);
    const inYear = mine.filter((r) => r.date.startsWith(String(year)));
    const q = (n: number) => inYear.filter((r) => quarterOf(r.date) === `${year}-Q${n}`).reduce((t, r) => t + r.value, 0);
    const total = inYear.reduce((t, r) => t + r.value, 0);
    // The same year share as the quarterly report: year targets are stored as running totals.
    const yearTargets = Object.fromEntries(Object.entries((i.forecast as Record<string, number> | null) ?? {}).map(([k, v]) => [k, Number(v)]));
    const target = yearShare({ target: Number(i.target), yearTargets }, year);
    ws.addRow([
      i.donorCode ?? i.code,
      activityOf(i.donorCode, i.code),
      i.name,
      i.unit,
      i.baseline === null ? "" : Number(i.baseline),
      target || "",
      q(1),
      q(2),
      q(3),
      q(4),
      total,
      target ? Math.round((total / target) * 100) / 100 : "",
      inYear.reduce((t, r) => t + (r.female ?? 0), 0),
      inYear.reduce((t, r) => t + (r.male ?? 0), 0),
      mine.reduce((t, r) => t + r.value, 0),
      Number(i.target),
      inYear.length,
      inYear.filter((r) => proofCount(r)).length,
    ]);
  }
  ws.getColumn(12).numFmt = "0%";
  [10, 10, 60, 14].forEach((w, k) => (ws.getColumn(k + 1).width = w));
  for (let k = 5; k <= 18; k++) ws.getColumn(k).width = 11;

  const rec = wb.addWorksheet("Records");
  const rh = rec.addRow(["Indicator", "Date", "Quarter", "Value", "Women", "Men", "Province", "District", "What was done", "Proof files", "Proof links", "Recorded by"]);
  rh.font = { bold: true };
  const code2 = new Map(rows.map((i) => [i.code, i.donorCode ?? i.code]));
  for (const r of results.filter((x) => x.date.startsWith(String(year))).sort((a, b) => a.indicator.localeCompare(b.indicator) || a.date.localeCompare(b.date)))
    rec.addRow([code2.get(r.indicator) ?? r.indicator, r.date, quarterOf(r.date), r.value, r.female ?? "", r.male ?? "", r.province ?? "", r.district ?? "", r.note, r.files.map((f) => f.name).join("; "), (r.links ?? []).map((l) => `${l.title}: ${l.url}`).join("; "), r.by]);
  [12, 11, 9, 8, 7, 7, 11, 13, 70, 40, 40, 12].forEach((w, k) => (rec.getColumn(k + 1).width = w));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** The evidence annex's index for a quarter: every accepted result, by indicator, with its files and links. */
export async function evidenceIndex(code: string, quarter: string) {
  const { project, rows } = await indicatorsOf(code);
  const { from, to } = quarterRange(quarter);
  const results = (await loadResults(code)).filter((r) => r.status === "accepted" && r.date >= from && r.date <= to);
  return {
    project: { code: project.code, name: project.name },
    quarter,
    indicators: rows
      .map((i) => ({
        code: i.code,
        donorCode: i.donorCode ?? i.code,
        name: i.name,
        unit: i.unit,
        results: results
          .filter((r) => r.indicator === i.code)
          .sort((a, b) => a.date.localeCompare(b.date))
          .map((r) => ({ id: r.id, date: r.date, value: r.value, province: r.province ?? "", district: r.district ?? "", note: r.note, files: r.files.map((f) => ({ hash: f.hash, name: f.name, type: f.type, caption: r.captions?.[f.hash] ?? "" })), links: r.links ?? [] })),
      }))
      .filter((i) => i.results.length),
  };
}
export type EvidenceIndex = Awaited<ReturnType<typeof evidenceIndex>>;
