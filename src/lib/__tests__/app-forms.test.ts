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
