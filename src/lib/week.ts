import { z } from "zod";
import { ANSWER_DAYS } from "@/lib/feedback";

/**
 * The week ahead for a manager: a four-sentence summary built from the records (what is due, what
 * is at risk, what waits on them, what changed), three numbers, and up to three priorities the app
 * proposes and the person confirms, changes or adds to. Nothing here is written by AI: every
 * figure comes from a record and opens the page that holds it.
 */

/** Three, not five: a list a person can hold in their head is a list they act on. */
export const MAX_PRIORITIES = 3;

/** What the week is built from, one entry per project the person oversees. */
export type ProjectWeek = {
  code: string;
  short: string;
  /** Results late against this year's targets. */
  late: number;
  /** Reports owed: late, or due within 30 days. `days` to the due date (negative when late). */
  reports: { label: string; due: string; days: number; late: boolean; href: string }[];
  /** What blocks the next report, or 0. */
  blocking: number;
  blockingHref: string;
  /** Approvals waiting on this person, with the day the oldest has waited since. Each link opens its own project. */
  approvals: { text: string; href: string; since: string | null; short: string }[];
  /** Complaints and questions waiting more than the answer days. */
  complaintsLate: number;
  /** In the last seven days. */
  complaintsNew: number;
  complaintsAnswered: number;
  released: string[];
  /** For the people who run a project or lead its field teams. Absent for leadership, who read across projects. */
  work?: ProjectWork;
};

/**
 * Whose week it is. Leadership reads across projects (promises to donors). A project manager reads
 * their project (evidence, money, deadlines). A technical lead reads the field (farmers, issues,
 * the team's updates). Each sees four sentences, in the same order, about their own job.
 */
export type WeekKind = "lead" | "manager" | "technical";
export type ProjectWork = {
  /** Budget lines over budget. */
  overBudget: number;
  /** Results waiting for MEL to check, and results MEL sent back to correct. */
  toCheck: number;
  queried: number;
  /** Field issues still open. */
  fieldIssues: number;
  /** Farmer selection: farmers on the list, how many have no decision, and whether the rules are written. */
  farmers: number;
  undecided: number;
  rulesWritten: boolean;
  /** Weekly updates: last week's was sent; this week's is started. */
  lastWeekSent: boolean;
  thisWeekStarted: boolean;
  /** Whether the project writes weekly updates at all: one that never has is not "up to date". */
  weeklyKept: boolean;
};

export type Part = { t: string; href?: string };
export type Sentence = { kind: "due" | "risk" | "waiting" | "changed"; parts: Part[]; flag: boolean };
export type WeekNumber = { label: string; value: string; href: string; level: "good" | "warning" | "critical" };
/** `own`: the person's own line, not from the records. `carried`: confirmed last week and not ticked done. */
export type Suggestion = { id: string; text: string; href: string; own?: boolean; carried?: boolean };

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
const list = (parts: Part[]): Part[] => parts.flatMap((p, k) => (k === 0 ? [p] : [{ t: k === parts.length - 1 ? " and " : ", " }, p]));

/** The link with its project named (?project=), so it opens that project and not whichever one is selected. */
export function withProject(href: string, code: string): string {
  if (!href.startsWith("/") || /[?&]project=/.test(href) || href.startsWith("/approve/")) return href;
  const [path, hash] = href.split("#", 2);
  return `${path}${path.includes("?") ? "&" : "?"}project=${encodeURIComponent(code)}${hash !== undefined ? `#${hash}` : ""}`;
}

