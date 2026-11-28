import { describe, expect, it } from "vitest";
import { evaluate } from "@/lib/form-expr";
import { APP_FORM_KINDS, appForm, fillText, formProblems, formState, savedAnswers, type FormLists } from "@/lib/app-forms";
import type { FieldSetup } from "@/lib/package";

/** Review round 1, Part 2 step 1: the five field forms filled in inside the app, with one reader. */
const TODAY = "2026-11-27";
const ctx = (values: Record<string, string>, self?: string) => ({ value: (n: string) => values[n] ?? "", self, today: TODAY });

describe("the form rule language", () => {
  it("reads the rules the made forms use", () => {
    expect(evaluate("${ready} = 'no'", ctx({ ready: "no" }))).toBe(true);
    expect(evaluate("${ready} = 'no'", ctx({ ready: "" }))).toBe(false);
    expect(evaluate("string-length(${start_geopoint}) = 0", ctx({}))).toBe(true);
    expect(evaluate(". <= today()", ctx({}, "2026-11-28"))).toBe(false);
    expect(evaluate(". <= today()", ctx({}, "2026-11-27"))).toBe(true);
    expect(evaluate(". <= ${visit_date}", ctx({ visit_date: "2026-11-20" }, "2026-11-21"))).toBe(false);
    const area = ". > 0 and (string-length(${farmer_ha}) = 0 or . <= number(${farmer_ha}))";
    expect(evaluate(area, ctx({ farmer_ha: "0.5" }, "0.4"))).toBe(true);
    expect(evaluate(area, ctx({ farmer_ha: "0.5" }, "0.6"))).toBe(false);
    expect(evaluate(area, ctx({ farmer_ha: "" }, "3"))).toBe(true);
    expect(evaluate("${planted} = 'no' or ${spacing_ok} = 'no'", ctx({ planted: "yes", spacing_ok: "no" }))).toBe(true);
    expect(evaluate("if(${per} = 'hectare', round(10 * number(${ha}), 2), 10)", ctx({ per: "hectare", ha: "0.333" }))).toBe(3.33);
  });

  it("refuses what it cannot read, instead of guessing", () => {
    expect(() => evaluate("regex(., 'x')", ctx({}))).toThrow(/does not know/);
    expect(() => evaluate("${a} = ", ctx({}))).toThrow();
  });
});

const setup = { items: [{ key: "seed", item: "Wheat seed", qty: 50, unit: "kg", per: "hectare" }, { key: "npk", item: "NPK fertiliser", qty: 25, unit: "kg", per: "farmer" }] } as unknown as FieldSetup;
const lists: FormLists = {
  farmers: [{ name: "F-1001", label: "F-1001 · Qala", hectares: 0.5 }, { name: "F-1002", label: "F-1002 · Qala", hectares: null }],
  package: [{ name: "seed", label: "Wheat seed", qty: 50, unit: "kg", per: "hectare" }, { name: "npk", label: "NPK fertiliser", qty: 25, unit: "kg", per: "farmer" }],
};

