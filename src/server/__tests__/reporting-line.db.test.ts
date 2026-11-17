import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { approversOf } from "@/lib/distribution";
import { seedSample } from "@/server/hr-store";
import { supervisorsNow, withReportingLine } from "@/server/reporting-line";
import { ready } from "@/server/__tests__/test-db";

/** Who reports to whom is kept once, on the HR record; the staff list's own value is only a fallback. */
const staff = [
  { id: "karim", name: "Karim", field: [], reportsTo: undefined as string | undefined },
  { id: "hamid", name: "Hamid", field: [], reportsTo: "karim" },
  { id: "nadia", name: "Nadia", field: ["manager"], reportsTo: "karim" },
  { id: "elena", name: "Elena", field: [], reportsTo: "karim" },
];

beforeAll(async () => {
  await ready;
}, 120_000);

describe("one source for who reports to whom", { timeout: 60_000 }, () => {
  it("leaves the staff list as it is while there is no HR record", async () => {
    expect(await supervisorsNow()).toEqual({});
    expect(await withReportingLine(staff)).toEqual(staff);
  });

  it("takes the supervisor from the HR record once there is one, and approvals follow it", async () => {
    await seedSample();
    const line = await supervisorsNow();
    // The sample HR record: Hamid reports to Karim, Zahra to Hamid; Elena (a donor contact) has no record.
    expect(line).toMatchObject({ hamid: "karim", zahra: "hamid", nadia: "karim" });
    expect(line.elena).toBeUndefined();
    // The staff list says Zahra reports to Karim: the HR record wins. Elena keeps the staff list's value.
    const lined = await withReportingLine([...staff, { id: "zahra", name: "Zahra", field: ["manager"], reportsTo: "karim" }]);
    expect(lined.find((p) => p.id === "zahra")!.reportsTo).toBe("hamid");
    expect(lined.find((p) => p.id === "elena")!.reportsTo).toBe("karim");
    // So a distribution Zahra recorded herself goes to the other manager; with none, to her HR supervisor.
    expect(approversOf(lined.filter((p) => p.id !== "nadia"), "zahra").map((p) => p.id)).toEqual(["hamid"]);
  });
});
