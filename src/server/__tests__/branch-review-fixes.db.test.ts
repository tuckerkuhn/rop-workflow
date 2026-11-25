import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { distributionForm } from "@/lib/distribution-form";
import { filedAs, tagsFor } from "@/lib/kobo-photo";
import { quartersDue, ranIn } from "@/lib/period-report";
import { dayOf } from "@/server/distribution";

/** Fixes from the review of the handoffs branch (25 November). */
describe("handoffs branch review fixes", () => {
  it("a distribution dated after it reached the app counts on the day it arrived", () => {
    const arrived = new Date("2026-11-05T10:00:00Z");
    expect(dayOf({ payload: { distribution_date: "2027-11-05" }, completedAt: arrived })).toBe("2026-11-05");
    expect(dayOf({ payload: { distribution_date: "2026-11-01" }, completedAt: arrived })).toBe("2026-11-01");
  });

  it("the distribution form refuses a future date on the phone", () => {
    const form = distributionForm("A-2027", "Inputs", { items: [] } as never, "1");
    const [head, ...rows] = form.survey;
    const date = rows.find((r) => r[1] === "distribution_date")!;
    expect(date[head.indexOf("constraint")]).toBe(". <= today()");
  });

  it("one rule for which quarters a project ran in", () => {
    expect(ranIn("2026-Q1", "2026-03-15", null)).toBe(true);
    expect(ranIn("2026-Q1", "2026-04-01", null)).toBe(false);
    expect(quartersDue(2026, "2026-04-01", "2026-09-30", "2027-01-05")).toEqual(["2026-Q2", "2026-Q3"]);
  });

  it("the page and the server file a tagged photo the same way, and only storekeepers and extension agents supply the signed note", () => {
    expect(filedAs("signed-note")).toEqual({ activity: "distribution", signedNote: true });
    expect(tagsFor({ kind: "employee", field: ["store"] })).toContain("signed-note");
    expect(tagsFor({ kind: "employee", field: ["mel"] })).not.toContain("signed-note");
  });
});
