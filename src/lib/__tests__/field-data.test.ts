import { describe, expect, it } from "vitest";
import { fieldSteps, seedField, type Farmer } from "@/lib/field";
import { farmerTable, toCsv } from "@/lib/field-data";

const farmers = seedField().filter((i): i is Farmer => i.kind === "farmer");
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
