import { describe, expect, it } from "vitest";
import { daysWaited, fieldRows, PURCHASE_ROWS, purchaseRows, taskRow, waitingCount, waitingRows } from "@/lib/home-buckets";
import { users } from "@/lib/demo";
import { DONE, maySign, seedProcurements as procurements, stepById } from "@/lib/procurement";
import type { HomeAction } from "@/server/home-store";
import type { NextReport } from "@/server/next-report";

const action = (key: string, bucket: HomeAction["bucket"], urgent = false): HomeAction => ({ key, for: "lead", bucket, urgent, text: key, href: "/x" });
const report = (over: Partial<NextReport> = {}): NextReport => ({
  quarter: "2026-Q4",
  deadline: { due: "2027-01-15", aim: "2027-01-10", reviewDays: 5, source: null },
  daysLeft: 20,
  released: false,
  blocking: 1,
  items: [
    { owner: "mel", text: "3 results waiting", href: "/progress/results", blocks: true },
    { owner: "finance", text: "Spending not imported", href: "/progress/budget", blocks: true },
    { owner: "writers", text: "2 sections not written", href: "/progress/report", blocks: false },
  ],
  ...over,
});
const review = { key: "review", what: "November monthly review", date: "2026-11-30", days: 20, href: "/progress/review" };

describe("Home: Approve, Fix, Due", () => {
  it("keeps each action's message key so the row is put in the reader's language", () => {
    const a = { ...action("accept", "approve"), msg: { key: "ha.accept", vars: { n: 3 } } };
    const rows = waitingRows({ actions: [a], lenses: ["mel"], report: null, deadlines: [] });
    expect(rows.approve[0].msg).toEqual({ key: "ha.accept", vars: { n: 3 } });
    expect(rows.approve[0].text).toBe("accept");
  });

  it("puts each action in its group", () => {
    const rows = waitingRows({ actions: [action("accept", "approve"), action("queried", "fix"), action("import", "due")], lenses: ["field"], report: null, deadlines: [] });
    expect(rows.approve.map((r) => r.key)).toEqual(["accept"]);
    expect(rows.fix.map((r) => r.key)).toEqual(["queried"]);
    expect(rows.due.map((r) => r.key)).toEqual(["import"]);
  });
  it("lists only this person's part of what stands before the report, blockers first", () => {
    const rows = waitingRows({ actions: [], lenses: ["mel"], report: report(), deadlines: [] });
    expect(rows.fix.map((r) => r.item?.text)).toEqual(["3 results waiting", "2 sections not written"]);
    expect(rows.fix[0].urgent).toBe(true);
  });
  it("shows the report's ready-by date to those who write or release it, and the review to leads", () => {
    const lead = waitingRows({ actions: [], lenses: ["lead"], report: report(), deadlines: [review] });
    expect(lead.due.map((r) => r.key)).toEqual(["report-due", "review-due"]);
    expect(lead.due[0].due).toMatchObject({ date: "2027-01-10", days: 20 });
    const finance = waitingRows({ actions: [], lenses: ["finance"], report: report(), deadlines: [review] });
    expect(finance.due).toEqual([]);
    expect(finance.fix.map((r) => r.item?.text)).toEqual(["Spending not imported"]);
  });
  it("a released report leaves nothing to fix or hand in", () => {
    const rows = waitingRows({ actions: [], lenses: ["mel"], report: report({ released: true }), deadlines: [] });
    expect(waitingCount(rows)).toBe(0);
  });
  it("urgent rows come first within a group", () => {
    const rows = waitingRows({ actions: [action("a", "approve"), action("b", "approve", true)], lenses: ["lead"], report: null, deadlines: [] });
    expect(rows.approve.map((r) => r.key)).toEqual(["b", "a"]);
  });
});

