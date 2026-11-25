import { describe, expect, it } from "vitest";
import { addsSignedNote } from "@/lib/field";
import { dataFlags, gpsCheck, type Submission } from "@/lib/project";

const sub = (over: Partial<Submission>): Submission => ({ id: "KB-1", source: "kobo", orgId: "rop", form: "readiness", farmerId: "F-0001", date: "2026-11-24", enumerator: "farida", gps: [34.55, 69.2], fields: { result: "Yes" }, photo: true, status: "pending", ...over });

describe("a GPS point goes only to people who may see participant names", () => {
  it("says what the checks found without the point", () => {
    expect(gpsCheck(null)).toBe("missing");
    expect(gpsCheck([34.55, 69.2])).toBe("ok");
    expect(gpsCheck([35.9, 69.2])).toBe("outside");
  });

  it("the same flags whether or not the viewer was sent the point, and no coordinates when they were not", () => {
    const withPoint = dataFlags(sub({ gps: [35.9, 69.2] }), []);
    expect(withPoint.some((f) => f.includes("35.900") && f.includes("outside the project area"))).toBe(true);
    const without = dataFlags(sub({ gps: null, gpsCheck: "outside" }), []);
    expect(without).toContain("The GPS point is outside the project area");
    expect(without.join(" ")).not.toMatch(/\d\d\.\d/);
    // A point that was there and fine is not reported as missing just because it was withheld.
    expect(dataFlags(sub({ gps: null, gpsCheck: "ok" }), [])).not.toContain("No GPS point recorded");
    expect(dataFlags(sub({ gps: null, gpsCheck: "missing" }), [])).toContain("No GPS point recorded");
  });
});

describe("the signed note is proof: a save is checked for adding one", () => {
  const stored = { photos: [{ id: "a" }, { id: "note-old" }] };
  it("sees a new photo marked or tagged as the signed note", () => {
    expect(addsSignedNote(stored, { photos: [{ id: "a" }, { id: "note-old", signedNote: true }, { id: "b", signedNote: true }] })).toBe(true);
    expect(addsSignedNote(stored, { photos: [{ id: "a" }, { id: "c", tag: "signed-note" }] })).toBe(true);
  });
  it("leaves alone a signed note already on the record, and any other new photo", () => {
    expect(addsSignedNote(stored, { photos: [{ id: "a" }, { id: "note-old", signedNote: true }] })).toBe(false);
    expect(addsSignedNote(stored, { photos: [{ id: "a" }, { id: "d", tag: "visit" }] })).toBe(false);
    expect(addsSignedNote(null, { photos: [] })).toBe(false);
  });
});
