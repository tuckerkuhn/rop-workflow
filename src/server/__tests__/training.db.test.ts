import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

// The HR ledger, kept in memory: the sample book written through seedSample's own writer, folded as loadHr does.
const { book, write } = vi.hoisted(() => {
  const book: Entry[] = [];
  const write = async (actor: string, kind: string, subject: string | null, data: unknown) => {
  const n = book.length + 1;
  book.push({ n, at: new Date().toISOString(), actor, kind, subject, data: JSON.parse(JSON.stringify(data)), hash: `h${n}`, prevHash: `h${n - 1}` });
  return n;
  };
  return { book, write };
});
vi.mock("@/server/hr-store", async (orig) => {
  const real = await orig<typeof import("@/server/hr-store")>();
  return { ...real, append: write, loadHr: async () => ({ book: "demo", entries: book, state: fold(book, real.todayIso()), integrity: null }) };
});

import { fold, type Entry } from "@/lib/hr";
import { ready } from "@/server/__tests__/test-db";
import { seedSample } from "@/server/hr-store";
import { seedDatabase } from "@/server/demo-seed";
import { GET, POST, type TrainingView } from "@/app/api/training/route";

const get = async (as: string, person?: string) => {
  const res = await GET(new Request(`http://test/api/training${person ? `?person=${person}` : ""}`, { headers: { "x-demo-user": as } }));
  return { status: res.status, body: (res.ok ? await res.json() : null) as TrainingView | null };
};
const post = async (as: string, body: unknown) => {
  const res = await POST(new Request("http://test/api/training", { method: "POST", headers: { "x-demo-user": as, "Content-Type": "application/json" }, body: JSON.stringify(body) }));
  return { status: res.status, body: await res.json() };
};
const today = new Date().toISOString().slice(0, 10);
const training = { date: today, kind: "finance-procurement", topic: "Filing a procurement package", deliveredBy: "Karim, on the job", method: "coaching", hours: 2 };

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  await seedSample(write, async (name) => ({ hash: createHash("sha256").update(name).digest("hex"), name, type: "application/pdf", size: 1 }));
}, 120_000);

describe("training log", { timeout: 60_000 }, () => {
  it("HR sees everyone, a supervisor their team, a person only themselves", async () => {
    const hr = (await get("sima")).body!;
    const sup = (await get("karim")).body!;
    const self = (await get("yusuf")).body!;
    expect(hr.rows.length).toBeGreaterThan(sup.rows.length);
    expect(sup.rows.map((r) => r.person)).toEqual(expect.arrayContaining(["karim", "yusuf"]));
    expect(self.rows.map((r) => r.person)).toEqual(["yusuf"]);
    expect((await get("yusuf", "karim")).body!.open?.person).toBe("yusuf");
  });

  it("the sample log has the policy date, refreshers, coaching and a plan; staff with nothing are overdue first", async () => {
    const v = (await get("sima")).body!;
    expect(v.logStart).toBeTruthy();
    expect(v.rows[0].standing.overdue).toBeGreaterThan(0);
    const y = (await get("sima", "yusuf")).body!.open!;
    expect(y.standing.antiFraud.state).toBe("done");
    expect(y.standing.donorRules.state).toBe("done");
    expect(y.plan?.priorities.length).toBe(2);
    expect(y.records.length).toBeGreaterThanOrEqual(3);
  });

  it("a supervisor records for their team; a colleague cannot; a person needs proof for their own", async () => {
    expect((await post("karim", { action: "record", person: "yusuf", record: training })).status).toBe(200);
    expect((await post("nadia", { action: "record", person: "yusuf", record: training })).status).toBe(403);
    const own = await post("yusuf", { action: "record", person: "yusuf", record: training });
    expect(own.status).toBe(400);
    expect(own.body.error).toMatch(/proof/);
  });

  it("the person cannot write their own priorities; who recorded a training may withdraw it, with a reason", async () => {
    expect((await post("yusuf", { action: "plan", person: "yusuf", plan: { year: 2026, priorities: [{ what: "Anything", how: "Anyhow" }] } })).status).toBe(403);
    const made = await post("karim", { action: "record", person: "yusuf", record: { ...training, topic: "Recorded in error" } });
    expect((await post("nadia", { action: "void", person: "yusuf", record: made.body.n, why: "Not mine to undo" })).status).toBe(403);
    const undone = await post("karim", { action: "void", person: "yusuf", record: made.body.n, why: "Recorded twice" });
    expect(undone.status).toBe(200);
    const r = (undone.body.view as TrainingView).open!.records.find((x) => x.n === made.body.n);
    expect(r?.voided?.why).toBe("Recorded twice");
  });

  it("only HR sets the day the policy took effect", async () => {
    expect((await post("karim", { action: "start", effective: today })).status).toBe(403);
    expect((await post("sima", { action: "start", effective: today })).status).toBe(200);
  });
});
