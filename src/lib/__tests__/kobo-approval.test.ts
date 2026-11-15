import { describe, expect, it } from "vitest";
import { users } from "@/lib/demo";
import { approverNames, DEFAULT_KOBO_APPROVAL, koboApprovalProblem, koboApprovers, mayApproveKobo, mayDecide, needsKoboCheck, type KoboApproval } from "@/lib/kobo-approval";

const u = (id: string) => users.find((x) => x.id === id)!;
const named: KoboApproval = { who: "named", person: "karim", standIn: "nadia" };

describe("who approves KoboCollect data", () => {
  it("is anyone with the MEL role until a project chooses otherwise", () => {
    expect(mayApproveKobo(u("omar"), DEFAULT_KOBO_APPROVAL)).toBe(true);
    expect(mayApproveKobo(u("nadia"), DEFAULT_KOBO_APPROVAL)).toBe(false);
    expect(mayApproveKobo(u("bilal"), DEFAULT_KOBO_APPROVAL)).toBe(false);
  });

  it("is only the named person and their stand-in when one is named, MEL role or not", () => {
    expect(mayApproveKobo(u("karim"), named)).toBe(true);
    expect(mayApproveKobo(u("nadia"), named)).toBe(true);
    expect(mayApproveKobo(u("omar"), named)).toBe(false);
    expect(mayApproveKobo(u("omar"), { who: "named" })).toBe(false);
  });

  it("is the project manager when the project says so", () => {
    expect(mayApproveKobo(u("nadia"), { who: "manager" })).toBe(true);
    expect(mayApproveKobo(u("omar"), { who: "manager" })).toBe(false);
  });

  it("lists the named person before their stand-in, and names a role when nobody holds it", () => {
    expect(koboApprovers(users, named).map((p) => p.id)).toEqual(["karim", "nadia"]);
    expect(approverNames(users, named)).toBe(`${u("karim").name} or ${u("nadia").name}`);
    expect(approverNames([], { who: "manager" })).toBe("the project manager");
    expect(approverNames([], { who: "named" })).toBe("the person named to approve KoboCollect data");
  });

  it("refuses a named rule with nobody, a stranger, or the same person twice", () => {
    expect(koboApprovalProblem({ who: "named" }, users)).toMatch(/^Choose the person/);
    expect(koboApprovalProblem({ who: "named", person: "nobody" }, users)).toMatch(/not on the staff list/);
    expect(koboApprovalProblem({ who: "named", person: "karim", standIn: "karim" }, users)).toMatch(/different person/);
    expect(koboApprovalProblem(named, users)).toBeNull();
    expect(koboApprovalProblem({ who: "mel" }, users)).toBeNull();
  });

  it("asks for a check on a KoboCollect distribution, once, unless the manager is the approver", () => {
    expect(needsKoboCheck({ source: "kobo" }, DEFAULT_KOBO_APPROVAL)).toBe(true);
    expect(needsKoboCheck({ source: "kobo", koboChecked: { by: "omar" } }, DEFAULT_KOBO_APPROVAL)).toBe(false);
    expect(needsKoboCheck({ source: "kobo" }, { who: "manager" })).toBe(false);
    // Recorded in the app by a named person: the project manager's approval is its check.
    expect(needsKoboCheck({ source: "manual" }, named)).toBe(false);
  });

  it("leaves records typed into the app with MEL, whatever the KoboCollect rule", () => {
    expect(mayDecide(u("omar"), false, named)).toBe(true);
    expect(mayDecide(u("karim"), false, named)).toBe(u("karim").project.includes("mel-owner"));
    expect(mayDecide(u("omar"), true, named)).toBe(false);
    expect(mayDecide(u("karim"), true, named)).toBe(true);
  });
});
