import { AlignmentType, BorderStyle, Document, HeadingLevel, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import type { TrackRecord } from "@/server/track-record";

/** ROP's track record as a Word document, for proposals: one section per project. */

const FONT = "Calibri";
const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const border = { style: BorderStyle.SINGLE, size: 4, color: "999999" };
const borders = { top: border, bottom: border, left: border, right: border };
const p = (text: string, o: { bold?: boolean; size?: number; italics?: boolean; color?: string; after?: number } = {}) => new Paragraph({ spacing: { after: o.after ?? 120 }, children: [new TextRun({ text, font: FONT, bold: o.bold, size: o.size, italics: o.italics, color: o.color })] });
const cell = (t: string, o: { bold?: boolean; shade?: boolean; w?: number; right?: boolean } = {}) =>
  new TableCell({
    borders,
    width: o.w ? { size: o.w, type: WidthType.PERCENTAGE } : undefined,
    shading: o.shade ? { fill: "DFE9E3", color: "auto", type: "clear" as never } : undefined,
    margins: { top: 50, bottom: 50, left: 80, right: 80 },
    children: [new Paragraph({ alignment: o.right ? AlignmentType.RIGHT : undefined, children: [new TextRun({ text: t, font: FONT, size: 18, bold: o.bold })] })],
  });

export type TrackImages = Map<string, { data: ArrayBuffer; width: number; height: number }>;

export async function trackRecordDocx(t: TrackRecord, images: TrackImages): Promise<Blob> {
  const kids: (Paragraph | Table)[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: "Roots of Peace: track record", font: FONT })] }),
    p(`Results accepted by our MEL team and backed by evidence, as of ${t.asOf}. Figures are totals to date against each project's life-of-project targets.`, { italics: true, color: "555555", after: 240 }),
  ];
  for (const pr of t.projects) {
    kids.push(new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 240, after: 120 }, children: [new TextRun({ text: pr.name, font: FONT })] }));
    const when = pr.duration ?? [pr.start, pr.end].filter(Boolean).join(" to ");
    kids.push(p([pr.donor, pr.country === "AF" ? "Afghanistan" : pr.country, when, pr.budget ? `budget ${pr.budget.currency} ${n(pr.budget.amount)}${pr.budget.spentPct !== null ? ` (${Math.round(pr.budget.spentPct)}% spent)` : ""}` : ""].filter(Boolean).join(" · ")));
    if (pr.achieved.length) {
      kids.push(
        new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({ tableHeader: true, children: [cell("Result", { bold: true, shade: true, w: 58 }), cell("Achieved", { bold: true, shade: true, w: 14, right: true }), cell("Target", { bold: true, shade: true, w: 14, right: true }), cell("Records with proof", { bold: true, shade: true, w: 14, right: true })] }),
            ...pr.achieved.map((a) => new TableRow({ children: [cell(`${a.code} ${a.name} (${a.unit})`), cell(n(a.total), { right: true }), cell(a.target ? n(a.target) : "", { right: true }), cell(`${a.proof} of ${a.records}`, { right: true })] })),
          ],
        }),
      );
      if (pr.women) kids.push(p(`Women reached across these results: ${n(pr.women)}.`, { after: 160 }));
    } else kids.push(p("No accepted results yet.", { italics: true, color: "777777" }));
    for (const st of pr.stories) {
      kids.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun({ text: st.title, font: FONT })] }));
      if (st.photo) {
        const img = images.get(st.photo.hash);
        if (img) {
          const width = Math.min(420, img.width);
          kids.push(new Paragraph({ children: [new ImageRun({ type: "jpg", data: img.data, transformation: { width, height: Math.round((img.height / img.width) * width) } })] }));
          kids.push(p(st.photo.caption, { italics: true, size: 18, color: "555555" }));
        }
      }
      for (const para of st.text.split(/\n{2,}/)) kids.push(p(para.trim()));
    }
  }
  return Packer.toBlob(new Document({ styles: { default: { document: { run: { font: FONT, size: 22 } } } }, sections: [{ children: kids }] }));
}
