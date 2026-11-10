import { beforeEach, describe, expect, it } from "vitest";
import { holdersOfType, holdsType, PROJECT_ROLE_TYPES, projectRolesFromTypes, registerAuthority, SIGNATURES, typesHeldBy } from "@/lib/authority";
import { HR_ROLES } from "@/lib/hr";
import { selfSchema } from "@/lib/solo";
import { selfApproval } from "@/server/solo";

describe("the authority table", () => {
  beforeEach(() => registerAuthority({ management: ["u-lead"], mel: ["u-mel"], finance: ["u-fin"], ceo: ["u-ceo"] }));
  it("answers who holds a role type", () => {
    expect(holdersOfType("mel")).toEqual(["u-mel"]);
    expect(holdsType("u-mel", "mel")).toBe(true);
    expect(holdsType("u-mel", "management")).toBe(false);
    expect(typesHeldBy("u-lead")).toEqual(["management"]);
  });
  it("holds nothing before it is loaded", () => {
    registerAuthority(null);
    expect(holdersOfType("mel")).toEqual([]);
    expect(holdsType("u-mel", "mel")).toBe(false);
  });
  it("gives project roles from role types", () => {
    const holders = { management: ["u-lead"], mel: ["u-mel"], finance: ["u-fin"], ceo: ["u-ceo"] };
    expect(projectRolesFromTypes("u-lead", holders).sort()).toEqual(["monthly-review", "plan-approver", "report-release"]);
    expect(projectRolesFromTypes("u-mel", holders)).toEqual(["mel-owner"]);
    expect(projectRolesFromTypes("u-fin", holders)).toEqual(["finance-import"]);
    expect(projectRolesFromTypes("u-ceo", holders)).toEqual(["plan-approver"]);
    expect(projectRolesFromTypes("u-nobody", holders)).toEqual([]);
  });
  it("only management releases the donor report, and only MEL accepts results", () => {
    expect(PROJECT_ROLE_TYPES["report-release"]).toEqual(["management"]);
    expect(PROJECT_ROLE_TYPES["mel-owner"]).toEqual(["mel"]);
  });
  it("every signature names who signs, using known role types", () => {
    const known = new Set<string>([...HR_ROLES, "supervisor", "requester", "committee", "self"]);
    for (const s of SIGNATURES) {
      expect(s.by.length, s.what).toBeGreaterThan(0);
      for (const b of s.by) expect(known.has(b), `${s.what}: ${b}`).toBe(true);
    }
  });
  it("a large award, a sole source or an exception goes to the executive head", () => {
    expect(SIGNATURES.find((s) => s.what === "Approve a large award, a sole source or an exception")!.by).toEqual(["ceo"]);
  });
});

describe("solo mode: approving your own work", () => {
  const refusal = "Someone else must accept a result you recorded.";
  it("is refused when solo mode is off, whatever is confirmed", () => {
    expect(selfApproval({ on: false, blocked: null }, { confirm: true, note: "" }, refusal)).toEqual({ ok: false, why: refusal });
  });
  it("is refused when the donor requires a second person, and says so", () => {
    const r = selfApproval({ on: true, blocked: "Sandbox Donor's rules require a second person on every approval for this project." }, { confirm: true, note: "" }, refusal);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.why).toContain("Sandbox Donor's rules require a second person");
  });
  it("needs the statement confirmed each time", () => {
    expect(selfApproval({ on: true, blocked: null }, undefined, refusal)).toEqual({ ok: false, why: "Confirm that you prepared this and are approving it yourself." });
  });
  it("marks the audit entry self-approved, with the note when there is one", () => {
    expect(selfApproval({ on: true, blocked: null }, { confirm: true, note: "" }, refusal)).toEqual({ ok: true, detail: { selfApproved: true } });
    expect(selfApproval({ on: true, blocked: null }, { confirm: true, note: "Only MEL officer this week" }, refusal)).toEqual({ ok: true, detail: { selfApproved: true, soloNote: "Only MEL officer this week" } });
  });
  it("the confirmation must be exactly true", () => {
    expect(selfSchema.safeParse({ confirm: true }).success).toBe(true);
    expect(selfSchema.safeParse({ confirm: false }).success).toBe(false);
    expect(selfSchema.safeParse({}).success).toBe(false);
    expect(selfSchema.parse({ confirm: true }).note).toBe("");
  });
});
