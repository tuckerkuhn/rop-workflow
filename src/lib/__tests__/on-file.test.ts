import { describe, expect, it } from "vitest";
import { donorPackProof, onFileKinds } from "@/lib/evidence";

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

/** The donor evidence pack: photos that may go under a plain name, the rest counted with the reason it is held. */
describe("donorPackProof", () => {
  const file = (hash: string, name: string, type: string, caption = "") => ({ hash, name, type, caption });
  const files = [
    file("p1", "Ahmad Karimi at his plot.jpg", "image/jpeg", "A prepared plot"),
    file("d1", "Attendance Ahmad Karimi.pdf", "application/pdf"),
    file("p2", "Gul Bibi signing.png", "image/png", "Gul Bibi signs for her inputs"),
    file("p3", "Field day.png", "image/png", "The field day"),
    file("d2", "Signature list.pdf", "application/pdf"),
  ];
  const rule = (hash: string) => (hash === "p2" ? { ok: false, why: "People can be recognised and no consent is recorded for sharing." } : { ok: true, why: "" });

  it("names a photo that goes in by its place in the list, and keeps its caption", () => {
    expect(donorPackProof(files, 0, rule).files).toEqual([
      { hash: "p1", type: "image/jpeg", caption: "A prepared plot", name: "Photo 1.jpg" },
      { hash: "p3", type: "image/png", caption: "The field day", name: "Photo 2.png" },
    ]);
  });

  it("counts what is held by kind, with the reason", () => {
    expect(donorPackProof(files, 2, rule).held).toEqual([
      { what: "2 PDF documents", why: "Held by Roots of Peace, available for verification: attendance sheets and forms can name people." },
      { what: "1 photo", why: "Held by Roots of Peace: People can be recognised and no consent is recorded for sharing." },
      { what: "2 linked documents", why: "Held by Roots of Peace, available for verification." },
    ]);
  });

  it("gives no name, and no caption of a photo that is held", () => {
    const told = JSON.stringify(donorPackProof(files, 1, rule));
    expect(told).not.toMatch(/Ahmad|Karimi|Gul|Bibi|Attendance|Signature|Field day\.png/);
  });

  it("says nothing is held when nothing is", () => {
    expect(donorPackProof([], 0, rule)).toEqual({ files: [], held: [] });
  });
});
