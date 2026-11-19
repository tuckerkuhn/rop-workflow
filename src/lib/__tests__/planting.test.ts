import { describe, expect, it } from "vitest";
import { fieldCheck, fieldSteps, handedOutOn, plantingProblem, seedField, stepRefusal, type Ctx, type Farmer } from "@/lib/field";
import { resultForPlanting } from "@/lib/distribution";
import { countsAtPlanting, DEMO_SETUP } from "@/lib/package";
import { proofCount, resultSchema } from "@/lib/results";

const at = (step: string) => seedField().find((i) => i.kind === "farmer" && i.step === step) as Farmer;
const ctx: Ctx = { stock: {}, setup: DEMO_SETUP, today: "2027-03-10" };
const check = (f: Farmer, id: string) => fieldCheck(f, fieldSteps.plant.checks.find((c) => c.id === id)!, ctx);

describe("the planting record", () => {
  const f = at("plant");
  const given = handedOutOn(f)!;

  it("reads the handout day from the signed note's photo", () => {
    expect(given).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(handedOutOn({ photos: [], timeline: [{ date: "2027-02-01", who: "manager", what: "Distribution approved by Nadia Rahimi: moved to planting" }] })).toBe("2027-02-01");
    expect(handedOutOn({ photos: [], timeline: [] })).toBeNull();
  });

  it("asks for the day and the area until they are recorded", () => {
    expect(plantingProblem({ ...f, planting: undefined }, ctx.today)).toMatch(/Record the day the farmer planted/);
    expect(check({ ...f, planting: undefined }, "recorded").ok).toBe(false);
  });

  it("refuses planting before the handout, after today, or more than the plot", () => {
    expect(plantingProblem({ ...f, planting: { date: "2020-01-01", hectares: 0.5 } }, ctx.today)).toMatch(/before the inputs were handed out/);
    expect(plantingProblem({ ...f, planting: { date: "2099-01-01", hectares: 0.5 } }, ctx.today)).toMatch(/after today/);
    expect(plantingProblem({ ...f, planting: { date: given, hectares: f.hectares + 1 } }, "2099-01-01")).toMatch(/more than the farmer's plot/);
    expect(plantingProblem({ ...f, planting: { date: given, hectares: 0 } }, "2099-01-01")).toMatch(/above zero/);
  });

  it("passes with a day from the handout to today and an area within the plot", () => {
    const ok = { ...f, planting: { date: given, hectares: f.hectares } };
    expect(plantingProblem(ok, given)).toBeNull();
    expect(fieldCheck(ok, fieldSteps.plant.checks.find((c) => c.id === "recorded")!, { ...ctx, today: given })).toMatchObject({ ok: true, detail: `Planted ${given} · ${f.hectares} of ${f.hectares} ha` });
  });

  it("judges the planting window on the day planted, not on today", () => {
    const late = { ...f, planting: { date: "2027-03-25", hectares: 0.5 } };
    expect(check(late, "window")).toMatchObject({ ok: false, detail: "Planted 2027-03-25, after the window closed 2027-03-20" });
    expect(check({ ...f, planting: { date: "2027-03-19", hectares: 0.5 } }, "window").ok).toBe(true);
    expect(check({ ...f, planting: undefined }, "window").ok).toBe(false);
  });

  it("cannot be recorded as planted without the record, on the server as on the screen", () => {
    const ticked = { ...f, checks: { ...f.checks, "plant.manner": true, "plant.followup": true } };
    expect(stepRefusal(ticked, { ...ticked, step: "complete" }, ["extension"], { ...ctx, today: given })).toMatch(/Not done: Planting date and area recorded; Planted within the planting window/);
    const recorded = { ...ticked, planting: { date: given, hectares: f.hectares } };
    expect(stepRefusal(recorded, { ...recorded, step: "complete" }, ["extension"], { ...ctx, today: given })).toBeNull();
  });

  it("a seeded farmer who has planted carries the record", () => {
    expect(at("complete").planting).toMatchObject({ hectares: at("complete").hectares });
  });
});

describe("a target counted at planting", () => {
  it("is on only with a target and the planting choice", () => {
    expect(countsAtPlanting({ target: "IND-2", targetAt: "planting" })).toBe(true);
    expect(countsAtPlanting({ target: "IND-2" })).toBe(false);
    expect(countsAtPlanting({ targetAt: "planting" })).toBe(false);
  });

  it("makes one result for the farmer, dated the day planted, with the planting record as proof", () => {
    const r = resultForPlanting({ id: "F-0002", community: "Village B", gender: "Female", planting: { date: "2027-03-01", hectares: 0.8 } }, "IND-2", { crop: "Maize", recordedBy: "Farida Noori", unit: "farmers" });
    expect(r).toMatchObject({ indicator: "IND-2", date: "2027-03-01", value: 1, female: 1, male: 0, district: "Village B", planting: "F-0002" });
    expect(r.note).toBe("Farmer F-0002 in Village B planted 0.8 ha of maize on 2027-03-01. Recorded by Farida Noori.");
    expect(proofCount(r)).toBe(1);
    expect(resultSchema.safeParse(r).success).toBe(true);
  });
});

describe("a crop counted one by one", () => {
  const grapes = { by: "count" as const, unit: "vines", rowM: 3, plantM: 1.5 };
  const f = at("plant");
  const given = handedOutOn(f)!;

  it("checks the count and the area worked out from it", () => {
    expect(plantingProblem({ ...f, planting: { date: given, count: 0, hectares: 0 } }, "2099-01-01")).toMatch(/how many were planted/);
    expect(plantingProblem({ ...f, planting: { date: given, count: 1.5, hectares: 0.01 } }, "2099-01-01")).toMatch(/whole number/);
    expect(plantingProblem({ ...f, hectares: 0.5, planting: { date: given, count: 2000, hectares: 0.9 } }, "2099-01-01")).toMatch(/^2,000 planted at this spacing takes 0.9 ha, more than the farmer's plot \(0.5 ha\)/);
    expect(plantingProblem({ ...f, hectares: 0.5, planting: { date: given, count: 1000, hectares: 0.45 } }, "2099-01-01")).toBeNull();
  });

  it("adds vines to a target in vines, hectares to one in hectares, and one farmer otherwise", () => {
    const planting = { date: "2027-03-01", count: 1000, hectares: 0.45 };
    const base = { id: "F-1", community: "Village B", gender: "Male", planting };
    expect(resultForPlanting(base, "IND-3", { recordedBy: "Farida Noori", unit: "vines", plan: grapes })).toMatchObject({ value: 1000 });
    expect(resultForPlanting(base, "IND-3", { recordedBy: "Farida Noori", unit: "vines", plan: grapes }).male).toBeUndefined();
    expect(resultForPlanting(base, "IND-4", { recordedBy: "Farida Noori", unit: "hectares", plan: grapes })).toMatchObject({ value: 0.45 });
    expect(resultForPlanting(base, "IND-2", { crop: "Grapes", recordedBy: "Farida Noori", unit: "trellis systems", plan: grapes })).toMatchObject({ value: 1, male: 1, female: 0 });
    expect(resultForPlanting(base, "IND-2", { crop: "Grapes", recordedBy: "Farida Noori", unit: "farmers", plan: grapes }).note).toBe("Farmer F-1 in Village B planted 1,000 vines on 0.45 ha of grapes on 2027-03-01. Recorded by Farida Noori.");
  });
});
