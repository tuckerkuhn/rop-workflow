import { describe, expect, it } from "vitest";
import { FARMER_TEMPLATE, csvRows, parseFarmers } from "@/lib/farmer-import";
import { DEMO_SETUP, describePackage, keyFrom, setupProblem } from "@/lib/package";

describe("parseFarmers: a farmer list saved from Excel", () => {
  it("reads the template", () => {
    const r = parseFarmers(FARMER_TEMPLATE);
    expect(r.problems).toEqual([]);
    expect(r.rows).toEqual([{ id: "F-1001", village: "Example village", gender: "Female", hectares: 0.5, ageBand: "36–49", householdSize: 3, household: [{ sex: "Female", age: 34 }, { sex: "Male", age: 40 }, { sex: "Female", age: 6 }], contributionPaid: true, step: "train" }]);
    expect(r.hasNames).toBe(false);
  });
  it("accepts other column names, quotes, semicolons and ages as numbers", () => {
    const r = parseFarmers('code;community;gender;ha;full name;age\nX-1;"Kot, upper";m;1,5;Test Person;24\n');
    expect(r.rows[0]).toMatchObject({ id: "X-1", village: "Kot, upper", gender: "Male", hectares: 1.5, name: "Test Person", ageBand: "18–35 (youth)" });
    expect(r.hasNames).toBe(true);
  });
  it("leaves out bad rows and says why, by Excel row number", () => {
    const r = parseFarmers("Farmer ID,Village,Sex,Hectares,Step\nF-1,A,F,1,\nF-1,A,F,1,\nF 2,,X,abc,harvest\n");
    expect(r.rows.map((x) => x.id)).toEqual(["F-1"]);
    expect(r.problems[0]).toMatch(/^Row 3: F-1 appears twice/);
    expect(r.problems[1]).toMatch(/^Row 4: .*ID.*no village.*sex "X".*hectares "abc".*step "harvest"/);
  });
  it("says which required columns are missing", () => {
    expect(parseFarmers("Farmer ID,Village\nF-1,A\n").problems[0]).toMatch(/Missing: sex, hectares/);
  });
  it("splits CSV with quoted quotes and line breaks", () => {
    expect(csvRows('a,"b ""c"""\r\n\r\nd,e')).toEqual([["a", 'b "c"'], ["d", "e"]]);
  });
});

describe("setupProblem: a package a manager can save", () => {
  it("accepts the demo package", () => {
    expect(setupProblem(DEMO_SETUP)).toBeNull();
    expect(describePackage(DEMO_SETUP)).toBe("10 kg Certified maize seed and 50 kg NPK 17-17-17");
  });
  it("names what is missing", () => {
    const item = { key: "c", item: "Cuttings", unit: "cuttings", qty: 1, per: "hectare" as const, budgetLine: "A" };
    expect(setupProblem({ items: [] })).toMatch(/at least one item/);
    expect(setupProblem({ items: [{ ...item, budgetLine: "" }] })).toMatch(/budget line/);
    expect(setupProblem({ items: [{ ...item, qty: 0 }] })).toMatch(/amount above zero/);
    expect(setupProblem({ items: [item, item] })).toMatch(/share the short id/);
  });
  it("makes short ids from item names", () => {
    expect(keyFrom("Drip irrigation kit")).toBe("drip_irrigation_kit");
    expect(keyFrom("2 m trellis posts")).toBe("i2_m_trellis_posts");
  });
});

describe("young people are 35 and younger", () => {
  it("bands ages at 35 and reads older records safely", async () => {
    const { isYouth } = await import("@/lib/field");
    const band = (age: number) => parseFarmers(`id,village,sex,hectares,age\nA-1,V,f,1,${age}\n`).rows[0].ageBand;
    expect(band(35)).toBe("18–35 (youth)");
    expect(band(36)).toBe("36–49");
    expect(band(50)).toBe("50+");
    expect(isYouth("18–35 (youth)")).toBe(true);
    expect(isYouth("18–29 (youth)")).toBe(true);
    expect(isYouth("36–49")).toBe(false);
    expect(isYouth("30–49")).toBeNull();
  });
});
