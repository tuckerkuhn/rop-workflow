import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET as preflight } from "@/app/(app)/progress/preflight/route";
import { GET as records } from "@/app/(app)/progress/records/route";

/**
 * Two addresses the app no longer has pages for. A link kept from before must land on the page
 * that took its place, sent there by the server: a redirect from inside a page showed
 * "Application error" instead.
 */
const to = (res: Response) => {
  const u = new URL(res.headers.get("location")!);
  return u.pathname + u.search + u.hash;
};
const ask = (path: string) => new NextRequest(`http://localhost:3000${path}`);

describe("old addresses", () => {
  it("sends the old report check to the check on the right report", () => {
    expect(to(preflight(ask("/progress/preflight")))).toBe("/progress/report#checks");
    expect(to(preflight(ask("/progress/preflight?period=2026-Q4")))).toBe("/progress/report?q=2026-Q4#checks");
    expect(to(preflight(ask("/progress/preflight?report=annual&period=2026")))).toBe("/progress/annual?year=2026#checks");
    expect(to(preflight(ask("/progress/preflight?report=face&period=2026-11")))).toBe("/progress/face?month=2026-11#checks");
  });

  it("drops a period that is not one", () => {
    expect(to(preflight(ask("/progress/preflight?period=%2F%2Fevil.example")))).toBe("/progress/report#checks");
    expect(to(preflight(ask("/progress/preflight?report=annual&period=2026-Q4")))).toBe("/progress/annual#checks");
  });

  it("sends the old project record to Projects", () => {
    const res = records(ask("/progress/records"));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(to(res)).toBe("/project");
  });
});
