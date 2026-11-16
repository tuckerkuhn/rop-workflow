import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { PUT } from "@/app/api/projects/[code]/field/route";
import { userById } from "@/lib/demo";
import type { Farmer, FieldItem } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { loadField } from "@/server/field-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * Saving Field activities from the browser (PUT /api/projects/[code]/field): the server applies the
 * screen's rules itself. A stale copy is refused, a step is moved only by its owner with its checks
 * done, and the version comes back so the next save from the same page goes through.
 */
const code = "A-2027";
const farida = userById("farida")!;

const all = async () => (await loadField(code, farida)).items;
const farmer = async (id: string) => (await all()).find((i) => i.id === id) as Farmer;
async function put(as: string, items: FieldItem[]) {
  const res = await PUT(new Request(`http://test/api/projects/${code}/field`, { method: "PUT", headers: { "x-demo-user": as, "content-type": "application/json" }, body: JSON.stringify({ items }) }), { params: Promise.resolve({ code }) });
  return { status: res.status, body: (await res.json()) as { error?: string; revs?: Record<string, string> } };
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("saving Field activities from the browser", { timeout: 60_000 }, () => {
  it("saves an edit and returns the new version, so a second save from the same page goes through", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "train") as Farmer;
    const first = await put("farida", [{ ...f, checks: { ...f.checks, "train.attended": true } }]);
    expect(first.status).toBe(200);
    const rev = first.body.revs![f.id];
    expect(rev).toBeTruthy();
    expect(rev).not.toBe(f.rev);
    const second = await put("farida", [{ ...f, rev, checks: { ...f.checks, "train.attended": true, "train.register": true } }]);
    expect(second.status).toBe(200);
    expect((await farmer(f.id)).checks["train.register"]).toBe(true);
  });

  it("refuses a stale copy and keeps the newer work", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "train") as Farmer;
    // Another page saves first.
    expect((await put("farida", [{ ...f, timeline: [...f.timeline, { date: "2026-11-16", who: "extension", what: "Newer note" }] }])).status).toBe(200);
    // This page still holds the old version.
    const stale = await put("farida", [{ ...f, checks: {} }]);
    expect(stale.status).toBe(409);
    expect(stale.body.error).toMatch(/changed by someone else since you opened this page/);
    expect((await farmer(f.id)).timeline.at(-1)!.what).toBe("Newer note");
  });

  it("refuses a step moved by someone who does not own it", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "prepare") as Farmer;
    const ticked = { ...f, checks: { ...f.checks, "prepare.plot": true, "prepare.spec": true } };
    const byMel = await put("omar", [{ ...ticked, step: "verify" }]);
    expect(byMel.status).toBe(409);
    expect(byMel.body.error).toMatch(/is for the Extension agent to record/);
    expect((await farmer(f.id)).step).toBe("prepare");
  });

  it("refuses a move whose checks are not done, and accepts it once they are", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "prepare") as Farmer;
    const early = await put("farida", [{ ...f, checks: { ...f.checks, "prepare.plot": true }, step: "verify" }]);
    expect(early.status).toBe(409);
    expect(early.body.error).toMatch(/Not done: Farmer reports land prepared to the technical spec/);
    const done = await put("farida", [{ ...f, checks: { ...f.checks, "prepare.plot": true, "prepare.spec": true }, step: "verify" }]);
    expect(done.status).toBe(200);
    expect((await farmer(f.id)).step).toBe("verify");
  });

  it("refuses moving past readiness without the joint visit recorded", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "verify") as Farmer;
    const skip = await put("omar", [{ ...f, checks: {}, step: "distribute" }]);
    expect(skip.status).toBe(409);
    expect(skip.body.error).toMatch(/cannot be recorded as "Readiness: Yes" yet/);
  });

  it("lets an outcome that goes ahead without its checks through, for the step's owner", async () => {
    const f = (await all()).find((i) => i.kind === "farmer" && i.step === "correct") as Farmer;
    const res = await put("farida", [{ ...f, step: "removal" }]);
    expect(res.status).toBe(200);
    expect((await farmer(f.id)).step).toBe("removal");
  });

  it("keeps the version stamp out of the stored record", async () => {
    const { db, schema: s } = await import("@/db");
    const rows = await db.select().from(s.fieldItems);
    expect(rows.every((r) => !("rev" in (r.data as object)))).toBe(true);
  });
});