describe("Home: tasks made at a handoff reach their owner", () => {
  const ctx = { me: "farida", lead: false, code: "A-2027", today: "2026-11-14", lens: "field" as const };
  const task = (over: Partial<Parameters<typeof taskRow>[0]>) => ({ id: "t1", title: "Fix the distribution record for F-0007: no signature", date: "2026-11-14", assignee: "farida", sourceKey: "dist-fix:abc", ...over });

  it("a sent-back distribution is a Fix row that opens the record itself", () => {
    const r = taskRow(task({}), ctx)!;
    expect(r.bucket).toBe("fix");
    expect(r.urgent).toBe(true);
    expect(r.href).toBe("/approve/A-2027/abc");
    expect(r.key).toBe("task:t1");
  });
  it("a payment to release is a Due row that opens the purchase", () => {
    const r = taskRow(task({ sourceKey: "pay-ready:PR-2027-011", assignee: "yusuf" }), { ...ctx, me: "yusuf", lens: "finance" })!;
    expect(r.bucket).toBe("due");
    expect(r.href).toBe("/work?source=procurement&open=PR-2027-011&project=A-2027");
  });
  it("someone else's task is not shown", () => {
    expect(taskRow(task({ assignee: "bilal" }), ctx)).toBeNull();
  });
  it("a task the app made with no owner goes to the project's leads, and says so", () => {
    expect(taskRow(task({ assignee: null }), ctx)).toBeNull();
    const r = taskRow(task({ assignee: null }), { ...ctx, me: "nadia", lead: true, lens: "lead" })!;
    expect(r.text).toMatch(/^No one is assigned: /);
  });
  it("a task given by hand shows when due within a week or late, not before", () => {
    expect(taskRow(task({ sourceKey: null, date: "2026-11-20" }), ctx)?.bucket).toBe("due");
    expect(taskRow(task({ sourceKey: null, date: "2026-11-10" }), ctx)?.urgent).toBe(true);
    expect(taskRow(task({ sourceKey: null, date: "2026-12-20" }), ctx)).toBeNull();
    expect(taskRow(task({ sourceKey: null, date: null }), ctx)).toBeNull();
  });
  it("demo items and donor deadlines are not handoff tasks", () => {
    expect(taskRow(task({ sourceKey: "demo:venue", date: "2027-03-25" }), ctx)).toBeNull();
  });
});

describe("Home: field work waiting on this person", () => {
  const items = [
    { id: "F-0008", kind: "farmer" as const, step: "distribute" },
    { id: "F-0007", kind: "farmer" as const, step: "distribute" },
    { id: "F-0009", kind: "farmer" as const, step: "verify" },
    { id: "F-0001", kind: "farmer" as const, step: "complete" },
  ];
  it("gives the storekeeper one row for the farmers ready for inputs, opening the first", () => {
    const rows = fieldRows(items, ["store"], "A-2027", "field");
    expect(rows).toHaveLength(1);
    expect(rows[0].text).toBe("Distribute the input package: 2 farmers are waiting for you");
    expect(rows[0].href).toBe("/work?source=field&open=F-0007&project=A-2027");
    expect(rows[0].bucket).toBe("due");
  });
  it("shows nothing for steps owned by other roles, or finished farmers", () => {
    expect(fieldRows(items, ["extension"], "A-2027", "field")).toEqual([]);
    expect(fieldRows(items, [], "A-2027", "field")).toEqual([]);
  });
  it("says 1 farmer is, not 1 farmers are", () => {
    expect(fieldRows(items, ["mel"], "A-2027", "mel")[0].text).toMatch(/: 1 farmer is waiting for you$/);
  });
});

