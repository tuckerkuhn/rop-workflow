import {
  AlignmentType,
  BorderStyle,
  Document,
  ExternalHyperlink,
  HeadingLevel,
  ImageRun,
  Packer,
  PageBreak,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableOfContents,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import { SECTIONS, STATUS_LABEL, overspentLines, quarterSpendOf, type Breakdown, type Photo, type Qpr, type Row, type Spend } from "@/lib/qpr";
import { quarterRange } from "@/lib/results";

/**
 * The quarterly report as a Word document (.docx), in the order ROP sends it to UNDP: cover,
 * project information, acronyms, contents, then the report. Figures in the indicator table link
 * to the records behind them in the app; captioned photos appear as numbered figures under their
 * activity. Word fills in the table of contents when the file is opened.
 */

export type DocxInput = {
  project: { code: string; name: string; start: string | null; end: string | null };
  quarter: string;
  saved: Qpr;
  rows: Row[];
  spend: Spend;
  activities: { code: string; name: string }[];
  photos: Photo[];
  breakdowns: Breakdown[];
  /** e.g. https://rop-workflow.vercel.app, for the links to evidence. */
  origin: string;
};
/** Photos as JPEG, keyed by fingerprint, with their size in pixels. */
export type Images = Map<string, { data: ArrayBuffer; width: number; height: number }>;

const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const long = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;
const FONT = "Calibri";
const GREEN = "1F4E3D";
const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };

const p = (text: string, opts: { bold?: boolean; size?: number; color?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; italics?: boolean } = {}) =>
  new Paragraph({ alignment: opts.align, spacing: { after: 120 }, children: [new TextRun({ text, bold: opts.bold, size: opts.size, color: opts.color, italics: opts.italics, font: FONT })] });

/** Text written in the app: blank lines separate paragraphs. */
const paras = (text: string | undefined) =>
  text?.trim()
    ? text
        .trim()
        .split(/\n{2,}/)
        .map((block) => new Paragraph({ spacing: { after: 120 }, children: block.split("\n").map((line, i) => new TextRun({ text: line, font: FONT, break: i ? 1 : 0 })) }))
    : [p("[To be written]", { color: "AA3333" })];

const h = (text: string, level: 1 | 2) => new Paragraph({ heading: level === 1 ? HeadingLevel.HEADING_1 : HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, children: [new TextRun({ text, font: FONT })] });

const cell = (content: string | Paragraph[], opts: { bold?: boolean; shade?: string; span?: number; rowSpan?: number; width?: number } = {}) =>
  new TableCell({
    borders,
    columnSpan: opts.span,
    rowSpan: opts.rowSpan,
    width: opts.width ? { size: opts.width, type: WidthType.PERCENTAGE } : undefined,
    shading: opts.shade ? { type: ShadingType.CLEAR, color: "auto", fill: opts.shade } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: typeof content === "string" ? [new Paragraph({ children: [new TextRun({ text: content, bold: opts.bold, font: FONT, size: 18 })] })] : content,
  });

const table = (columns: string[], rows: (string | number)[][], widths?: number[]) =>
  new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({ tableHeader: true, children: columns.map((c, i) => cell(c, { bold: true, shade: "DFE9E3", width: widths?.[i] })) }),
      ...rows.map((r, k) => new TableRow({ children: r.map((c) => cell(typeof c === "number" ? n(c) : c, { bold: k === rows.length - 1 && r[0] === "Total" })) })),
    ],
  });

const link = (text: string, url: string) =>
  new Paragraph({ alignment: AlignmentType.RIGHT, children: [new ExternalHyperlink({ link: url, children: [new TextRun({ text, style: "Hyperlink", font: FONT, size: 18 })] })] });

