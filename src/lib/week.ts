import { z } from "zod";
import { ANSWER_DAYS } from "@/lib/feedback";
import { canEditProject } from "@/lib/demo";

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
  /** Approvals waiting on this person, with the day the oldest has waited since. Each link opens its own project. `key`: Home's row it came from. */
  approvals: { text: string; href: string; since: string | null; short: string; key?: string }[];
  /** Complaints and questions waiting more than the answer days. */
  complaintsLate: number;
  /** In the last seven days. */
  complaintsNew: number;
  complaintsAnswered: number;
  released: string[];
  /** For the people who run a project or lead its field teams. Absent for leadership, who read across projects. */
  work?: ProjectWork;
  /** For Finance: month close, spending imports, budget lines and what waits on them. */
  finance?: FinanceWork;
  /** For MEL: what waits to be checked, what was sent back, targets before the next report. */
  mel?: MelWork;
};

/**
 * Whose week it is. Leadership reads across projects (promises to donors). A project manager reads
 * their project (evidence, money, deadlines). A technical lead reads the field (farmers, issues,
 * the team's updates). Finance reads the money (month close, spending imports, budget lines, what
 * waits to be paid or checked). MEL reads the evidence (what waits to be checked, what was sent
 * back, targets before the next report, the report calendar). Each sees four sentences, in the same
 * order, about their own job.
 */
export type WeekKind = "lead" | "manager" | "technical" | "finance" | "mel";

/**
 * Whose week it is, or null for people who have no week: one rule for the server (server/week-store,
 * with lensesFor) and for Home's page (with the lenses Home's own answer carries), so the page never
 * shows a week the API refuses, or hides one it would give.
 *
 * One week each, the first that fits: leadership, then the technical lead, then the person who runs
 * the project, then Finance, then MEL. Leadership answers for every promise, so their week is the
 * widest and wins. A technical lead or a manager who also imports spending or owns the evidence
 * reads that in their own week already (budget lines over, results to check), and their job is the
 * project as a whole. Finance comes before MEL because nobody in the demo holds both, and someone
 * who did would be paid to close the books first: the evidence has a manager's week behind it.
 * Field and office staff work from the to-do list.
 */
export function weekKindOf(u: { kind: string; project: readonly string[]; field: readonly string[] }, lenses: readonly string[]): WeekKind | null {
  if (u.kind !== "employee") return null;
  if (lenses.includes("lead")) return "lead";
  if (u.project.includes("technical-lead")) return "technical";
  if (canEditProject({ project: [...u.project], field: [...u.field] })) return "manager";
  if (lenses.includes("finance")) return "finance";
  if (u.field.includes("mel") || u.project.includes("mel-owner")) return "mel";
  return null;
}
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

/** Finance's part of one project. Months are YYYY-MM; `since` days are YYYY-MM-DD. */
export type FinanceWork = {
  /** Past months with vouchers that are not closed, oldest first, and how many vouchers still stop each. */
  unclosed: { month: string; blockers: number }[];
  /** The month whose spending should be imported by now, and the last month imported (null: none yet). */
  importWanted: string;
  importedTo: string | null;
  /** Budget lines over budget, by code, and whether the project spends well ahead of the time gone. */
  overspent: string[];
  ahead: boolean;
  /** Purchases whose current step waits on this person, oldest first. */
  purchases: { id: string; title: string; step: string; since: string | null }[];
  /** Approved bills waiting for Finance's voucher. */
  billsToVoucher: { id: string; since: string | null }[];
  /** In the last seven days: spending imports, months closed, bill vouchers filed. */
  imported: number;
  closed: string[];
  filed: number;
};

/** MEL's part of one project. */
export type MelWork = {
  /** Results and KoboCollect field forms waiting for this person to check, with the day the oldest arrived. */
  results: { n: number; since: string | null };
  forms: { n: number; since: string | null };
  /** Results sent back for correction and not corrected yet. */
  queried: number;
  /** Accepted results whose KoboToolbox record changed afterwards. */
  mismatched: number;
  /** Targets under way with no accepted result, and targets behind (their codes). */
  noData: number;
  behind: string[];
};

