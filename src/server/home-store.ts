import { hoursLeft } from "@/lib/funding-proposals";
import { proposalWork } from "@/server/funding-proposals-store";
import { quarterRange } from "@/lib/results";
import { quartersDue } from "@/lib/period-report";
import { reportDeadline } from "@/server/preflight";
import { ourWork } from "@/lib/budget";
import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { fieldRows, purchaseRows, taskRow } from "@/lib/home-buckets";
import { loadLineReasons } from "@/server/overspend-store";
import { onProject, people } from "@/server/auth";
import { collectorOf, mayApproveKobo, mayDecideRecord, maySendBack } from "@/lib/kobo-approval";
import { koboApprovalFor } from "@/server/kobo-approval";
import { koboState } from "@/server/kobo-link";
import { loadProcurements } from "@/server/procurement-store";
import { billRoles, loadBills } from "@/server/bills-store";
import { billBooksProblem, toCorrect } from "@/lib/bills";
import { NON_CONTRACT } from "@/lib/timesheet";
import { loadPurchaseBooks, mayPostToBooks, paymentKey } from "@/server/books-posting";
import { paymentBooksProblem } from "@/lib/books-posting";
import type { FieldItem } from "@/lib/field";
import { koboMismatches } from "@/server/results-store";
import { db, schema as s } from "@/db";
import { fieldItemRows, listDistributions, stockFor } from "@/server/distribution";
import { canEditProject, type AppUser } from "@/lib/demo";
import { quartersLabel } from "@/lib/monthly-review";
import { STATUS_LABEL, type Status } from "@/lib/qpr";
import { mayExplainOverspend } from "@/lib/overspend";
import { countTargetWords } from "@/lib/target-status";
import { procRolesFor } from "@/lib/procurement";
import { farmerNames, projectByCode, setupFor } from "@/server/field-store";
import { DONE, stepById } from "@/lib/procurement";
import { handRecordedCounts } from "@/server/kobo-fed";
import { loadReview, rawReview } from "@/server/monthly-review-store";
import { loadPlan } from "@/server/procurement-plan-store";
import { awaiting as awaitingPlan } from "@/lib/procurement-plan";
import { STUCK_DAYS, approverFor, isStuck } from "@/lib/grants";
import { realToday } from "@/lib/clock";
import { projectProcurementCards } from "@/server/boards-store";
import { grantRules, loadGrantBook, mayApprove } from "@/server/grants-store";
import { rawQpr } from "@/server/qpr-store";
import { loadActivities } from "@/server/activities-store";
import { joinRunning, reportQuarter, shareRunning } from "@/server/next-report";
import { early } from "@/server/early";

/**
 * Everything Home needs for a database project, computed once: where results stand against the
 * workplan (as of this month), where money stands against the budget and the time gone, what is
 * waiting for this person, the next deadlines, and the work in season. The page chooses what each
 * role sees first.
 */

/**
 * Something waiting on a person. `bucket` says what kind of thing it is, for Home's three groups:
 * approve (a sign-off or acceptance only they can give), fix (something wrong to put right), due
 * (something to hand in by a date).
 */
export type Bucket = "approve" | "fix" | "due";
/** `msg` puts the row in the reader's language; vars named "month" hold "YYYY-MM" and are written out on screen. */
export type HomeAction = { key: string; for: Lens; bucket: Bucket; urgent: boolean; text: string; msg?: { key: string; vars?: Record<string, string | number> }; href: string; /** The day (YYYY-MM-DD) the oldest thing in this row began to wait, where the app knows it: Home says how long. */ since?: string };

/** The earliest of some days, or undefined when there are none. */
const oldest = (days: (string | null | undefined)[]) => days.filter((d): d is string => !!d).map((d) => d.slice(0, 10)).sort()[0];
export type Lens = "lead" | "hr" | "mel" | "field" | "finance" | "procurement";

const monthOf = (d: Date) => d.toISOString().slice(0, 7);
const prevMonth = (m: string) => (m.endsWith("-01") ? `${Number(m.slice(0, 4)) - 1}-12` : `${m.slice(0, 4)}-${String(Number(m.slice(5)) - 1).padStart(2, "0")}`);
const quarterStart = (d: string) => `${d.slice(0, 4)}-${String(Math.floor((Number(d.slice(5, 7)) - 1) / 3) * 3 + 1).padStart(2, "0")}-01`;
const addQuarter = (q: string) => (q.slice(5, 7) === "10" ? `${Number(q.slice(0, 4)) + 1}-01-01` : `${q.slice(0, 4)}-${String(Number(q.slice(5, 7)) + 3).padStart(2, "0")}-01`);
const qLabel = (q: string) => `${q.slice(0, 4)}-Q${Math.floor((Number(q.slice(5, 7)) - 1) / 3) + 1}`;
const monthName = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/**
 * Which views a person gets on Home, most senior first. `hrStaff`: they hold the HR or payroll
 * role type, so their Home is about the organization's people, not a project's activities.
 */
export function lensesFor(u: AppUser, hrStaff = false): Lens[] {
  const out: Lens[] = [];
  if (u.admin || u.project.some((r) => r === "plan-approver" || r === "monthly-review")) out.push("lead");
  if (hrStaff) out.push("hr");
  const proc = procRolesFor(u);
  if (u.project.includes("mel-owner")) out.push("mel");
  // Delivery before money and process: the people who run activities (field staff, technical
  // leads, budget holders) open on their activities and results.
  if (u.fieldAccess === "edit" || proc.includes("holder")) out.push("field");
  if (u.project.includes("finance-import") || proc.includes("finance")) out.push("finance");
  // Procurement is the view of the people who run the workflow, not of everyone who requests a purchase.
  if (proc.some((r) => r === "procurement" || r === "approver" || r === "ho")) out.push("procurement");
  return out.length ? out : ["field"];
}

async function holdsHrRole(personId: string) {
  const holders = ((await (await import("@/server/hr-store")).loadHr().catch(() => null))?.state.rules?.holders ?? {}) as Record<string, string[]>;
  return !!(holders.hr?.includes(personId) || holders.payroll?.includes(personId));
}

