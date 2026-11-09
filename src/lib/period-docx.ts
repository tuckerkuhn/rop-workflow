import { AlignmentType, BorderStyle, Document, ExternalHyperlink, HeadingLevel, Packer, PageBreak, Paragraph, ShadingType, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { periodFigures, refOf, withRef } from "@/lib/evidence";
import { draftMark } from "@/lib/preflight";
import { periodLabel } from "@/lib/period-report";
import { YOUTH } from "@/lib/results";
import type { PeriodReportView } from "@/server/period-report-store";

/**
 * The annual or final report as a Word document: cover, summary table of indicators against
 * targets and baselines with links to the records behind each figure, gender and youth, the
 * narrative gathered from the quarters, lessons learned and spending.
 */

const FONT = "Calibri";
const GREEN = "1F4E3D";
const n = (v: number | null) => (v === null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));
const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };
const p = (text: string, o: { bold?: boolean; size?: number; color?: string; italics?: boolean; align?: (typeof AlignmentType)[keyof typeof AlignmentType] } = {}) =>
  new Paragraph({ alignment: o.align, spacing: { after: 120 }, children: [new TextRun({ text, bold: o.bold, size: o.size, color: o.color, italics: o.italics, font: FONT })] });
const h = (text: string, level: (typeof HeadingLevel)[keyof typeof HeadingLevel] = HeadingLevel.HEADING_1) => new Paragraph({ heading: level, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: FONT, color: GREEN })] });
const cell = (text: string, o: { bold?: boolean; fill?: string; link?: string } = {}) =>
  new TableCell({
    borders,
    shading: o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
    children: [new Paragraph({ children: [o.link ? new ExternalHyperlink({ link: o.link, children: [new TextRun({ text, style: "Hyperlink", font: FONT, size: 18 })] }) : new TextRun({ text, bold: o.bold, font: FONT, size: 18 })] })],
  });

export async function periodDocx(v: PeriodReportView, origin: string, draft = 0): Promise<Blob> {
  const annual = v.period.kind === "annual";
  const title = periodLabel(v.period).toUpperCase();
  // Each figure carries its reference in the evidence pack (lib/evidence); a figure has one when accepted results stand behind it.
  const figs = periodFigures(v.rows, v.range.from, v.range.to, annual ? String((v.period as { year: number }).year) : "Final", (c, f) => {
    const r = v.rows.find((x) => x.code === c);
    return f ? (r?.records ?? 0) : r?.cumulative ? 1 : 0;
  });
  const head = annual
    ? ["Code", "Indicator", "Baseline", `${(v.period as { year: number }).year} target`, "Q1", "Q2", "Q3", "Q4", "Achieved", "%", "Cumulative / life target"]
    : ["Code", "Indicator", "Baseline", "Target", ...(v.rows[0]?.parts.map((x) => x.label) ?? []), "Achieved", "%"];
  const table = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: head.map((t) => cell(t, { bold: true, fill: "E2EFDA" })) }),
      ...v.rows.map(
        (r) =>
          new TableRow({
            children: [
              cell(r.donorCode),
              cell(`${r.name} (${r.unit})`),
              cell(n(r.baseline)),
              cell(n(r.target)),
              ...r.parts.map((x) => cell(n(x.value))),
              cell(withRef(n(r.achieved), refOf(figs, r.code, "q"), r.achieved)),
              cell(r.pct === null ? "—" : `${r.pct}%`),
              ...(annual ? [cell(`${withRef(n(r.cumulative), refOf(figs, r.code, "y"), r.cumulative)} / ${n(r.lifeTarget)}`)] : []),
            ],
          }),
      ),
    ],
  });
  const people = v.rows.filter((r) => r.women + r.men > 0);
  const gender = people.length
    ? new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: ["Indicator", "Women", "Men", YOUTH.label, "Women-led", "Men-led"].map((t) => cell(t, { bold: true, fill: "E2EFDA" })) }),
          ...people.map((r) => new TableRow({ children: [cell(`${r.donorCode} ${r.name}`), cell(n(r.women)), cell(n(r.men)), cell(r.youth ? n(r.youth) : "not recorded"), cell(r.womenLed ? n(r.womenLed) : "—"), cell(r.menLed ? n(r.menLed) : "—")] })),
        ],
      })
    : null;
  const met = v.rows.filter((r) => r.verdict === "met").length;
  const children = [
    ...(draft ? [p(draftMark(draft), { bold: true, size: 24, color: "AA3333" })] : []),
    p(v.project.name, { size: 28, color: GREEN }),
    p(title, { bold: true, size: 44 }),
    p(`${v.range.from} – ${v.range.to}`, { bold: true, size: 28 }),
    p(v.info?.partner ?? "Roots of Peace", { bold: true, size: 28 }),
    new Paragraph({ children: [new PageBreak()] }),
    h("Summary of results"),
    p(`${met} of ${v.rows.length} indicators met their ${annual ? "targets for the year" : "life-of-project targets"}. Figures are from results checked by MEL; each figure's reference, e.g. [E-01], is its entry in the evidence pack, with the results behind it and their proof.${v.open ? ` ${v.open} results from the period are still waiting for MEL and are not counted.` : ""}`),
    table,
    ...(gender ? [h("Women, men and young people"), p(`${YOUTH.label}: ${YOUTH.source}. Shown where the results record it.`, { size: 16, italics: true }), gender] : []),
    ...v.narrative.flatMap((sec) => [h(sec.heading), ...sec.parts.flatMap((x) => [p(`${x.quarter.replace("-", " ")}${x.released ? "" : " (draft)"}`, { bold: true, size: 18, color: "555555" }), ...x.text.split(/\n{2,}/).map((t) => p(t))])]),
    h(annual ? "Lessons learned this year" : "Lessons learned"),
    ...(v.lessons.length ? v.lessons.flatMap((l) => [p(`${l.area}, ${l.date}`, { bold: true }), p(`What happened: ${l.happened}`), p(`Lesson: ${l.lesson}`), p(`What we do differently: ${l.action}${l.applied ? ` (applied ${l.applied.on}: ${l.applied.how})` : ""}`)]) : [p("No lessons recorded for the period.", { italics: true })]),
    ...(v.spend ? [h("Spending"), p(`Budget ${v.spend.currency} ${n(v.spend.budget)}; spent to ${v.range.to < new Date().toISOString().slice(0, 10) ? v.range.to : "date"} ${v.spend.currency} ${n(v.spend.cumulative)} (${v.spend.budget ? Math.round((v.spend.cumulative / v.spend.budget) * 100) : 0}%)${v.spend.withOverhead ? ", overhead included" : ""}.`)] : []),
  ];
  const doc = new Document({ styles: { default: { document: { run: { font: FONT, size: 20 } } } }, sections: [{ children }] });
  return Packer.toBlob(doc);
}
