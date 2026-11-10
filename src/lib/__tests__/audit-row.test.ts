import { describe, expect, it } from "vitest";
import { auditRow } from "@/server/audit";

const project = "11111111-1111-4111-8111-111111111111";

describe("audit rows", () => {
  it("names who made the change", () => {
    const row = auditRow(project, { entity: "result", entityId: "22222222-2222-4222-8222-222222222222", action: "result_accepted", by: "u-mel", detail: { value: 10 } });
    expect(row).toEqual({ projectId: project, entity: "result", entityId: "22222222-2222-4222-8222-222222222222", action: "result_accepted", detail: { by: "u-mel", value: 10 } });
  });
  it("files a bill number under its project instead of being refused by the database (bug found 9 Nov 2026)", () => {
    const row = auditRow(project, { entity: "bill", entityId: "BL-004", action: "bill_approved", by: "u-lead", detail: { usd: 120 } });
    expect(row.entityId).toBe(project);
    expect(row.detail).toEqual({ by: "u-lead", ref: "BL-004", usd: 120 });
  });
});
