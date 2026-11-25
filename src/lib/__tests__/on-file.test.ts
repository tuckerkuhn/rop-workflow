import { describe, expect, it } from "vitest";
import { onFileKinds } from "@/lib/evidence";

/** What a donor is told about the documents kept behind a record: how many, of what kind, never a name. */
describe("onFileKinds", () => {
  const pdf = { type: "application/pdf", name: "Attendance Ahmad Karimi.pdf" };
  const photo = { type: "image/jpeg", name: "Gul Bibi signing.jpg" };
  const sheet = { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", name: "List of farmers.xlsx" };
  const word = { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", name: "Visit report.docx" };

  it("says nothing when nothing is kept", () => {
    expect(onFileKinds([])).toEqual([]);
  });

  it("counts each kind, with one and many worded apart", () => {
    expect(onFileKinds([pdf])).toEqual(["1 PDF document"]);
    expect(onFileKinds([pdf, pdf, photo, sheet, word], 1)).toEqual(["2 PDF documents", "1 photo", "1 spreadsheet", "1 other document", "1 linked document"]);
    expect(onFileKinds([photo, photo], 2)).toEqual(["2 photos", "2 linked documents"]);
  });

  it("never gives a file's name", () => {
    const told = onFileKinds([pdf, photo, sheet, word], 3).join("; ");
    for (const f of [pdf, photo, sheet, word]) expect(told).not.toContain(f.name);
    expect(told).not.toMatch(/Ahmad|Karimi|Gul|Bibi/);
  });
});
