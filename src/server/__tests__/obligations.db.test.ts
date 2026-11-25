import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { POST } from "@/app/api/projects/[code]/agreement/route";
import { userById } from "@/lib/demo";
import { periodEndMonths, type ObligationInput } from "@/lib/obligations";
import { reportPeriod } from "@/lib/progress";
import { ready } from "@/server/__tests__/test-db";
import { seedDatabase } from "@/server/demo-seed";
import { projectByCode } from "@/server/field-store";
import { loadObligations } from "@/server/obligations-store";
import { reportDeadline } from "@/server/preflight";
import { listDonors } from "@/server/progress-store";
import { reportCalendar } from "@/server/report-calendar";

/**
 * The agreement's reporting obligations, confirmed in setup, are kept per donor and drive each
 * donor's report periods and deadlines, on the agreement's own months. The demo project runs from
 * October 2026 and has two donors.
 */
const code = "A-2027";
const send = async (as: string, body: unknown) => {
  const res = await POST(new Request(`http://test/api/projects/${code}/agreement`, { method: "POST", headers: { "x-demo-user": as, "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ code }) });
  return { status: res.status, body: (await res.json()) as { error?: string; added?: number; obligations?: number } };
};

let donors: { id: string; name: string }[] = [];
const ob = (donorId: string | null, o: Partial<ObligationInput> = {}): ObligationInput => ({
  donorId,
  report: "quarterly",
  name: "Quarterly progress report",
  frequency: "quarterly",
  periodEnds: periodEndMonths("quarterly", 10),
  daysAfter: 30,
  dueDates: [],
  format: "Foundation narrative template",
  formatFile: "https://example.org/template.docx",
  source: "Agreement, clause 8.2",
  ...o,
});

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  donors = (await listDonors(code, userById("nadia")!)).map((d) => ({ id: d.id, name: d.name }));
}, 120_000);

describe("reporting obligations from the agreement", { timeout: 60_000 }, () => {
  it("without obligations, periods and deadlines work out as before", async () => {
    const project = await projectByCode(code);
    expect(await loadObligations(project.id)).toEqual([]);
    expect((await listDonors(code, userById("nadia")!)).every((d) => d.obligations === undefined)).toBe(true);
    const { rows } = await reportCalendar(code, "2026-11-21");
    expect(rows.every((r) => r.name === undefined && r.format === undefined)).toBe(true);
    expect(rows.filter((r) => r.kind === "qpr").map((r) => r.period).sort()).toEqual(["2026-Q4", "2027-Q1", "2027-Q2"]);
  });

  it("keeps each obligation for its donor and sets the donor on each deadline, logged", async () => {
    expect(donors.length).toBe(2);
    const [a, b] = donors;
    const body = {
      action: "deadlines",
      items: [
        { title: "Quarterly progress report (period to 2026-12-31)", date: "2027-01-30", source: "Agreement, clause 8.2", donorId: a.id },
        { title: "Annual report (period to 2027-09-30)", date: "2027-12-29", source: "Agreement, clause 8.4", donorId: b.id },
      ],
      obligations: [ob(a.id), ob(b.id, { report: "annual", name: "Annual report", frequency: "annual", periodEnds: periodEndMonths("annual", 10), daysAfter: 90, format: "", formatFile: null, source: "Agreement, clause 8.4" })],
      rules: [],
    };
    expect((await send("farida", body)).status).toBe(403);
    expect((await send("nadia", { ...body, obligations: [ob("00000000-0000-4000-8000-000000000009")] })).status).toBe(400);
    expect(await send("nadia", body)).toMatchObject({ status: 200, body: { added: 2, obligations: 2 } });

    const project = await projectByCode(code);
    const saved = await loadObligations(project.id);
    expect(saved.map((o) => [o.donorId, o.name, o.periodEnds, o.daysAfter, o.format])).toEqual([
      [a.id, "Quarterly progress report", [3, 6, 9, 12], 30, "Foundation narrative template"],
      [b.id, "Annual report", [9], 90, ""],
    ]);
    const ms = await db.select().from(s.workItems).where(and(eq(s.workItems.projectId, project.id), eq(s.workItems.milestoneKind, "report_deadline")));
    expect(ms.find((m) => m.title === "Quarterly progress report (period to 2026-12-31)")?.donorId).toBe(a.id);
    expect(ms.find((m) => m.title === "Annual report (period to 2027-09-30)")?.donorId).toBe(b.id);
    const logged = await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, project.id), eq(s.auditLog.action, "agreement_deadlines_confirmed")));
    expect(logged.at(-1)?.detail).toMatchObject({ added: 2, obligations: [{ donorId: a.id, frequency: "quarterly" }, { donorId: b.id, frequency: "annual" }] });

    // Confirmed again: nothing added twice, the same obligations replaced, not doubled.
    expect(await send("nadia", body)).toMatchObject({ status: 200, body: { added: 0 } });
    expect(await loadObligations(project.id)).toHaveLength(2);
  });

  it("gives each donor its own periods: October to December, then January to March", async () => {
    const [a, b] = await listDonors(code, userById("nadia")!);
    expect(a.obligations?.[0]).not.toHaveProperty("by");
    expect(reportPeriod(a, "2026-11-24", "2026-10-01", "2028-12-31")).toMatchObject({ from: "2026-10-01", to: "2026-12-31", deadline: { date: "2027-01-30" } });
    expect(reportPeriod(a, "2027-02-10", "2026-10-01", "2028-12-31")).toMatchObject({ from: "2027-01-01", to: "2027-03-31", deadline: { date: "2027-04-30" } });
    // The annual donor reports on the agreement's year, October to September.
    expect(reportPeriod(b, "2027-02-10", "2026-10-01", "2028-12-31")).toMatchObject({ from: "2026-10-01", to: "2027-09-30", deadline: { date: "2027-12-29" } });
  });

  it("works out pre-flight's deadline as the period's end plus the days allowed", async () => {
    expect((await reportDeadline(code, "2027-06-30", 60, "quarterlyReportDays")).due).toBe("2027-07-30");
    // A date the donor's own deadline in Tasks gives (the demo's "Quarterly progress report", 15 April) still comes first.
    expect(await reportDeadline(code, "2027-03-31", 60, "quarterlyReportDays")).toMatchObject({ due: "2027-04-15", source: { kind: "milestone" } });
    const annual = await reportDeadline(code, "2027-12-31", 120, "annualReportDays");
    expect(annual.due).toBe("2028-12-29");
    expect(annual.source).toMatchObject({ kind: "policy", days: 90, text: "Agreement, clause 8.4" });
  });

  it("lists the reports in the calendar on the agreement's periods, with the format asked for", async () => {
    const { rows } = await reportCalendar(code, "2027-02-10");
    const q = rows.filter((r) => r.kind === "qpr");
    expect(q.map((r) => [r.from, r.end, r.due])).toContainEqual(["2027-04-01", "2027-06-30", "2027-07-30"]);
    expect(q.map((r) => [r.from, r.end, r.due])).toContainEqual(["2026-10-01", "2026-12-31", "2027-01-30"]);
    expect(q[0].format).toEqual({ text: "Format asked for: Foundation narrative template", href: "https://example.org/template.docx" });
    expect(q[0].donor).toBe(donors[0].name);
    const y = rows.filter((r) => r.kind === "annual");
    expect(y.map((r) => [r.from, r.end, r.due])).toEqual([["2026-10-01", "2027-09-30", "2027-12-29"]]);
    expect(y[0].format).toBeNull();
  });
});
