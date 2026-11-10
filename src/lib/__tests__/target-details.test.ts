import { describe, expect, it } from "vitest";
import { detailChanges, linkProblem, nextDetails, targetDetailsSchema, type StoredDetails } from "@/lib/target-details";

const before: StoredDetails = { baseline: null, disaggregation: ["sex", "crop"], verification: null, budgetRef: null, workplanCode: null, inQuarterlyReport: true };
const patch = { indicator: "IND-3", baseline: 120, breakdown: ["district", "sex"] as ("sex" | "province" | "district")[], verification: "Attendance sheets", budgetRef: "PRG-1.1.1.A", workplanCode: "", inQuarterlyReport: false };

describe("target details: the six facts setup does not ask for", () => {
  it("keeps a breakdown this screen does not offer, and orders the known ones", () => {
    expect(nextDetails(before, patch).disaggregation).toEqual(["sex", "district", "crop"]);
  });
  it("stores empty text as not set", () => {
    const after = nextDetails(before, patch);
    expect(after.workplanCode).toBeNull();
    expect(after.verification).toBe("Attendance sheets");
  });
  it("leaves a breakdown that was never set as not set when none is chosen", () => {
    expect(nextDetails({ ...before, disaggregation: null }, { ...patch, breakdown: [] }).disaggregation).toBeNull();
  });
  it("lists only what changed, for the audit log", () => {
    const changes = detailChanges(before, nextDetails(before, patch));
    expect(Object.keys(changes).sort()).toEqual(["baseline", "budgetRef", "disaggregation", "inQuarterlyReport", "verification"]);
    expect(changes.baseline).toEqual({ from: null, to: 120 });
  });
  it("finds no change when the same facts are saved again", () => {
    const once = nextDetails(before, patch);
    expect(detailChanges(once, nextDetails(once, patch))).toEqual({});
  });
  it("refuses a budget line or workplan step the project does not have", () => {
    expect(linkProblem(patch, ["PRG-1.1.1.A"], [])).toBeNull();
    expect(linkProblem(patch, ["PRG-2"], [])).toMatch(/not in this project's budget/);
    expect(linkProblem({ budgetRef: "", workplanCode: "1.1.1.3" }, [], ["1.1.1.1"])).toMatch(/not in this project's workplan/);
  });
  it("refuses a breakdown the checks do not know and a target code that is not one", () => {
    expect(targetDetailsSchema.safeParse({ ...patch, breakdown: ["age"] }).success).toBe(false);
    expect(targetDetailsSchema.safeParse({ ...patch, indicator: "3" }).success).toBe(false);
    expect(targetDetailsSchema.safeParse(patch).success).toBe(true);
  });
});