/** What waits on Finance across the organization, not one project: expense reports and payroll. */
export type OrgWeek = { expenses: { n: number; since: string | null }; payroll: { month: string; since: string | null }[] };

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
  if (approvals.length) out.push({ id: "approvals", text: approvals.length === 1 ? `${approvals[0].text}${projects.length > 1 ? ` (${approvals[0].short})` : ""}` : `Decide the ${approvals.length} approvals waiting on you`, href: approvals[0].href });
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
/** The nightly check of the books (server/ledger-check), as the week needs it. */
export type BooksCheck = { at: string; ok: boolean; problems: string[] } | null;

/**
 * What leadership and Finance hear about the nightly check of the books: a problem it found, or that it
 * has stopped running. Nothing when it has never run (the books are not kept in the app) or all is well.
 */
export function booksCheckParts(check: BooksCheck, today: string): Part[] {
  if (!check) return [];
  const href = "/work/closeout#bank";
  if (!check.ok && check.problems.length) {
    const more = check.problems.length > 1 ? ` (and ${check.problems.length - 1} more)` : "";
    return [{ t: "The nightly check of the books found a problem: ", href }, { t: `${check.problems[0].replace(/\.$/, "")}${more}. Finance looks at it before anything else is posted.` }];
  }
  if (days(check.at.slice(0, 10), today) > 2) return [{ t: `The nightly check of the books has not run since ${check.at.slice(0, 10)}.`, href }];
  return [];
}

/** Adds the books' check to the "at risk" sentence, flagged when there is something to say. */
function withBooks(out: Sentence[], books: BooksCheck | undefined, today: string): Sentence[] {
  const parts = booksCheckParts(books ?? null, today);
  if (!parts.length) return out;
  return out.map((x) => (x.kind === "risk" ? { ...x, flag: true, parts: [...(x.flag ? [...x.parts, { t: " " }] : []), ...parts] } : x));
}

