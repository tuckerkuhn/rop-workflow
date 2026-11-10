import { quarterRange } from "@/lib/results";
import { reportDeadline } from "@/server/preflight";
import { ourWork } from "@/lib/budget";
import { eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { quartersLabel } from "@/lib/monthly-review";
import { STATUS_LABEL, type Status } from "@/lib/qpr";
import { procRolesFor } from "@/lib/procurement";
import { projectByCode } from "@/server/field-store";
import { loadReview, rawReview } from "@/server/monthly-review-store";
import { loadPlan } from "@/server/procurement-plan-store";
import { loadQpr } from "@/server/qpr-store";
import { loadActivities } from "@/server/activities-store";

/**
 * Everything Home needs for a database project, computed once: where results stand against the
 * workplan (as of this month), where money stands against the budget and the time gone, what is
 * waiting for this person, the next deadlines, and the work in season. The page chooses what each
 * role sees first.
 */

export type HomeAction = { key: string; for: Lens; urgent: boolean; text: string; href: string };
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

export async function loadHome(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const today = new Date().toISOString().slice(0, 10);
  const month = monthOf(new Date());
  const thisQ = quarterStart(today);
  const lastQ = quarterStart(`${prevMonth(thisQ.slice(0, 7))}-01`);
  // One full load (results, statuses, budget, this quarter's report checks); the rest only what they decide.
  const [review, last, lastReport, plan, allPlan, acts] = await Promise.all([
    loadReview(code, month, u),
    rawReview(project.id, prevMonth(month)),
    loadQpr(code, qLabel(lastQ)),
    db.select().from(s.workplanItems).where(eq(s.workplanItems.projectId, project.id)),
    loadPlan(code),
    loadActivities(code, u).catch(() => null),
  ]);
  const lastReview = { month: prevMonth(month), review: last };
  const report = { checks: review.checks, results: review.results };

  // On time: the indicators as of this month.
  const counts: Record<Status, number> = { completed: 0, on_track: 0, not_started: 0, delayed: 0, not_implemented: 0 };
  for (const i of review.indicators) counts[i.status] += 1;
  const late = review.indicators.filter((i) => i.status === "delayed" || i.status === "not_implemented");
  const schedule = {
    total: review.indicators.length,
    counts,
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

  // The report's deadline comes from the same function as pre-flight (a "Report deadline" in Tasks,
  // else the donor's rule), so Home never shows a different date. Only when neither sets one does
  // Home fall back to the 10th of the month after the quarter, and says that it is not a set date.
  const set = await reportDeadline(code, quarterRange(qLabel(thisQ)).to, 60, "quarterlyReportDays");
  const reportDue = set.due ?? `${addQuarter(thisQ).slice(0, 7)}-10`;
  const dueNote = set.source?.kind === "milestone" ? `From Tasks: ${set.source.title}` : set.source?.kind === "policy" ? `${set.source.days} days after the quarter, from the donor's rules` : "No deadline is set in Tasks or in the donor's rules; ROP usually sends it about the 10th after each quarter";
  const deadlines = [
    { key: "qpr", what: `${qLabel(thisQ).replace("-", " ")} report to the donor`, date: reportDue, days: days(today, reportDue), note: dueNote, href: "/progress/report" },
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
  const actions: HomeAction[] = [];
  const lenses = lensesFor(u, await holdsHrRole(u.id));
  if (lenses.includes("lead")) {
    if (project.stage === "Design") actions.push({ key: "signoff", for: "lead", urgent: true, text: "Sign off the plan and budget to start Execute", href: "/home" });
    for (const r of [lastReview, review]) {
      const waiting = r.review.changes.filter((c) => c.status === "proposed" && c.proposedBy !== u.id).length;
      if (waiting) actions.push({ key: `decide-${r.month}`, for: "lead", urgent: true, text: `Decide ${waiting} proposed plan ${waiting === 1 ? "change" : "changes"} in the ${monthName(r.month)} review`, href: "/progress/review" });
    }
    if (!lastReview.review.signedOff) actions.push({ key: "review-signoff", for: "lead", urgent: false, text: `Sign off the ${monthName(lastReview.month)} monthly review`, href: "/progress/review" });
    if (!lastReport.released) actions.push({ key: "release", for: "lead", urgent: false, text: `Release the ${qLabel(lastQ).replace("-", " ")} report in the app`, href: "/progress/report" });
  }
  if (lenses.includes("mel")) {
    const toCheck = allResults.filter((r) => r.status === "pending" && r.by !== u.id).length;
    if (toCheck) actions.push({ key: "accept", for: "mel", urgent: true, text: `Accept or query ${toCheck} ${toCheck === 1 ? "result" : "results"} waiting for you`, href: "/progress/results" });
    const stops = report.checks.filter((c) => c.level === "stop").length;
    if (stops) actions.push({ key: "report-stops", for: "mel", urgent: false, text: `Clear ${stops} stop ${stops === 1 ? "item" : "items"} in the ${qLabel(thisQ).replace("-", " ")} report`, href: "/progress/report" });
  }
  const myQueried = allResults.filter((r) => r.status === "queried" && r.by === u.id);
  if (myQueried.length) actions.push({ key: "queried", for: "field", urgent: true, text: `Fix ${myQueried.length} ${myQueried.length === 1 ? "result" : "results"} MEL queried`, href: "/progress/results" });
  if (lenses.includes("finance")) {
    const wanted = prevMonth(month);
    if (!budget.importedTo || budget.importedTo < wanted) actions.push({ key: "import", for: "finance", urgent: true, text: `Import Finance's workbook for ${monthName(wanted)} (imported to ${budget.importedTo ? monthName(budget.importedTo) : "nothing yet"})`, href: "/progress/report" });
    if (overspent.length) actions.push({ key: "overspent", for: "finance", urgent: false, text: `Explain ${overspent.length} overspent budget ${overspent.length === 1 ? "line" : "lines"}`, href: "/progress/budget" });
  }

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
    mel: { pending: allResults.filter((r) => r.status === "pending").length, queried: allResults.filter((r) => r.status === "queried").length, toCheck: allResults.filter((r) => r.status === "pending" && r.by !== u.id).length, noProof: proof, stops: report.checks.filter((c) => c.level === "stop").length, checks: report.checks.filter((c) => c.level === "check").length, quarter: qLabel(thisQ).replace("-", " ") },
    field: { queried: myQueried.length, mine: allResults.filter((r) => r.by === u.id && r.date >= thisQ).length },
  };
}
export type HomeView = Awaited<ReturnType<typeof loadHome>>;
