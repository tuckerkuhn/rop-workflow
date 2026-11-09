/**
 * Pre-flight: what stands between a report and the donor, before anyone downloads or releases it.
 * One list in three groups: what blocks the report, what is worth fixing, and what is ready. Each
 * item says what is wrong in one line, who acts, and where to fix it. Built on the server
 * (server/preflight) from the report's own checks, so the report, pre-flight and Home agree.
 *
 * Deadlines: the donor's (a "Report deadline" milestone in Tasks, else the donor's rule in policy),
 * and the date the team aims for, earlier by the internal review time the policy keeps free.
 */

export const REPORT_KINDS = ["qpr", "annual", "face"] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export type ReportRef = { kind: "qpr"; quarter: string } | { kind: "annual"; year: number } | { kind: "face"; month: string };

export type Owner = "field" | "mel" | "writers" | "finance" | "lead";
export const OWNERS: Owner[] = ["lead", "field", "mel", "writers", "finance"];

export type Vars = Record<string, string | number>;
export type PreflightItem = {
  group: "blocks" | "fix";
  owner: Owner;
  /** English, always: Home and the audit log use it. */
  text: string;
  /** A translated message for the checks pre-flight adds (`pf.c.*`); the report's older checks are English for now. */
  key?: string;
  vars?: Vars;
  href: string;
};
/** A check that passed, by message key. */
export type ReadyItem = { key: string; vars?: Vars };

export type Deadline = {
  /** The donor's deadline. Null when neither Tasks nor the policy gives one. */
  due: string | null;
  /** The date the team aims for: the deadline less the internal review time. */
  aim: string | null;
  reviewDays: number;
  /** Where the deadline comes from. */
  source: { kind: "milestone"; title: string } | { kind: "policy"; days: number; text: string } | null;
};

export type Preflight = {
  report: ReportRef;
  label: string;
  released: boolean;
  items: PreflightItem[];
  ready: ReadyItem[];
  deadline: Deadline;
  /** Where the report itself is. */
  href: string;
};

export const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);

/**
 * The deadline for a period ending `end`: the first open "Report deadline" milestone after the
 * period ends (within `window` days), else `days` after the end from the policy.
 */
export function deadlineFor(end: string, window: number, milestones: { title: string; date: string; done: boolean }[], days: number | null, policyText: string, reviewDays: number): Deadline {
  const m = milestones.filter((x) => !x.done && x.date > end && x.date <= addDays(end, window)).sort((a, b) => a.date.localeCompare(b.date))[0];
  const due = m ? m.date : days !== null ? addDays(end, days) : null;
  return {
    due,
    aim: due ? addDays(due, -reviewDays) : null,
    reviewDays,
    source: m ? { kind: "milestone", title: m.title } : days !== null ? { kind: "policy", days, text: policyText } : null,
  };
}

/** A deadline is near when the aim date is a week away or less; past when the donor's date has gone. */
export function urgency(d: Deadline, today: string): "past" | "missed-aim" | "near" | null {
  if (!d.due || !d.aim) return null;
  if (today > d.due) return "past";
  if (today > d.aim) return "missed-aim";
  return daysBetween(today, d.aim) <= 7 ? "near" : null;
}

export const blockers = (p: Pick<Preflight, "items">) => p.items.filter((i) => i.group === "blocks").length;

export function parseReport(kind: string | null, period: string | null): ReportRef | null {
  if (kind === "qpr" && /^\d{4}-Q[1-4]$/.test(period ?? "")) return { kind, quarter: period! };
  if (kind === "annual" && /^\d{4}$/.test(period ?? "")) return { kind, year: Number(period) };
  if (kind === "face" && /^\d{4}-\d{2}$/.test(period ?? "")) return { kind, month: period! };
  return null;
}
export const periodOf = (r: ReportRef) => (r.kind === "qpr" ? r.quarter : r.kind === "annual" ? String(r.year) : r.month);
export const preflightHref = (r: ReportRef) => `/progress/preflight?report=${r.kind}&period=${periodOf(r)}`;

/** The mark on a file downloaded before pre-flight is clear. */
export const draftMark = (n: number) => `DRAFT, NOT CHECKED: ${n} ${n === 1 ? "item blocks" : "items block"} this report in pre-flight. Not for the donor.`;
