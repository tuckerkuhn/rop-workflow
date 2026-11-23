import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { GET } from "@/app/api/projects/[code]/distributions/[id]/route";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { seedDatabase } from "@/server/demo-seed";
import { listDistributions } from "@/server/distribution";
import { loadField } from "@/server/field-store";
import { ready } from "@/server/__tests__/test-db";

/** The approval screen's title names the farmer only for a signed-in viewer allowed to see names (pii). */
const code = "A-2027";
let id = "";
let name = "";

async function get(as: string) {
  const res = await GET(new Request(`http://test/api/projects/${code}/distributions/${id}`, { headers: { "x-demo-user": as } }), { params: Promise.resolve({ code, id }) });
  return { status: res.status, text: await res.text() };
}

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const d = (await listDistributions(code))[0];
  id = d.id;
  const f = (await loadField(code, userById("nadia")!)).items.find((i): i is Farmer => i.kind === "farmer" && i.id === d.farmerId)!;
  name = f.name;
}, 120_000);

describe("the farmer's name on a distribution", { timeout: 60_000 }, () => {
  it("is sent to a signed-in viewer with pii", async () => {
    expect(name).toBeTruthy();
    const r = await get("nadia");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).farmerName).toBe(name);
  });

  it("is never sent to a viewer without pii", async () => {
    const r = await get("marcus");
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).farmerName).toBeNull();
    expect(r.text).not.toContain(name);
  });
});
