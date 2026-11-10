import { describe, expect, it } from "vitest";
import type { Grid } from "@/lib/budget";
import { byCode, byDescription, counts, guessMapping, matchGroups, monthOfCell, readRows, sampleForAi, signatureOf, toBva, type BudgetRef } from "@/lib/spend-map";
import { spentIn } from "@/lib/bva";

/** A synthetic accounting export. The names are invented. */
const grid: Grid = [
  ["Sandbox Org: Transaction detail"],
  ["Account", "Description", "Name", "Date", "Amount"],
  ["PRG-1.1", "Training venue", "Zarmal Noorzad", "07/15/2026", 100],
  ["PRG-1.1", "Trainer fee", "Torpekai Sahak", "08/20/2026", 250.5],
  ["6100", "Office rent", "Sandbox Landlord", "08/01/2026", 300],
  ["7200", "Bank charges", "", "09/03/2026", 12],
  ["Total", "", "", "", 662.5],
];
const budget: BudgetRef[] = [
  { code: "PRG-1.1", description: "Farmer training", amount: 1000, currency: "USD" },
  { code: "OPS-1", description: "Office rent", amount: 3600, currency: "USD" },
];

describe("what goes to the AI: headings and a few rows, names removed", () => {
  const sample = sampleForAi(grid);
  it("blanks every value under a heading that names people", () => {
    expect(sample[1][2]).toBe("Name");
    expect(sample.slice(2).map((r) => r[2])).toEqual(["[name]", "[name]", "[name]", "", ""]);
    expect(JSON.stringify(sample)).not.toMatch(/Zarmal|Torpekai|Landlord/);
  });
  it("replaces names inside other text cells", () => {
    const s = sampleForAi([["Account", "Details"], ["6100", "Rent paid to Haji Baryal Noorzad"]]);
    expect(s[1][1]).toBe("Rent paid to a farmer");
  });
  it("sends no more rows than asked and shortens long cells", () => {
    const long = sampleForAi([["Account"], ...Array.from({ length: 40 }, () => ["x".repeat(200)])], 5);
    expect(long.length).toBe(5);
    expect(long[1][0].length).toBe(60);
  });
});

describe("reading dates", () => {
  it("reads the month from the forms exports use", () => {
    expect(monthOfCell("2026-10-03", false)).toBe("2026-10");
    expect(monthOfCell("10/03/2026", false)).toBe("2026-10");
    expect(monthOfCell("10/03/2026", true)).toBe("2026-03");
    expect(monthOfCell("Oct 2026", false)).toBe("2026-10");
    expect(monthOfCell("Oct-26", false)).toBe("2026-10");
    expect(monthOfCell(46300, false)).toBe("2026-10");
    expect(monthOfCell("13/13/2026", false)).toBeNull();
    expect(monthOfCell("soon", false)).toBeNull();
  });
});

describe("matching accounts to budget lines", () => {
  it("matches by code, the longest code first", () => {
    const lines: BudgetRef[] = [{ code: "A-11", description: "", amount: 1, currency: "USD" }, { code: "A-111", description: "", amount: 1, currency: "USD" }];
    expect(byCode(["A-111 Tools"], lines)).toBe("A-111");
    expect(byCode(["A-11 Seeds"], lines)).toBe("A-11");
    expect(byCode(["B-9"], lines)).toBeNull();
  });
  it("matches by description only when clearly the same", () => {
    expect(byDescription(["6100 Office rent"], budget)).toBe("OPS-1");
    expect(byDescription(["Bank charges"], budget)).toBeNull();
  });
});