describe("the five forms", () => {
  it("every form can be read by the app", () => {
    for (const k of APP_FORM_KINDS) expect(appForm(k, "A2027", { setup, names: true }).questions.length).toBeGreaterThan(3);
  });

  it("distribution: the planned amount is worked out for the farmer, and an amount is asked only when it differed", () => {
    const f = appForm("distribution", "A2027", { setup });
    const s = formState(f, { farmer: "F-1001", seed_given: "yes", npk_given: "other" }, lists, TODAY);
    expect(s.values.seed_plan).toBe("25");
    expect(s.values.npk_plan).toBe("25");
    expect(s.shown.has("seed_qty")).toBe(false);
    expect(s.shown.has("npk_qty")).toBe(true);
    const hint = f.questions.find((q) => q.name === "seed_given")!.hint!;
    expect(fillText(hint, s.values)).toBe("Planned for this farmer: 25 kg");
    // Today, unless changed.
    expect(s.values.distribution_date).toBe(TODAY);
    // No GPS when the form opened: the place is asked.
    expect(s.shown.has("location")).toBe(true);
    expect(formState(f, { start_geopoint: "34.5 69.1" }, lists, TODAY).shown.has("location")).toBe(false);
  });

  it("refuses on the phone what the app would refuse later", () => {
    const f = appForm("visit", "A2027", { plan: null });
    const bad = formProblems(f, { farmer: "F-1001", visit_date: "2026-11-27", purpose: "germination", both_present: "yes", planted: "yes", planting_date: "2026-11-28", area_planted: "0.9", spacing_ok: "yes", photo: "p.jpg" }, lists, TODAY);
    expect(bad.map((p) => p.name)).toEqual(["planting_date", "area_planted"]);
    expect(bad[1].text).toContain("no more than the farmer's plot");
    expect(formProblems(f, { farmer: "F-9999" }, lists, TODAY)[0].text).toContain("not on this project's farmer list");
  });

  it("a readiness check that is not ready must say what to fix", () => {
    const f = appForm("readiness", "A2027", {});
    const base = { farmer: "F-1002", visit_type: "first", both_present: "yes", ready: "no", photo: "p.jpg" };
    expect(formProblems(f, base, lists, TODAY).map((p) => p.name)).toEqual(["issue"]);
    expect(formProblems(f, { ...base, issue: "Ridges too far apart" }, lists, TODAY)).toEqual([]);
    // An answer to a question that is not shown is not saved.
    expect(savedAnswers(f, { ...base, ready: "yes", issue: "left over" }, lists, TODAY).issue).toBeUndefined();
  });

  it("register a farmer: the name is asked only of someone who may see names, and the ID is checked", () => {
    expect(appForm("register", "A2027", { names: false }).questions.some((q) => q.name === "farmer_name")).toBe(false);
    expect(appForm("register", "A2027", { names: true }).questions.some((q) => q.name === "farmer_name")).toBe(true);
    const f = appForm("register", "A2027", { names: false });
    expect(formProblems(f, { farmer_id: "F 1003", village: "Qala", sex: "Female", hectares: "0.4" }, lists, TODAY).map((p) => p.name)).toEqual(["farmer_id"]);
    expect(formProblems(f, { farmer_id: "F-1003", village: "Qala", sex: "Female", hectares: "200" }, lists, TODAY)[0].text).toContain("between 0 and 100");
  });

  it("training: many farmers ticked, each on the list", () => {
    const f = appForm("training", "A2027", {});
    const a = { session: "land_prep", farmers: "F-1001 F-1002", register_ref: "Book 2 p. 14", photo: "r.jpg", start_geopoint: "34.5 69.1" };
    expect(formProblems(f, a, lists, TODAY)).toEqual([]);
    expect(formProblems(f, { ...a, farmers: "F-1001 F-7" }, lists, TODAY)[0].text).toContain("F-7");
  });
});

describe("who fills in field forms", () => {
  it("field staff who may change Field activities fill them in; registering is for the manager, plan approvers and extension agents", async () => {
    const { userById } = await import("@/lib/demo");
    const { mayFillForms, mayRegister, mayOpenForms } = await import("@/lib/app-forms");
    const u = (id: string) => userById(id)!;
    expect(["farida", "omar", "bilal", "nadia"].every((id) => mayFillForms(u(id)))).toBe(true);
    // A plan approver whose role signs nothing in Field activities registers farmers, and fills in nothing else.
    expect(mayFillForms(u("daniel"))).toBe(false);
    expect(mayRegister(u("daniel"))).toBe(true);
    expect(mayRegister(u("omar"))).toBe(false);
    expect(mayRegister(u("farida"))).toBe(true);
    expect(mayOpenForms(u("hamid"))).toBe(false);
  });
});

