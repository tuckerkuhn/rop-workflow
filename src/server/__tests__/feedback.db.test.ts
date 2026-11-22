import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import { ready } from "@/server/__tests__/test-db";
import { auditTrail } from "@/server/audit";
import { seedDatabase } from "@/server/demo-seed";
import { actOnFeedback, loadFeedback } from "@/server/feedback-store";
import { reportCalendar } from "@/server/report-calendar";

/** The feedback and complaints log, and the report calendar, on the seeded demo project. */
const code = "A-2027";
const users = ["marcus", "omar", "bilal", "farida"].map((id) => userById(id)!).filter(Boolean);
const approver = users.find((u) => u.admin || u.project.includes("plan-approver"))!;
const others = users.filter((u) => u.kind === "employee" && !u.admin && !u.project.includes("plan-approver"));

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("feedback and complaints log", { timeout: 60_000 }, () => {
  it("records, withholds a serious matter and takes one answer", async () => {
    const [recorder, reader] = others;
    expect(recorder && reader && approver).toBeTruthy();
    expect((await loadFeedback(code, recorder)).entries).toHaveLength(0);
    expect(await actOnFeedback(code, { action: "record", date: "2026-10-01", kind: "complaint", from: "farmer", channel: "in person", place: "Kama", about: "The trellis posts were shorter than promised.", serious: false }, recorder)).toBeNull();
    expect(await actOnFeedback(code, { action: "record", date: "2026-10-02", kind: "complaint", from: "community member", channel: "phone", place: "", about: "A staff member asked for payment to be put on the list.", serious: true }, recorder)).toBeNull();
    expect(await actOnFeedback(code, { action: "record", date: "2999-01-01", kind: "question", from: "farmer", channel: "phone", place: "", about: "When does the training start?", serious: false }, recorder)).toMatch(/future/);

    const seen = await loadFeedback(code, reader);
    expect(seen.entries).toHaveLength(2);
    const serious = seen.entries.find((e) => e.serious)!;
    expect(serious.withheld).toBe(true);
    expect(serious.about).toBe("");
    expect((await loadFeedback(code, recorder)).entries.find((e) => e.serious)!.about).toMatch(/payment/);
    expect((await loadFeedback(code, approver)).entries.find((e) => e.serious)!.withheld).toBe(false);

    // Someone who cannot read a serious matter cannot answer it.
    expect(await actOnFeedback(code, { action: "answer", id: serious.id, text: "Looked into it and closed." }, reader)).toMatch(/serious/);
    expect(await actOnFeedback(code, { action: "answer", id: serious.id, text: "Investigated by the director; the person was told the outcome." }, approver)).toBeNull();
    expect(await actOnFeedback(code, { action: "answer", id: serious.id, text: "A second answer to the same entry." }, approver)).toMatch(/Already/);
    expect((await loadFeedback(code, approver)).all).toMatchObject({ received: 2, complaints: 2, answered: 1, open: 1 });
  });

  it("keeps the words of the matter out of the audit trail", async () => {
    const rows = (await auditTrail(code, "2000-01-01", "2999-12-31")).filter((r) => r.entity === "feedback");
    expect(rows.map((r) => r.action).sort()).toEqual(["feedback_answered", "feedback_recorded", "feedback_recorded"]);
    expect(JSON.stringify(rows)).not.toMatch(/trellis|payment/);
  });

  it("keeps both entries when two people record at the same moment", async () => {
    const [a, b] = others;
    const before = (await loadFeedback(code, approver)).entries.length;
    const entry = (about: string) => ({ action: "record" as const, date: "2026-10-03", kind: "question" as const, from: "farmer" as const, channel: "phone" as const, place: "", about, serious: false });
    expect(await Promise.all([actOnFeedback(code, entry("When is the next training day?"), a), actOnFeedback(code, entry("Who do I call about the seedlings?"), b)])).toEqual([null, null]);
    const after = await loadFeedback(code, approver);
    expect(after.entries.length).toBe(before + 2);
  });
});

describe("report calendar", { timeout: 60_000 }, () => {
  it("lists the reports owed around a date, each linked to its check", async () => {
    const { rows } = await reportCalendar(code, "2026-11-21");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.href).toMatch(/^\/progress\/(report\?q=\d{4}-Q[1-4]|annual\?year=\d{4})#checks$/);
    expect(rows.some((r) => r.kind === "qpr")).toBe(true);
  });
});
