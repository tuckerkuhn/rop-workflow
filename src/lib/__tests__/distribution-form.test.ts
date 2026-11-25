import { describe, expect, it } from "vitest";
import { distributionForm, formProblem } from "@/lib/distribution-form";
import type { FieldSetup } from "@/lib/package";

const setup: FieldSetup = {
  items: [
    { key: "cuttings", item: "Grape cuttings", unit: "cuttings", qty: 1100, per: "hectare", budgetLine: "2.1" },
    { key: "drip", item: "Drip irrigation kit", unit: "kit", qty: 1, per: "farmer", budgetLine: "2.3" },
  ],
};
const names = (f: ReturnType<typeof distributionForm>) => f.survey.slice(1).map((r) => r[1]);
const row = (f: ReturnType<typeof distributionForm>, name: string) => Object.fromEntries(f.survey[0].map((h, i) => [h, f.survey.slice(1).find((r) => r[1] === name)![i]]));

describe("a project's distribution form is made from the package it saved", () => {
  const f = distributionForm("GT-2027", "GT-2027 input distribution", setup, "2026112501");

  it("asks for each item of the package, under the names the app reads", () => {
    expect(names(f)).toEqual(expect.arrayContaining(["project_code", "farmer", "distribution_date", "cuttings_given", "cuttings_qty", "drip_given", "drip_qty", "condition", "signed", "list_photo", "handover_photo", "notes"]));
    expect(row(f, "project_code").calculation).toBe("'GT-2027'");
    expect(row(f, "cuttings_plan").calculation).toContain("pulldata('package', 'qty', 'name', 'cuttings')");
    // One tap when the planned amount was handed over; the amount is typed only when it differed.
    expect(row(f, "cuttings_given").type).toBe("select_one given");
    expect(row(f, "cuttings_qty").relevant).toBe("${cuttings_given} = 'other'");
    expect(f.choices.filter((c) => c[0] === "given").map((c) => c[1])).toEqual(["yes", "other", "no"]);
  });

  it("types nothing the phone or the app already knows", () => {
    // The place is the phone's; the GPS question shows only when the phone found none.
    expect(row(f, "start_geopoint").type).toBe("start-geopoint");
    expect(row(f, "location").relevant).toBe("string-length(${start_geopoint}) = 0");
    expect(row(f, "distribution_date").default).toBe("today()");
    expect(names(f)).not.toContain("distribution_point");
    // The only typed question is the optional note.
    expect(f.survey.slice(1).filter((r) => r[0] === "text").map((r) => r[1])).toEqual(["notes"]);
    expect(row(f, "notes").required).toBe("");
  });

  it("requires the signed note's photo, tagged by its question", () => {
    expect(row(f, "list_photo")).toMatchObject({ type: "image", required: "yes" });
    expect(row(f, "handover_photo").required).toBe("");
  });

  it("names the form for the project and carries the version", () => {
    expect(f.settings[1]).toEqual(["GT-2027 input distribution", "gt_2027_input_distribution", "2026112501", "concat(${farmer}, ' ', ${distribution_date})"]);
  });

  it("says why a form cannot be made, before making a broken one", () => {
    expect(formProblem(null)).toMatch(/Save the input package first/);
    expect(formProblem({ items: [] })).toMatch(/Save the input package first/);
    expect(formProblem({ items: [{ ...setup.items[0], key: "Grape Cuttings" }] })).toMatch(/short name the form cannot use/);
    expect(formProblem({ items: [setup.items[0], setup.items[0]] })).toMatch(/same short name/);
    expect(formProblem(setup)).toBeNull();
  });
});
