import { and, asc, eq, like } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import type { DonorInfo } from "@/lib/progress";
import { DONOR_FUNDING_KEY, donorMoney, fundingFor, grantTotal, type DonorFunding, type DonorFundingBook, type DonorMoney, type LineInfo } from "@/lib/donor-funding";
import { periodLabel, periodOfKey, periodOfSlug, periodSlug } from "@/lib/period-report";
import { quarterRange } from "@/lib/results";
import type { ReportCopy } from "@/lib/report-copy";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { reportQuarter } from "@/server/next-report";
import { loadPeriodCopies, type PeriodCopy } from "@/server/period-report-store";
import { donorPhotoRule } from "@/server/photo-consent";
import { reportDeadline } from "@/server/preflight";
import { listDonors } from "@/server/progress-store";
import { loadProjectState, updateProjectState } from "@/server/project-state";
import { donorSafeReport } from "@/server/share-store";

/**
 * What a donor sees inside their own account: the reports Roots of Peace has released, and how
 * their money is being spent as the latest released report gave it.
 *
 * Three rules hold throughout:
 * - Only released reports. A draft or a practice copy never shows here, and no figure comes from
 *   an import that has not been through a release.
 * - A donor's own grant only. Which budget lines a donor's grant pays for, and which are its cost
 *   share, is a setting per donor (lib/donor-funding). On a project with several donors and no
 *   setting, nothing about money is shown.
 * - The same report as the emailed link (server/share-store donorSafeReport): people by role,
 *   places by district, photos the consent rule allows.
 *
 * Staff may look at any donor's view of their project ("as the donor sees it") and are not
 * recorded as a donor's reading of it.
 */

const COPIES = "qpr-copies:";

type Project = Awaited<ReturnType<typeof projectByCode>>;
type DonorRow = Pick<DonorInfo, "id" | "name" | "reportFormat" | "indicatorRefs" | "deadlines">;

/** Reads every donor entry: who may see which is decided in `donorFor`, not here. */
const STAFF = { kind: "employee" } as AppUser;
/** The project's donors, oldest first, with each one's own report format, references and dates. */
const donorsOf = async (code: string): Promise<DonorRow[]> => listDonors(code, STAFF);

export const loadDonorFunding = (projectId: string) => loadProjectState<DonorFundingBook>(projectId, DONOR_FUNDING_KEY, {});

const budgetLines = async (projectId: string) =>
  (await db.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, projectId)).orderBy(asc(s.budgetLines.sort))).map((l) => ({ code: l.code, description: l.description, activityCode: l.activityCode, activity: l.activity, amount: l.amount === null ? null : Number(l.amount), currency: l.currency }));

/** For Project settings: each donor's setting as saved, what applies to it, and the budget's lines to choose from. */
export async function fundingSetup(code: string) {
  const project = await projectByCode(code);
  const [donors, book, lines] = await Promise.all([donorsOf(code), loadDonorFunding(project.id), budgetLines(project.id)]);
  return { donors: donors.map((d) => ({ id: d.id, name: d.name, saved: book[d.id] ?? null, applies: fundingFor(book, d.id, donors.length) })), lines };
}

/** Saves what one donor funds. Returns why it was refused, or null. Codes the budget does not have are dropped; a line cannot be both paid by the grant and cost share. */
export async function saveDonorFunding(code: string, donorId: string, input: DonorFunding, by: string): Promise<string | null> {
  const project = await projectByCode(code);
  const [donors, lines] = await Promise.all([donorsOf(code), budgetLines(project.id)]);
  const donor = donors.find((d) => d.id === donorId);
  if (!donor) return "No such donor on this project.";
  const known = new Set(lines.map((l) => l.code));
  const share = [...new Set(input.share)].filter((c) => known.has(c));
  const funding: DonorFunding = { lines: input.lines === "all" ? "all" : [...new Set(input.lines)].filter((c) => known.has(c) && !share.includes(c)), share };
  if (funding.lines !== "all" && !funding.lines.length && !share.length) return "Choose at least one budget line, or the whole budget.";
  // Saved with the book locked: two donors set at the same moment both stay.
  await updateProjectState<DonorFundingBook, null>(project.id, DONOR_FUNDING_KEY, {}, async (cur) => ({ data: { ...cur, [donorId]: funding }, result: null }));
  await logAudit(db, project.id, { entity: "donor", entityId: donorId, action: "donor_funding_set", by, detail: { name: donor.name, funds: funding.lines === "all" ? "the whole budget" : `${funding.lines.length} budget line(s)`, costShare: share.length } });
  return null;
}

