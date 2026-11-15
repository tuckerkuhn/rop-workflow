import { describe, expect, it } from "vitest";
import { DEMO_LINES, DEMO_RESULT_TARGETS, DEMO_TARGET_PLACES, demoResults, demoTakesResults, demoActivities, demoBudget, demoFramework, demoMonths, demoSpending, demoWorkplan } from "@/lib/demo-design";
import { workplanOfProcurement } from "@/lib/connections";
import { users } from "@/lib/demo";
import { ancestors } from "@/lib/framework";
import { DEMO_SETUP } from "@/lib/package";
import { DONE, seedProcurements, stepById, stages, valueOf } from "@/lib/procurement";
import { seedField } from "@/lib/field";
import { indicators, seedSubmissions } from "@/lib/project";
import { resultSchema } from "@/lib/results";

const TODAY = "2026-11-14";
const START = "2026-10-01";
const codes = new Set(DEMO_LINES.map((l) => l.code));

describe("the demo project's design holds together", () => {
  it("has a budget line for every purchase and every item in the input package", () => {
    for (const p of seedProcurements()) expect(codes, `${p.id} is bought on line ${p.budgetLine}`).toContain(p.budgetLine);
    for (const i of DEMO_SETUP.items) expect(codes, `${i.item} is bought on line ${i.budgetLine}`).toContain(i.budgetLine);
  });

  it("marks the lines purchases are made on as lines to procure", () => {
    const bought = new Set(seedProcurements().map((p) => p.budgetLine));
    for (const l of DEMO_LINES.filter((x) => bought.has(x.code))) expect(l.procure, l.code).toBe(true);
  });

  it("budgets enough on each line for the purchases made on it", () => {
    for (const l of DEMO_LINES) {
      const asked = seedProcurements().filter((p) => p.budgetLine === l.code).reduce((s, p) => s + valueOf(p), 0);
      expect(asked, `line ${l.code}`).toBeLessThanOrEqual(l.total);
    }
  });

  it("shows as spent on seed and fertilizer what the paid purchases cost", () => {
    const paid = (lineCode: string) =>
      seedProcurements()
        .filter((p) => p.budgetLine === lineCode && (p.step === DONE || (stepById[p.step]?.stage ?? 0) >= stages.indexOf("Close")))
        .reduce((s, p) => s + valueOf(p), 0);
    const bva = demoSpending(START, TODAY)!;
    for (const c of ["2.1", "2.2"]) expect(bva.lines.find((l) => l.code === c)!.actual, `line ${c}`).toBe(paid(c));
  });

  it("places each target under a level the framework has words for, and on a workplan row and budget line that exist", () => {
    const fw = demoFramework(TODAY);
    const rows = new Set(demoWorkplan(TODAY).map((w) => w.code));
    for (const [ind, place] of Object.entries(DEMO_TARGET_PLACES)) {
      expect(indicators.some((i) => i.id === ind), ind).toBe(true);
      const chain = ancestors(place.donorCode);
      expect(chain.length, `${ind} has a place`).toBeGreaterThan(0);
      for (const key of chain.slice(0, 2)) expect(fw.nodes[key]?.text, `${ind}: level ${key}`).toBeTruthy();
      if (place.workplanCode) expect(rows, ind).toContain(place.workplanCode);
      if (place.budgetRef) expect(codes, ind).toContain(place.budgetRef);
    }
  });

  it("gives every workplan row an owner who is on the demo team, and work in this quarter or the next", () => {
    const book = demoActivities(TODAY);
    for (const w of demoWorkplan(TODAY)) {
      expect(users.some((u) => u.id === book.items[w.code]?.owner), w.code).toBe(true);
      expect(["2026-10-01", "2027-01-01"]).toContain(w.active[0]);
      for (const q of Object.keys(w.targets)) expect(w.active).toContain(q);
    }
  });

  it("ties every purchase to the workplan row it serves, through its budget line", () => {
    const lines = demoBudget(TODAY).lines;
    const plan = demoWorkplan(TODAY);
    for (const p of seedProcurements()) expect(workplanOfProcurement(p, [], plan, lines), `${p.id} on line ${p.budgetLine}`).toBe(p.budgetLine === "3.1" ? "1.2.2.1" : "1.2.1.1");
  });

  it("imports spending for the months that have ended, and none before one has", () => {
    expect(demoMonths(START, TODAY)).toEqual(["2026-10"]);
    expect(demoMonths(START, "2027-03-04")).toEqual(["2026-10", "2026-11", "2026-12", "2027-01", "2027-02"]);
    expect(demoMonths(START, "2028-01-10")).toHaveLength(6);
    expect(demoSpending(START, "2026-10-20")).toBeNull();
  });

  it("adds up: each line's months to its total, and the lines to the grand total", () => {
    for (const today of [TODAY, "2027-03-04"]) {
      const bva = demoSpending(START, today)!;
      for (const l of bva.lines) expect(Object.values(l.months).reduce((a, b) => a + b, 0)).toBe(l.actual);
      expect(bva.totals.grand!.actual).toBe(bva.lines.reduce((s, l) => s + l.actual, 0));
      expect(bva.totals.grand!.budget).toBe(demoBudget(today).lines.reduce((s, l) => s + l.total, 0));
    }
  });

  it("leaves exactly one line over budget, so there is one to explain", () => {
    const bva = demoSpending(START, TODAY)!;
    expect(bva.lines.filter((l) => l.actual > l.budget).map((l) => l.code)).toEqual(["4.3"]);
  });
});