describe("the household roster (MF-07)", async () => {
  const { parseHousehold, householdCounts, householdText } = await import("@/lib/household");
  const { parseFarmers } = await import("@/lib/farmer-import");

  it("reads sex and age for each person and counts women, men, girls and boys", () => {
    const { members } = parseHousehold("Female 34, Male 40; f 12, boy 3");
    expect(members).toEqual([{ sex: "Female", age: 34 }, { sex: "Male", age: 40 }, { sex: "Female", age: 12 }, { sex: "Male", age: 3 }]);
    expect(householdCounts(members)).toEqual({ women: 1, men: 1, girls: 1, boys: 1, size: 4 });
    expect(householdText(members)).toBe("Female 34, Male 40, Female 12, Male 3");
    expect(parseHousehold("Female 34, Male ?").problem).toMatch(/person 2/);
  });

  it("on the register form, the roster gives the household's size, and a bad line is refused", () => {
    const f = appForm("register", "A2027", {});
    const base = { farmer_id: "F-1003", village: "Qala", sex: "Female", hectares: "0.4" };
    expect(formState(f, { ...base, household: "Female 34, Male 5" }, lists, TODAY).shown.has("household_size")).toBe(false);
    expect(formState(f, base, lists, TODAY).shown.has("household_size")).toBe(true);
    expect(formProblems(f, { ...base, household: "Female" }, lists, TODAY).map((p) => p.name)).toEqual(["household"]);
  });

  it("a farmer list may carry the roster, and it must match the household size given", () => {
    const ok = parseFarmers("id,village,sex,hectares,household members\nF-1,Qala,F,0.5,\"Female 30, Male 2\"");
    expect(ok.rows[0]).toMatchObject({ household: [{ sex: "Female", age: 30 }, { sex: "Male", age: 2 }], householdSize: 2 });
    const bad = parseFarmers("id,village,sex,hectares,household size,household members\nF-1,Qala,F,0.5,5,\"Female 30\"");
    expect(bad.problems[0]).toContain("household size 5 but 1 household members listed");
  });
});

describe("training details (MF-09)", async () => {
  const { parseScores, scoreLine } = await import("@/lib/field-training");

  it("scores are read for farmers ticked, and never above the top mark", () => {
    expect(parseScores("F-1001:4:8, F-1002::9", ["F-1001", "F-1002"], 10)).toEqual({ scores: [{ farmer: "F-1001", pre: 4, post: 8 }, { farmer: "F-1002", post: 9 }] });
    expect(parseScores("F-7:4:8", ["F-1001"]).problem).toContain("not ticked as attending");
    expect(parseScores("F-1001:4:12", ["F-1001"], 10).problem).toContain("more than the 10");
    expect(scoreLine({ pre: 4, post: 8 }, 10)).toBe("pre-test 4/10, post-test 8/10");
  });

  it("the training form carries the project's curriculum, and asks scores once a top mark is given", () => {
    const f = appForm("training", "A2027", { setup: { ...setup, curriculum: { name: "Wheat farmer field school", version: "2.1" } } });
    const a = { session: "land_prep", farmers: "F-1001 F-1002", register_ref: "Book 2 p. 14", photo: "r.jpg", start_geopoint: "34.5 69.1" };
    expect(formState(f, a, lists, TODAY).values.curriculum).toBe("Wheat farmer field school, version 2.1");
    expect(formState(f, a, lists, TODAY).shown.has("scores")).toBe(false);
    expect(formState(f, { ...a, score_max: "10" }, lists, TODAY).shown.has("scores")).toBe(true);
    expect(formProblems(f, { ...a, score_max: "10", scores: "F-1001:4:11" }, lists, TODAY).map((p) => p.name)).toEqual(["scores"]);
    expect(formProblems(f, { ...a, score_max: "10", scores: "F-1001:4:9" }, lists, TODAY)).toEqual([]);
  });
});

describe("where a record came from (ISS-15)", async () => {
  const { sourceText } = await import("@/lib/form-record");
  it("names the real source and the person, the same way everywhere", () => {
    expect(sourceText("form", "Farida Noori")).toBe("Recorded in the app by Farida Noori");
    expect(sourceText("app", "Bilal Hotak")).toBe("Recorded in the app by Bilal Hotak");
    expect(sourceText("kobo", "Farida Noori")).toBe("Sent from KoboCollect by Farida Noori");
    expect(sourceText("kobo", null)).toBe("Sent from a KoboCollect account not yet matched to a person");
    expect(sourceText("sample", "x")).toBe("Sample record, made up for the demo");
  });
});
