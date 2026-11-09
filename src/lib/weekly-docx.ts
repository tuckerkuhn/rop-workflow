import { AlignmentType, BorderStyle, Document, ImageRun, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from "docx";
import { longDate, periodLabel } from "@/lib/weekly";

/**
 * The weekly update as the field team sends it today: the project and period, "Roots of Peace:"
 * and the region, one bullet per item (its title in bold), then "Selected Photos:" two to a row,
 * each with "Figure N: caption, date".
 */

export type WeeklyDocInput = {
  project: { name: string; donor: string | null };
  region: string;
  week: { n: number; from: string; to: string };
  items: { title?: string; note: string; photos: { hash: string; caption: string; taken?: string }[] }[];
};
export type WeeklyImages = Map<string, { data: ArrayBuffer; width: number; height: number }>;

const FONT = "Calibri";
const none = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };
const run = (text: string, o: { bold?: boolean; size?: number; italics?: boolean; color?: string } = {}) => new TextRun({ text, font: FONT, size: o.size ?? 22, bold: o.bold, italics: o.italics, color: o.color });

/** A caption ends with the date the photo was taken, unless it already gives a year. */
export const captionWithDate = (caption: string, taken?: string) => {
  const c = caption.trim().replace(/[.\s]+$/, "");
  return taken && !/\b20\d\d\b/.test(c) ? `${c}, ${longDate(taken)}` : c;
};

export async function weeklyDocx(d: WeeklyDocInput, images: WeeklyImages): Promise<Blob> {
  const photos = d.items.flatMap((i) => i.photos.filter((p) => p.caption.trim()));
  let figure = 0;
  const photoCell = (p: (typeof photos)[number] | undefined) => {
    const children: Paragraph[] = [];
    if (p) {
      const img = images.get(p.hash);
      figure++;
      if (img) {
        const width = 280;
        const height = Math.round((img.height / img.width) * width);
        children.push(new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "jpg", data: img.data, transformation: { width, height } })] }));
      } else children.push(new Paragraph({ children: [run("[Photo not available]", { color: "AA3333" })] }));
      children.push(new Paragraph({ spacing: { after: 160 }, children: [run(`Figure ${figure}: ${captionWithDate(p.caption, p.taken)}`, { italics: true, size: 18 })] }));
    } else children.push(new Paragraph({ children: [] }));
    return new TableCell({ borders: { top: none, bottom: none, left: none, right: none }, width: { size: 50, type: WidthType.PERCENTAGE }, children });
  };
  const rows: TableRow[] = [];
  for (let i = 0; i < photos.length; i += 2) rows.push(new TableRow({ children: [photoCell(photos[i]), photoCell(photos[i + 1])] }));

  const doc = new Document({
    styles: { default: { document: { run: { font: FONT, size: 22 } } } },
    sections: [
      {
        children: [
          ...(d.project.donor ? [new Paragraph({ alignment: AlignmentType.CENTER, children: [run(d.project.donor, { bold: true, size: 24 })] })] : []),
          new Paragraph({ alignment: AlignmentType.CENTER, children: [run(`${d.project.name}: Weekly Update #${d.week.n}`, { bold: true, size: 26 })] }),
          new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 240 }, children: [run(`Reporting period: ${periodLabel(d.week.from, d.week.to)}`, { size: 22 })] }),
          new Paragraph({ children: [run("Roots of Peace:", { bold: true })] }),
          ...(d.region.trim() ? [new Paragraph({ spacing: { after: 160 }, children: [run(d.region.trim(), { bold: true })] })] : []),
          ...d.items.map((i) => new Paragraph({ bullet: { level: 0 }, spacing: { after: 120 }, alignment: AlignmentType.JUSTIFIED, children: [...(i.title?.trim() ? [run(`${i.title.trim()}: `, { bold: true })] : []), run(i.note.trim())] })),
          ...(photos.length ? [new Paragraph({ spacing: { before: 240, after: 120 }, children: [run("Selected Photos:", { bold: true })] }), new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, rows })] : []),
        ],
      },
    ],
  });
  return Packer.toBlob(doc);
}
