import { describe, expect, it } from "vitest";
import { checkState, screenedOnOf, seedProcurements, stepById, stepsFor, type Procurement } from "@/lib/procurement";
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

  // Review round 1, ISS-10: a purchase asked for outside the calendar printed "Planned" on its requisition.
  it("the requisition says when a purchase was not on the calendar, and why", () => {
    const row = (p: Procurement) => documentFor(p, "Purchase requisition", usd, usd).rows.find(([k]) => k === "Planned or urgent")?.[1];
    expect(row(at("approveReq", { urgent: false, plan: undefined }))).toBe("Planned");
    const plan = { key: "UP-001", project: "Demo", budgetCode: "2.2", budgetName: "Fertilizer", leftUsd: 4800, left: 4800, currency: "USD", approvedBy: [], requestedBy: "Laila Haidari" };
    const asked = { by: "Laila Haidari", at: "2026-11-26", reason: "Twenty more farmers passed the readiness check.", urgent: false };
    expect(row(at("approveReq", { urgent: false, plan: { ...plan, unplanned: asked } }))).toBe("Not on the procurement calendar. Asked for by Laila Haidari on 2026-11-26: Twenty more farmers passed the readiness check.");
    expect(row(at("approveReq", { urgent: true, plan: { ...plan, unplanned: { ...asked, urgent: true } } }))).toMatch(/^Urgent, not on the procurement calendar\./);
    // A calendar item that was planned stays "Planned".
    expect(row(at("approveReq", { urgent: false, plan }))).toBe("Planned");
  });

  // Review round 1, ISS-21: the user ticked two things the app already knew.
  it("a request from the calendar is not asked for its activity or its lead time again", () => {
    const plan = { key: "UP-001", project: "Demo", budgetCode: "2.2", budgetName: "Fertilizer", leftUsd: 4800, left: 4800, currency: "USD", approvedBy: [], requestedBy: "Laila Haidari" };
    const made = [{ date: "2026-11-26", who: "holder" as const, what: "Request created from procurement calendar UP-001" }];
    const p = at("need", { plan, activity: "1.2.1 Buy and distribute the farm input package", qty: 40, unitPrice: 120, neededBy: "2027-01-15", timeline: made });
    expect(checkState(p, check("need", "activity"), usd)).toMatchObject({ ok: true, auto: true, detail: "1.2.1 Buy and distribute the farm input package, from calendar item UP-001" });
    expect(checkState(p, check("need", "leadtime"), usd)).toMatchObject({ ok: true, auto: true, detail: "Needed by 2027-01-15, 50 days after the request. A Small purchase usually takes 21 days" });
    // Too soon for a purchase this size: it does not pass on a tick, only with a recorded reason.
    const soon = { ...p, neededBy: "2026-12-05", checks: { "need.leadtime": true } };
    expect(checkState(soon, check("need", "leadtime"), usd)).toMatchObject({ ok: false, auto: true });
    expect(checkState({ ...soon, checks: { "fix.need.leadtime": true }, overrides: { "fix.need.leadtime": { why: "Supplier holds stock in Kandahar", by: "Laila", date: "2026-11-26" } } }, check("need", "leadtime"), usd)).toMatchObject({ ok: true });
    // The specification is still a person's to confirm, and a request made off the calendar is asked as before.
    expect(checkState(p, check("need", "spec"), usd)).toMatchObject({ ok: false, auto: false });
    expect(checkState(at("need", { plan: undefined }), check("need", "activity"), usd)).toMatchObject({ auto: false });
    expect(checkState(at("need", { plan: undefined }), check("need", "leadtime"), usd)).toMatchObject({ auto: false });
  });

  // Review round 1, ISS-13: one screening date, not one on the supplier and another in the purchase's history.
  it("the supplier's screening date is the same wherever it is shown", () => {
    const signed = { "Screening record": [{ as: "Reviewed by (procurement)", name: "Hamid Wardak", role: "procurement" as const, date: "2026-10-28" }] };
    const p = at("payReady", { supplier: { name: "FarmTools Co. (fictional)", screenedOn: "2026-05-13" }, signatures: signed });
    expect(screenedOnOf(p)).toBe("2026-10-28");
    expect(checkState(p, check("payReady", "rescreen"), usd).detail).toContain("Last screened 2026-10-28");
    // The newer of the two, whichever it is; and a purchase with neither says so.
    expect(screenedOnOf(at("payReady", { supplier: { name: "X", screenedOn: "2026-11-02" }, signatures: signed }))).toBe("2026-11-02");
    expect(screenedOnOf(at("payReady", { supplier: { name: "X", screenedOn: "" }, signatures: {} }))).toBeNull();
    // Every demo purchase past its screening step carries that step's date on the supplier.
    for (const q of seedProcurements()) {
      const step = q.signatures["Screening record"]?.at(-1)?.date;
      if (q.supplier && step) expect(q.supplier.screenedOn, q.id).toBe(step);
    }
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
