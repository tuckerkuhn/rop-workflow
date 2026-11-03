import type { DonorInfo, IndicatorProgress, Period } from "@/lib/progress";
import { isImpact } from "@/lib/progress";
import type { MessageKey } from "@/lib/i18n";
import type { MilestoneKind } from "@/lib/work-items";

/**
 * Donor report layouts. Each donor picks one in project settings; Export report builds the
 * donor's layout. Add a donor's own template as another entry in FORMATS.
 */

export type ReportInput = {
  project: { code: string; name: string };
  donor: DonorInfo | null;
  period: Period & { deadline: { title: string; date: string } | null };
  indicators: IndicatorProgress[];
  /** Each indicator's count within `period`. */
  periodValues: Record<string, number | null>;
  /** Milestones from Tasks: those in the period and the next ones after it. */
  milestones: { title: string; date: string; end: string | null; kind: MilestoneKind }[];
  preparedOn: string;
  t: (key: MessageKey, vars?: Record<string, string | number>) => string;
  date: (iso: string) => string;
};

export type ReportTable = { heading: string; columns: string[]; rows: (string | number)[][]; note?: string };
/** A finished report, ready to show, print or save as a spreadsheet. */
export type ReportDoc = {
  title: string;
  subtitle: string;
  meta: [string, string][];
  summary: string;
  tables: ReportTable[];
  /** Headings the team writes under before sending. */
  narrative: string[];
};

export type ReportFormat = { id: string; label: MessageKey; build: (input: ReportInput) => ReportDoc };

const pct = (v: number | null, target: number) => (v === null || !target ? "—" : `${Math.round((v / target) * 100)}%`);

/** The baseline: what most donor progress reports ask for, in a neutral layout. */
const baseline: ReportFormat = {
  id: "baseline",
  label: "report.format.baseline",
  build: ({ project, donor, period, indicators, periodValues, milestones, preparedOn, t, date }) => {
    // A donor's report covers the indicators it tracks, under its own codes.
    const tracked = donor && Object.keys(donor.indicatorRefs).length ? indicators.filter((i) => i.code in donor.indicatorRefs) : indicators;
    const code = (i: IndicatorProgress) => donor?.indicatorRefs[i.code] || i.code;
    const columns = [t("report.col.code"), t("report.col.indicator"), t("report.col.unit"), t("report.col.target"), t("report.col.period"), t("report.col.total"), t("report.col.pct"), t("report.col.gender")];
    const row = (i: IndicatorProgress) => [
      code(i),
      i.name,
      i.unit,
      i.target,
      periodValues[i.code] ?? "—",
      i.total ?? t("report.notDue"),
      pct(i.total, i.target),
      i.unit === "farmers" && i.total !== null ? `${i.byGender.Female} / ${i.byGender.Male}` : "—",
    ];
    const impact = tracked.filter(isImpact);
    const outputs = tracked.filter((i) => !isImpact(i));
    const withData = tracked.filter((i) => periodValues[i.code]).length;
    const when = (m: ReportInput["milestones"][number]) => (m.end ? `${date(m.date)} – ${date(m.end)}` : date(m.date));

    return {
      title: t("report.title"),
      subtitle: project.name,
      meta: [
        [t("report.meta.project"), `${project.name} (${project.code})`],
        [t("report.meta.donor"), donor?.name ?? "—"],
        [t("report.meta.period"), `${date(period.from)} – ${date(period.to)}`],
        [t("report.meta.due"), period.deadline ? `${date(period.deadline.date)} · ${period.deadline.title}` : "—"],
        [t("report.meta.prepared"), date(preparedOn)],
      ],
      summary: t("report.summary", { withData, count: tracked.length }),
      tables: [
        ...(impact.length ? [{ heading: t("report.impact"), columns, rows: impact.map(row) }] : []),
        ...(outputs.length ? [{ heading: t("report.outputs"), columns, rows: outputs.map(row) }] : []),
        ...(milestones.length
          ? [{ heading: t("report.milestones"), columns: [t("report.col.date"), t("report.col.milestone"), t("report.col.kind")], rows: milestones.map((m) => [when(m), m.title, t(`milestone.kind.${m.kind}`)]) }]
          : []),
      ],
      narrative: [t("report.narrative.achievements"), t("report.narrative.challenges"), t("report.narrative.next")],
    };
  },
};

export const FORMATS: ReportFormat[] = [baseline];
export const formatById = (id: string | undefined) => FORMATS.find((f) => f.id === id) ?? baseline;

/* ---------- export ---------- */

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One sheet: the details, then each table under its heading. */
export function reportCsv(doc: ReportDoc) {
  const lines: (string | number)[][] = [[doc.title, doc.subtitle], ...doc.meta, [], [doc.summary]];
  for (const tbl of doc.tables) lines.push([], [tbl.heading], tbl.columns, ...tbl.rows);
  return lines.map((l) => l.map(csvCell).join(",")).join("\n") + "\n";
}

const esc = (s: string | number) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/** A standalone page for printing to PDF or opening in Word. */
export function reportHtml(doc: ReportDoc, lang: string, dir: string) {
  const tables = doc.tables
    .map(
      (tbl) => `<h2>${esc(tbl.heading)}</h2><table><thead><tr>${tbl.columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${tbl.rows
        .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
        .join("")}</tbody></table>`,
    )
    .join("");
  return `<!doctype html><html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><title>${esc(doc.title)} · ${esc(doc.subtitle)}</title>
<style>body{font-family:system-ui,"Segoe UI",Tahoma,sans-serif;color:#13201a;max-width:900px;margin:32px auto;padding:0 24px;line-height:1.45}
h1{font-size:26px;margin:0}h2{font-size:17px;margin:28px 0 8px;border-bottom:1px solid #ccc;padding-bottom:4px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:16px 0}dt{color:#5a6a60}dd{margin:0}
table{width:100%;border-collapse:collapse;font-size:13px}th,td{border:1px solid #ddd;padding:6px 8px;text-align:start;vertical-align:top}th{background:#f3f0e8}
.write{min-height:90px;border:1px dashed #bbb;border-radius:6px}@media print{body{margin:0}}</style></head>
<body><h1>${esc(doc.title)}</h1><p>${esc(doc.subtitle)}</p><dl>${doc.meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>
<p>${esc(doc.summary)}</p>${tables}${doc.narrative.map((h) => `<h2>${esc(h)}</h2><div class="write"></div>`).join("")}</body></html>`;
}