describe("purchases waiting on a person reach Home", () => {
  const officer = users.find((u) => u.id === "zahra")!;
  const manager = users.find((u) => u.id === "nadia")!;
  const rows = (u: typeof officer) => purchaseRows(procurements(), u, "A-2027", "procurement");

  it("names the step and the purchase, and opens that purchase", () => {
    const r = rows(manager).find((x) => x.key === "purchase:PR-2027-011");
    expect(r?.text).toMatch(/^Receive and inspect: PR-2027-011 /);
    expect(r?.href).toBe("/work?source=procurement&open=PR-2027-011&project=A-2027");
  });

  it("only lists a purchase for someone who may sign its current step", () => {
    for (const u of [officer, manager])
      for (const r of rows(u).filter((x) => x.key !== "purchase:more")) {
        const p = procurements().find((q) => `purchase:${q.id}` === r.key)!;
        expect(maySign(u, p, stepById[p.step].owner)).toBe(true);
      }
    expect(rows(users.find((u) => u.id === "omar")!)).toEqual([]);
  });

  it("puts an approval under Approve and anything else under Due", () => {
    const all = [...rows(officer), ...rows(manager), ...rows(users.find((u) => u.id === "karim")!)].filter((x) => x.key !== "purchase:more");
    for (const r of all) {
      const p = procurements().find((q) => `purchase:${q.id}` === r.key)!;
      expect(r.bucket).toBe(stepById[p.step].owner === "approver" ? "approve" : "due");
    }
  });

  it("folds a long list into one row so the rest of Home stays in view", () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ ...procurements().find((p) => p.step === "receive")!, id: `PR-X-${i}` }));
    const r = purchaseRows(many, manager, "A-2027", "field");
    expect(r).toHaveLength(PURCHASE_ROWS);
    expect(r.at(-1)).toMatchObject({ key: "purchase:more", text: "6 more purchases are waiting for you", href: "/work?source=procurement&project=A-2027" });
  });

  it("leaves a finished purchase off Home", () => {
    expect(purchaseRows([{ ...procurements()[0], step: DONE }], officer, "A-2027", "procurement")).toEqual([]);
  });
});

describe("Home says a thing once", () => {
  const item = (key: string, owner: "mel" | "finance" | "lead", blocks: boolean) => ({ owner, text: key, key, href: "/pf", blocks });

  it("drops the report blocker when the same thing is already listed as the action to take", () => {
    const rows = waitingRows({ actions: [{ ...action("accept", "approve"), for: "mel" }], lenses: ["mel"], report: report({ items: [item("pf.c.pending", "mel", true), item("pf.c.noProof", "mel", false)] }), deadlines: [] });
    expect(rows.approve.map((r) => r.key)).toEqual(["accept"]);
    expect(rows.fix.map((r) => r.item?.key)).toEqual(["pf.c.noProof"]);
  });

  it("marks the action that stays as needing doing now when it blocks the report", () => {
    const rows = waitingRows({ actions: [{ ...action("overspent", "fix"), for: "finance" }, { ...action("accept", "approve"), for: "mel" }], lenses: ["mel", "finance"], report: report({ items: [item("pf.c.pending", "mel", true), item("pf.c.unexplained", "finance", false)] }), deadlines: [] });
    expect(rows.approve[0]).toMatchObject({ key: "accept", urgent: true });
    expect(rows.fix).toEqual([expect.objectContaining({ key: "overspent", urgent: false })]);
  });

  it("keeps the blocker when no action covers it", () => {
    const rows = waitingRows({ actions: [], lenses: ["mel"], report: report({ items: [item("pf.c.pending", "mel", true)] }), deadlines: [] });
    expect(rows.fix.map((r) => r.item?.key)).toEqual(["pf.c.pending"]);
  });
});

describe("how long an approval has waited", () => {
  it("is carried from the action to its row", () => {
    const rows = waitingRows({ actions: [{ key: "distributions", for: "field", bucket: "approve", urgent: true, text: "Approve 2 input distributions", href: "/approve/A/1", since: "2026-11-08" }], lenses: ["field"], report: null, deadlines: [] });
    expect(rows.approve[0].since).toBe("2026-11-08");
  });
  it("is said in whole days from two days on, and not at all when unknown", () => {
    expect(daysWaited("2026-11-08", "2026-11-20")).toBe(12);
    expect(daysWaited("2026-11-18T09:30:00.000Z", "2026-11-20")).toBe(2);
    expect(daysWaited("2026-11-19", "2026-11-20")).toBeNull();
    expect(daysWaited("2026-11-20", "2026-11-20")).toBeNull();
    expect(daysWaited(undefined, "2026-11-20")).toBeNull();
  });
});
