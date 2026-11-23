import { describe, expect, it } from "vitest";
import { LEAVE_KINDS, ON_TIMESHEET, RULES } from "@/lib/leave";
import { LEAVE_TYPES, splitOf, type Sheet } from "@/lib/timesheet";

/** Every leave kind on the Leave page has its own line on the timesheet; unpaid leave is not paid or charged. */
describe("leave types on the timesheet", () => {
  it("each Leave page kind shows as itself, not as 'Other leave'", () => {
    for (const k of LEAVE_KINDS) {
      expect(LEAVE_TYPES).toContain(ON_TIMESHEET[k]);
      expect(ON_TIMESHEET[k]).toBe(k);
    }
    for (const g of Object.values(RULES)) for (const k of g.kinds) expect(LEAVE_TYPES).toContain(ON_TIMESHEET[k]);
  });

  it("unpaid leave is recorded but not shared out to funding sources", () => {
    const sheet: Sheet = {
      month: "2026-11",
      days: {
        "2026-11-02": { hours: { GRANT: 8 }, place: "in" },
        "2026-11-03": { leave: { type: "hajj", hours: 8 } },
        "2026-11-04": { leave: { type: "unpaid", hours: 8 } },
      },
    } as Sheet;
    const s = splitOf(sheet, "Afghanistan");
    expect(s.leave.hajj).toBe(8);
    expect(s.leave.unpaid).toBe(8);
    expect(s.unpaidHours).toBe(8);
    expect(s.leaveTotal).toBe(8);
    expect(s.grandTotal).toBe(16);
    expect(s.total.GRANT).toBe(16);
  });
});
