import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => import("@/server/__tests__/test-db"));

import { and, eq, like } from "drizzle-orm";
import { DONOR_FUNDING_KEY } from "@/lib/donor-funding";
import { saveProjectState } from "@/server/project-state";
import { db, schema as s } from "@/db";
import { userById, type AppUser } from "@/lib/demo";
import { seedDatabase } from "@/server/demo-seed";
import { donorReport, donorView, fundingSetup, releasedPhoto, saveDonorFunding } from "@/server/donor-view-store";
import { projectByCode } from "@/server/field-store";
import { listDonors } from "@/server/progress-store";
import { addCopy, copyOf, loadCopies, qprData, rawQpr, saveQpr } from "@/server/qpr-store";
import { loadResults } from "@/server/results-store";
import { donorSafeReport } from "@/server/share-store";
import { ready } from "@/server/__tests__/test-db";

/**
 * A donor's own account: released reports only, their own grant only, and money only as a
 * released report gave it (server/donor-view-store).
 */
const code = "A-2027";
const nadia = userById("nadia")!;
const elena = userById("elena")!;
const NO_WORK = { minutes: 0, sittings: 0, first: null, last: null };
let quarter = "";
let projectId = "";
let mine = "";
let other = "";

const copyNow = async (kind: "release" | "practice", at: string) => {
  const d = await qprData(code, quarter);
  const saved = kind === "release" ? { ...((await rawQpr(projectId, quarter)) ?? d.saved), released: { by: "nadia", at } } : d.saved;
  if (kind === "release") await saveQpr(code, quarter, saved);
  await addCopy(code, quarter, { kind, by: "nadia", at, work: NO_WORK, data: copyOf({ ...d, saved }) });
};
const actions = async (action: string) => (await db.select().from(s.auditLog).where(and(eq(s.auditLog.projectId, projectId), eq(s.auditLog.action, action)))).length;

beforeAll(async () => {
  process.env.DEMO_SIGN_IN = "1";
  await ready;
  await seedDatabase();
  projectId = (await projectByCode(code)).id;
  // The demo now opens with what each donor funds and a released report (server/demo-report); these tests start from neither.
  await saveProjectState(projectId, DONOR_FUNDING_KEY, {});
  await db.delete(s.projectState).where(and(eq(s.projectState.projectId, projectId), like(s.projectState.key, "qpr%")));
  quarter = (await loadResults(code)).find((r) => r.status === "accepted" && r.value > 0)!.quarter;
  const donors = await listDonors(code, nadia);
  mine = donors.find((d) => d.name === elena.org)!.id;
  other = donors.find((d) => d.name !== elena.org)!.id;
}, 120_000);

describe("before anything is released", { timeout: 60_000 }, () => {
  it("a donor has no reports and no money, and a practice copy changes nothing", async () => {
    await copyNow("practice", "2026-10-20T00:00:00Z");
    const v = await donorView(code, elena);
    expect(v.donor?.name).toBe(elena.org);
    expect(v.preview).toBe(false);
    expect(v.donors).toEqual([]);
    expect(v.reports).toEqual([]);
    expect(v.money).toBeNull();
    expect(await donorReport(code, quarter, elena)).toBeNull();
    expect(await releasedPhoto(code, quarter, "0".repeat(64))).toBe(false);
  });
});