/**
 * What the grant and procurement rows below read. Started with Home's first reads: they need
 * nothing Home works out first. Whether the large procurements are read depends on the lead and
 * procurement views, which the HR role (the only thing not known yet) does not change. The week
 * ahead (`full` false) reads no large procurements: they only make a "stuck" row, which it does not show.
 */
function grantAndProcurementReads(code: string, name: string, u: AppUser, full = true) {
  const views = lensesFor(u);
  const cards = full && (views.includes("lead") || views.includes("procurement")) && u.procurementAccess !== "none" ? projectProcurementCards({ code, name, sandbox: false }, "Large").catch(() => []) : Promise.resolve([]);
  return early(Promise.all([loadGrantBook(code).catch(() => null), grantRules(code).catch(() => null), mayApprove(u, "cop"), mayApprove(u, "ho"), cards]));
}

async function grantAndProcurementRows(code: string, u: AppUser, lenses: Lens[], actions: HomeAction[], reads: ReturnType<typeof grantAndProcurementReads>) {
  const [book, rules, cop, ho, cards] = await reads;
  const today = realToday();
  if (book && rules) {
    const toApprove = book.items.filter((g) => g.status === "open" && g.step === "approval" && !g.approval && (approverFor(g, rules) === "ho" ? ho : cop));
    if (toApprove.length) {
      const n = toApprove.length;
      actions.push({ key: "grants-approve", for: "lead", bucket: "approve", urgent: true, text: n === 1 ? "Approve 1 grant" : `Approve ${n} grants`, msg: { key: n === 1 ? "cn.ha.approveGrant1" : "cn.ha.approveGrant", vars: { n } }, href: n === 1 ? `/work/grants?project=${encodeURIComponent(code)}&open=${toApprove[0].id}` : "/work/grants" });
    }
    const stuck = lenses.includes("lead") ? book.items.filter((g) => g.status === "open" && isStuck(g.since, today)) : [];
    if (stuck.length) {
      const n = stuck.length;
      actions.push({ key: "grants-stuck", for: "lead", bucket: "fix", urgent: false, text: `${n} ${n === 1 ? "grant has" : "grants have"} waited more than ${STUCK_DAYS} days in one step`, msg: { key: n === 1 ? "cn.ha.stuckGrant1" : "cn.ha.stuckGrant", vars: { n, days: STUCK_DAYS } }, href: n === 1 ? `/work/grants?project=${encodeURIComponent(code)}&open=${stuck[0].id}` : "/work/grants" });
    }
  }
  if ((lenses.includes("lead") || lenses.includes("procurement")) && u.procurementAccess !== "none") {
    const stuck = cards.filter((c) => c.stage >= 0 && isStuck(c.since, today));
    if (stuck.length) {
      const n = stuck.length;
      actions.push({ key: "procs-stuck", for: lenses.includes("procurement") ? "procurement" : "lead", bucket: "fix", urgent: false, text: `${n} large ${n === 1 ? "procurement has" : "procurements have"} waited more than ${STUCK_DAYS} days in one step`, msg: { key: n === 1 ? "cn.ha.stuckProc1" : "cn.ha.stuckProc", vars: { n, days: STUCK_DAYS } }, href: n === 1 ? `/work?source=procurement&open=${encodeURIComponent(stuck[0].id)}&project=${encodeURIComponent(code)}` : "/work/procurements" });
    }
  }
}

/**
 * Home for one project and one person. The week ahead reads Home for every project at the same
 * moment Home's own page reads it for the open one: it joins that read instead of doing it again
 * (server/next-report joinRunning). Home itself always reads afresh.
 */
const homeKey = (code: string, u: AppUser) => `home:${code}:${JSON.stringify(u)}`;
export function loadHome(code: string, u: AppUser) {
  return shareRunning(homeKey(code, u), () => readHome(code, u));
}

/**
 * The part of Home the week ahead reads (server/week-store): the "On time" and "On budget" panels,
 * the results counts and the rows waiting for the person. Worked out by the same functions as Home
 * itself (homeStanding, homeActions), so the two can never disagree; it leaves out what only Home
 * shows (deadlines, the season, the KoboToolbox panel, tasks, field steps), and their reads.
 * Rows only Home shows may be missing here: every approval row is here, and MEL's rows the week reads.
 */
export type HomeForWeek = {
  schedule: ReturnType<typeof homeStanding>["schedule"];
  budget: ReturnType<typeof homeStanding>["budget"];
  mel: { pending: number; queried: number; toCheck: number };
  actions: HomeAction[];
};
export async function homeForWeek(code: string, u: AppUser): Promise<HomeForWeek> {
  const project = await projectByCode(code);
  const today = new Date().toISOString().slice(0, 10);
  const month = monthOf(new Date());
  const lastQ = quarterStart(`${prevMonth(quarterStart(today).slice(0, 7))}-01`);
  const reads = waitingReads(code, u, project, false);
  const [review, last, lastReleased, allPlan] = await Promise.all([loadReview(code, month, u), rawReview(project.id, prevMonth(month)), releasedOf(project.id, qLabel(lastQ)), loadPlan(code)]);
  const { schedule, budget } = homeStanding(review);
  const { actions } = await homeActions({ code, u, project, today, month, lastQ, review, last, lastReleased, allPlan, budget, reads, full: false });
  return { schedule, budget, mel: melCounts(review.results, u), actions };
}
/** Home as the week ahead reads it: Home's own answer when the same read is already under way, else only the part the week reads. */
export function homeForWeekJoining(code: string, u: AppUser): Promise<HomeForWeek> {
  return joinRunning<HomeForWeek>(homeKey(code, u), () => homeForWeek(code, u));
}

type Project = Awaited<ReturnType<typeof projectByCode>>;
type Review = Awaited<ReturnType<typeof loadReview>>;

