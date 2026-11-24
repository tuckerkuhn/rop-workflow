import { describe, expect, it } from "vitest";
import { users } from "@/lib/demo";
import { approverNames, collectorOf, deciderNames, decidersOf, DEFAULT_KOBO_APPROVAL, koboApprovalProblem, koboApprovers, mayApproveKobo, mayDecide, mayDecideRecord, maySendBack, needsKoboCheck, refusalFor, reviewRefusal, suggestedCollector, type KoboApproval } from "@/lib/kobo-approval";

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
    expect(approverNames([], { who: "named" })).toBe("nobody yet: name the person who approves KoboCollect data in Set up");
    expect(approverNames([], { who: "named", person: "gone" })).toBe("the person named to approve KoboCollect data");
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

describe("nobody approves what they collected", () => {
  const rule: KoboApproval = { who: "mel", accounts: { omar_field: "omar", "Farida.N": "farida" } };
  const ids = (rec: { fromKobo: boolean; collector: string | null }, r: KoboApproval = rule, team = users) => decidersOf(team, rec, r).map((p) => p.id);

  it("knows the collector from the KoboCollect account, however it is capitalised", () => {
    expect(collectorOf("omar_field", rule, users)).toBe("omar");
    expect(collectorOf("farida.n", rule, users)).toBe("farida");
    expect(collectorOf("someone_else", rule, users)).toBeNull();
    expect(collectorOf("", rule, users)).toBeNull();
    // An account matched to someone who has left is unknown again, not a stale name.
    expect(collectorOf("gone", { who: "mel", accounts: { gone: "nobody" } }, users)).toBeNull();
  });

  it("matches an account named like the person's sign-in email without being told", () => {
    const team = [{ ...users.find((x) => x.id === "omar")!, email: "omar.sadiq@example.org" }];
    expect(collectorOf("Omar.Sadiq@example.org", { who: "mel" }, team)).toBe("omar");
    // Named like the start of the email: only suggested, until a person confirms it.
    expect(collectorOf("omar.sadiq", { who: "mel" }, team)).toBeNull();
    expect(suggestedCollector("omar.sadiq", team)).toBe("omar");
    expect(suggestedCollector("admin", team)).toBeNull();
  });

  it("with one MEL officer who collected it, sends it to the person they report to", () => {
    expect(users.filter((p) => p.project.includes("mel-owner")).map((p) => p.id)).toEqual(["omar"]);
    expect(ids({ fromKobo: true, collector: "omar" })).toEqual([u("omar").reportsTo]);
    expect(mayDecideRecord(u("omar"), users, { fromKobo: true, collector: "omar" }, rule)).toBe(false);
    expect(refusalFor(u("omar"), users, { fromKobo: true, collector: "omar" }, rule)).toBe(`You collected this record, so someone else decides it: ${u(u("omar").reportsTo!).name}.`);
  });

  it("leaves it with the usual approver when someone else collected it, or nobody knows who did", () => {
    expect(ids({ fromKobo: true, collector: "farida" })).toEqual(["omar"]);
    expect(ids({ fromKobo: true, collector: null })).toEqual(["omar"]);
    expect(refusalFor(u("omar"), users, { fromKobo: true, collector: "farida" }, rule)).toBeNull();
  });

  it("uses the stand-in before the line manager when the named approver collected it", () => {
    const named: KoboApproval = { who: "named", person: "omar", standIn: "karim" };
    expect(ids({ fromKobo: true, collector: "omar" }, named)).toEqual(["karim"]);
    expect(ids({ fromKobo: true, collector: "omar" }, { who: "named", person: "omar" })).toEqual([u("omar").reportsTo]);
  });

  it("applies the same rule to a result typed into the app", () => {
    expect(ids({ fromKobo: false, collector: "farida" })).toEqual(["omar"]);
    expect(ids({ fromKobo: false, collector: "omar" })).toEqual([u("omar").reportsTo]);
    expect(refusalFor(u("bilal"), users, { fromKobo: false, collector: "farida" }, rule)).toBe(`Only ${u("omar").name} can accept or query this record.`);
  });

  it("says so when nobody is left to decide", () => {
    const alone = [{ ...u("omar"), reportsTo: undefined }];
    expect(decidersOf(alone, { fromKobo: true, collector: "omar" }, rule)).toEqual([]);
    expect(deciderNames(alone, { fromKobo: true, collector: "omar" }, rule)).toMatch(/^nobody yet/);
  });
});

describe("the technical lead sends field forms back", () => {
  const rule: KoboApproval = { who: "mel" };
  const visit = { fromKobo: true, collector: "farida", form: "visit" };
  const lead = u("alejandro");

  it("may send back a field form with a note, never accept it", () => {
    expect(reviewRefusal(lead, users, visit, rule, "queried", "Measure the rows again")).toBeNull();
    expect(reviewRefusal(lead, users, visit, rule, "accepted")).toBe("Only MEL accepts field forms; you can send one back with a note.");
    expect(reviewRefusal(lead, users, visit, rule, "queried", " ")).toMatch(/^Write a note/);
    expect(maySendBack(lead, users, visit)).toBe(true);
  });

  it("names who accepts under a named rule", () => {
    expect(reviewRefusal(lead, users, visit, named, "accepted")).toBe(`Only ${u("karim").name} or ${u("nadia").name} accepts field forms; you can send one back with a note.`);
  });

  it("does not touch distributions, results, their own record, or a project they are not on", () => {
    expect(reviewRefusal(lead, users, { ...visit, form: "distribution" }, rule, "queried", "x")).toMatch(/project manager approves input distributions/);
    expect(reviewRefusal(lead, users, { ...visit, form: "result" }, rule, "queried", "x")).toBe(refusalFor(lead, users, visit, rule));
    expect(reviewRefusal(lead, users, { ...visit, collector: "alejandro" }, rule, "queried", "x")).toMatch(/^You collected this record/);
    expect(maySendBack(lead, users, { ...visit, collector: "alejandro" })).toBe(false);
    expect(reviewRefusal(lead, users.filter((p) => p.id !== "alejandro"), visit, rule, "queried", "x")).not.toBeNull();
  });

  it("leaves MEL and everyone else as before", () => {
    expect(reviewRefusal(u("omar"), users, visit, rule, "accepted")).toBeNull();
    expect(reviewRefusal(u("omar"), users, visit, rule, "queried")).toBeNull();
    expect(reviewRefusal(u("bilal"), users, visit, rule, "queried", "x")).toBe(refusalFor(u("bilal"), users, visit, rule));
    expect(maySendBack(u("omar"), users, visit)).toBe(false);
  });
});
