import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { farmerDrift } from "@/server/farmer-mirror";
import { farmerListRows, loadField, saveItems } from "@/server/field-store";
import { ready } from "@/server/__tests__/test-db";

/** A farmer's details are entered once: the working record is the source and the farmers table follows it. */
const code = "A-2027";
const nadia = userById("nadia")!;
const item = async (id: string) => (await loadField(code, nadia)).items.find((i) => i.id === id) as Farmer;
const table = async (id: string) => (await db.select().from(s.farmers).where(eq(s.farmers.code, id)))[0];

beforeAll(async () => {
  await ready;
  await seedDatabase();
}, 120_000);

describe("one source for a farmer's details", { timeout: 60_000 }, () => {
  it("writes a change to the working record through to the farmers table", async () => {
    const f = await item("F-0003");
    await saveItems(code, [{ ...f, community: "Village Z", contributionPaid: true }]);
    expect(await table("F-0003")).toMatchObject({ village: "Village Z", contributionPaid: true });
    expect((await farmerListRows(code)).find((r) => r.name === "F-0003")!.label).toContain("Village Z");
  });

  it("marks a removed farmer as removed in the table too", async () => {
    const f = await item("F-0004");
    await saveItems(code, [{ ...f, step: "removed" }]);
    expect((await table("F-0004")).status).toBe("removed");
  });

  it("finds rows that drifted before and puts them right", async () => {
    await db.update(s.farmers).set({ village: "Stale" }).where(eq(s.farmers.code, "F-0005"));
    expect((await farmerDrift()).find((d) => d.code === "F-0005")!.changes.join()).toMatch(/village: Stale to/);
    await farmerDrift(true);
    expect((await farmerDrift()).some((d) => d.code === "F-0005")).toBe(false);
  });
});
