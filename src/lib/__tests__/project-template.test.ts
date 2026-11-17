import { describe, expect, it } from "vitest";
import { DEMO_SETUP } from "@/lib/package";
import { approvalForCopy, nextSteps, setupForCopy } from "@/lib/project-template";

describe("starting a project from another project's setup", () => {
  it("copies the package as a draft, without the old season's dates and place", () => {
    const d = setupForCopy(DEMO_SETUP, "A-2027", ["IND-1", "IND-2"]);
    expect(d.draft).toBe(true);
    expect(d.from).toBe("A-2027");
    expect(d.items).toEqual(DEMO_SETUP.items);
    expect(d.items[0]).not.toBe(DEMO_SETUP.items[0]);
    expect("windowEnd" in d || "season" in d || "village" in d).toBe(false);
    expect(d.crop).toBe("Maize");
    expect(d.target).toBe("IND-2");
  });
  it("drops the target the package counts toward when the new project has no such target", () => {
    expect("target" in setupForCopy(DEMO_SETUP, "A-2027", ["IND-1"])).toBe(false);
  });
  it("keeps the named approver and stand-in when both work on the new project, and never the KoboCollect accounts", () => {
    const rule = { who: "named" as const, person: "rahima", standIn: "omar", accounts: { "farida.kobo": "farida" } };
    expect(approvalForCopy(rule, () => true)).toEqual({ who: "named", person: "rahima", standIn: "omar" });
    expect(approvalForCopy(rule, (p) => p === "rahima")).toEqual({ who: "named", person: "rahima" });
  });
  it("copies nothing when the named approver does not work on the new project", () => {
    expect(approvalForCopy({ who: "named", person: "rahima" }, () => false)).toBeNull();
  });
  it("copies a role-based rule as it is", () => {
    expect(approvalForCopy({ who: "manager", accounts: { a: "b" } }, () => false)).toEqual({ who: "manager" });
  });
  it("says what to do next, in order, and what was left alone", () => {
    const all = nextSteps({ package: true, approval: true, targets: 5 }, { package: false, approval: false, targets: false }, false);
    expect(all).toHaveLength(3);
    expect(all[0]).toMatch(/^5 targets were copied/);
    expect(all[1]).toMatch(/draft/);
    const none = nextSteps({ package: false, approval: false, targets: 0 }, { package: true, approval: true, targets: true }, false);
    expect(none.every((n) => /already/.test(n))).toBe(true);
    expect(nextSteps({ package: true, approval: false, targets: 0 }, { package: false, approval: false, targets: true }, true).at(-1)).toMatch(/does not work on this one/);
  });
});
