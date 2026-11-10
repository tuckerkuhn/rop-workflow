import { and, eq, isNotNull } from "drizzle-orm";
import { draftMark } from "@/lib/preflight";
import ExcelJS from "exceljs";
import { db, schema as s } from "@/db";
import { spentIn } from "@/lib/bva";
import { activityOfLine, emptyFace, faceRows, monthShort, nextMonth, periodText, type FaceMonth, type FaceRow, type FaceState } from "@/lib/face";
import { loadActuals } from "@/server/actuals-store";
import { projectByCode, donorNameOf } from "@/server/field-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";

/** The FACE form: header and each month's entries in project_state ("face"); figures from the spending import. */

export async function loadFace(code: string): Promise<FaceState> {
  const project = await projectByCode(code);
  const st = await loadProjectState<FaceState>(project.id, "face", emptyFace);
  return { header: { ...emptyFace.header, ...st.header }, months: st.months ?? {} };
}
export async function saveFace(code: string, st: FaceState) {
  const project = await projectByCode(code);
  await saveProjectState(project.id, "face", st);
}

export type FaceViewData = {
  project: { code: string | null; name: string; donor: string | null };
  month: string;
  period: string;
  header: FaceState["header"];
  entries: FaceMonth;
  saved: boolean;
  imported: boolean;
  currency: string;
  rows: FaceRow[];
  total: FaceRow;
  overheadUsd: number;
  months: string[];
};

/** A month's form: rows by activity, overhead, what is missing, and the entries pre-filled from the month before. */
/** What stays authorised after a month (G, per activity): the next month's authorised amount. */
async function outstandingAfter(code: string, month: string): Promise<Record<string, number>> {
  const v = await faceView(code, month);
  return Object.fromEntries(v.rows.map((r) => [r.activity, r.g]));
}

export async function faceView(code: string, month: string): Promise<FaceViewData> {
  const project = await projectByCode(code);
  const st = await loadFace(code);
  const actuals = await loadActuals(code);
  // The import whose months include this one (an agreement's phases are imported separately).
  const imp = [...actuals.imports].reverse().find((i) => i.months.includes(month)) ?? null;
  const spentByLine = imp ? spentIn(imp, month, month).byLine : {};
  const spent: Record<string, number> = {};
  for (const [line, v] of Object.entries(spentByLine)) {
    const a = activityOfLine(line);
    if (a) spent[a] = (spent[a] ?? 0) + v;
  }
  const names = new Map<string, string>();
  for (const l of await db.selectDistinct({ c: s.budgetLines.activityCode, n: s.budgetLines.activity }).from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id))) if (l.c && l.n && !names.has(l.c)) names.set(l.c, l.n);
  for (const w of await db.selectDistinct({ c: s.workplanItems.activityCode, n: s.workplanItems.activity }).from(s.workplanItems).where(and(eq(s.workplanItems.projectId, project.id), isNotNull(s.workplanItems.activityCode)))) if (w.c && w.n && !names.has(w.c)) names.set(w.c, w.n);
  const codes = [...new Set([...(imp?.lines ?? []).map((l) => activityOfLine(l.code)).filter((x): x is string => !!x), ...Object.keys(spent)])].sort();
  const activities = codes.map((c) => ({ code: c, name: names.get(c) ?? `Activity ${c}` }));
  // Not saved yet: authorised starts from last month's outstanding amount (G), the request empty.
  const saved = st.months[month];
  const prevKey = Object.keys(st.months).filter((k) => k < month).sort().at(-1);
  let entries: FaceMonth | undefined = saved;
  if (!saved && prevKey) entries = { authorised: await outstandingAfter(code, prevKey), request: {}, requestPeriod: monthShort(nextMonth(month)), authorisedPeriod: monthShort(month) };
  entries ??= { authorised: {}, request: {}, requestPeriod: monthShort(nextMonth(month)), authorisedPeriod: monthShort(month) };
  const { rows, total } = faceRows(activities, spent, entries);
  const overheadUsd = Math.round(imp?.totals.overhead?.currency === "USD" ? (imp.totals.overhead.months[month] ?? 0) : 0);
  return {
    project: { code: project.code, name: project.name, donor: await donorNameOf(project) },
    month,
    period: periodText(month),
    header: st.header,
    entries,
    saved: !!saved,
    imported: !!imp,
    currency: imp?.currency ?? "AFN",
    rows,
    total,
    overheadUsd,
    months: [...new Set(actuals.imports.flatMap((i) => i.months))].sort().reverse(),
  };
}
export type FaceView = FaceViewData;