/** The release copy of each quarter that has one, newest quarter first. Practice copies are never listed. */
async function releases(projectId: string): Promise<{ quarter: string; copy: ReportCopy }[]> {
  const rows = await db.select({ key: s.projectState.key, data: s.projectState.data }).from(s.projectState).where(and(eq(s.projectState.projectId, projectId), like(s.projectState.key, `${COPIES}%`)));
  return rows
    .flatMap((r) => {
      const copy = ((r.data as { copies?: ReportCopy[] } | null)?.copies ?? []).find((c) => c.kind === "release");
      return copy ? [{ quarter: r.key.slice(COPIES.length), copy }] : [];
    })
    .sort((a, b) => b.quarter.localeCompare(a.quarter));
}

/** The released annual and final reports, newest release first. */
async function periodReleases(projectId: string) {
  return Object.entries(await loadPeriodCopies(projectId))
    .flatMap(([key, copy]) => {
      const p = periodOfKey(key);
      return p ? [{ slug: periodSlug(p), label: periodLabel(p), copy }] : [];
    })
    .sort((a, b) => b.copy.at.localeCompare(a.copy.at));
}

/** Whose view this is: a donor's own entry (by their organization's name), or for staff the donor they ask to look as. */
async function donorFor(code: string, user: AppUser, asked?: string | null) {
  const all = await donorsOf(code);
  const donor = user.kind === "donor" ? (all.find((d) => d.name === user.org) ?? null) : ((asked ? all.find((d) => d.id === asked) : all[0]) ?? null);
  return { donor, count: all.length, preview: user.kind !== "donor" };
}

type MoneyNote = "noDonor" | "notSet" | null;
export type MoneyView = DonorMoney & { quarter: string; releasedAt: string; total: { approved: number; spent: number } };

async function moneyFrom(project: Project, donor: DonorRow | null, count: number, release: { quarter: string; copy: ReportCopy }): Promise<{ money: MoneyView | null; moneyNote: MoneyNote }> {
  if (!donor) return { money: null, moneyNote: "noDonor" };
  const funding = fundingFor(await loadDonorFunding(project.id), donor.id, count);
  if (!funding) return { money: null, moneyNote: "notSet" };
  const info: LineInfo[] = await budgetLines(project.id);
  const m = donorMoney(release.copy.data.spend, funding, info);
  return { money: { ...m, quarter: release.quarter, releasedAt: release.copy.at, total: grantTotal(m) }, moneyNote: null };
}

/** A donor's Home: the released reports, the money as the latest of them gave it, and the next report to expect. */
export async function donorView(code: string, user: AppUser, asked?: string | null) {
  const project = await projectByCode(code);
  const [{ donor, count, preview }, list, periods] = await Promise.all([donorFor(code, user, asked), releases(project.id), periodReleases(project.id)]);
  const latest = list[0] ?? null;
  const { money, moneyNote } = latest ? await moneyFrom(project, donor, count, latest) : { money: null, moneyNote: (donor ? null : "noDonor") as MoneyNote };
  // The next report: this donor's own next date where one is set, else the project's rule for the quarter being written.
  const today = new Date().toISOString().slice(0, 10);
  const own = donor?.deadlines.find((x) => x.date >= today);
  const quarter = own ? null : await reportQuarter(code).catch(() => null);
  const due = quarter && !list.some((r) => r.quarter === quarter) ? ((await reportDeadline(code, quarterRange(quarter).to, 60, "quarterlyReportDays").catch(() => null))?.due ?? null) : null;
  const next = own ? { title: own.title as string | null, date: own.date } : due && due >= today ? { title: null, date: due } : null;
  return {
    project: { code, name: project.name },
    donor: donor && { id: donor.id, name: donor.name, reportFormat: donor.reportFormat },
    /** True for staff looking at what a donor sees; `donors` is who they can choose between. */
    preview,
    donors: preview ? (await donorsOf(code)).map((d) => ({ id: d.id, name: d.name })) : [],
    reports: list.map((r) => ({ quarter: r.quarter, releasedAt: r.copy.at })),
    /** Released annual and final reports: `slug` is "annual-2026" or "final". */
    periods: periods.map((r) => ({ slug: r.slug, label: r.label, releasedAt: r.copy.at })),
    money,
    moneyNote,
    next,
  };
}
export type DonorView = Awaited<ReturnType<typeof donorView>>;

/**
 * A donor's own format: only the targets that donor tracks, under that donor's own references
 * (the same rule as the Progress page and the report exports, lib/report-formats).
 */
function inDonorFormat<R extends { code: string; donorCode: string | null }>(rows: R[], donor: DonorRow | null): R[] {
  if (!donor) return rows;
  const refs = donor.indicatorRefs;
  const tracked = Object.keys(refs).length ? rows.filter((r) => r.code in refs) : rows;
  return tracked.map((r) => ({ ...r, donorCode: refs[r.code] || r.donorCode }));
}

