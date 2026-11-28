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

describe("a budget shortfall overridden (review round 2, R2-03)", () => {
  const laila = userById("laila")!;
  const yusuf = userById("yusuf")!; // Finance
  const BKEY = "fix.requisition.budgetValue";
  const budget = stepById.requisition.checks.find((c) => c.id === "budgetValue")!;
  const at = { ...req("PR-A2027-009", 10_000_000), step: "requisition" } as Procurement;
  it("needs a reason in the ticker's own name, and then Finance's confirmation", () => {
    expect(budget.secondBy).toBe("finance");
    const bare = { ...at, checks: { [BKEY]: true } } as Procurement;
    expect(validateProcurementSave(at, bare, laila)).toMatch(/Record why the check is overridden/);
    const recorded = { ...at, checks: { [BKEY]: true }, overrides: { [BKEY]: { why: "Funder revision 4 approved by email on 20 Nov.", by: laila.name, date: "2026-11-28" } } } as Procurement;
    expect(validateProcurementSave(at, recorded, laila) ?? "").not.toMatch(/Record why/);
    expect(checkState(recorded, budget, usd).ok).toBe(false);
    const confirmed = (u: { name: string }) => ({ ...recorded, overrides: { [BKEY]: { ...recorded.overrides![BKEY], confirmedBy: { name: u.name, date: "2026-11-28" } } } }) as Procurement;
    expect(validateProcurementSave(recorded, confirmed(hamid), hamid)).toBe("Only Finance confirms a budget revision.");
    expect(validateProcurementSave(recorded, confirmed(yusuf), yusuf)).toBeNull();
    expect(checkState(confirmed(yusuf), budget, usd).ok).toBe(true);
  });
});

describe("a contract above what was approved (review round 2, R2-04)", async () => {
  const { contractValueCheck } = await import("@/lib/procurement");
  const c = { ...req("PR-A2027-010", 3_000), step: "contract", contractCurrency: "USD", contractUsd: 9_500, bids: [], selectedBid: undefined } as unknown as Procurement;
  it("stops at the contract step until an amendment is recorded", () => {
    expect(contractValueCheck(c, usd)).toMatchObject({ ok: false });
    expect(contractValueCheck(c, usd)!.detail).toContain("above the $3000 approved");
    expect(contractValueCheck({ ...c, contractUsd: 2_900 } as Procurement, usd)).toMatchObject({ ok: true });
    expect(stepById.contract.checks.find((x) => x.id === "contractValue")?.secondBy).toBe("finance");
  });
});
