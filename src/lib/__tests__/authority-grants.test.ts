import { describe, expect, it } from "vitest";
import { namedGrants } from "@/lib/authority";
import { users } from "@/lib/demo";
import type { HrRole } from "@/lib/hr";

/** Review round 1, ISS-19: the authority table said nobody held MEL while Omar Sadiq accepted results. */
describe("the authority table shows a right given outside it", () => {
  const none = {} as Record<HrRole, string[]>;
  it("names the person who has the MEL right on their own record, and what it lets them do", () => {
    expect(namedGrants("mel", { ...none, mel: [] }, users)).toEqual([{ id: "omar", name: "Omar Sadiq", does: ["accepts or queries results"] }]);
  });
  it("says nothing once they are in the table, or for a role with no project right", () => {
    expect(namedGrants("mel", { ...none, mel: ["omar"] }, users)).toEqual([]);
    expect(namedGrants("payroll", none, users)).toEqual([]);
  });
  it("lists each right a person holds under the role it belongs to", () => {
    const person = [{ id: "x", name: "X", project: ["plan-approver", "report-release", "mel-owner"] }];
    expect(namedGrants("management", none, person)).toEqual([{ id: "x", name: "X", does: ["approves the project plan", "releases reports"] }]);
    expect(namedGrants("ceo", none, person)).toEqual([{ id: "x", name: "X", does: ["approves the project plan"] }]);
  });
});
