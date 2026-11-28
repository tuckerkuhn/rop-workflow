import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { readFileSync } from "node:fs";
import path from "node:path";
import { userById } from "@/lib/demo";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { backupStatus, confirmBackupPlan } from "@/server/backup-plan";
import { orgIdForPerson } from "@/server/org-settings-store";
import { scheduledExport } from "@/server/records-export";

/** ISS-25: a weekly export on a schedule, and a backup plan an administrator confirms every 90 days. */
beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  delete process.env.PROOF_FILE_STORE;
  await ready;
  await seedDatabase();
}, 120_000);

describe("backups", { timeout: 60_000 }, () => {
  it("the weekly export is on the schedule, and says when it could not be kept", async () => {
    const crons = (JSON.parse(readFileSync(path.resolve(import.meta.dirname, "../../../vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] }).crons;
    expect(crons.find((c) => c.path === "/api/cron/records-export")?.schedule).toBe("0 4 * * 0");
    expect(await scheduledExport()).toEqual({ kept: false });
    const org = await orgIdForPerson("tucker");
    expect((await backupStatus(org)).lastExport).toMatchObject({ kept: false });
  });

  it("an administrator confirms the backup plan; nobody else can; it is due again after 90 days", async () => {
    const org = await orgIdForPerson("tucker");
    expect((await backupStatus(org)).due).toBe(true);
    await expect(confirmBackupPlan(userById("farida")!, true, "Checked the dashboard")).rejects.toThrow(/Only an administrator/);
    const s = await confirmBackupPlan(userById("tucker")!, true, "Daily backups on in the database dashboard, Pro plan");
    expect(s.due).toBe(false);
    expect(s.plan).toMatchObject({ confirmedBy: "tucker", dailyBackups: true });
  });
});