describe("import from any spreadsheet, end to end", () => {
  const mapping = guessMapping(grid, null);
  it("guesses the header row and columns from the headings", () => {
    expect(mapping.headerRow).toBe(1);
    expect(mapping.columns).toMatchObject({ code: 0, description: 1, date: 3, amount: 4 });
  });
  const read = readRows(grid, mapping, "USD");
  it("reads rows, skips the total row and adds up by account and month", () => {
    expect(read.problems).toEqual([]);
    expect(read.rows).toBe(4);
    expect(read.months).toEqual(["2026-07", "2026-08", "2026-09"]);
    const prg = read.groups.find((g) => g.key === "prg-1.1")!;
    expect(prg.total).toBe(350.5);
    expect(prg.months).toEqual({ "2026-07": 100, "2026-08": 250.5 });
    expect(read.notes.some((n) => /1 total row was skipped/.test(n))).toBe(true);
  });
  const groups = matchGroups(read, budget, {}, { confirmed: [], assign: {} });
  it("matches by code, then by description, and leaves the rest unmatched", () => {
    expect(groups.find((g) => g.key === "prg-1.1")).toMatchObject({ line: "PRG-1.1", how: "code" });
    expect(groups.find((g) => g.key === "6100")).toMatchObject({ line: "OPS-1", how: "description" });
    expect(groups.find((g) => g.key === "7200")).toMatchObject({ line: null, how: "none" });
  });
  it("a description match counts only once a person has ticked it", () => {
    const rent = groups.find((g) => g.key === "6100")!;
    expect(counts(rent, new Set())).toBe(false);
    expect(counts(rent, new Set(["6100"]))).toBe(true);
  });
  it("keeps every amount: matched lines under their budget code, the rest marked for pre-flight", () => {
    const bva = toBva(read, groups, budget, new Set(["6100"]), "export.csv");
    expect(bva.lines.find((l) => l.code === "PRG-1.1")).toMatchObject({ actual: 350.5, budget: 1000 });
    expect(bva.lines.find((l) => l.code === "OPS-1")).toMatchObject({ actual: 300, budget: 3600 });
    expect(bva.lines.find((l) => l.code.startsWith("?"))).toMatchObject({ code: "?7200", actual: 12, budget: 0 });
    expect(bva.totals.grand!.actual).toBe(662.5);
    expect(spentIn(bva, "2026-07", "2026-09").total).toBe(662.5);
  });
  it("an unticked description match stays unmatched, so nothing is counted on a guess", () => {
    const bva = toBva(read, groups, budget, new Set(), "export.csv");
    expect(bva.lines.find((l) => l.code === "OPS-1")).toBeUndefined();
    expect(bva.lines.filter((l) => l.code.startsWith("?")).length).toBe(2);
    expect(bva.totals.grand!.actual).toBe(662.5);
  });
  it("leaves out an account the person chose to skip, and follows an assignment", () => {
    const g2 = matchGroups(read, budget, {}, { confirmed: [], assign: { "7200": "skip", "6100": "OPS-1" } });
    expect(g2.find((g) => g.key === "7200")!.how).toBe("skipped");
    expect(g2.find((g) => g.key === "6100")).toMatchObject({ line: "OPS-1", how: "assigned" });
    expect(toBva(read, g2, budget, new Set(), "export.csv").totals.grand!.actual).toBe(650.5);
  });
  it("remembers last month's choices, unless a budget line no longer exists", () => {
    const g3 = matchGroups(read, budget, { "7200": "OPS-1", "6100": "GONE-1" }, { confirmed: [], assign: {} });
    expect(g3.find((g) => g.key === "7200")).toMatchObject({ line: "OPS-1", how: "remembered" });
    expect(g3.find((g) => g.key === "6100")!.how).toBe("description");
  });
  it("refuses a file in another currency than the budget", () => {
    expect(readRows(grid, mapping, "AFN").problems).toEqual([]);
    const withCur: Grid = [["Account", "Date", "Amount", "Currency"], ["PRG-1.1", "2026-07-01", 5, "AFN"]];
    expect(readRows(withCur, guessMapping(withCur, null), "USD").problems.some((p) => /The file is in AFN/.test(p))).toBe(true);
  });
  it("recognises the same export next month by its headings", () => {
    expect(signatureOf(["Account", " Description ", "Amount"])).toBe(signatureOf(["account", "description", "AMOUNT"]));
  });
});