/** The form as an Excel workbook, laid out like UNDP's FACE template. */
export async function faceWorkbook(v: FaceView, draft = 0): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("FACE Form", { pageSetup: { orientation: "landscape", fitToPage: true } });
  if (draft) ws.addRow([draftMark(draft)]).font = { bold: true, color: { argb: "FFAA3333" } };
  const h = v.header;
  const bold = { bold: true };
  const date = new Date(Date.UTC(Number(v.month.slice(0, 4)), Number(v.month.slice(5, 7)), 0)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit", timeZone: "UTC" }).replace(/ /g, "-");
  ws.addRow(["Funding Authorization and Certificate of Expenditures", "", "", "", "", "", "UN Agency:", h.agency, "", "Date:", date]).font = bold;
  ws.addRow([]);
  ws.addRow(["Country:", h.country, "", "", "", "", "Type of Request:"]);
  ws.addRow(["Programme Code & Title:", h.programme, "", "", "", "", "■ Direct Cash Transfer (DCT)"]);
  ws.addRow(["Project Code & Title:", v.project.name, "", "", "", "", "□ Reimbursement"]);
  ws.addRow(["Responsible Officer(s):", h.officer, "", "", "", "", "□ Direct Payment"]);
  ws.addRow(["Implementing Institution:", h.institution]);
  ws.addRow(["Period:", v.period]);
  ws.addRow(["", `Currency: ${v.currency} & USD`, "", "REPORTING", "", "", "", "REQUESTS / AUTHORIZATIONS"]).font = bold;
  const head = ws.addRow(["Activity Description from AWP with Duration", "Atlas Activity ID", "Account code", "Authorised Amount", "Actual Project Expenditure", "Expenditures accepted by Agency", "Balance", "New Request Period & Amount", "Authorised Amount", "Outstanding Authorised Amount"]);
  head.font = bold;
  ws.addRow(["", "", "", v.entries.authorisedPeriod, monthShort(v.month), monthShort(v.month), monthShort(v.month), v.entries.requestPeriod, v.entries.requestPeriod, v.entries.requestPeriod]).font = { italic: true };
  ws.addRow(["", "", "", "A", "B", "C", "D = A - C", "E", "F", "G = D + F"]).font = { italic: true };
  for (const r of v.rows) ws.addRow([`Activity ${r.activity}: ${r.name}`, r.activity, "Multiple", r.a, r.b, r.c, r.d, r.f || "", r.f, r.g]);
  const t = v.total;
  ws.addRow([`Total ${v.currency}`, "", "", t.a, t.b, t.c, t.d, t.f || "", t.f, t.g]).font = bold;
  ws.addRow([]);
  ws.addRow(["Overhead/GMS - 08%", "Overhead", "Multiple", 0, v.overheadUsd, v.overheadUsd, -v.overheadUsd, "", v.overheadUsd, 0]);
  ws.addRow(["Total USD", "", "", 0, v.overheadUsd, v.overheadUsd, -v.overheadUsd, "", v.overheadUsd, 0]).font = bold;
  ws.addRow([]);
  ws.addRow(["CERTIFICATION"]).font = bold;
  ws.addRow(["The undersigned authorized officer of the above-mentioned implementing institution hereby certifies that:"]);
  ws.addRow(["□ The funding request shown above represents estimated expenditures as per AWP and itemized cost estimates attached."]);
  ws.addRow(["■ The actual expenditures for the period stated herein has been disbursed in accordance with the AWP and request with itemized cost estimates. The detailed accounting documents for these expenditures can be made available for examination, when required, for the period of five years from the date of the provision of funds."]);
  ws.addRow(["□ The progress report for the activities stated herein has been submitted."]);
  ws.addRow(["Date Submitted:", date, "", "Signature:", "", "Name:", h.signer, "Title:", h.signerTitle]);
  ws.addRow([]);
  ws.addRow(["Made in ROP Workflow from Finance's budget against actual workbook. Expenditure accepted (C) is shown as reported until UNDP confirms it."]).font = { italic: true, color: { argb: "FF666666" } };
  ws.getColumn(1).width = 62;
  for (let k = 2; k <= 10; k++) ws.getColumn(k).width = 16;
  for (let k = 4; k <= 10; k++) ws.getColumn(k).numFmt = "#,##0;(#,##0)";
  return Buffer.from(await wb.xlsx.writeBuffer());
}
