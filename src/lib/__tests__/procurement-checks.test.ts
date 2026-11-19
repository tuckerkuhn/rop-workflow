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
});