/**
 * Whether a quarter's report is released: its own saved report's stamp (one not saved yet is not
 * released), as loadQpr(...).released gives it without also reading the quarter before and the lines'
 * reasons. Read as the whole document on purpose: the monthly review reads the same report in the
 * same request (this quarter's report carries the last one forward), and a read-only request reads
 * it once for both (server/request-memo), where a separate query for the stamp alone would be one more.
 */
const releasedOf = async (projectId: string, quarter: string) => !!(await rawQpr(projectId, quarter))?.released;

/** The results counts Home's MEL panel shows and the week ahead reads. */
const melCounts = (results: Review["results"], u: AppUser) => ({
  pending: results.filter((r) => r.status === "pending").length,
  queried: results.filter((r) => r.status === "queried").length,
  toCheck: results.filter((r) => r.status === "pending" && r.by !== u.id).length,
});

/**
 * What the rows waiting for a person read, started at once: none needs another. `full` false (the
 * week ahead) leaves out the reads of rows only Home shows (the HR role, which only says which view
 * a row sits under; unmatched KoboCollect accounts; forms that count toward no target).
 */
function waitingReads(code: string, u: AppUser, project: Project, full: boolean) {
  // For the people who can match a KoboCollect account to a person (the project manager, plan approvers, administrators).
  const matchesAccounts = u.kind === "employee" && (canEditProject(u) || !!u.admin);
  return {
    hrRole: full ? early(holdsHrRole(u.id)) : null,
    koboRule: early(koboApprovalFor(code)),
    people: early(people()),
    grants: grantAndProcurementReads(code, project.name, u, full),
    // Accepted results changed in KoboToolbox afterwards, for MEL (the HR role does not change who is MEL).
    mismatches: lensesFor(u).includes("mel") ? early(koboMismatches(project.id)) : null,
    forms: early(
      db
        .select({ source: s.evidence.source, form: s.evidence.form, by: s.evidence.completedBy, at: s.evidence.completedAt, made: s.evidence.createdAt })
        .from(s.evidence)
        .where(and(eq(s.evidence.projectId, project.id), inArray(s.evidence.form, ["readiness", "training", "visit"]), eq(s.evidence.reviewStatus, "pending"), isNull(s.evidence.koboRemovedAt))),
    ),
    // For the people who can link a form to a target: the same, and the MEL owner.
    formsState: full && (matchesAccounts || u.project.includes("mel-owner")) ? early(koboState(code).catch(() => null)) : null,
    accounts: full && matchesAccounts ? early(db.selectDistinct({ account: s.evidence.completedBy }).from(s.evidence).where(and(eq(s.evidence.projectId, project.id), eq(s.evidence.source, "kobo"), isNotNull(s.evidence.completedBy)))) : null,
    proposals: project.organizationId ? early(proposalWork(project.organizationId, u).catch(() => [])) : null,
    procurements: u.procurementAccess === "none" ? null : early(loadProcurements(code).catch(() => [])),
    // Bills paid directly, read with the rest rather than after them.
    bills: u.kind === "employee" ? early(loadBills(code).catch(() => null)) : null,
  };
}

