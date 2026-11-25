import { describe, expect, it } from "vitest";
import { suggestActivities, workplanActivityOf } from "@/lib/kobo-activities";
import { buildPeriodRows } from "@/lib/period-report";
import { buildRows } from "@/lib/qpr";
import { isPrivateAddress, safeFetch } from "@/server/safe-fetch";

/** The fixes from the review of 24 November's work. */
describe("review fixes", () => {
  it("the link reader refuses this network, before and after resolving", async () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "169.254.169.254", "172.16.0.1", "192.168.1.1", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:127.0.0.1"]) expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "151.101.1.69", "2606:4700::1111"]) expect(isPrivateAddress(ip), ip).toBe(false);
    for (const link of ["http://example.org/call", "https://127.0.0.1/", "https://localhost/", "https://[::1]/", "https://intranet/", "https://example.org:8443/"]) await expect(safeFetch(link), link).rejects.toThrow(/public web address/);
  });

  it("Kobo forms link only to real workplan activities", () => {
    expect(workplanActivityOf(null, "IND-3")).toBeNull();
    expect(workplanActivityOf("1.a", "IND-4")).toBeNull();
    expect(workplanActivityOf("1.2.1-a", "IND-5")).toBe("1.2.1");
    const s = suggestActivities(
      [
        { indicatorCode: "IND-3", assetUid: "f1" },
        { indicatorCode: "IND-5", assetUid: "f1" },
      ],
      [
        { code: "IND-3", donorCode: null },
        { code: "IND-5", donorCode: "1.2.1" },
      ],
    );
    expect(s).toEqual({ f1: ["1.2.1"] });
  });

  it("a survey target with no survey yet is not measured, not 'not met'", () => {
    const [row] = buildPeriodRows([{ code: "IND-7", name: "Change in net farm income", unit: "USD", target: 100, yearTargets: { "2026": 100 }, baseline: null, measure: "change" } as never], [], { kind: "annual", year: 2026 }, "2026-01-01", "2027-12-31");
    expect(row.verdict).toBe("not_measured");
  });

  it("year to date starts on 1 January even when the agreement's period began in December", () => {
    const ind = { code: "IND-1", name: "Farmers trained", unit: "farmers", target: 100, yearTargets: {}, baseline: null } as never;
    const res = (date: string, value: number) => ({ indicator: "IND-1", date, value, status: "accepted", at: `${date}T00:00:00Z`, files: [], links: [] }) as never;
    const [row] = buildRows([ind], [res("2026-12-10", 30), res("2027-01-15", 5)], "2027-Q1", { rows: {} } as never, {}, { from: "2026-12-01", to: "2027-02-28", label: "Dec–Feb" } as never);
    expect(row.quarter).toBe(35);
    expect(row.year).toBe(5);
  });
});
