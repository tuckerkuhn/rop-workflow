import { afterEach, describe, expect, it } from "vitest";
import { userById } from "@/lib/demo";
import { checkState, seedProcurements, setProcurementSet, stepById, type Procurement } from "@/lib/procurement";
import { validateProcurementSave } from "@/server/procurement-guard";

/** Review round 1, ISS-17: the approver alone could record a possible split purchase as separate needs. */
const usd = (n: number) => `$${n}`;
const karim = userById("karim")!;
const hamid = userById("hamid")!; // the procurement manager
const zahra = userById("zahra")!; // a procurement officer, not the manager
const base = seedProcurements()[0];
const req = (id: string, value: number): Procurement => ({ ...base, id, title: "Spare parts", budgetLine: "2.3", qty: 1, unitPrice: value, step: "approveReq", checks: {}, plan: undefined, payments: [], issues: [], overrides: {} }) as Procurement;
const KEY = "fix.approveReq.notSplit";
const notSplit = stepById.approveReq.checks.find((c) => c.id === "notSplit")!;

afterEach(() => setProcurementSet([]));

describe("separate needs, recorded and confirmed by a second person", () => {
  const a = req("PR-A2027-002", 3000);
  const b = req("PR-A2027-003", 3000);
  const recorded = { ...a, checks: { [KEY]: true }, overrides: { [KEY]: { why: "Different sites, different weeks: two separate needs.", by: karim.name, date: "2026-11-27" } } } as Procurement;
  const confirm = (u: { name: string }) => ({ ...recorded, overrides: { [KEY]: { ...recorded.overrides![KEY], confirmedBy: { name: u.name, date: "2026-11-27" } } } }) as Procurement;

  it("the approver's reason alone does not let the step go on", () => {
    setProcurementSet([a, b]);
    expect(checkState(a, notSplit, usd).ok).toBe(false);
    const s = checkState(recorded, notSplit, usd);
    expect(s.ok).toBe(false);
    expect(s.detail).toContain("Waiting for the procurement manager to confirm it");
    expect(checkState(confirm(hamid), notSplit, usd)).toMatchObject({ ok: true });
    expect(checkState(confirm(hamid), notSplit, usd).detail).toContain(`Confirmed by ${hamid.name}`);
  });

  it("only the procurement manager confirms, never the person who recorded it", () => {
    setProcurementSet([a, b]);
    expect(validateProcurementSave(recorded, confirm(karim), karim)).toBe("You recorded this, so a second person confirms it.");
    expect(validateProcurementSave(recorded, confirm(zahra), zahra)).toBe("Only the procurement manager confirms this.");
    expect(validateProcurementSave(recorded, confirm(hamid), zahra)).toBe("A confirmation is signed by the person confirming.");
    expect(validateProcurementSave(recorded, confirm(hamid), hamid)).toBeNull();
  });
});
