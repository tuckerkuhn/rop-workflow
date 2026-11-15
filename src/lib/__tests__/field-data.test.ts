import { describe, expect, it } from "vitest";
import { fieldSteps, seedField, type Farmer, type FieldItem } from "@/lib/field";
import { farmerTable, stepKey, stepKind, stepResult, stepResults, toCsv } from "@/lib/field-data";
import { resultSchema } from "@/lib/results";

const farmers = seedField().filter((i): i is Farmer => i.kind === "farmer");
const f = farmers.find((x) => x.id === "F-0007")!;
const move = (id: string, from: string, to: string) => ({ before: new Map([[id, from]]), items: [{ ...farmers.find((x) => x.id === id)!, step: to }] as FieldItem[] });
const base = { setup: { targets: { training: "IND-1", readiness: "IND-3", visit: "IND-4" } }, taken: new Set<string>(), countable: new Set(["IND-1", "IND-3", "IND-4"]), date: "2026-11-15", by: "Farida Noori" };

describe("a recorded field step becomes one result", () => {
  it("knows which moves complete a step a project can count", () => {
    expect(stepKind("train", "prepare")).toBe("training");
    expect(stepKind("verify", "distribute")).toBe("readiness");
    expect(stepKind("correct", "distribute")).toBe("readiness");
    expect(stepKind("plant", "complete")).toBe("visit");
    // Not ready, a removal, the distribution itself (the manager's approval counts that one).
    expect(stepKind("verify", "correct")).toBeNull();
    expect(stepKind("distribute", "plant")).toBeNull();
    expect(stepKind(undefined, "train")).toBeNull();
  });

  it("only uses moves the workflow allows", () => {
    for (const [from, to] of [["train", "prepare"], ["verify", "distribute"], ["correct", "distribute"], ["plant", "complete"]]) expect(fieldSteps[from].outcomes.some((o) => o.to === to), `${from} to ${to}`).toBe(true);
  });

  it("makes a result the app accepts, by number and village, tied to the farmer and step", () => {
    const r = stepResult(f, "training", "2026-11-15", "Farida Noori", "IND-1");
    expect(resultSchema.safeParse(r).success).toBe(true);
    expect(r).toMatchObject({ indicator: "IND-1", value: 1, date: "2026-11-15", fieldStep: "F-0007:training", district: f.community });
    expect(r.note).toBe(`Farmer F-0007 completed the land preparation training in ${f.community}. Recorded in Field activities by Farida Noori.`);
    for (const part of f.name.split(/\s+/)) expect(r.note).not.toContain(part);
  });

  it("counts the step once: not again when it is already counted, not when the project has not named a target", () => {
    expect(stepResults({ ...base, ...move("F-0007", "train", "prepare") })).toHaveLength(1);
    expect(stepResults({ ...base, ...move("F-0007", "train", "prepare"), taken: new Set([stepKey("F-0007", "training")]) })).toEqual([]);
    expect(stepResults({ ...base, ...move("F-0007", "train", "prepare"), setup: { targets: { readiness: "IND-3" } } })).toEqual([]);
    expect(stepResults({ ...base, ...move("F-0007", "train", "prepare"), setup: null })).toEqual([]);
    // A target that does not take recorded results (or no longer exists) is not written to.
    expect(stepResults({ ...base, ...move("F-0007", "train", "prepare"), countable: new Set(["IND-3"]) })).toEqual([]);
    // A move that completes nothing countable.
    expect(stepResults({ ...base, ...move("F-0007", "verify", "correct") })).toEqual([]);
  });
});

describe("the farmer table", () => {
  const given = [{ farmerId: "F-0001", date: "2026-11-01", status: "accepted", items: [{ key: "seed", item: "Certified maize seed", unit: "kg", qty: 10 }, { key: "npk", item: "NPK 17-17-17", unit: "kg", qty: 50 }] }];
  const t = farmerTable(seedField(), given, (s) => fieldSteps[s]?.title ?? s);
  const col = (name: string) => t.headers.indexOf(name);
  const row = (id: string) => t.rows.find((r) => r[0] === id)!;

  it("has one row per farmer, every row as wide as the headings", () => {
    expect(t.rows).toHaveLength(farmers.length);
    for (const r of t.rows) expect(r).toHaveLength(t.headers.length);
  });

  it("never carries a name", () => {
    const text = toCsv(t);
    for (const x of farmers) for (const part of x.name.split(/\s+/)) expect(text).not.toContain(part);
    expect(t.headers.some((h) => /name/i.test(h))).toBe(false);
  });

  it("shows what a farmer received beside how their season went", () => {
    const r = row("F-0001");
    expect(r[col("Package given on")]).toBe("2026-11-01");
    expect(r[col("Package approved")]).toBe("Yes");
    expect(r[col("Certified maize seed (kg)")]).toBe("10");
    expect(r[col("NPK 17-17-17 (kg)")]).toBe("50");
    expect(r[col("Trained on")]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("says whether a plot was ready at the first check, and how many corrections it took", () => {
    const corrected = farmers.find((x) => x.timeline.some((e) => e.what.startsWith("Readiness: No")))!;
    expect(row(corrected.id)[col("Ready at first check")]).toBe("No");
    expect(Number(row(corrected.id)[col("Corrections needed")])).toBeGreaterThan(0);
    const untested = farmers.find((x) => !x.timeline.some((e) => e.what.startsWith("Readiness: ")))!;
    expect(row(untested.id)[col("Ready at first check")]).toBe("");
  });

  it("writes a file a spreadsheet opens safely", () => {
    const csv = toCsv({ headers: ["a", "b"], rows: [['He said "hi"', "x,y"], ["=SUM(A1)", "-5"], ["line\nbreak", "@cmd"]] });
    expect(csv).toBe('a,b\r\n"He said ""hi""","x,y"\r\n\'=SUM(A1),-5\r\n"line\nbreak",\'@cmd\r\n');
  });
});
