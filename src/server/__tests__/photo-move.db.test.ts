import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { createHash } from "node:crypto";
import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { loadField, saveItems } from "@/server/field-store";
import { movePhotos } from "@/server/photo-move";

/** Part 2 step 4: photos already in the records move to file storage, keeping their fingerprints. */
const env = { ...process.env };
beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);
afterAll(() => {
  process.env = { ...env };
  vi.unstubAllGlobals();
});

describe("moving photos out of the database", { timeout: 60_000 }, () => {
  it("counts first; refuses to move with file storage off; moves and keeps each fingerprint", async () => {
    const farida = userById("farida")!;
    const first = (await loadField("A-2027", farida)).items.find((i): i is Farmer => i.kind === "farmer")!;
    const JPG = `data:image/jpeg;base64,${Buffer.from("fictional plot photo").toString("base64")}`;
    await saveItems("A-2027", [{ ...first, photos: [...first.photos, { id: "move-test", activity: "visit", date: "2026-11-28", caption: "Plot", src: JPG }] }]);
    const before = await movePhotos(false);
    expect(before.farmerPhotos).toBeGreaterThan(0);
    delete process.env.PROOF_FILE_STORE;
    await expect(movePhotos(true)).rejects.toThrow(/not switched on/);

    Object.assign(process.env, { PROOF_FILE_STORE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://example.invalid", SUPABASE_SERVICE_ROLE_KEY: "test-only" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const one = (await loadField("A-2027", farida)).items.find((i): i is Farmer => i.kind === "farmer" && i.photos.some((p) => p.src?.startsWith("data:image/jpeg")))!;
    const pic = one.photos.find((p) => p.src?.startsWith("data:image/jpeg"))!;
    const hash = createHash("sha256").update(Buffer.from(pic.src!.split(",")[1], "base64")).digest("hex");

    const moved = await movePhotos(true);
    expect(moved.farmerPhotos).toBe(before.farmerPhotos);
    const after = (await loadField("A-2027", farida)).items.find((i): i is Farmer => i.kind === "farmer" && i.id === one.id)!;
    expect(after.photos.find((p) => p.id === pic.id)!.src).toBe(`file:${hash}`);
    expect((await movePhotos(false)).farmerPhotos).toBe(0);
  });
});
