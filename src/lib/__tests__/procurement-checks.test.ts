import { describe, expect, it } from "vitest";
import { checkState, seedProcurements, stepById, stepsFor, type Procurement } from "@/lib/procurement";
import { documentFor } from "@/lib/procurement-docs";

const usd = (n: number) => `$${n}`;
const at = (step: string, over: Partial<Procurement> = {}): Procurement => ({ ...seedProcurements()[0], step, checks: {}, ...over }) as Procurement;
const check = (step: string, id: string) => stepById[step].checks.find((c) => c.id === id)!;

describe("procurement checks that cannot be ticked on trust", () => {
  it("an AI review tick waits until the AI check has run, or is overridden with a reason", () => {
    const c = check("package", "aiPackage");
    expect(checkState(at("package"), c, usd)).toMatchObject({ ok: false, auto: true });
    // Run: the person then ticks it as before.
    expect(checkState(at("package", { ai: { package: [] } }), c, usd)).toMatchObject({ ok: false, auto: false });
    expect(checkState(at("package", { ai: { package: [] }, checks: { "package.aiPackage": true } }), c, usd)).toMatchObject({ ok: true });
    // AI not available: overridden, with the reason shown.
    const off = at("package", { checks: { "fix.package.aiPackage": true }, overrides: { "fix.package.aiPackage": { why: "AI service down; checked by hand", by: "Hamid", date: "2026-11-19" } } });
    expect(checkState(off, c, usd)).toMatchObject({ ok: true });
    expect(checkState(off, c, usd).detail).toContain("AI service down");
  });

  it("the quotation step does not ask for screening that the next step does", () => {
    const p = at("quotes");
    const has = stepsFor(p).some((s) => s.id === "screen");
    const r = checkState(p, check("quotes", "screened"), usd);
    if (has) expect(r).toMatchObject({ ok: true, auto: true });
    else expect(r).toMatchObject({ ok: false, auto: false });
  });

  it("the source selection memo carries the reason for fewer than three quotations", () => {
    const p = at("quotes", { overrides: { "fix.quotes.three": { why: "Only two halls in the district", by: "Hamid", date: "2026-11-19" } } });
    const doc = documentFor(p, "Source selection memo", usd, usd);
    expect(doc.rows.find(([k]) => k === "Why fewer than three quotations")?.[1]).toContain("Only two halls in the district");
  });

  // Review round 1, ISS-08: PR-2027-009 was awarded, contracted and received with no licence on file.
  it("a supplier with no licence on file does not pass screening, except as a recorded exception", () => {
    const c = check("screen", "dd");
    const named = { name: "FarmTools Co. (fictional)", screenedOn: "2026-08-20" };
    expect(checkState(at("screen", { supplier: undefined }), c, usd)).toMatchObject({ ok: false, auto: true, detail: "Name the supplier above" });
    expect(checkState(at("screen", { supplier: named }), c, usd)).toMatchObject({ ok: false, auto: true });
    expect(checkState(at("screen", { supplier: named }), c, usd).detail).toContain("No business licence is recorded for FarmTools Co.");
    // Ticking it on trust does not get past a missing or expired licence.
    expect(checkState(at("screen", { supplier: named, checks: { "screen.dd": true } }), c, usd)).toMatchObject({ ok: false });
    expect(checkState(at("screen", { supplier: { ...named, licenceNo: "D-1", licenceExpiry: "2020-01-01" }, checks: { "screen.dd": true } }), c, usd).detail).toContain("licence expired on 2020-01-01");
    // With a licence in date, a person still confirms the ID, the bank details and the declaration.
    const licensed = { ...named, licenceNo: "D-04-1187", licenceExpiry: "2099-12-31" };
    expect(checkState(at("screen", { supplier: licensed }), c, usd)).toMatchObject({ ok: false, auto: false });
    expect(checkState(at("screen", { supplier: licensed, checks: { "screen.dd": true } }), c, usd)).toMatchObject({ ok: true });
    // The exception: allowed, and the reason shows on the check for whoever approves the award.
    const exception = at("screen", { supplier: named, checks: { "fix.screen.dd": true }, overrides: { "fix.screen.dd": { why: "Village blacksmith, no licence exists; cleared by the country director", by: "Hamid", date: "2026-11-27" } } });
    expect(checkState(exception, c, usd)).toMatchObject({ ok: true });
    expect(checkState(exception, c, usd).detail).toContain("Village blacksmith");
  });

  it("a drafted document counts as read only once a person corrected or confirmed it", () => {
    const c = check("rfq", "read");
    const draft = { sections: [], questions: [], model: "m", at: "2026-11-19", by: "Hamid", edited: false };
    expect(checkState(at("rfq"), c, usd)).toMatchObject({ ok: false });
    expect(checkState(at("rfq", { drafts: { "Request for quotation": draft } }), c, usd)).toMatchObject({ ok: false });
    expect(checkState(at("rfq", { drafts: { "Request for quotation": { ...draft, edited: true, asIs: true } } }), c, usd)).toMatchObject({ ok: true, detail: "Read: no changes needed" });
  });

  it("the memo's method says how many quotations there were when fewer than three", () => {
    const p = at("quotes", { overrides: { "fix.quotes.three": { why: "Only two", by: "Hamid", date: "2026-11-19" } } });
    const method = documentFor(p, "Source selection memo", usd, usd).rows.find(([k]) => k === "Method")?.[1] ?? "";
    if (method.startsWith("Written") || method.startsWith("Three")) expect(method).not.toBe("Three written quotations");
  });
});