describe("after a release", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    await copyNow("release", "2026-11-01T00:00:00Z");
  });

  it("the report is listed for the donor, and reads as the emailed link does, in the donor's own format", async () => {
    const v = await donorView(code, elena);
    expect(v.reports).toEqual([{ quarter, releasedAt: "2026-11-01T00:00:00Z" }]);
    const r = (await donorReport(code, quarter, elena))!;
    const release = (await loadCopies(code, quarter)).find((c) => c.kind === "release")!;
    const link = await donorSafeReport(code, projectId, quarter, release);
    expect(r.report.status).toBe("released");
    expect(r.report.sections).toEqual(link.sections);
    expect(r.report.photos).toEqual(link.photos);
    // Only the targets this donor tracks, under this donor's own references.
    const refs = (await listDonors(code, elena))[0].indicatorRefs;
    const tracked = Object.keys(refs).length ? link.rows.filter((x) => x.code in refs) : link.rows;
    expect(r.report.rows.map((x) => x.code)).toEqual(tracked.map((x) => x.code));
    expect(r.report.rows.length).toBeGreaterThan(0);
    for (const row of r.report.rows) expect(row.donorCode).toBe(refs[row.code] || tracked.find((x) => x.code === row.code)!.donorCode);
    expect(r.report.rows.map((x) => [x.quarter, x.year, x.status])).toEqual(tracked.map((x) => [x.quarter, x.year, x.status]));
    expect(r.report.project.donor).toBe(elena.org);
  });

  it("shows no money while the project has two donors and nobody has said what each funds", async () => {
    const v = await donorView(code, elena);
    expect(v.money).toBeNull();
    expect(v.moneyNote).toBe("notSet");
    const setup = await fundingSetup(code);
    expect(setup.donors.map((d) => d.applies)).toEqual([null, null]);
    expect(setup.lines.length).toBeGreaterThan(3);
  });

  it("refuses a setting with nothing in it, or for a donor of another project", async () => {
    expect(await saveDonorFunding(code, mine, { lines: [], share: [] }, "nadia")).toMatch(/at least one/);
    expect(await saveDonorFunding(code, mine, { lines: ["no-such-line"], share: [] }, "nadia")).toMatch(/at least one/);
    expect(await saveDonorFunding(code, "00000000-0000-4000-8000-000000000000", { lines: "all", share: [] }, "nadia")).toMatch(/No such donor/);
  });

  it("shows every budget line of a grant that pays for the whole budget, with the released report's own figures", async () => {
    const before = await actions("donor_funding_set");
    expect(await saveDonorFunding(code, mine, { lines: "all", share: [] }, "nadia")).toBeNull();
    expect(await actions("donor_funding_set")).toBe(before + 1);
    const released = (await loadCopies(code, quarter)).find((c) => c.kind === "release")!.data.spend;
    const m = (await donorView(code, elena)).money!;
    expect(m.quarter).toBe(quarter);
    expect(m.currency).toBe(released.currency);
    expect(m.funded.lines.map((l) => l.code).sort()).toEqual(Object.keys(released.byLine).sort());
    for (const l of m.funded.lines) expect([l.approved, l.spent]).toEqual([released.byLine[l.code].budget, released.byLine[l.code].actual].map((n) => Math.round(n * 100) / 100));
    expect(m.share).toBeNull();
    // The other donor is still not set, and sees nothing.
    expect((await donorView(code, nadia, other)).moneyNote).toBe("notSet");
  });

  it("keeps the figures of the release when spending moves on afterwards", async () => {
    const then = (await donorView(code, elena)).money!;
    const [line] = await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, projectId)).limit(1);
    await db.update(s.budgetLines).set({ spent: String(Number(line.spent ?? 0) + 12345) }).where(eq(s.budgetLines.id, line.id));
    const now = (await donorView(code, elena)).money!;
    expect(now.funded.lines).toEqual(then.funded.lines);
    expect(now.total).toEqual(then.total);
    await db.update(s.budgetLines).set({ spent: line.spent }).where(eq(s.budgetLines.id, line.id));
  });

  it("shows chosen lines and cost share apart, drops codes the budget does not have, and never counts a line twice", async () => {
    const codes = (await fundingSetup(code)).lines.map((l) => l.code);
    const [a, b, c] = codes;
    expect(await saveDonorFunding(code, mine, { lines: [b, a, c, "no-such-line"], share: [c] }, "nadia")).toBeNull();
    const setup = await fundingSetup(code);
    expect(setup.donors.find((d) => d.id === mine)!.saved).toEqual({ lines: [b, a], share: [c] });
    const r = (await donorReport(code, quarter, elena))!;
    expect(r.money!.funded.lines.map((l) => l.code)).toEqual([a, b]);
    expect(r.money!.share!.lines.map((l) => l.code)).toEqual([c]);
    expect(r.money!.indirect).toBeNull();
    expect(r.money!.total.approved).toBe(r.money!.funded.approved);
  });

  it("gives a donor their own organization's view whatever they ask for, and staff the donor they choose", async () => {
    expect((await donorView(code, elena, other)).donor?.id).toBe(mine);
    expect((await donorReport(code, quarter, elena, { asked: other }))!.donor?.id).toBe(mine);
    const staff = await donorView(code, nadia, other);
    expect(staff.donor?.id).toBe(other);
    expect(staff.preview).toBe(true);
    expect(staff.donors.map((d) => d.id).sort()).toEqual([mine, other].sort());
    expect((await donorView(code, nadia)).donor?.id).toBe((await listDonors(code, nadia))[0].id);
  });

  it("shows a donor whose organization has no grant here the reports, and no money", async () => {
    const stranger = { ...elena, org: "Somebody Else Fund" } as AppUser;
    const v = await donorView(code, stranger);
    expect(v.donor).toBeNull();
    expect(v.money).toBeNull();
    expect(v.moneyNote).toBe("noDonor");
    expect((await donorReport(code, quarter, stranger))!.money).toBeNull();
  });

  it("records a donor's own reading of a report, and not staff looking at what the donor sees", async () => {
    const before = await actions("donor_report_viewed");
    await donorReport(code, quarter, elena, { record: true });
    expect(await actions("donor_report_viewed")).toBe(before + 1);
    await donorReport(code, quarter, nadia, { record: true });
    await donorReport(code, quarter, elena);
    expect(await actions("donor_report_viewed")).toBe(before + 1);
  });

  it("names the donor's own next report date when one is set", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const own = (await listDonors(code, elena))[0].deadlines.find((d) => d.date >= today);
    const next = (await donorView(code, elena)).next;
    if (own) expect(next).toEqual({ title: own.title, date: own.date });
    else expect(next === null || next.title === null).toBe(true);
  });

  it("opens only photos that are in the released report", async () => {
    const r = (await donorReport(code, quarter, elena))!;
    const inReport = [...r.report.photos.map((p) => p.hash), ...r.report.rows.flatMap((x) => x.records.flatMap((y) => y.photos.map((p) => p.hash)))];
    for (const hash of inReport.slice(0, 2)) expect(await releasedPhoto(code, quarter, hash)).toBe(true);
    expect(await releasedPhoto(code, quarter, "f".repeat(64))).toBe(false);
    expect(await releasedPhoto(code, "1999-Q1", "f".repeat(64))).toBe(false);
  });
});
