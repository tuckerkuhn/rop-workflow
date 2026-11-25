import { describe, expect, it } from "vitest";
import { EMPTY_FRAMEWORK } from "@/lib/framework";
import { projectDesignSchema } from "@/lib/project-setup";
import { appFrequency, frameworkFromIndicators, indicatorsFromDocuments, MAX_INDICATORS, measureFromDocuments, setupDesignSchema, type DesignIndicator } from "@/lib/setup-design";

/** A stubbed reading of fictional documents: no AI is called. */
const ind = (over: Partial<DesignIndicator> = {}): DesignIndicator => ({
  donorCode: "1.1.1.1",
  name: "Farmers trained in orchard care",
  unit: "farmers",
  target: 600,
  level: "output",
  yearTargets: [],
  baseline: null,
  baselineYear: null,
  breakdowns: [],
  verification: "",
  frequency: "not_stated",
  result: "",
  statedAs: "count",
  surveyed: false,
  source: "Logframe, row 4",
  ...over,
});

const stub = {
  name: "Fictional Orchard Project (FOP)",
  donor: "Fictional Fund",
  country: "GT",
  crop: "avocado",
  startDate: "2028-01-01",
  endDate: "2029-12-31",
  goal: "Smallholders earn more from orchards.",
  indicators: [
    ind({ baseline: 0, baselineYear: 2027, breakdowns: ["sex", "age", "province"], verification: "Attendance sheets", frequency: "quarterly", result: "Farmers apply improved orchard practices", yearTargets: [{ year: 2028, target: 200 }, { year: 2029, target: 400 }] }),
    ind({ donorCode: "1.1", name: "Household income from avocado", unit: "% vs baseline", target: null, level: "outcome", baseline: 1200, baselineYear: 2027, verification: "Baseline and endline household survey", frequency: "annual", result: "Increased income from orchards", statedAs: "change_from_baseline", surveyed: true, source: "Logframe, row 2" }),
  ],
  sources: { name: "Agreement, cover page", donor: "Agreement, cover page", dates: "Agreement, clause 2", goal: "Agreement, annex 1" },
  questions: [],
};

describe("the setup design schema and its mapping", () => {
  it("keeps baseline, breakdowns, means of verification, frequency and result statement", () => {
    const parsed = setupDesignSchema.parse(stub);
    const { indicators } = indicatorsFromDocuments(parsed.indicators);
    expect(indicators[0]).toMatchObject({
      donorCode: "1.1.1.1",
      target: 600,
      baseline: 0,
      baselineYear: 2027,
      disaggregation: ["sex", "age", "province"],
      verification: "Attendance sheets",
      frequency: "quarterly",
      result: "Farmers apply improved orchard practices",
      docSource: "Logframe, row 4",
      forecast: { "2028": 200, "2029": 600 },
    });
    // Yearly in the documents: measured at points in time in the app, with the documents' words kept.
    expect(indicators[1]).toMatchObject({ baseline: 1200, frequency: "end_of_season", frequencyAsWritten: "yearly", result: "Increased income from orchards" });
    // What setup sends is what the save accepts.
    expect(projectDesignSchema.safeParse({ name: stub.name, country: "GT", crop: "", startDate: stub.startDate, endDate: stub.endDate, goal: stub.goal, indicators }).success).toBe(true);
  });

  it("keeps an indicator with no number target, with 0 and a note", () => {
    const { indicators, notes } = indicatorsFromDocuments(setupDesignSchema.parse(stub).indicators);
    expect(indicators).toHaveLength(2);
    expect(indicators[1]).toMatchObject({ name: "Household income from avocado", target: 0, level: "outcome" });
    expect(notes.join(" ")).toMatch(/1\.1: the documents give no number target/);
  });

  it("gives a warning for 41 indicators instead of dropping the 41st", () => {
    const list = Array.from({ length: MAX_INDICATORS + 1 }, (_, n) => ind({ donorCode: `1.1.1.${n + 1}`, name: `Indicator ${n + 1}`, frequency: "monthly" }));
    const { indicators, notes } = indicatorsFromDocuments(list);
    expect(indicators).toHaveLength(41);
    expect(indicators[40].name).toBe("Indicator 41");
    expect(notes[0]).toMatch(/41 indicators; a project keeps at most 40/);
    // Saving still asks the person to choose, in plain words.
    const r = projectDesignSchema.safeParse({ name: "X", country: "GT", crop: "", startDate: "2028-01-01", endDate: "2028-12-31", goal: "", indicators });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toMatch(/at most 40 indicators/);
  });

  it("uses the documents' frequency and quarterly only when they say nothing", () => {
    expect(appFrequency("monthly")).toBe("monthly");
    expect(appFrequency("quarterly")).toBe("quarterly");
    expect(appFrequency("annual")).toBe("end_of_season");
    expect(appFrequency("not_stated")).toBe("quarterly");
    const { indicators, notes } = indicatorsFromDocuments([ind({ frequency: "monthly" }), ind({ donorCode: "1.1.1.2" })]);
    expect(indicators.map((i) => i.frequency)).toEqual(["monthly", "quarterly"]);
    expect(notes.join(" ")).toMatch(/no reporting frequency for 1\.1\.1\.2: set to quarterly/);
  });
});

describe("the measure the documents point to", () => {
  it("change against a baseline: change; a rate, share or average from a survey: latest; else the default", () => {
    expect(measureFromDocuments({ statedAs: "change_from_baseline", surveyed: true })).toBe("change");
    expect(measureFromDocuments({ statedAs: "change_from_baseline", surveyed: false })).toBe("change");
    expect(measureFromDocuments({ statedAs: "rate_share_or_average", surveyed: true })).toBe("latest");
    expect(measureFromDocuments({ statedAs: "rate_share_or_average", surveyed: false, verification: "Endline survey report" })).toBe("latest");
    expect(measureFromDocuments({ statedAs: "rate_share_or_average", surveyed: false, verification: "Training records" })).toBeUndefined();
    expect(measureFromDocuments({ statedAs: "count", surveyed: true })).toBeUndefined();
    const { indicators } = indicatorsFromDocuments(setupDesignSchema.parse(stub).indicators);
    expect(indicators[0].measure).toBeUndefined();
    expect(indicators[1].measure).toBe("change");
  });
});

describe("result statements into the results framework", () => {
  it("words an outcome and an output where the framework has none; never replaces a person's wording", () => {
    const { indicators } = indicatorsFromDocuments(setupDesignSchema.parse(stub).indicators);
    const fw = frameworkFromIndicators(EMPTY_FRAMEWORK, indicators, "2028-01-05")!;
    expect(fw.nodes["1"]).toMatchObject({ text: "Increased income from orchards", source: "Logframe, row 2", by: "setup" });
    expect(fw.nodes["1.1"]).toMatchObject({ text: "Farmers apply improved orchard practices" });
    const worded = { goal: null, nodes: { "1": { text: "A person's wording", source: "Agreement p3", by: "u1", byName: "A person", at: "2028-01-01" } } };
    const next = frameworkFromIndicators(worded, indicators, "2028-01-05")!;
    expect(next.nodes["1"].text).toBe("A person's wording");
    expect(next.nodes["1.1"].text).toBe("Farmers apply improved orchard practices");
    expect(frameworkFromIndicators(next, indicators, "2028-01-06")).toBeNull();
  });
});