async function readHome(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const today = new Date().toISOString().slice(0, 10);
  const month = monthOf(new Date());
  const thisQ = quarterStart(today);
  const lastQ = quarterStart(`${prevMonth(thisQ.slice(0, 7))}-01`);
  // Started with the full load below and awaited further down where each is used: none depends
  // on another, and one after another each costs a round trip to the database.
  const rqLater = early(reportQuarter(code, today));
  const setLater = early(rqLater.then((q) => reportDeadline(code, quarterRange(q).to, 60, "quarterlyReportDays")));
  const reads = waitingReads(code, u, project, true);
  // Not started early: listing distributions first deals with records that have just arrived
  // (server/distribution processPending), which writes. It runs in homeActions, where it always did,
  // and the reads that must see its writes (open tasks, the field records) start once it is done.
  const connLater = early(db.select({ at: s.koboConnections.lastSyncedAt }).from(s.koboConnections).where(eq(s.koboConnections.projectId, project.id)).limit(1));
  const byHandLater = early(handRecordedCounts());
  // One full load (results, statuses, budget, this quarter's report checks); the rest only what they decide.
  // Of last quarter's report only whether it is released (releasedOf).
  const [review, last, lastReleased, plan, allPlan, acts] = await Promise.all([
    loadReview(code, month, u),
    rawReview(project.id, prevMonth(month)),
    releasedOf(project.id, qLabel(lastQ)),
    db.select().from(s.workplanItems).where(eq(s.workplanItems.projectId, project.id)),
    loadPlan(code),
    loadActivities(code, u).catch(() => null),
  ]);
  const report = { checks: review.checks, results: review.results };

  const { schedule, budget } = homeStanding(review);

  // The report's deadline comes from the same function as pre-flight (a "Report deadline" in Tasks,
  // else the donor's rule), so Home never shows a different date. Only when neither sets one does
  // Home fall back to the 10th of the month after the quarter, and says that it is not a set date.
  // The report in question is the one pre-flight and Home's panel are about (server/next-report).
  const rq = await rqLater;
  const set = await setLater;
  const reportDue = set.due ?? `${addQuarter(quarterRange(rq).from).slice(0, 7)}-10`;
  const dueNote = set.source?.kind === "milestone" ? `From Work: ${set.source.title}` : set.source?.kind === "policy" ? `${set.source.days} days after the quarter, from the project's reporting rules` : "No deadline is set in Work or in the donor's rules; ROP usually sends it about the 10th after each quarter";
  const deadlines = [
    { key: "qpr", what: `${rq.replace("-", " ")} report to the donor`, date: reportDue, days: days(today, reportDue), note: dueNote, href: `/progress/report?q=${rq}` },
    { key: "review", what: `${new Date(`${month}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })} monthly review`, date: new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10), days: 0, note: "Signed off at the month's end", href: "/progress/review" },
  ].map((d) => ({ ...d, days: days(today, d.date) }));

  // In season: what the workplan schedules now and next quarter, and purchases due to start.
  const ours = ourWork(plan);
  const nextQ = addQuarter(thisQ);
  const inQ = (q: string) => [...new Map(ours.filter((w) => ((w.active as string[]) ?? []).includes(q)).map((w) => [w.code, { code: w.code, title: w.title, quarters: quartersLabel(((w.active as string[]) ?? []).filter((d) => d.startsWith(q.slice(0, 4)))) }])).values()];
  const purchases = allPlan
    .filter((p) => p.status !== "started" && p.startBy && p.startBy >= today && days(today, p.startBy) <= 60)
    .sort((a, b2) => (a.startBy ?? "").localeCompare(b2.startBy ?? ""))
    .map((p) => ({ key: p.key, title: p.title, startBy: p.startBy, days: days(today, p.startBy!) }));
  // This quarter's work as it stands: who owns it, whether it has started, and its result so far.
  const qEnd = new Date(Date.UTC(Number(thisQ.slice(0, 4)), Number(thisQ.slice(5, 7)) + 2, 0)).toISOString().slice(0, 10);
  const now = inQ(thisQ).map((a) => {
    const rec = acts?.rows.find((r) => r.code === a.code);
    // An activity can deliver several indicators; they are linked by the indicator's workplan code.
    const ind = review.indicators.filter((i) => i.workplanCode === a.code && i.yearTarget > 0)[0];
    return {
      ...a,
      owner: rec?.ownerName ?? null,
      status: rec?.status ?? "not_started",
      timing: rec?.timing ?? "due_now",
      result: ind && ind.yearTarget > 0 ? { achieved: ind.year, target: ind.yearTarget, unit: ind.unit } : null,
    };
  });
  const season = {
    quarter: qLabel(thisQ).replace("-", " "),
    quarterEnd: qEnd,
    weeksLeft: Math.max(0, Math.ceil(days(today, qEnd) / 7)),
    now,
    next: inQ(nextQ).filter((x) => !inQ(thisQ).some((y) => y.code === x.code)),
    nextQuarter: qLabel(nextQ).replace("-", " "),
    purchases,
  };

  // Waiting for this person.
  const allResults = report.results;
  const { actions, lenses } = await homeActions({ code, u, project, today, month, lastQ, review, last, lastReleased, allPlan, budget, reads, full: true });
  const myQueried = allResults.filter((r) => r.status === "queried" && r.by === u.id);

  // Field staff who only use KoboCollect: is this project's data all collected there, and what has arrived lately.
  const [conn] = await connLater;
  const byHand = (await byHandLater).get(code) ?? 0;
  const kobo = {
    connected: !!conn,
    // Every target is counted from a form: nobody on this project records results by hand.
    only: !!conn && byHand === 0,
    lastSyncedAt: conn?.at?.toISOString() ?? null,
    recent: allResults
      .filter((r) => !!r.kobo)
      .sort((a, b2) => b2.at.localeCompare(a.at))
      .slice(0, 5)
      .map((r) => ({ id: r.id, date: r.date, value: r.value, status: r.status, target: review.indicators.find((i) => i.code === r.indicator)?.name ?? r.indicator, unit: review.indicators.find((i) => i.code === r.indicator)?.unit ?? "" })),
  };
  // Accepted this quarter with no file or link behind it.
  const proof = report.results.filter((r) => r.status === "accepted" && r.date >= thisQ && !(r.files.length + (r.links?.length ?? 0))).length;
  return {
    // "Afghanistan Community Resilience Programme (ACRP)" reads as "ACRP" in a sentence.
    project: { code, name: project.name, short: project.name.match(/\(([^)]+)\)\s*$/)?.[1] ?? project.name, stage: project.stage },
    today,
    lenses,
    schedule,
    budget,
    deadlines,
    season,
    actions,
    kobo,
    mel: { ...melCounts(allResults, u), noProof: proof, quarter: rq.replace("-", " ") },
    field: { queried: myQueried.length, mine: allResults.filter((r) => r.by === u.id && r.date >= thisQ).length },
  };
}
export type HomeView = Awaited<ReturnType<typeof readHome>>;

type ActionsInput = {
  code: string;
  u: AppUser;
  project: Project;
  today: string;
  month: string;
  /** The first day of last quarter. */
  lastQ: string;
  review: Review;
  /** Last month's review, as saved. */
  last: Awaited<ReturnType<typeof rawReview>>;
  /** Whether last quarter's report is released. */
  lastReleased: boolean;
  allPlan: Awaited<ReturnType<typeof loadPlan>>;
  budget: ReturnType<typeof homeStanding>["budget"];
  reads: ReturnType<typeof waitingReads>;
  /** False for the week ahead: only the rows it reads (every approval, and MEL's), and only their reads. */
  full: boolean;
};

/** What is waiting for this person on one project, as Home's rows, in Home's order. */
async function homeActions(c: ActionsInput): Promise<{ actions: HomeAction[]; lenses: Lens[] }> {
  const { code, u, project, today, month, lastQ, review, allPlan, budget, reads, full } = c;
  const lastReview = { month: prevMonth(month), review: c.last };
  const allResults = review.results;
  const actions: HomeAction[] = [];
  // The HR role only adds the HR view, which decides no row below: only which view a row sits under.
  const lenses = lensesFor(u, reads.hrRole ? await reads.hrRole : false);
  if (lenses.includes("lead")) {
    if (project.stage === "Design") actions.push({ key: "signoff", for: "lead", bucket: "approve", urgent: true, // The sign-off control for a saved project is on Progress, not on Home.
      text: "Sign off the plan and budget to start Execute", msg: { key: "ha.signoff" }, href: "/progress" });
    for (const r of [lastReview, review]) {
      const waiting = r.review.changes.filter((ch) => ch.status === "proposed" && ch.proposedBy !== u.id).length;
      if (waiting) actions.push({ key: `decide-${r.month}`, for: "lead", bucket: "approve", urgent: true, text: `Decide ${waiting} proposed plan ${waiting === 1 ? "change" : "changes"} in the ${monthName(r.month)} review`, msg: { key: waiting === 1 ? "ha.decide1" : "ha.decide", vars: { n: waiting, month: r.month } }, href: "/progress/review" });
    }
    if (!lastReview.review.signedOff) actions.push({ key: "review-signoff", for: "lead", bucket: "approve", urgent: false, text: `Sign off the ${monthName(lastReview.month)} monthly review`, msg: { key: "ha.reviewSignoff", vars: { month: lastReview.month } }, href: "/progress/review" });
    // Only a quarter the project ran in has a report to release (lib/period-report quartersDue).
    if (!c.lastReleased && quartersDue(Number(lastQ.slice(0, 4)), project.startDate, project.endDate, today).includes(qLabel(lastQ))) actions.push({ key: "release", for: "lead", bucket: "approve", urgent: false, text: `Release the ${qLabel(lastQ).replace("-", " ")} report in the app`, msg: { key: "ha.release", vars: { quarter: qLabel(lastQ).replace("-", " ") } }, href: "/progress/report" });
  }
  // The procurement calendar: items waiting for this person's approval (procurement manager or the
  // line's technical lead), and approved items whose request this technical lead has not made yet.
  // Without these, an approval or a late purchase waits on someone who was never told.
  if (u.procurementAccess !== "none") {
    const mine = awaitingPlan(allPlan, u);
    const toApprove = [...new Map([...mine.asManager, ...mine.asLead].map((i) => [i.key, i])).values()];
    if (toApprove.length)
      actions.push({ key: "plan-approve", for: lenses.includes("procurement") ? "procurement" : lenses[0], bucket: "approve", urgent: toApprove.some((i) => i.startBy <= today), text: toApprove.length === 1 ? `Approve ${toApprove[0].title} on the procurement calendar` : `Approve ${toApprove.length} purchases on the procurement calendar`, href: "/work/plan" });
    const toStart = allPlan.filter((i) => i.status === "approved" && i.techLead === u.id && days(today, i.startBy) <= 14);
    for (const i of toStart)
      actions.push({ key: `plan-start:${i.key}`, for: lenses.includes("procurement") ? "procurement" : lenses[0], bucket: "due", urgent: i.startBy < today, text: `Make the request for ${i.title}: ${i.startBy < today ? `it was due to start ${i.startBy}` : `start by ${i.startBy}`}`, href: "/work/plan" });
  }

  // Bills paid directly: a bill waiting for approval is told to the people who approve bills, and a
  // bill sent back to the people who record them. Without these rows a bill waits on someone who
  // was never told. The person who recorded a bill does not approve it, so it is not theirs to approve.
  if (u.kind === "employee") {
    const book = await (reads.bills ?? null);
    const waiting = (book?.items ?? []).filter((b) => b.status === "waiting" && b.raised.by !== u.id);
    const back = toCorrect(book?.items ?? []);
    // The person's own procurement roles answer most cases; the HR role holders are read only when they do not.
    const own = { record: u.procurement.includes("finance"), approve: u.procurement.includes("approver") };
    const settled = (!waiting.length || own.approve) && (!back.length || own.record);
    const roles = !waiting.length && !back.length ? null : settled ? own : await billRoles(u).catch(() => own);
    if (roles?.approve && waiting.length)
      actions.push({ key: "bills-approve", for: lenses.includes("lead") ? "lead" : lenses[0], bucket: "approve", urgent: true, text: waiting.length === 1 ? `Approve the bill from ${waiting[0].payee}` : `Approve ${waiting.length} bills paid directly`, href: "/work/bills", since: oldest(waiting.map((b) => b.raised.at)) });
    if (roles?.record && back.length)
      actions.push({ key: "bills-correct", for: lenses.includes("finance") ? "finance" : lenses[0], bucket: "fix", urgent: true, text: back.length === 1 ? `Correct the bill from ${back[0].payee} that was sent back and record it again` : `Correct ${back.length} bills that were sent back and record them again`, href: "/work/bills", since: oldest(back.map((b) => b.returned?.at)) });
    // A filed bill that is not in the books yet: Finance posts it with one press (decision AI).
    // Until then the budget's "spent" does not hold it. A bill whose entry was reversed is told on Bills itself.
    const toPost = (book?.items ?? []).filter((b) => !billBooksProblem(b, NON_CONTRACT) && !b.postings?.length);
    if (toPost.length && (u.procurement.includes("finance") || u.project.includes("finance-import") || (await mayPostToBooks(u).catch(() => false))))
      actions.push({ key: "bills-post", for: lenses.includes("finance") ? "finance" : lenses[0], bucket: "due", urgent: false, text: toPost.length === 1 ? `Post the bill from ${toPost[0].payee} to the books` : `Post ${toPost.length} filed bills to the books`, href: "/work/bills", since: oldest(toPost.map((b) => b.voucher?.at)) });
    // The same for a purchase recorded as paid: it counts as spent once Finance has posted it.
    const paidOnes = ((await (reads.procurements ?? null)) ?? []).flatMap((p) => (p.payments ?? []).filter((r) => !paymentBooksProblem(p, r)).map((r) => ({ p, r })));
    if (paidOnes.length && (u.procurement.includes("finance") || u.project.includes("finance-import") || (await mayPostToBooks(u).catch(() => false)))) {
      const kept = (await loadPurchaseBooks(code).catch(() => ({ postings: {} as Record<string, unknown[]> }))).postings;
      const open = paidOnes.filter((x) => !kept[paymentKey(x.p.id, x.r.n)]?.length);
      if (open.length)
        actions.push({ key: "purchases-post", for: lenses.includes("finance") ? "finance" : lenses[0], bucket: "due", urgent: false, text: open.length === 1 ? `Post the payment to ${open[0].r.supplier} to the books` : `Post ${open.length} purchase payments to the books`, href: `/work?source=procurement&open=${open[0].p.id}&project=${code}`, since: oldest(open.map((x) => x.r.paid.date)) });
    }
  }

  // Who approves KoboCollect data on this project (lib/kobo-approval): results made from a form
  // and distributions from a phone wait for that person, not for anyone with the MEL role.
  const koboRule = await reads.koboRule;
  const team = (await reads.people).filter((p) => onProject(p, code));
  const koboMine = mayApproveKobo(u, koboRule);
  const isMel = lenses.includes("mel");
  // Also for someone a record has fallen to because its collector is the only usual approver.
  const fallsToMe = !isMel && !koboMine && allResults.some((r) => r.status === "pending" && r.by !== u.id && mayDecideRecord(u, team, { fromKobo: !!r.kobo, collector: r.kobo ? collectorOf(r.kobo.by, koboRule, team) : r.by }, koboRule));
  if (isMel || koboMine || fallsToMe) {
    const mineToCheck = allResults.filter((r) => r.status === "pending" && r.by !== u.id && mayDecideRecord(u, team, { fromKobo: !!r.kobo, collector: r.kobo ? collectorOf(r.kobo.by, koboRule, team) : r.by }, koboRule));
    const toCheck = mineToCheck.length;
    if (toCheck) actions.push({ key: "accept", for: isMel ? "mel" : lenses[0], bucket: "approve", urgent: true, text: `Accept or query ${toCheck} ${toCheck === 1 ? "result" : "results"} waiting for you`, msg: { key: toCheck === 1 ? "ha.accept1" : "ha.accept", vars: { n: toCheck } }, href: "/progress/results", since: oldest(mineToCheck.map((r) => r.at)) });
    // What blocks the report is listed from pre-flight itself (Home reads /next-report), so the
    // count here can never differ from the pre-flight screen's.
  }
  // Field forms (readiness, training, farm visit) waiting in the review queue on Results and proof,
  // for whoever may decide each one; accepting them is what moves farmers in Field activities.
  {
    const forms = await reads.forms;
    const mine = forms.filter((f) => {
      const fromKobo = f.source === "kobo";
      return mayDecideRecord(u, team, { fromKobo, collector: fromKobo ? collectorOf(f.by, koboRule, team) : f.by }, koboRule);
    });
    const n = mine.length;
    if (n) actions.push({ key: "field-forms", for: isMel ? "mel" : lenses[0], bucket: "approve", urgent: false, text: `Check ${n} field ${n === 1 ? "form" : "forms"} from KoboCollect (readiness, training, farm visits)`, msg: { key: n === 1 ? "ha.fieldForms1" : "ha.fieldForms", vars: { n } }, href: "/progress/results#field-records", since: oldest(mine.map((f) => f.made?.toISOString())) });
    // The technical lead does not accept field forms but may send one back with a note
    // (lib/kobo-approval maySendBack). One quiet row, only when the forms are not already theirs
    // to check above, so it never doubles up with the "Check" row.
    if (!n) {
      const readable = forms.filter((f) => maySendBack(u, team, { fromKobo: f.source === "kobo", collector: f.source === "kobo" ? collectorOf(f.by, koboRule, team) : f.by, form: f.form }));
      const k = readable.length;
      if (k) actions.push({ key: "field-forms-send-back", for: lenses[0] ?? "field", bucket: "fix", urgent: false, text: `${k} field ${k === 1 ? "form is" : "forms are"} waiting for MEL: send back any that need fixing, with a note`, msg: { key: k === 1 ? "ha.sendBack1" : "ha.sendBack", vars: { n: k } }, href: "/progress/results#field-records" });
    }
  }
  // KoboCollect accounts that have sent records and are not matched to a person. Until they are,
  // the app cannot tell who collected those records, so the rule that nobody approves what they
  // collected cannot hold for them (lib/kobo-approval collectorOf).
  if (reads.accounts) {
    const sent = [...new Set((await reads.accounts).map((x) => (x.account ?? "").trim()).filter(Boolean))];
    const n = sent.filter((account) => !collectorOf(account, koboRule, team)).length;
    if (n) actions.push({ key: "kobo-accounts", for: lenses[0] ?? "lead", bucket: "fix", urgent: false, text: `Match ${n} KoboCollect ${n === 1 ? "account" : "accounts"} to the ${n === 1 ? "person who uses it" : "people who use them"}: until then the app cannot tell who collected ${n === 1 ? "its" : "their"} records`, href: "/setup?step=kobo-connect" });
  }
  // Linked KoboCollect forms that count toward no target: their records arrive, move farmers and
  // are kept, but add to no result, so the work never shows on Progress or in a report. A form
  // counts through a question linked to a target in setup, through a target counted straight from
  // that kind of form, or (a distribution form) through the input package's target.
  if (reads.formsState) {
    const state = await reads.formsState;
    const linked = new Set((state?.mappings ?? []).map((m) => m.assetUid));
    let loose = (state?.forms ?? []).filter((f) => !linked.has(f.uid));
    if (loose.length) {
      // A target can also be counted straight from one kind of form (its source is "training", "readiness", "visit" or "distribution").
      const direct = new Set((await db.selectDistinct({ source: s.indicators.source }).from(s.indicators).where(eq(s.indicators.projectId, project.id))).map((r) => r.source));
      loose = loose.filter((f) => !f.purpose || !direct.has(f.purpose));
    }
    if (loose.some((f) => f.purpose === "distribution") && (await setupFor(code).catch(() => null))?.target) loose = loose.filter((f) => f.purpose !== "distribution");
    const n = loose.length;
    if (n) actions.push({ key: "kobo-forms-loose", for: lenses[0] ?? "lead", bucket: "fix", urgent: false, text: `${n} linked KoboCollect ${n === 1 ? "form counts" : "forms count"} toward no target (${loose.map((f) => f.name).slice(0, 3).join(", ")}${n > 3 ? "…" : ""}): link ${n === 1 ? "it" : "each"} to a target, or ${n === 1 ? "its" : "their"} records add to no result`, href: "/setup?step=kobo-map" });
  }
  // Read once for both rows below.
  const dists = await listDistributions(code).catch(() => []);
  // Read once the list above has dealt with records that just arrived (it may have written), and
  // all together: names, the field records, open tasks. The field records come from the read the
  // list itself made when nothing was written (server/distribution fieldItemRows).
  const manages = u.kind === "employee" && (canEditProject(u) || u.field.includes("manager"));
  const fieldWork = (u.field.length && u.fieldAccess !== "none") || manages;
  const itemsLater = full && fieldWork ? early(fieldItemRows(project.id).then((rows) => rows.map((r) => r.data as FieldItem))) : null;
  const openLater = full
    ? early(
        db
          .select({ id: s.workItems.id, title: s.workItems.title, date: s.workItems.date, assignee: s.workItems.assignee, sourceKey: s.workItems.sourceKey })
          .from(s.workItems)
          .where(and(eq(s.workItems.projectId, project.id), eq(s.workItems.type, "task"), isNull(s.workItems.doneAt)))
          .orderBy(asc(s.workItems.date)),
      )
    : null;
  // The farmer's name first for people allowed to see it ("Shirin Ahmadi (F-0007)"); the number alone for anyone else.
  const names = dists.length ? await farmerNames(project.id, u) : new Map<string, string>();
  const farmerOf = (id: string) => (names.get(id) ? `${names.get(id)} (${id})` : id);
  if (koboRule.who !== "manager") {
    const unchecked = dists.filter((d) => d.koboCheck.needed && d.koboCheck.who.includes(u.id)).reverse();
    const n = unchecked.length;
    if (n) actions.push({ key: "kobo-check", for: lenses[0], bucket: "approve", urgent: true, text: n === 1 ? `Check the KoboCollect distribution to ${farmerOf(unchecked[0].farmerId)} before it goes to the project manager` : `Check ${n} KoboCollect distributions before they go to the project manager`, href: `/approve/${encodeURIComponent(code)}/${unchecked[0].id}`, since: oldest(unchecked.map((d) => d.waitingSince)) });
  }
  // Input distributions waiting for the project manager (server/distribution), oldest first.
  // One from KoboCollect is hers once it has been checked.
  // Hers unless she recorded it herself: then it is for another manager, or the person she reports to.
  {
    const waiting = dists.filter((d) => d.status === "pending" && !d.koboCheck.needed && d.approvers.includes(u.id)).reverse();
    const n = waiting.length;
    if (n) actions.push({ key: "distributions", for: lenses.includes("field") ? "field" : (lenses[0] ?? "lead"), bucket: "approve", urgent: true, text: n === 1 ? `Approve the input distribution to ${farmerOf(waiting[0].farmerId)}` : `Approve ${n} input distributions`, href: `/approve/${encodeURIComponent(code)}/${waiting[0].id}`, since: oldest(waiting.map((d) => d.waitingSince)) });
  }
  // Proposals belong to the organization, so their rows show on Home whichever project is open:
  // what this person must sign first, then what they own (lib/funding-proposals mine).
  if (project.organizationId) {
    for (const w of (await reads.proposals) ?? []) {
      const href = `/work/proposals?open=${w.proposal.id}`;
      const lens = lenses[0] ?? "lead";
      const left = w.proposal.deadline ? hoursLeft(w.proposal.deadline, new Date()) : null;
      const when = left == null ? "" : left < 0 ? ", past the donor's deadline" : left < 72 ? `, ${left} hours to the donor's deadline` : `, ${Math.floor(left / 24)} days to the donor's deadline`;
      if (w.toSign.length) actions.push({ key: `proposal-sign-${w.proposal.id}`, for: lens, bucket: "approve", urgent: true, text: `Sign ${w.toSign.length === 1 ? w.toSign[0].title : `${w.toSign.length} items`} for the proposal ${w.proposal.title}${when}`, href });
      if (w.items.length) actions.push({ key: `proposal-${w.proposal.id}`, for: lens, bucket: "due", urgent: left != null && left < 72, text: `Proposal ${w.proposal.title}: ${w.items.length === 1 ? `${w.items[0].title} is yours` : `${w.items.length} items are yours`}${when}`, href });
    }
  }
  const myQueried = allResults.filter((r) => r.status === "queried" && r.by === u.id);
  // Accepted results whose KoboToolbox submission was changed or deleted afterwards: MEL reopens them.
  if (lenses.includes("mel")) {
    const n = (await (reads.mismatches ?? koboMismatches(project.id))).size;
    if (n) actions.push({ key: "kobo-mismatch", for: "mel", bucket: "fix", urgent: true, text: `${n} accepted ${n === 1 ? "result no longer matches" : "results no longer match"} KoboToolbox: reopen ${n === 1 ? "it" : "them"} to check the new figure`, href: `/progress/results?project=${encodeURIComponent(code)}` });
  }
  if (myQueried.length) actions.push({ key: "queried", for: "field", bucket: "fix", urgent: true, text: `Fix ${myQueried.length} ${myQueried.length === 1 ? "result" : "results"} MEL queried`, msg: { key: myQueried.length === 1 ? "ha.queried1" : "ha.queried", vars: { n: myQueried.length } }, href: "/progress/results" });
  if (lenses.includes("finance")) {
    const wanted = prevMonth(month);
    if (!budget.importedTo || budget.importedTo < wanted) actions.push({ key: "import", for: "finance", bucket: "due", urgent: true, text: `Import Finance's workbook for ${monthName(wanted)} (imported to ${budget.importedTo ? monthName(budget.importedTo) : "nothing yet"})`, msg: budget.importedTo ? { key: "ha.import", vars: { month: wanted, to: budget.importedTo } } : { key: "ha.importNone", vars: { month: wanted } }, href: "/progress/report" });
  }
  // Overspent lines are explained by the people who write the report (the MEL owner or a lead)
  // and by Finance (lib/overspend mayExplainOverspend), as the Budget page and its API require.
  if (full && mayExplainOverspend(u)) {
    // Only the lines nobody has explained yet: an explained line stays overspent, but there is nothing left to ask for.
    const reasons = budget.overspent.length ? await loadLineReasons(project.id) : {};
    const toExplain = budget.overspent.filter((l) => !reasons[l.code]);
    if (toExplain.length) actions.push({ key: "overspent", for: isMel ? "mel" : lenses.includes("lead") ? "lead" : lenses[0], bucket: "fix", urgent: false, text: `Explain ${toExplain.length} overspent budget ${toExplain.length === 1 ? "line" : "lines"}`, msg: { key: toExplain.length === 1 ? "ha.overspent1" : "ha.overspent", vars: { n: toExplain.length } }, href: "/progress/budget" });
  }

  // Field activities waiting on a role this person holds: their day's work, ahead of anything about reports.
  // Farmers at Distribute that nothing has been recorded for yet, and whether the store can supply
  // them: the storekeeper is told when there is nothing to hand out, and whoever runs the field
  // programme is told to get the inputs bought, so a farmer never sits at Inputs with no one acting.
  if (fieldWork && itemsLater) {
    const items = await itemsLater;
    const waiting = items.filter((i) => i.kind === "farmer" && i.step === "distribute" && (i as { awaiting?: { status: string } }).awaiting?.status !== "pending");
    const short = waiting.length ? ((await stockFor(code).catch(() => null))?.block ?? null) : null;
    if (u.field.length && u.fieldAccess !== "none") {
      const rows = fieldRows(items, u.field, code, lenses.includes("field") ? "field" : lenses[0]);
      const dist = rows.find((r) => r.key === "field:distribute");
      if (dist && short) dist.text = `${dist.text.replace(/ waiting for you$/, " waiting")}, but the store has nothing to hand out yet. ${short}`;
      actions.push(...rows);
    }
    if (manages && short) {
      // A purchase already under way on the package's budget lines: say where it is, and open it.
      const lines = new Set(((await setupFor(code).catch(() => null))?.items ?? []).map((i) => i.budgetLine));
      const coming = (await (reads.procurements ?? loadProcurements(code).catch(() => []))).filter((p) => p.step !== DONE && lines.has(p.budgetLine) && !p.grn);
      const who = waiting.length === 1 ? "1 farmer is" : `${waiting.length} farmers are`;
      actions.push({
        key: "restock",
        for: lenses.includes("lead") ? "lead" : lenses[0],
        bucket: coming.length ? "due" : "fix",
        urgent: !coming.length,
        text: coming.length
          ? `${who} waiting for inputs still being bought: ${coming.map((p) => `${p.title} (${p.id}, now at "${stepById[p.step]?.title ?? p.step}")`).join("; ")}.`
          : `The store cannot supply the input package: ${who} waiting at Distribute. ${short}`,
        href: coming.length ? `/work?source=procurement&open=${encodeURIComponent(coming[0].id)}&project=${encodeURIComponent(code)}` : "/work/plan",
      });
    }
  }

  // Purchases whose current step waits on this person: each one named, one tap from its step.
  const waitingPurchases = u.procurementAccess === "none" ? [] : purchaseRows((await reads.procurements) ?? [], u, code, lenses.includes("procurement") ? "procurement" : lenses[0]);
  actions.push(...waitingPurchases);
  // Tasks made at a handoff (a distribution sent back, a readiness correction, a payment to
  // release) and tasks given to this person: on Home, one tap from the place to act.
  for (const t of openLater ? await openLater : []) {
    // A payment to release is already listed as the purchase itself when its step is this person's.
    if (t.sourceKey?.startsWith("pay-ready:") && waitingPurchases.some((r) => r.key === `purchase:${t.sourceKey!.slice("pay-ready:".length)}`)) continue;
    const row = taskRow(t, { me: u.id, lead: lenses.includes("lead"), code, today: realToday(), lens: lenses[0] });
    if (row) actions.push(row);
  }

  // Grants and large procurements (lib/connections.ts): approvals for the people who give them, and anything stuck for the people who run the project.
  await grantAndProcurementRows(code, u, lenses, actions, reads.grants);
  return { actions, lenses };
}

