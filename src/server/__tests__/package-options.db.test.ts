import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { userById } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { itemsFor } from "@/lib/package";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { saveForm } from "@/server/app-forms";
import { importFarmers } from "@/server/farmers";
import { loadField, saveSetup, setupFor } from "@/server/field-store";

/** Tucker, 28 Nov: farmers choose one of the project's packages; the record keeps it and plans by it. */
const code = "A-2027";
const farida = userById("farida")!;
const nadia = userById("nadia")!;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
}, 120_000);

describe("packages on a project", { timeout: 60_000 }, () => {
  it("a farmer registered or loaded with a package keeps it, and is planned by it", async () => {
    const setup = (await setupFor(code))!;
    const [a, b] = setup.items.map((i) => i.key);
    await saveSetup(code, { ...setup, packages: [{ key: "full", name: "Full", items: [a, b] }, { key: "seed_only", name: "Seed only", why: "farmers with their own fertiliser", items: [a] }] });
    await saveForm(code, "register", { entryId: "pkg-test-1", answers: { start_geopoint: "34.5 69.1", farmer_id: "F-PKG-1", village: "Qala", sex: "Female", hectares: "1", package: "seed_only" } }, farida);
    await importFarmers(code, [{ id: "F-PKG-2", village: "Qala", gender: "Male", hectares: 1, package: "Seed only" }], { id: nadia.id, name: nadia.name });
    const farmers = (await loadField(code, farida)).items.filter((i): i is Farmer => i.kind === "farmer");
    for (const id of ["F-PKG-1", "F-PKG-2"]) expect(farmers.find((f) => f.id === id)!.package).toBe("seed_only");
    expect(itemsFor((await setupFor(code))!, 1, "seed_only").map((i) => i.key)).toEqual([a]);
    await expect(importFarmers(code, [{ id: "F-PKG-3", village: "Qala", gender: "Male", hectares: 1, package: "Gold" }], { id: nadia.id, name: nadia.name })).rejects.toThrow(/does not offer: F-PKG-3 \("Gold"\)/);
  });
});