/**
 * One released report as the donor sees it, with their money as that report gave it. Null when
 * the quarter has no release. `record` notes a donor's own reading in the audit trail; staff
 * looking, and an administrator viewing as the donor, are not a donor's reading.
 */
export async function donorReport(code: string, quarter: string, user: AppUser, opts: { asked?: string | null; record?: boolean } = {}) {
  const project = await projectByCode(code);
  const [{ donor, count, preview }, list] = await Promise.all([donorFor(code, user, opts.asked), releases(project.id)]);
  const release = list.find((r) => r.quarter === quarter);
  if (!release) return null;
  const [safe, m] = await Promise.all([donorSafeReport(code, project.id, quarter, release.copy), moneyFrom(project, donor, count, release)]);
  const report = { ...safe, project: { name: safe.project.name, donor: donor?.name ?? safe.project.donor }, rows: inDonorFormat(safe.rows, donor) };
  if (opts.record && user.kind === "donor") await logAudit(db, project.id, { entity: "share", entityId: project.id, action: "donor_report_viewed", by: user.id, detail: { quarter, donor: donor?.name ?? user.org } });
  return { project: { code, name: project.name }, donor: donor && { id: donor.id, name: donor.name, reportFormat: donor.reportFormat }, preview, report, ...m };
}
export type DonorReportView = NonNullable<Awaited<ReturnType<typeof donorReport>>>;

/**
 * A released annual or final report as a donor may see it: the indicator table, the quarters'
 * text only where that quarter was released, lessons without who wrote them, the spending totals
 * and the photos the consent rule allows now. Nobody is named. Staff working notes (results still
 * waiting, figures changed since, the close-out) stay out.
 */
async function donorSafePeriod(projectId: string, copy: PeriodCopy, donor: DonorRow | null) {
  const d = copy.data;
  const photoOk = await donorPhotoRule(projectId);
  return {
    project: { name: d.project.name, donor: donor?.name ?? d.project.donor },
    period: d.period,
    label: periodLabel(d.period),
    range: d.range,
    releasedAt: copy.at,
    rows: inDonorFormat(d.rows, donor),
    narrative: d.narrative.map((sec) => ({ heading: sec.heading, parts: sec.parts.filter((x) => x.released).map((x) => ({ quarter: x.quarter, text: x.text })) })).filter((sec) => sec.parts.length),
    lessons: d.lessons.map((l) => ({ id: l.id, area: l.area, date: l.date, lesson: l.lesson, action: l.action })),
    spend: d.spend && { currency: d.spend.currency, budget: d.spend.budget, cumulative: d.spend.cumulative, withOverhead: d.spend.withOverhead },
    photos: d.photos.filter((ph) => photoOk(ph.hash).ok).map((ph) => ({ hash: ph.hash, caption: ph.caption, activity: ph.activity })),
  };
}

/** One released annual or final report ("annual-2026" or "final") as the donor sees it. Null when it has not been released. */
export async function donorPeriodReport(code: string, slug: string, user: AppUser, opts: { asked?: string | null; record?: boolean } = {}) {
  const p = periodOfSlug(slug);
  if (!p) return null;
  const project = await projectByCode(code);
  const [{ donor, preview }, list] = await Promise.all([donorFor(code, user, opts.asked), periodReleases(project.id)]);
  const release = list.find((r) => r.slug === slug);
  if (!release) return null;
  const report = await donorSafePeriod(project.id, release.copy, donor);
  if (opts.record && user.kind === "donor") await logAudit(db, project.id, { entity: "share", entityId: project.id, action: "donor_report_viewed", by: user.id, detail: { report: release.label, donor: donor?.name ?? user.org } });
  return { project: { code, name: project.name }, donor: donor && { id: donor.id, name: donor.name, reportFormat: donor.reportFormat }, preview, report };
}
export type DonorPeriodReportView = NonNullable<Awaited<ReturnType<typeof donorPeriodReport>>>;

/** Whether a signed-in viewer may be sent this file: only captioned photos in that quarter's released report or behind its figures, or in a released annual or final report ("annual-2026", "final"). */
export async function releasedPhoto(code: string, quarter: string, hash: string) {
  const project = await projectByCode(code);
  if (periodOfSlug(quarter)) {
    const period = (await periodReleases(project.id)).find((r) => r.slug === quarter);
    return !!period && (await donorSafePeriod(project.id, period.copy, null)).photos.some((p) => p.hash === hash);
  }
  const release = (await releases(project.id)).find((r) => r.quarter === quarter);
  if (!release) return false;
  const v = await donorSafeReport(code, project.id, quarter, release.copy);
  return v.photos.some((p) => p.hash === hash) || v.rows.some((r) => r.records.some((x) => x.photos.some((p) => p.hash === hash)));
}