/** The Monday (YYYY-MM-DD) of the week `today` falls in. */
export function mondayOf(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** Oldest first; one with no date goes last. */
const oldestFirst = <T extends { since: string | null }>(xs: T[]) => [...xs].sort((a, b) => (a.since ?? "9").localeCompare(b.since ?? "9"));

export function weekSummary(projects: ProjectWeek[], today: string): Sentence[] {
  const reports = projects.flatMap((p) => p.reports.map((r) => ({ ...r, short: p.short })));
  const late = reports.filter((r) => r.late);
  const soon = reports.filter((r) => !r.late && r.days <= 14).sort((a, b) => a.days - b.days);
  const due: Sentence = {
    kind: "due",
    flag: late.length > 0,
    parts:
      late.length || soon.length
        ? [
            ...(late.length ? [{ t: `${n(late.length, "report is", "reports are")} late: ` }, ...list(late.map((r) => ({ t: `${r.label} for ${r.short}`, href: r.href }))), { t: ". " }] : []),
            ...(soon.length ? [{ t: `${n(soon.length, "report is", "reports are")} due in the next 14 days: ` }, ...list(soon.map((r) => ({ t: `${r.label} for ${r.short} in ${n(Math.max(r.days, 0), "day", "days")}`, href: r.href }))), { t: "." }] : []),
          ]
        : [{ t: "No report is due in the next 14 days." }],
  };

  const blocked = projects.filter((p) => p.blocking > 0);
  const slipping = projects.filter((p) => p.late > 0);
  const risk: Sentence = {
    kind: "risk",
    flag: blocked.length > 0 || slipping.length > 0,
    parts:
      blocked.length || slipping.length
        ? [
            ...blocked.flatMap((p) => [{ t: `The next ${p.short} report is blocked by ` }, { t: n(p.blocking, "thing", "things"), href: p.blockingHref }, { t: ". " }]),
            ...slipping.flatMap((p) => [{ t: `${p.short} has ` }, { t: n(p.late, "result", "results"), href: `/progress?project=${encodeURIComponent(p.code)}` }, { t: " behind this year's target. " }]),
          ]
        : [{ t: "Nothing is blocked and no project is behind its targets." }],
  };

  const approvals = oldestFirst(projects.flatMap((p) => p.approvals));
  const oldest = approvals[0]?.since ?? undefined;
  const waiting: Sentence = {
    kind: "waiting",
    flag: false,
    parts: approvals.length
      ? [{ t: n(approvals.length, "approval is", "approvals are"), href: approvals[0].href }, { t: ` waiting on you${oldest && days(oldest, today) > 0 ? `, the oldest for ${n(days(oldest, today), "day", "days")}` : ""}.` }]
      : [{ t: "Nothing is waiting on you." }],
  };

  const answered = projects.reduce((t, p) => t + p.complaintsAnswered, 0);
  const fresh = projects.reduce((t, p) => t + p.complaintsNew, 0);
  const released = projects.flatMap((p) => p.released.map((r) => `${r} for ${p.short}`));
  const bits = [released.length ? `${released.join(" and ")} ${released.length === 1 ? "was" : "were"} released` : "", answered ? `${n(answered, "complaint or question was", "complaints or questions were")} answered` : "", fresh ? `${n(fresh, "new complaint or question", "new complaints or questions")} came in` : ""].filter(Boolean);
  const changed: Sentence = { kind: "changed", flag: false, parts: [{ t: bits.length ? `In the last seven days ${bits.length > 1 ? `${bits.slice(0, -1).join(", ")} and ${bits[bits.length - 1]}` : bits[0]}.` : "No report was released and no complaint came in or was answered in the last seven days." }] };
  return [due, risk, waiting, changed];
}

export function weekNumbers(projects: ProjectWeek[]): WeekNumber[] {
  const on = projects.filter((p) => p.late === 0).length;
  const reports = projects.reduce((t, p) => t + p.reports.length, 0);
  const lateReports = projects.reduce((t, p) => t + p.reports.filter((r) => r.late).length, 0);
  const complaints = projects.reduce((t, p) => t + p.complaintsLate, 0);
  const worst = projects.find((p) => p.complaintsLate > 0);
  return [
    { label: "Projects on track for results", value: `${on} of ${projects.length}`, href: "/portfolio", level: on === projects.length ? "good" : on * 2 >= projects.length ? "warning" : "critical" },
    { label: "Reports late or due in 30 days", value: String(reports), href: projects.find((p) => p.reports.length)?.reports[0].href ?? "/progress", level: lateReports ? "critical" : reports ? "warning" : "good" },
    { label: `Complaints waiting over ${ANSWER_DAYS} days`, value: String(complaints), href: worst ? `/progress/feedback?project=${encodeURIComponent(worst.code)}` : "/progress/feedback", level: complaints ? "critical" : "good" },
  ];
}

/** Up to three priorities, the most pressing first: late reports, blocked reports due soon, approvals, complaints, projects behind. */
export function suggestPriorities(projects: ProjectWeek[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const p of projects) for (const r of p.reports.filter((x) => x.late)) out.push({ id: `late:${p.code}:${r.label}`, text: `Get the ${r.label} for ${p.short} to the donor: it is late`, href: r.href });
  for (const p of projects) if (p.blocking && p.reports.some((r) => !r.late && r.days <= 14)) out.push({ id: `block:${p.code}`, text: `Clear what blocks the next ${p.short} report (${n(p.blocking, "thing", "things")})`, href: p.blockingHref });
  const approvals = oldestFirst(projects.flatMap((p) => p.approvals));
  // With more than one project, the approval names its own: "Sign off the October review" alone does not say where.
  if (approvals.length) out.push({ id: "approvals", text: approvals.length === 1 ? `Decide${projects.length > 1 ? ` for ${approvals[0].short}` : ""}: ${approvals[0].text}` : `Decide the ${approvals.length} approvals waiting on you`, href: approvals[0].href });
  for (const p of projects) if (p.complaintsLate) out.push({ id: `complaints:${p.code}`, text: `See that ${n(p.complaintsLate, "complaint", "complaints")} on ${p.short} ${p.complaintsLate === 1 ? "is" : "are"} answered`, href: `/progress/feedback?project=${encodeURIComponent(p.code)}` });
  for (const p of projects) if (p.late) out.push({ id: `behind:${p.code}`, text: `Ask about ${p.short}: ${n(p.late, "result is", "results are")} behind target`, href: `/progress?project=${encodeURIComponent(p.code)}` });
  return out.slice(0, MAX_PRIORITIES);
}

export type Priority = { id: string; text: string; href: string; own: boolean; done: boolean };
export type WeekPlan = { week: string; items: Priority[]; confirmedAt: string | null };

export const weekAction = z.discriminatedUnion("action", [
  /** Confirms the list as it stands on screen: the kept suggestions and the person's own lines, in their order. */
  z.object({ action: z.literal("confirm"), items: z.array(z.object({ id: z.string().max(120), text: z.string().trim().min(3).max(200), href: z.string().max(300).default(""), own: z.boolean() })).max(MAX_PRIORITIES, `Keep it to ${MAX_PRIORITIES}: a longer list is not a priority list.`) }),
  z.object({ action: z.literal("done"), id: z.string().max(120), done: z.boolean() }),
  /** Back to choosing: the confirmed list opens for changes again. */
  z.object({ action: z.literal("reopen") }),
]);
export type WeekAction = z.infer<typeof weekAction>;

/** A link the app made is kept; anything else typed in is dropped, so a priority never carries an outside address. */
export const safeHref = (href: string) => (/^\/[a-z]/.test(href) && !href.startsWith("//") ? href : "");

const sum = (projects: ProjectWeek[], f: (w: ProjectWork) => number) => projects.reduce((t, p) => t + (p.work ? f(p.work) : 0), 0);
const one = (projects: ProjectWeek[]) => (projects.length === 1 ? `?project=${encodeURIComponent(projects[0].code)}` : "");

/** The four sentences for whoever's week it is (see WeekKind). Leadership's are `weekSummary`. */
export function weekSummaryFor(kind: WeekKind, projects: ProjectWeek[], today: string): Sentence[] {
  const [due, risk, waiting, changed] = weekSummary(projects, today);
  if (kind === "lead") return [due, risk, waiting, changed];
  const q = one(projects);
  const over = sum(projects, (w) => w.overBudget);
  const toCheck = sum(projects, (w) => w.toCheck);
  const queried = sum(projects, (w) => w.queried);
  const issues = sum(projects, (w) => w.fieldIssues);
  const undecided = sum(projects, (w) => w.undecided);
  const farmers = sum(projects, (w) => w.farmers);
  const noRules = projects.some((p) => p.work && !p.work.rulesWritten && p.work.farmers > 0);
  const lastMissing = projects.filter((p) => p.work && !p.work.lastWeekSent);
  const notStarted = projects.filter((p) => p.work && !p.work.thisWeekStarted);
  const weekly: Part[] = lastMissing.length
    ? [{ t: "Last week's " }, { t: "weekly update", href: `/progress/weekly${q}` }, { t: " was not sent." }]
    : notStarted.length
      ? [{ t: "This week's " }, { t: "weekly update", href: `/progress/weekly${q}` }, { t: " is not started." }]
      : projects.some((p) => p.work?.weeklyKept)
        ? [{ t: "The weekly updates are up to date." }]
        : [];

  if (kind === "manager") {
    const extra: Part[] = [
      ...(over ? [{ t: n(over, "budget line is", "budget lines are"), href: `/progress/budget${q}` }, { t: " over budget. " }] : []),
      ...(toCheck ? [{ t: n(toCheck, "result waits", "results wait"), href: `/progress/results${q}` }, { t: " for MEL to check and will not count until then. " }] : []),
    ];
    const quiet = !risk.flag;
    const riskM: Sentence = { kind: "risk", flag: risk.flag || over > 0 || toCheck > 0, parts: extra.length ? [...(quiet ? [] : risk.parts), ...extra] : risk.parts };
    const waitingM: Sentence = queried ? { kind: "waiting", flag: false, parts: [...waiting.parts, { t: " " }, { t: n(queried, "result MEL sent back is", "results MEL sent back are"), href: `/progress/results${q}` }, { t: " to correct." }] } : waiting;
    return [due, riskM, waitingM, { kind: "changed", flag: lastMissing.length > 0, parts: weekly.length ? [...changed.parts, { t: " " }, ...weekly] : changed.parts }];
  }

  // Technical lead: the farmers, what is wrong in the field, what waits on them, and the team's updates.
  const selection: Sentence = {
    kind: "due",
    flag: noRules || undecided > 0,
    parts: noRules
      ? [{ t: "The " }, { t: "selection rules", href: `/work/selection${q}` }, { t: ` are not written yet, with ${n(farmers, "farmer", "farmers")} on the list.` }]
      : undecided
        ? [{ t: `${undecided} of ${n(farmers, "farmer", "farmers")}`, href: `/work/selection${q}` }, { t: ` ${undecided === 1 ? "is" : "are"} still waiting on a selection decision.` }]
        : farmers
          ? [{ t: `All ${n(farmers, "farmer", "farmers")} on the list ${farmers === 1 ? "has" : "have"} a selection decision.` }]
          : [{ t: "No farmers are on the list yet." }],
  };
  const behind = projects.filter((p) => p.late > 0);
  const field: Part[] = [
    ...(issues ? [{ t: n(issues, "field issue is", "field issues are"), href: `/work?source=field${q ? `&${q.slice(1)}` : ""}` }, { t: " open. " }] : []),
    ...(queried ? [{ t: n(queried, "result", "results"), href: `/progress/results${q}` }, { t: ` ${queried === 1 ? "was" : "were"} sent back by MEL to correct. ` }] : []),
    ...behind.flatMap((p) => [{ t: `${p.short} has ` }, { t: n(p.late, "result", "results"), href: `/progress?project=${encodeURIComponent(p.code)}` }, { t: " behind this year's target. " }]),
  ];
  const riskT: Sentence = { kind: "risk", flag: field.length > 0, parts: field.length ? field : [{ t: "No field issue is open, no result was sent back and no result is behind target." }] };
  return [selection, riskT, waiting, { kind: "changed", flag: lastMissing.length > 0, parts: weekly.length ? weekly : [{ t: "No weekly update has been written for this project yet." }] }];
}

/** Up to three priorities for whoever's week it is, the most pressing first. */
export function suggestFor(kind: WeekKind, projects: ProjectWeek[]): Suggestion[] {
  const base = suggestPriorities(projects);
  if (kind === "lead") return base;
  const q = one(projects);
  const over = sum(projects, (w) => w.overBudget);
  const queried = sum(projects, (w) => w.queried);
  const issues = sum(projects, (w) => w.fieldIssues);
  const undecided = sum(projects, (w) => w.undecided);
  const noRules = projects.some((p) => p.work && !p.work.rulesWritten && p.work.farmers > 0);
  const lastMissing = projects.some((p) => p.work && !p.work.lastWeekSent);
  const own: Suggestion[] = [];
  if (kind === "technical") {
    if (noRules) own.push({ id: "rules", text: "See that the farmer selection rules are written", href: `/work/selection${q}` });
    else if (undecided) own.push({ id: "selection", text: undecided === 1 ? "Decide the farmer still waiting on selection" : `Decide the ${undecided} farmers still waiting on selection`, href: `/work/selection${q}` });
    if (issues) own.push({ id: "issues", text: issues === 1 ? "Close the open field issue" : `Close the ${issues} open field issues`, href: `/work?source=field${q ? `&${q.slice(1)}` : ""}` });
    if (queried) own.push({ id: "queried", text: queried === 1 ? "Have the result MEL sent back corrected" : `Have the ${queried} results MEL sent back corrected`, href: `/progress/results${q}` });
    if (lastMissing) own.push({ id: "weekly", text: "Get last week's weekly update sent", href: `/progress/weekly${q}` });
    return [...own, ...base.filter((b) => b.id === "approvals")].slice(0, MAX_PRIORITIES);
  }
  if (over) own.push({ id: "budget", text: over === 1 ? "Explain the budget line that is over budget" : `Explain the ${over} budget lines over budget`, href: `/progress/budget${q}` });
  if (queried) own.push({ id: "queried", text: queried === 1 ? "Have the result MEL sent back corrected" : `Have the ${queried} results MEL sent back corrected`, href: `/progress/results${q}` });
  if (lastMissing) own.push({ id: "weekly", text: "Get last week's weekly update sent", href: `/progress/weekly${q}` });
  // Late and blocked reports first, then the manager's own, then the rest.
  const first = base.filter((b) => /^(late|block):/.test(b.id));
  return [...first, ...own, ...base.filter((b) => !/^(late|block):/.test(b.id))].slice(0, MAX_PRIORITIES);
}

/**
 * This week's proposals: what the person confirmed last week and did not tick done comes first
 * (an unfinished priority does not quietly disappear on Monday), then what the records raise, three
 * in all. A carried line the records raise again is listed once.
 */
export function withCarried(lastWeek: WeekPlan | null, fresh: Suggestion[]): Suggestion[] {
  const carried: Suggestion[] = lastWeek?.confirmedAt ? lastWeek.items.filter((i) => !i.done).map((i) => ({ id: i.own ? `carried:${i.id}` : i.id, text: i.text, href: i.own ? "" : i.href, own: i.own, carried: true })) : [];
  const seen = new Set(carried.map((c) => c.id));
  return [...carried, ...fresh.filter((f) => !seen.has(f.id))].slice(0, MAX_PRIORITIES);
}

/** Friday's line: how the confirmed week went. Null before a week is confirmed. */
export function weekScore(plan: WeekPlan): { done: number; of: number; left: number } | null {
  if (!plan.confirmedAt || !plan.items.length) return null;
  const done = plan.items.filter((i) => i.done).length;
  return { done, of: plan.items.length, left: plan.items.length - done };
}