describe("the demo's field records count as results", () => {
  const subs = seedSubmissions(seedField());
  const made = demoResults(subs);

  it("makes one result per record that counts, and none for a plot that failed its readiness check", () => {
    const failed = subs.filter((s) => s.form === "readiness" && s.fields.result !== "Yes").length;
    // A distribution the manager has not approved yet becomes a result when she does, not before.
    const waiting = subs.filter((s) => s.form === "distribution" && s.status === "pending").length;
    expect(waiting).toBeGreaterThan(0);
    expect(made).toHaveLength(subs.length - failed - waiting);
    for (const form of ["training", "distribution", "readiness", "visit"] as const)
      expect(made.filter((r) => r.payload.indicator === DEMO_RESULT_TARGETS[form]).length, form).toBe(subs.filter((s) => s.form === form && (form !== "readiness" || s.fields.result === "Yes") && !(form === "distribution" && s.status === "pending")).length);
  });

  it("keeps what MEL had decided: accepted stays accepted, waiting stays waiting", () => {
    expect(made.filter((r) => r.status === "accepted").length).toBe(subs.filter((s) => s.status === "accepted" && (s.form !== "readiness" || s.fields.result === "Yes")).length);
    expect(made.some((r) => r.status === "pending")).toBe(true);
    for (const r of made.filter((x) => x.status === "accepted")) expect(r.reviewedBy).toBe("omar");
    // Nobody checks their own record: the MEL officer accepts what the field team recorded.
    for (const r of made) expect(r.by).not.toBe("omar");
  });

  it("writes every result so the app would accept it, with or without its proof file", () => {
    const file = { hash: "a".repeat(64), name: "Attendance sheet (sample).pdf", type: "application/pdf", size: 900 };
    for (const r of [...made, ...demoResults(subs, Object.fromEntries(subs.map((s) => [s.id, file])))]) expect(resultSchema.safeParse(r.payload).success, r.payload.note).toBe(true);
  });

  it("never carries a farmer's name: numbers and the village only", () => {
    const names = seedField().flatMap((i) => (i.kind === "farmer" ? i.name.split(/\s+/) : []));
    expect(names.length).toBeGreaterThan(10);
    for (const r of made) for (const n of names) expect(r.payload.note).not.toContain(n);
  });

  it("gives each of the four field targets results, and leaves the survey target alone", () => {
    for (const i of indicators) expect(demoTakesResults(i.id), i.id).toBe(i.source !== "survey");
  });
});