export function weekSummaryFor(kind: WeekKind, projects: ProjectWeek[], today: string, org?: OrgWeek, books?: BooksCheck): Sentence[] {
  if (kind === "finance") return withBooks(financeSummary(projects, today, org), books, today);
  if (kind === "mel") return melSummary(projects, today);
  const [due, risk, waiting, changed] = weekSummary(projects, today);
  if (kind === "lead") return withBooks([due, risk, waiting, changed], books, today);
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
export function suggestFor(kind: WeekKind, projects: ProjectWeek[], org?: OrgWeek): Suggestion[] {
  if (kind === "finance") return financeSuggestions(projects, org);
  if (kind === "mel") return melSuggestions(projects);
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

const monthName = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const proj = (href: string, p: ProjectWeek) => withProject(href, p.code);
/** "the oldest for 6 days", or nothing when the oldest arrived today or no day is known. */
const oldestFor = (sinces: (string | null)[], today: string) => {
  const first = sinces.filter((x): x is string => !!x).sort()[0];
  const d = first ? days(first.slice(0, 10), today) : 0;
  return d > 0 ? `, the oldest for ${n(d, "day", "days")}` : "";
};
/** Things that are not Home's purchase rows (Finance's week counts purchases from the procurements themselves). */
const otherApprovals = (projects: ProjectWeek[]) => oldestFirst(projects.flatMap((p) => p.approvals.filter((a) => !a.key?.startsWith("purchase:"))));
const sentence = (kind: Sentence["kind"], parts: Part[], quiet: string): Sentence => ({ kind, flag: parts.length > 0, parts: parts.length ? parts : [{ t: quiet }] });
const joined = (bits: Part[][]): Part[] => bits.flatMap((b, k) => (k === 0 ? b : [{ t: k === bits.length - 1 ? " and " : ", " }, ...b]));

/** Finance: month close and imports, budget lines, what waits on them, what changed. */
function financeSummary(projects: ProjectWeek[], today: string, org?: OrgWeek): Sentence[] {
  const fin = projects.filter((p) => p.finance);
  const due: Part[] = fin.flatMap((p) => {
    const f = p.finance!;
    return [
      ...(!f.importedTo || f.importedTo < f.importWanted ? [{ t: `${p.short}: ` }, { t: `spending for ${monthName(f.importWanted)}`, href: proj("/progress/budget", p) }, { t: ` is not imported yet (${f.importedTo ? `imported to ${monthName(f.importedTo)}` : "nothing imported yet"}). ` }] : []),
      ...f.unclosed.flatMap((m) => [{ t: `${monthName(m.month)} is not closed for ${p.short}: ` }, { t: m.blockers ? `${n(m.blockers, "voucher", "vouchers")} still to finish, file or post` : "it is ready to close", href: proj("/work/closeout", p) }, { t: ". " }]),
    ];
  });
  const risk: Part[] = fin.flatMap((p) => {
    const f = p.finance!;
    return [
      ...(f.overspent.length ? [{ t: `${p.short} has ` }, { t: `${n(f.overspent.length, "budget line", "budget lines")} over budget`, href: proj("/progress/budget", p) }, { t: `: ${f.overspent.join(", ")}. ` }] : []),
      ...(f.ahead ? [{ t: `${p.short} is ` }, { t: "spending well ahead of the time gone", href: proj("/progress/budget", p) }, { t: ". " }] : []),
    ];
  });

  // What waits on Finance, oldest first across every kind of thing.
  const purchases = fin.flatMap((p) => p.finance!.purchases.map((x) => ({ ...x, p })));
  const bills = fin.flatMap((p) => p.finance!.billsToVoucher.map((x) => ({ ...x, p })));
  const others = otherApprovals(projects);
  const q = one(projects);
  const items: { parts: Part[]; since: string | null }[] = [
    ...(purchases.length ? [{ parts: [{ t: n(purchases.length, "purchase step", "purchase steps"), href: purchases.length === 1 ? proj(`/work?source=procurement&open=${encodeURIComponent(purchases[0].id)}`, purchases[0].p) : `/work/procurements${q}` }], since: oldestFirst(purchases)[0].since }] : []),
    ...(bills.length ? [{ parts: [{ t: `the ${bills.length === 1 ? "voucher" : "vouchers"} for ${n(bills.length, "approved bill", "approved bills")}`, href: bills.length === 1 ? proj("/work/bills", bills[0].p) : `/work/bills${q}` }], since: oldestFirst(bills)[0].since }] : []),
    ...(org?.expenses.n ? [{ parts: [{ t: n(org.expenses.n, "expense report", "expense reports"), href: "/expenses" }], since: org.expenses.since }] : []),
    ...(org?.payroll ?? []).map((r) => ({ parts: [{ t: `the ${monthName(r.month)} payroll`, href: "/payroll" }], since: r.since })),
    ...(others.length ? [{ parts: [{ t: n(others.length, "other approval", "other approvals"), href: others[0].href }], since: others[0].since }] : []),
  ];
  const waiting: Sentence = { kind: "waiting", flag: false, parts: items.length ? [{ t: "Waiting on you: " }, ...joined(items.map((i) => i.parts)), { t: `${oldestFor(items.map((i) => i.since), today)}.` }] : [{ t: "Nothing is waiting on you." }] };

  const changedBits: Part[][] = fin.flatMap((p) => {
    const f = p.finance!;
    return [
      ...(f.imported ? [[{ t: `spending was imported for ${p.short}` }]] : []),
      ...f.closed.map((m) => [{ t: `${monthName(m)} was closed for ${p.short}` }]),
      ...(f.filed ? [[{ t: `${n(f.filed, "bill voucher was", "bill vouchers were")} filed for ${p.short}` }]] : []),
    ];
  });
  const changed: Sentence = { kind: "changed", flag: false, parts: changedBits.length ? [{ t: "In the last seven days " }, ...joined(changedBits), { t: "." }] : [{ t: "No spending was imported and no month was closed in the last seven days." }] };
  return [sentence("due", due, "Every past month is closed and spending is imported."), sentence("risk", risk, "No budget line is over budget and no project is spending ahead of the time gone."), waiting, changed];
}

function financeSuggestions(projects: ProjectWeek[], org?: OrgWeek): Suggestion[] {
  const fin = projects.filter((p) => p.finance);
  const q = one(projects);
  const out: Suggestion[] = [];
  // People are paid first, then suppliers, then staff out of pocket; then the books.
  for (const r of org?.payroll ?? []) out.push({ id: `payroll:${r.month}`, text: `Approve the ${monthName(r.month)} payroll`, href: "/payroll" });
  const purchases = oldestFirst(fin.flatMap((p) => p.finance!.purchases.map((x) => ({ ...x, p }))));
  if (purchases.length) out.push({ id: "purchases", text: purchases.length === 1 ? `${purchases[0].step}: ${purchases[0].id} ${purchases[0].title}` : `Do the ${purchases.length} purchase steps waiting on you`, href: purchases.length === 1 ? proj(`/work?source=procurement&open=${encodeURIComponent(purchases[0].id)}`, purchases[0].p) : `/work/procurements${q}` });
  if (org?.expenses.n) out.push({ id: "expenses", text: org.expenses.n === 1 ? "Check the expense report waiting on you" : `Check the ${org.expenses.n} expense reports waiting on you`, href: "/expenses" });
  for (const p of fin) if (!p.finance!.importedTo || p.finance!.importedTo < p.finance!.importWanted) out.push({ id: `import:${p.code}`, text: `Import the ${monthName(p.finance!.importWanted)} spending for ${p.short}`, href: proj("/progress/budget", p) });
  for (const p of fin) {
    const m = p.finance!.unclosed[0];
    if (m) out.push({ id: `close:${p.code}:${m.month}`, text: m.blockers ? `Finish the ${n(m.blockers, "voucher", "vouchers")} that keep ${monthName(m.month)} open for ${p.short}` : `Close ${monthName(m.month)} for ${p.short}`, href: proj("/work/closeout", p) });
  }
  const bills = fin.reduce((t, p) => t + p.finance!.billsToVoucher.length, 0);
  if (bills) out.push({ id: "bills", text: bills === 1 ? "Prepare the voucher for the approved bill" : `Prepare the vouchers for ${bills} approved bills`, href: `/work/bills${q}` });
  const others = otherApprovals(projects);
  if (others.length) out.push({ id: "other-approvals", text: others.length === 1 ? others[0].text : `Decide the ${others.length} other approvals waiting on you`, href: others[0].href });
  return out.slice(0, MAX_PRIORITIES);
}

/** A check waiting this many days or more is flagged: the field team waits on it, and so does the report. */
export const CHECK_DAYS = 7;

/** MEL: what waits to be checked, what was sent back, targets before the next report, the report calendar. */
function melSummary(projects: ProjectWeek[], today: string): Sentence[] {
  const mel = projects.filter((p) => p.mel);
  const q = one(projects);
  const results = mel.reduce((t, p) => t + p.mel!.results.n, 0);
  const forms = mel.reduce((t, p) => t + p.mel!.forms.n, 0);
  const resultsSince = mel.map((p) => p.mel!.results.since);
  const formsSince = mel.map((p) => p.mel!.forms.since);
  const all = [...resultsSince, ...formsSince].filter((x): x is string => !!x).sort()[0];
  const checks: Sentence = {
    kind: "due",
    flag: !!all && days(all.slice(0, 10), today) >= CHECK_DAYS,
    parts:
      results || forms
        ? [
            { t: "Waiting for you to check: " },
            ...joined([
              ...(results ? [[{ t: n(results, "result", "results"), href: `/progress/results${q}` }, { t: oldestFor(resultsSince, today) }]] : []),
              ...(forms ? [[{ t: n(forms, "field form", "field forms"), href: `/progress/results${q}#field-records` }, { t: ` from KoboCollect${oldestFor(formsSince, today)}` }]] : []),
            ]),
            { t: "." },
          ]
        : [{ t: "No result or field form is waiting for you to check." }],
  };
  const queried = mel.reduce((t, p) => t + p.mel!.queried, 0);
  const mismatched = mel.reduce((t, p) => t + p.mel!.mismatched, 0);
  const sentBack = sentence(
    "risk",
    [
      ...(queried ? [{ t: n(queried, "result", "results"), href: `/progress/results${q}` }, { t: ` sent back for correction ${queried === 1 ? "is" : "are"} still not corrected. ` }] : []),
      ...(mismatched ? [{ t: n(mismatched, "accepted result no longer matches", "accepted results no longer match"), href: `/progress/results${q}` }, { t: " KoboToolbox: reopen to check the new figure. " }] : []),
    ],
    "No result sent back is waiting to be corrected.",
  );
  const targets = sentence(
    "waiting",
    mel.flatMap((p) => {
      const m = p.mel!;
      const bits: Part[][] = [
        ...(m.noData ? [[{ t: `${n(m.noData, "target has", "targets have")} ` }, { t: "no data", href: proj("/progress", p) }]] : []),
        ...(m.behind.length ? [[{ t: `${n(m.behind.length, "target is", "targets are")} ` }, { t: "behind", href: proj("/progress", p) }, { t: ` (${m.behind.join(", ")})` }]] : []),
        ...(p.blocking ? [[{ t: n(p.blocking, "check blocks", "checks block"), href: p.blockingHref }, { t: " the report" }]] : []),
      ];
      return bits.length ? [{ t: `Before the next ${p.short} report, ` }, ...joined(bits), { t: ". " }] : [];
    }),
    "Every target has data, none is behind and nothing blocks the next report.",
  );
  const reports = mel.flatMap((p) => p.reports.map((r) => ({ ...r, short: p.short }))).sort((a, b) => a.days - b.days);
  const released = mel.flatMap((p) => p.released.map((r) => `${r} for ${p.short}`));
  const calendar: Sentence = {
    kind: "changed",
    flag: reports.some((r) => r.late),
    parts: [
      ...(reports.length
        ? [...joined(reports.map((r) => [{ t: `The ${r.label} for ${r.short}`, href: r.href }, { t: r.late ? " is late" : ` is due in ${n(Math.max(r.days, 0), "day", "days")}` }])), { t: ". " }]
        : [{ t: "No report is due in the next 30 days. " }]),
      ...(released.length ? [{ t: `In the last seven days ${released.join(" and ")} ${released.length === 1 ? "was" : "were"} released.` }] : []),
    ],
  };
  return [checks, sentBack, targets, calendar];
}

function melSuggestions(projects: ProjectWeek[]): Suggestion[] {
  const mel = projects.filter((p) => p.mel);
  const q = one(projects);
  const out: Suggestion[] = [];
  // A late report first: the donor is already waiting.
  for (const p of mel) for (const r of p.reports.filter((x) => x.late)) out.push({ id: `late:${p.code}:${r.label}`, text: `Get the ${r.label} for ${p.short} to the donor: it is late`, href: r.href });
  const results = mel.reduce((t, p) => t + p.mel!.results.n, 0);
  const forms = mel.reduce((t, p) => t + p.mel!.forms.n, 0);
  if (results) out.push({ id: "check-results", text: results === 1 ? "Check the result waiting for you" : `Check the ${results} results waiting for you, oldest first`, href: `/progress/results${q}` });
  if (forms) out.push({ id: "check-forms", text: forms === 1 ? "Check the field form from KoboCollect" : `Check the ${forms} field forms from KoboCollect, oldest first`, href: `/progress/results${q}#field-records` });
  for (const p of mel) if (p.blocking && p.reports.some((r) => !r.late && r.days <= 30)) out.push({ id: `block:${p.code}`, text: `Clear what blocks the next ${p.short} report (${n(p.blocking, "thing", "things")})`, href: p.blockingHref });
  const queried = mel.reduce((t, p) => t + p.mel!.queried, 0);
  if (queried) out.push({ id: "queried", text: queried === 1 ? "Follow up the result sent back for correction" : `Follow up the ${queried} results sent back for correction`, href: `/progress/results${q}` });
  const mismatched = mel.reduce((t, p) => t + p.mel!.mismatched, 0);
  if (mismatched) out.push({ id: "mismatch", text: mismatched === 1 ? "Reopen the result that no longer matches KoboToolbox" : `Reopen the ${mismatched} results that no longer match KoboToolbox`, href: `/progress/results${q}` });
  return out.slice(0, MAX_PRIORITIES);
}

/**
 * This week's proposals: what the person confirmed last week and did not tick done comes first
 * (an unfinished priority does not quietly disappear on Monday), then what the records raise, three
 * in all. A carried line the records raise again is listed once.
 */
export function withCarried(lastWeek: WeekPlan | null, fresh: Suggestion[]): Suggestion[] {
  const carried: Suggestion[] = lastWeek?.confirmedAt ? lastWeek.items.filter((i) => !i.done).map((i) => ({ id: i.own && !i.id.startsWith("carried:") ? `carried:${i.id}` : i.id, text: i.text, href: i.own ? "" : i.href, own: i.own, carried: true })) : [];
  const seen = new Set(carried.map((c) => c.id));
  return [...carried, ...fresh.filter((f) => !seen.has(f.id))].slice(0, MAX_PRIORITIES);
}

/** Friday's line: how the confirmed week went. Null before a week is confirmed. */
export function weekScore(plan: WeekPlan): { done: number; of: number; left: number } | null {
  if (!plan.confirmedAt || !plan.items.length) return null;
  const done = plan.items.filter((i) => i.done).length;
  return { done, of: plan.items.length, left: plan.items.length - done };
}
