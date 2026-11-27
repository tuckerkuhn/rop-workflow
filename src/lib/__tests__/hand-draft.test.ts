import { describe, expect, it } from "vitest";
import { handDraft, type HandKind } from "@/lib/hand-draft";
import { HAND_WRITTEN, checkState, openBlanks, seedProcurements, stepById, type Draft, type Procurement } from "@/lib/procurement";
import { documentFor } from "@/lib/procurement-docs";

/**
 * Review round 1, ISS-01: a purchase never waits on AI. Procurement can write the request for
 * quotation, solicitation, sole source justification and package cover memo by hand, from the
 * same document with the record filled in, and the step's checks treat it like any draft.
 */

const usd = (n: number) => `$${n}`;
const at = (step: string, over: Partial<Procurement> = {}): Procurement => ({ ...seedProcurements()[0], step, checks: {}, ...over }) as Procurement;
const check = (step: string, id: string) => stepById[step].checks.find((c) => c.id === id)!;
/** Every blank replaced, as a person would, through the screen's own edit (which marks it edited). */
const filled = (d: Draft): Draft => ({ ...d, edited: true, asIs: false, sections: d.sections.map((s) => ({ ...s, body: s.body.replace(/\[[^\[\]\n]{2,160}\]/g, "done") })) });

describe("a procurement document written by hand", () => {
  it("opens with the record's facts filled in and the rest as blanks", () => {
    const p = at("rfq", { title: "Urea fertilizer packs", qty: 40, unit: "bag", specification: "Urea 46% nitrogen, sealed 50 kg bags.", place: "Village B distribution point", neededBy: "2027-01-15" });
    const d = handDraft(p, "rfq", "Hamid Wardak", "2026-11-27");
    expect(d).toMatchObject({ model: HAND_WRITTEN, by: "Hamid Wardak", at: "2026-11-27", edited: false, questions: [] });
    const text = d.sections.map((s) => s.body).join("\n");
    for (const fact of ["Urea fertilizer packs", "40 bag", "Urea 46% nitrogen", "Village B distribution point", "2027-01-15", p.id]) expect(text).toContain(fact);
    // What only a person knows is asked for, not invented.
    expect(openBlanks(d)).toEqual(expect.arrayContaining(["[date and time]", "[email or address]", "[currency]", "[organization name]"]));
    expect(text).toContain("lowest-priced quotation that meets every requirement");
  });

  it("has the sections the AI is asked for, for every kind of document", () => {
    const p = at("rfq", { sole: { supplier: "Green Valley Agro Ltd", reason: "Only licensed importer of this seed variety in the province." } });
    const count: Record<HandKind, number> = { rfq: 7, solicitation: 8, sole: 8, package: 8 };
    for (const kind of Object.keys(count) as HandKind[]) {
      const d = handDraft(p, kind, "Hamid", "2026-11-27");
      expect(d.sections).toHaveLength(count[kind]);
      for (const s of d.sections) expect(s.heading.trim() && s.body.trim()).toBeTruthy();
    }
    expect(handDraft(p, "sole", "Hamid", "2026-11-27").sections[1].body).toBe("Green Valley Agro Ltd");
  });

  it("counts as drafted at once, and as read only when every blank is filled", () => {
    const d = handDraft(at("rfq"), "rfq", "Hamid", "2026-11-27");
    const drafted = check("rfq", "draft");
    const read = check("rfq", "read");
    const p = at("rfq", { drafts: { "Request for quotation": d } });
    expect(checkState(p, drafted, usd)).toMatchObject({ ok: true, detail: "Written by hand 2026-11-27" });
    expect(checkState(p, read, usd)).toMatchObject({ ok: false });
    expect(checkState(p, read, usd).detail).toContain("[square brackets]");
    // One edit is not enough while a blank is left: ticking it on trust is still refused.
    const half = { ...d, edited: true, asIs: false };
    expect(checkState(at("rfq", { drafts: { "Request for quotation": half } }), read, usd)).toMatchObject({ ok: false });
    expect(checkState(at("rfq", { drafts: { "Request for quotation": filled(d) } }), read, usd)).toMatchObject({ ok: true, detail: "Written by hand" });
  });

  it("the package cover memo follows the same rule", () => {
    const memo = check("package", "memo");
    const d = handDraft(at("package"), "package", "Hamid", "2026-11-27");
    expect(checkState(at("package"), memo, usd)).toMatchObject({ ok: false, detail: "Draft it above" });
    if (openBlanks(d).length) expect(checkState(at("package", { drafts: { "Procurement package": d } }), memo, usd)).toMatchObject({ ok: false });
    expect(checkState(at("package", { drafts: { "Procurement package": filled(d) } }), memo, usd)).toMatchObject({ ok: true });
  });

  it("an AI draft is judged as before: blanks in it do not block a person's confirmation", () => {
    const ai: Draft = { sections: [{ heading: "Submission", body: "Deadline: [submission deadline]." }], questions: [], model: "m", at: "2026-11-19", by: "Hamid", edited: true, asIs: true };
    expect(checkState(at("rfq", { drafts: { "Request for quotation": ai } }), check("rfq", "read"), usd)).toMatchObject({ ok: true, detail: "Read: no changes needed" });
  });

  it("the generated document says it was written without AI", () => {
    const p = at("rfq", { drafts: { "Request for quotation": filled(handDraft(at("rfq"), "rfq", "Hamid Wardak", "2026-11-27")) } });
    const doc = documentFor(p, "Request for quotation", usd, usd);
    expect(doc.notes?.[0]).toBe("Written by Hamid Wardak on 2026-11-27, without AI. Procurement is responsible for every statement in it.");
    expect(doc.rows.some(([k]) => k === "How and when to submit")).toBe(true);
  });
});
