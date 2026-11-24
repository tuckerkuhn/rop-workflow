import { describe, expect, it } from "vitest";
import { seedProcurements } from "@/lib/procurement";
import { REGISTER_HEADERS, registerCsv, registerMonths, registerRow, registerRows, registerTotals } from "@/lib/procurement-register";

/** The procurement register is read from the records: a donor's "no reports from the system" is answered without typing anything twice. */
describe("procurement register", () => {
  const items = seedProcurements();

  it("has one row per purchase with who asked, who approved and the supplier", () => {
    const rows = registerRows(items);
    expect(rows).toHaveLength(items.length);
    const done = rows.find((r) => r.id === "PR-2027-006")!;
    expect(done.requestedBy).toBeTruthy();
    expect(done.approved).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(done.supplier).toContain("fictional");
    expect(done.ordered).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(done.received).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("a month's report keeps purchases that moved that month or were still open at its end", () => {
    const months = registerMonths(items);
    expect(months[0] > months[months.length - 1]).toBe(true);
    const dec = registerRows(items, "2026-12");
    expect(dec.map((r) => r.id)).toContain("PR-2027-006");
    expect(dec.every((r) => r.requested <= "2026-12-31")).toBe(true);
    expect(dec.length).toBeLessThan(items.length);
  });

  it("downloads as a spreadsheet with the same columns, and adds up", () => {
    const rows = registerRows(items);
    const csv = registerCsv(rows);
    expect(csv.split("\r\n")[0]).toBe(REGISTER_HEADERS.join(","));
    expect(csv.trim().split("\r\n")).toHaveLength(rows.length + 1);
    const t = registerTotals(rows);
    expect(t.open + t.closed).toBe(t.count);
    expect(t.valueUsd).toBeCloseTo(rows.reduce((s, r) => s + r.valueUsd, 0), 2);
  });

  it("a purchase not yet submitted has no requester or approval", () => {
    const r = registerRow({ ...items[0], signatures: {}, plan: undefined });
    expect(r.requestedBy).toBe("");
    expect(r.approved).toBe("");
  });
});
