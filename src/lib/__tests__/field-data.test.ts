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

import { recordTable, type FieldRecord } from "@/lib/field-data";

describe("the field records table: one row per record", () => {
  const rec = (over: Partial<FieldRecord>): FieldRecord => ({ id: "R-1", form: "visit", farmerId: "F-0001", date: "2026-11-01", source: "KoboCollect", collector: "farida", status: "accepted", removed: false, decidedBy: "rahima", decidedOn: "2026-11-04", photo: true, fields: {}, ...over });
  const title = (f: string) => ({ visit: "Farm visit", training: "Training attendance" })[f] ?? f;

  it("keeps every record, so a farmer visited twice has two rows", () => {
    const t = recordTable([rec({ id: "R-2", date: "2026-11-09" }), rec({ id: "R-1" })], title);
    expect(t.rows.map((r) => [r[0], r[2], r[3]])).toEqual([["R-1", "F-0001", "2026-11-01"], ["R-2", "F-0001", "2026-11-09"]]);
  });
  it("says who collected, who decided and how long it waited", () => {
    const t = recordTable([rec({})], title);
    const row = Object.fromEntries(t.headers.map((h, i) => [h, t.rows[0][i]]));
    expect(row).toMatchObject({ "Collected with": "KoboCollect", "Collected by": "farida", Decision: "Accepted", "Decided by": "rahima", "Days to decision": "3", "Still in KoboToolbox": "Yes" });
  });
  it("leaves the wait empty while a record is still waiting", () => {
    const t = recordTable([rec({ status: "pending", decidedBy: "", decidedOn: "" })], title);
    expect(t.rows[0][t.headers.indexOf("Days to decision")]).toBe("");
    expect(t.rows[0][t.headers.indexOf("Decision")]).toBe("Waiting");
  });
  it("gives each form's answers their own columns, filled only for that form", () => {
    const t = recordTable([rec({ fields: { planted_as_trained: "Yes" } }), rec({ id: "T-1", form: "training", fields: { attended: "Yes", session: "Land preparation" } })], title);
    expect(t.headers.slice(12)).toEqual(["Training attendance: attended", "Training attendance: session", "Farm visit: planted as trained"]);
    const visit = t.rows.find((r) => r[0] === "R-1")!;
    expect(visit.slice(12)).toEqual(["", "", "Yes"]);
    expect(t.rows.every((r) => r.length === t.headers.length)).toBe(true);
  });
  it("has no column for a name", () => {
    expect(recordTable([rec({})], title).headers.some((h) => /name/i.test(h))).toBe(false);
  });
});
