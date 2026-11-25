import { describe, expect, it } from "vitest";
import { FIELD_FORM_KINDS, fieldForm, readinessForm, trainingForm, visitForm } from "@/lib/field-forms";
import { guessPurpose } from "@/lib/kobo-setup";
import type { XlsForm } from "@/lib/distribution-form";

const names = (f: XlsForm) => f.survey.slice(1).map((r) => r[1]);
const row = (f: XlsForm, name: string) => Object.fromEntries(f.survey[0].map((h, i) => [h, f.survey.slice(1).find((r) => r[1] === name)![i]]));
const V = "202611250116";

describe("the app makes a project's readiness, training and farm visit forms", () => {
  it("readiness: the questions the app reads, with the photo required", () => {
    const f = readinessForm("GT-2027", V);
    expect(names(f)).toEqual(["project_code", "start_geopoint", "farmer", "visit_date", "visit_type", "both_present", "ready", "issue", "photo", "location"]);
    expect(row(f, "project_code").calculation).toBe("'GT-2027'");
    expect(row(f, "farmer")).toMatchObject({ type: "select_one_from_file farmers.csv", required: "yes", appearance: "autocomplete" });
    // What needs fixing is asked only when the plot is not ready, and then it must be answered.
    expect(row(f, "issue")).toMatchObject({ required: "yes", relevant: "${ready} = 'no'" });
    expect(row(f, "photo")).toMatchObject({ type: "image", required: "yes", parameters: "max-pixels=1024" });
    expect(f.choices.filter((c) => c[0] === "visit_type").map((c) => c[1])).toEqual(["first", "recheck"]);
    expect(f.settings[1]).toEqual(["GT-2027 readiness check", "gt_2027_readiness_check", V, "concat(${farmer}, ' ', ${visit_date})"]);
  });

  it("training: one record per session, every farmer who attended ticked", () => {
    const f = trainingForm("GT-2027", V);
    expect(names(f)).toEqual(["project_code", "start_geopoint", "training_date", "session", "farmers", "register_ref", "photo", "location", "notes"]);
    expect(row(f, "farmers")).toMatchObject({ type: "select_multiple_from_file farmers.csv", required: "yes" });
    // No question per farmer: a farmer who is not ticked did not attend.
    expect(names(f)).not.toContain("farmer");
    expect(names(f)).not.toContain("attended");
    expect(row(f, "photo").required).toBe("yes");
    // The GPS question shows only when the phone found no place by itself.
    expect(row(f, "location").relevant).toBe("string-length(${start_geopoint}) = 0");
    expect(f.choices.filter((c) => c[0] === "session").map((c) => c[1])).toEqual(["land_prep", "crop_care", "harvest"]);
    expect(f.settings[1][3]).toBe("concat(${session}, ' ', ${training_date})");
  });

  it("farm visit: a crop sown by area is asked the area, held to the farmer's plot", () => {
    for (const plan of [null, { by: "area" as const }]) {
      const f = visitForm("GT-2027", V, plan);
      expect(names(f)).toContain("area_planted");
      expect(names(f)).not.toContain("number_planted");
      expect(row(f, "area_planted")).toMatchObject({ type: "decimal", required: "yes", relevant: "${planted} = 'yes'" });
      expect(row(f, "area_planted").constraint).toContain(". <= number(${farmer_ha})");
      expect(row(f, "farmer_ha").calculation).toBe("pulldata('farmers', 'hectares', 'name', ${farmer})");
    }
  });

  it("farm visit: a crop counted one by one is asked how many, in the project's own word", () => {
    const f = visitForm("GT-2027", V, { by: "count", unit: "Vines", rowM: 3, plantM: 1.5 });
    expect(names(f)).toContain("number_planted");
    expect(names(f)).not.toContain("area_planted");
    expect(row(f, "number_planted")).toMatchObject({ type: "integer", required: "yes", label: "How many vines were planted?", constraint: ". > 0" });
    expect(row(f, "number_planted").hint).toContain("rows 3 m apart, 1.5 m between vines");
  });

  it("farm visit: a counted crop with no spacing saved is asked the area, which the app can record", () => {
    const f = visitForm("GT-2027", V, { by: "count", unit: "trees" });
    expect(names(f)).toContain("area_planted");
    expect(names(f)).not.toContain("number_planted");
  });

  it("refuses on the phone what the app would refuse later", () => {
    expect(row(readinessForm("X", V), "visit_date")).toMatchObject({ default: "today()", constraint: ". <= today()" });
    expect(row(trainingForm("X", V), "training_date")).toMatchObject({ default: "today()", constraint: ". <= today()" });
    const visit = visitForm("X", V, null);
    expect(row(visit, "visit_date").constraint).toBe(". <= today()");
    expect(row(visit, "planting_date")).toMatchObject({ constraint: ". <= ${visit_date}", constraint_message: "The date planted cannot be after the visit date." });
    // What needs follow-up must be said when the farmer has not planted, or not as trained.
    expect(row(visit, "issue")).toMatchObject({ required: "yes", relevant: "${planted} = 'no' or ${spacing_ok} = 'no'" });
  });

  it("every form is a whole XLSForm, and Setup guesses what it is for from its title", () => {
    for (const kind of FIELD_FORM_KINDS) {
      const f = fieldForm(kind, "GT-2027", V, null);
      expect(f.survey[0]).toEqual(expect.arrayContaining(["type", "name", "label", "required", "relevant", "constraint", "constraint_message"]));
      for (const r of [...f.survey, ...f.choices, ...f.settings]) expect(r.every((c) => typeof c === "string")).toBe(true);
      // Each select question has its list of choices, or reads the farmer list.
      const lists = new Set(f.choices.slice(1).map((c) => c[0]));
      for (const r of f.survey.slice(1)) {
        const m = /^select_(?:one|multiple) (\S+)$/.exec(r[0]);
        if (m) expect(lists.has(m[1])).toBe(true);
      }
      expect(new Set(names(f)).size).toBe(names(f).length);
      expect(guessPurpose(f.settings[1][0])).toBe(kind);
    }
  });
});
