import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { en } from "@/lib/i18n/en";

/** Part 2 step 7: KoboToolbox is removed (Tucker, 27 Nov). Field data comes from the app's own forms. */
const root = path.resolve(import.meta.dirname, "../../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

describe("KoboToolbox is out", () => {
  it("no nightly check, no Kobo routes, no Kobo script, no Kobo token key", () => {
    const crons = (JSON.parse(read("vercel.json")) as { crons: { path: string }[] }).crons;
    expect(crons.some((c) => c.path.includes("kobo"))).toBe(false);
    expect(existsSync(path.join(root, "src/app/api/kobo"))).toBe(false);
    expect(existsSync(path.join(root, "src/app/api/projects/[code]/kobo/sync"))).toBe(false);
    expect(existsSync(path.join(root, "kobo"))).toBe(false);
    expect(read("package.json")).not.toMatch(/kobo:/);
    expect(read(".env.example")).not.toMatch(/KOBO_TOKEN_KEY/);
  });

  it("the words people see for field work no longer send them to KoboCollect", () => {
    const keys = ["work.new.farmerStepHint", "setup.h.indicators", "setup.h.done", "new.fieldForm", "work.new.fieldFormHint", "setup.q.fieldApproval", "setup.h.fieldApproval"] as const;
    for (const k of keys) expect((en as Record<string, string>)[k]).not.toMatch(/Kobo/);
  });

  it("the migration that drops the Kobo tables is written and kept out of the migrations that run", () => {
    expect(existsSync(path.join(root, "docs/deep-dive/migrations-pending/0029_drop_kobo.sql"))).toBe(true);
    expect(existsSync(path.join(root, "drizzle/0029_drop_kobo.sql"))).toBe(false);
  });
});
