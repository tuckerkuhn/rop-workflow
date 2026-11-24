import { describe, expect, it } from "vitest";
import type { Entry, HrState } from "@/lib/hr";
import { foldTraining, logRows, recordSchema, standing, type TrainingRecord } from "@/lib/training";

const hr = {
  rules: { holders: { hr: ["sima"] } },
  people: { yusuf: { id: "yusuf", current: { supervisor: "karim", startDate: "2025-01-10" } }, zara: { id: "zara", current: { supervisor: "nadia", startDate: "2026-11-01" } } },
} as unknown as HrState;
let n = 0;
const entry = (actor: string, kind: string, subject: string | null, data: unknown): Entry => ({ n: ++n, at: "2026-11-20T10:00:00Z", actor, kind, subject, data, hash: "", prevHash: "" });
const rec = { date: "2026-10-01", kind: "anti-fraud", topic: "Yearly refresher", deliveredBy: "Home Office", method: "home-office", hours: 2 };

describe("training log", () => {
  it("HR and the supervisor record training; others are ignored; a self-recorded one needs its proof", () => {
    const { records, ignored } = foldTraining(
      [
        entry("sima", "training", "yusuf", rec),
        entry("karim", "training", "yusuf", { ...rec, kind: "finance-procurement", topic: "Bank reconciliation" }),
        entry("nadia", "training", "yusuf", rec),
        entry("yusuf", "training", "yusuf", rec),
        entry("yusuf", "training", "yusuf", { ...rec, proof: { hash: "a".repeat(64), name: "cert.pdf", type: "application/pdf", size: 10 } }),
      ],
      hr,
    );
    expect(records).toHaveLength(3);
    expect(ignored.map((i) => i.actor)).toEqual(["nadia", "yusuf"]);
    expect(records.find((r) => r.self)?.proof).toBeTruthy();
  });

  it("a withdrawn record stays in the log, marked, and no longer counts", () => {
    n = 100;
    const e1 = entry("sima", "training", "yusuf", rec);
    const { records } = foldTraining([e1, entry("karim", "training-void", "yusuf", { record: e1.n, why: "Wrong person" }), entry("sima", "training-void", "yusuf", { record: e1.n, why: "Recorded for the wrong person" })], hr);
    expect(records[0].voided?.by).toBe("sima");
    const s = standing("yusuf", "2025-01-10", records, [], "2026-11-24", "2025-11-01");
    expect(s.antiFraud.last).toBe("");
  });

  it("donor rules name the donor, and paid outside training needs the CEO's approval first", () => {
    expect(recordSchema.safeParse({ ...rec, kind: "donor-rules" }).success).toBe(false);
    expect(recordSchema.safeParse({ ...rec, kind: "donor-rules", donor: "UNDP" }).success).toBe(true);
    expect(recordSchema.safeParse({ ...rec, method: "paid-external" }).success).toBe(false);
    expect(recordSchema.safeParse({ ...rec, method: "paid-external", ceoApproved: "2026-10-02" }).success).toBe(false);
    expect(recordSchema.safeParse({ ...rec, method: "paid-external", ceoApproved: "2026-09-20" }).success).toBe(true);
  });

  it("induction is due 30 days after starting; refreshers a year after the last; nothing is due before the policy took effect", () => {
    const none: TrainingRecord[] = [];
    // No policy date yet: nothing is called overdue.
    expect(standing("zara", "2026-11-01", none, [], "2026-12-15").induction.state).toBe("unknown");
    // A new hire after the policy: induction due by day 30, then overdue.
    expect(standing("zara", "2026-11-01", none, [], "2026-11-20", "2026-06-01").induction).toMatchObject({ state: "due", by: "2026-12-01" });
    expect(standing("zara", "2026-11-01", none, [], "2026-12-15", "2026-06-01").overdue).toBe(3);
    // An older hand: no induction finding, refreshers due a year after the policy took effect.
    const old = standing("yusuf", "2025-01-10", none, [], "2026-11-24", "2025-11-01");
    expect(old.induction.state).toBe("unknown");
    expect(old.antiFraud).toMatchObject({ state: "overdue", by: "2026-11-01" });
    // A refresher last month: done, due again next year.
    const { records } = foldTraining([entry("sima", "training", "yusuf", rec)], hr);
    const s = standing("yusuf", "2025-01-10", records, [], "2026-11-24", "2025-11-01");
    expect(s.antiFraud).toMatchObject({ state: "done", by: "2027-10-01" });
    expect(s.donorRules.state).toBe("overdue");
    expect(s.hoursThisYear).toBe(2);
  });

  it("the year's priorities are written by the supervisor or HR, at most three", () => {
    const plan = { year: 2026, priorities: [{ what: "Close the books", how: "Coaching" }] };
    const { plans, ignored } = foldTraining([entry("yusuf", "training-plan", "yusuf", plan), entry("karim", "training-plan", "yusuf", plan)], hr);
    expect(plans).toHaveLength(1);
    expect(ignored).toHaveLength(1);
    expect(standing("yusuf", "2025-01-10", [], plans, "2026-11-24").plan.agreed).toBe(true);
  });

  it("downloads for an auditor with the withdrawal shown", () => {
    const { records } = foldTraining([entry("sima", "training", "yusuf", rec)], hr);
    const t = logRows(records, (id) => id.toUpperCase());
    expect(t.headers).toContain("Proof");
    expect(t.rows[0][0]).toBe("YUSUF");
  });
});
