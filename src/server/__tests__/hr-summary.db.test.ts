import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

// The HR ledger, kept in memory: the sample book written through seedSample's own writer, folded as loadHr does.
const book: Entry[] = [];
vi.mock("@/server/hr-store", async (orig) => {
  const real = await orig<typeof import("@/server/hr-store")>();
  return { ...real, loadHr: async () => ({ book: "demo", entries: book, state: fold(book, real.todayIso()), integrity: null }) };
});

import { fold, type Entry } from "@/lib/hr";
import { ready } from "@/server/__tests__/test-db";
import { seedSample } from "@/server/hr-store";
import { seedDatabase } from "@/server/demo-seed";
import { GET as summaryGET } from "@/app/api/hr/summary/route";
import { GET as timesheetsGET } from "@/app/api/timesheets/route";
import { GET as expensesGET } from "@/app/api/expenses/route";
import { GET as onboardingGET } from "@/app/api/onboarding/route";
import { GET as leaveGET } from "@/app/api/leave/route";

/** Home's HR card asks one route (api/hr/summary) for what it used to ask four routes: same answers, same audience. */
const ask = async (get: (req: Request) => Promise<Response>, path: string, as: string) => {
  const res = await get(new Request(`http://test${path}`, { headers: { "x-demo-user": as } }));
  return { status: res.status, body: res.ok ? await res.json() : null };
};

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  const at = new Date().toISOString();
  await seedSample(
    async (actor, kind, subject, data) => {
      const n = book.length + 1;
      book.push({ n, at, actor, kind, subject, data: JSON.parse(JSON.stringify(data)), hash: `h${n}`, prevHash: `h${n - 1}` });
      return n;
    },
    async (name) => ({ hash: `file-${name}`, name, type: "application/pdf", size: 1 }),
  );
}, 120_000);

describe("HR summary for Home", { timeout: 60_000 }, () => {
  // People with an HR record, an HR role, a supervisor, someone without a record, and a donor.
  const people = ["tucker", "daniel", "sima", "mina", "nadia", "bilal", "farid", "marcus", "farida", "elena"];

  it.each(people)("gives %s what the four summaries gave", async (id) => {
    const [ts, ex, ob, lv, one] = await Promise.all([
      ask(timesheetsGET, "/api/timesheets?summary=1", id),
      ask(expensesGET, "/api/expenses?summary=1", id),
      ask(onboardingGET, "/api/onboarding?summary=1", id),
      ask(leaveGET, "/api/leave?summary=1", id),
      ask(summaryGET, "/api/hr/summary", id),
    ]);
    // Whoever the four routes turned away, this one turns away too.
    expect(one.status).toBe(ts.status);
    for (const r of [ex, ob, lv]) expect(r.status).toBe(ts.status);
    if (!one.body) return;
    expect(one.body.timesheet).toEqual({ hasRecord: ts.body.hasRecord, month: ts.body.month, status: ts.body.status });
    expect(one.body.expenses).toEqual({ hasRecord: ex.body.hasRecord, returned: ex.body.returned });
    expect(one.body.leave).toEqual({ hasRecord: lv.body.hasRecord, annualDays: lv.body.annualDays, returned: lv.body.returned });
    expect(one.body.onboarding).toEqual({ mine: ob.body.mine });
  });

  it("is answered for staff with an HR record", async () => {
    for (const id of ["tucker", "daniel", "sima", "nadia"]) {
      const one = await ask(summaryGET, "/api/hr/summary", id);
      expect(one.status, id).toBe(200);
      expect(one.body.timesheet.hasRecord, id).toBe(true);
    }
  });

  it("says nothing about anyone else", async () => {
    const one = await ask(summaryGET, "/api/hr/summary", "daniel");
    expect(Object.keys(one.body).sort()).toEqual(["expenses", "leave", "onboarding", "timesheet"]);
    expect(JSON.stringify(one.body)).not.toMatch(/waiting|todo|name/);
  });
});