/**
 * Home's "On time" and "On budget" panels, from the monthly review alone (no reads). The portfolio
 * (server/portfolio-store) judges each project with the same function, so the two never disagree.
 */
export function homeStanding(review: Awaited<ReturnType<typeof loadReview>>) {
  // On time: the indicators as of this month.
  const counts: Record<Status, number> = { completed: 0, on_track: 0, not_started: 0, delayed: 0, not_implemented: 0 };
  for (const i of review.indicators) counts[i.status] += 1;
  const late = review.indicators.filter((i) => i.status === "delayed" || i.status === "not_implemented");
  const schedule = {
    total: review.indicators.length,
    counts,
    // In the shared words (lib/target-status): "On track" with no accepted result is "No data".
    words: countTargetWords(review.indicators, Number(review.quarter.slice(-1))),
    late: late.map((i) => ({ code: i.donorCode, name: i.name, status: STATUS_LABEL[i.status], achieved: i.year, target: i.yearTarget, unit: i.unit })),
    level: (late.length === 0 ? "good" : late.length <= 2 ? "warning" : "critical") as "good" | "warning" | "critical",
  };

  // On budget.
  const b = review.budget;
  const spentPct = b.totals.approved ? (b.totals.spent / b.totals.approved) * 100 : null;
  const timePct = b.timeGone === null ? null : b.timeGone * 100;
  const overspent = b.flagged.filter((l) => l.flags.some((f) => f.level === "stop"));
  const budget = {
    currency: b.currency,
    approved: b.totals.approved,
    spent: b.totals.spent,
    forecast: b.totals.forecast,
    spentPct,
    timePct,
    importedTo: b.period?.to ?? null,
    flagged: b.flagged.length,
    overspent: overspent.map((l) => ({ code: l.code, description: l.description, spentPct: l.spentPct })),
    // The project as a whole decides the alarm: spending well ahead of the time gone, or a forecast
    // above approved. Single overspent lines, or many lines to explain, are worth watching.
    ahead: spentPct !== null && timePct !== null && spentPct > timePct + 10,
    level: (b.period === null
      ? "unknown"
      : (spentPct !== null && timePct !== null && spentPct > timePct + 10) || b.totals.forecast > b.totals.approved * 1.05
        ? "critical"
        : overspent.length || b.flagged.length > 5
          ? "warning"
          : "good") as "good" | "warning" | "critical" | "unknown",
  };

  return { schedule, budget };
}