export async function qprDocx(d: DocxInput, images: Images): Promise<Blob> {
  const { from, to } = quarterRange(d.quarter);
  const qn = d.quarter.slice(5);
  const year = d.quarter.slice(0, 4);
  const sec = (key: string) => d.saved.sections[key]?.text;
  const heading = (key: string) => SECTIONS.find((s) => s.key === key)!.heading;
  const i = d.saved.info;
  const money = (v: number | null) => (v === null ? "[to be entered]" : `${d.spend.currency} ${n(v)}`);
  const evidence = (code: string, f: string, text: string) => link(text, `${d.origin}/progress/results?indicator=${code}&from=${f}&to=${to}`);
  let figure = 0;
  const photo = (ph: Photo) => {
    const img = images.get(ph.hash);
    if (!img) return [p(`[Photo not available: ${ph.caption}]`, { color: "AA3333" })];
    const width = Math.min(560, img.width);
    const height = Math.round((img.height / img.width) * width);
    figure++;
    return [
      new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "jpg", data: img.data, transformation: { width, height } })] }),
      p(`Figure ${figure}: ${ph.caption}`, { italics: true, size: 18, align: AlignmentType.CENTER }),
    ];
  };

  // Cover: the first captioned photo, as ROP's reports have one.
  const cover = d.photos[0];
  const coverChildren = [
    p(d.project.name, { size: 28, color: GREEN }),
    p("QUARTERLY PROGRESS REPORT", { bold: true, size: 44 }),
    p(`(${qn}: ${long(from)} – ${long(to)})`, { bold: true, size: 28 }),
    ...(cover ? photo(cover) : []),
    p(i.partner, { bold: true, size: 28 }),
    new Paragraph({ children: [new PageBreak()] }),
  ];

  const duration = i.duration?.trim() || (d.project.start && d.project.end ? `${long(d.project.start)} – ${long(d.project.end)}` : "[to be entered]");
  const spendNote = d.spend.source.kind === "import" ? `Finance's budget against actual (${d.spend.source.files.map((f) => f.period).join("; ")})${d.spend.withOverhead ? ", overhead included" : ", overhead not included"}` : "the budget file";
  const info = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      ["Full project title", i.title || d.project.name],
      ["Agreement number", i.agreement || "[to be entered]"],
      ["Project duration", duration],
      [`Total budget (${d.spend.currency})`, money(d.spend.budget)],
      ["Expenditure this quarter", money(quarterSpendOf(d.saved, d.spend))],
      ["Cumulative expenditure", `${money(d.spend.cumulative)} to ${long(to)}`],
      ["Project locations (districts)", i.locations || "[to be entered]"],
      ["Responsible party", i.partner],
      ["Country director", i.director || "[to be entered]"],
    ].map(([k, v]) => new TableRow({ children: [cell(k, { bold: true, shade: "DFE9E3", width: 35 }), cell(v, { width: 65 })] })),
  });

  const acronyms = d.saved.acronyms?.length ? [h("Acronyms", 1), table(["Acronym", "Meaning"], d.saved.acronyms.map(([a, b]) => [a, b]), [20, 80])] : [];

  // Indicator table: output group rows, the activity cell spanning its indicators.
  const outputs = [...new Set(d.rows.map((r) => r.output))];
  const indicatorRows: TableRow[] = [];
  for (const o of outputs) {
    indicatorRows.push(new TableRow({ children: [cell(o || "Outputs", { bold: true, shade: "F1EFE8", span: 6 })] }));
    for (const a of [...new Set(d.rows.filter((r) => r.output === o).map((r) => r.activity))]) {
      const name = d.activities.find((x) => x.code === a)?.name ?? "";
      const list = d.rows.filter((r) => r.output === o && r.activity === a);
      list.forEach((r, k) =>
        indicatorRows.push(
          new TableRow({
            children: [
              ...(k === 0 ? [cell(`Activity ${a}: ${name}`, { rowSpan: list.length, width: 16 })] : []),
              cell(`${r.donorCode} ${r.name} (${r.unit})`, { width: 28 }),
              cell(n(r.yearTarget), { width: 8 }),
              cell([evidence(r.code, from, n(r.quarter))], { width: 8 }),
              cell([evidence(r.code, `${year}-01-01`, n(r.year))], { width: 10 }),
              cell(r.comment, { width: 30 }),
            ],
          }),
        ),
      );
    }
  }
  const indicatorTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [
      new TableRow({
        tableHeader: true,
        children: ["Project Output & Activity", "Output Indicator", `${year} Target`, `${qn} Achieved`, "Annual achievement", `Comments [${Object.values(STATUS_LABEL).join(", ")}]`].map((c) => cell(c, { bold: true, shade: "DFE9E3" })),
      }),
      ...indicatorRows,
    ],
  });

  const narrative = d.activities.flatMap((a) => {
    const codes = d.rows.filter((r) => r.activity === a.code).map((r) => r.code);
    return [
      h(`Activity ${a.code}: ${a.name}`, 2),
      ...paras(sec(`act.${a.code}`)),
      ...d.breakdowns.filter((b) => codes.includes(b.indicator)).flatMap((b) => [p(b.title, { bold: true, size: 18 }), table(b.columns, b.rows), p("")]),
      ...d.photos.filter((ph) => ph.activity === a.code && ph !== cover).flatMap(photo),
    ];
  });

  const grm = d.saved.grm;
  const grmLine = grm.received === null ? [] : [p(`Complaints received this quarter: ${grm.received}. Resolved: ${grm.resolved ?? "[to be entered]"}. Open: ${grm.resolved === null ? "[to be entered]" : grm.received - grm.resolved}.`)];
  const risks = d.saved.risks.length ? [table(["Risks", "Mitigation Measures"], d.saved.risks.map((r) => [r.risk, r.mitigation]), [45, 55])] : [p("[Risk table to be completed]", { color: "AA3333" })];

  const doc = new Document({
    creator: "ROP Workflow",
    title: `${d.project.name} Quarterly Progress Report ${d.quarter}`,
    features: { updateFields: true },
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        children: [
          ...coverChildren,
          h("Project Information", 1),
          info,
          p(`Spending from ${spendNote}.`, { size: 16, color: "555555" }),
          ...overspentLines(d.spend, d.saved)
            .filter((l) => l.explanation)
            .flatMap((l, k) => [...(k === 0 ? [p("Budget lines above budget", { bold: true })] : []), p(`${l.code}: ${money(l.actual)} spent of ${money(l.budget)} (${l.pct}%). ${l.explanation}`)]),
          ...acronyms,
          new Paragraph({ children: [new PageBreak()] }),
          new TableOfContents("Table of Contents", { hyperlink: true, headingStyleRange: "1-2" }),
          new Paragraph({ children: [new PageBreak()] }),
          h(heading("summary"), 1),
          ...paras(sec("summary")),
          h(heading("background"), 1),
          ...paras(sec("background")),
          h("II. Progress Towards Results", 1),
          indicatorTable,
          p("Figures are from results checked by MEL. Each figure links to the records and proof behind it.", { size: 16, color: "555555" }),
          h("Narrative Description", 1),
          ...narrative,
          h("III. Cross-cutting Issues", 1),
          h(heading("gender"), 2),
          ...paras(sec("gender")),
          h(heading("principled"), 2),
          ...paras(sec("principled")),
          h(heading("partnerships"), 2),
          ...paras(sec("partnerships")),
          h(heading("safeguards"), 2),
          ...paras(sec("safeguards")),
          h(heading("grm"), 2),
          ...grmLine,
          ...paras(sec("grm")),
          ...(sec("story")?.trim() ? [h(heading("story"), 2), ...paras(sec("story"))] : []),
          h(heading("challenges"), 1),
          ...paras(sec("challenges")),
          h("V. Risk Management", 1),
          ...risks,
          h(heading("lessons"), 1),
          ...paras(sec("lessons")),
          h(heading("next"), 1),
          ...paras(sec("next")),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}
