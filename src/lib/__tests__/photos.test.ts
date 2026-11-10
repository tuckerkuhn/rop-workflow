import { describe, expect, it } from "vitest";
import { needs, rank, shareLimit, type Coaching, type PhotoMeta } from "@/lib/photos";

const coach = (over: Partial<Coaching> = {}): Coaching => ({ isPhoto: true, label: "report", tips: [], shows: "A synthetic orchard", people: "none", womenIdentifiable: false, model: "test", at: "2026-11-01T00:00:00Z", ...over });
const consent = (uses: ("report" | "comms" | "social")[]): PhotoMeta["consent"] => ({ how: "written", uses, date: "2026-10-01", takenBy: "Test Officer", by: "u1", at: "2026-10-01T00:00:00Z" });

describe("photo consent: how far a photo may go", () => {
  it("a photo nobody has looked at stays inside", () => {
    expect(shareLimit(undefined, null).max).toBe("internal");
    expect(shareLimit({}, null).max).toBe("internal");
  });
  it("a document (attendance sheet, receipt) never leaves", () => {
    expect(shareLimit({ coach: coach({ isPhoto: false }) }, ["social"]).max).toBe("internal");
  });
  it("no people, or people who cannot be recognised: may go public", () => {
    expect(shareLimit({ coach: coach({ people: "none" }) }, null).max).toBe("public");
    expect(shareLimit({ coach: coach({ people: "not-identifiable" }) }, null).max).toBe("public");
  });
  it("recognisable people and no consent: inside only", () => {
    const l = shareLimit({ coach: coach({ people: "identifiable" }) }, null);
    expect(l.max).toBe("internal");
    expect(l.why).toMatch(/no consent is recorded/);
  });
  it("consent for communications does not cover social media", () => {
    const l = shareLimit({ coach: coach({ people: "identifiable", womenIdentifiable: true }), consent: consent(["comms"]) }, null);
    expect(l.max).toBe("comms");
    expect(l.why).toMatch(/a woman can be recognised/);
  });
  it("consent for social media allows public", () => {
    expect(shareLimit({ coach: coach({ people: "identifiable" }), consent: consent(["social"]) }, null).max).toBe("public");
  });
  it("an approved story's consent covers its photos", () => {
    expect(shareLimit({ coach: coach({ people: "identifiable" }) }, ["comms"]).max).toBe("comms");
  });
  it("pinned as it is today: consent for donor reports alone keeps a recognisable photo inside (question for Tucker)", () => {
    expect(shareLimit({ coach: coach({ people: "identifiable" }), consent: consent(["report"]) }, null).max).toBe("internal");
  });
  it("public social media needs public clearance; donors and newsletters need communications clearance", () => {
    expect(needs("instagram")).toBe("public");
    expect(needs("linkedin")).toBe("public");
    expect(needs("donor")).toBe("comms");
    expect(needs("newsletter")).toBe("comms");
    expect(rank("internal")).toBeLessThan(rank("comms"));
    expect(rank("comms")).toBeLessThan(rank("public"));
  });
});
