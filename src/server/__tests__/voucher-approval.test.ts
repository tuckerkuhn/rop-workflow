import { afterEach, describe, expect, it } from "vitest";
import { registerAuthority } from "@/lib/authority";
import { userById } from "@/lib/demo";
import { reviewKey, seedProcurements, setProcurementSet, type Procurement } from "@/lib/procurement";
import { validateProcurementSave } from "@/server/procurement-guard";

/**
 * The expense voucher's three signatures (the paper form): prepared and entered, reviewed, approved.
 * The preparer never approves; while Finance has a third person, the reviewer does not either; on a
 * two-person Finance team the reviewer may.
 */
const yusuf = userById("yusuf")!;
const omid = userById("omid")!;
const diego = userById("diego")!;

const atApprove = (): Procurement => {
  const p = seedProcurements()[0];
  const q = {
    ...p,
    step: "voucherApprove",
    issues: [],
    voucher: { number: "VB-1", month: "2026-11", date: "2026-11-20", sharepointUrl: "https://rootsofpeace.sharepoint.com/sites/x/v.pdf", netsuiteRef: "" },
    signatures: { ...p.signatures, "Expense voucher": [{ as: "Prepared and entered by (finance)", name: yusuf.name, role: "finance", date: "2026-11-20" }, { as: "Reviewed by (finance)", name: omid.name, role: "finance", date: "2026-11-20" }] },
  } as Procurement;
  return { ...q, checks: { ...q.checks, "voucherApprove.approve": true, [reviewKey(q)]: true } };
};
const approve = (p: Procurement) => ({ ...p, step: "paid" });

afterEach(() => {
  registerAuthority(null);
  setProcurementSet([]);
});

describe("approving the expense voucher", () => {
  it("is never done by the person who prepared it", () => {
    registerAuthority({ finance: ["yusuf", "omid"] });
    const p = atApprove();
    expect(validateProcurementSave(p, approve(p), yusuf)).toBe("The voucher must be approved by someone other than the person who prepared it.");
  });

  it("is done by a third Finance person when there is one, not the reviewer", () => {
    registerAuthority({ finance: ["yusuf", "omid", "diego"] });
    const p = atApprove();
    expect(validateProcurementSave(p, approve(p), omid)).toBe(`The voucher must be approved by a third Finance person: ${diego.name}.`);
    expect(validateProcurementSave(p, approve(p), diego)).toBeNull();
  });

  it("may be done by the reviewer on a two-person Finance team", () => {
    registerAuthority({ finance: ["yusuf", "omid"] });
    const p = atApprove();
    expect(validateProcurementSave(p, approve(p), omid)).toBeNull();
  });
});
