import { z } from "zod";

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
  /** Approvals waiting on this person, with the day the oldest has waited since. */
  approvals: { text: string; href: string; since: string | null }[];
  /** Complaints and questions waiting more than the answer days. */
  complaintsLate: number;
  /** In the last seven days. */
  complaintsNew: number;
  complaintsAnswered: number;
  released: string[];
};

export type Part = { t: string; href?: string };
export type Sentence = { kind: "due" | "risk" | "waiting" | "changed"; parts: Part[]; flag: boolean };
export type WeekNumber = { label: string; value: string; href: string; level: "good" | "warning" | "critical" };
export type Suggestion = { id: string; text: string; href: string };

const days = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
const list = (parts: Part[]): Part[] => parts.flatMap((p, k) => (k === 0 ? [p] : [{ t: k === parts.length - 1 ? " and " : ", " }, p]));

/** The Monday (YYYY-MM-DD) of the week `today` falls in. */
export function mondayOf(today: string): string {
  const d = new Date(`${today}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

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

  const approvals = projects.flatMap((p) => p.approvals);
  const oldest = approvals.map((a) => a.since).filter((x): x is string => !!x).sort()[0];
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
  const bits = [released.length ? `${released.join(" and ")} ${released.length === 1 ? "was" : "were"} released` : "", answered ? `${n(answered, "complaint or question was", "complaints or questions were")} answered` : "", fresh ? `${n(fresh, "new one", "new ones")} came in` : ""].filter(Boolean);
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
    { label: "Complaints waiting over 14 days", value: String(complaints), href: worst ? `/progress/feedback?project=${encodeURIComponent(worst.code)}` : "/progress/feedback", level: complaints ? "critical" : "good" },
  ];
}

/** Up to three priorities, the most pressing first: late reports, blocked reports due soon, approvals, complaints, projects behind. */
export function suggestPriorities(projects: ProjectWeek[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const p of projects) for (const r of p.reports.filter((x) => x.late)) out.push({ id: `late:${p.code}:${r.label}`, text: `Get the ${r.label} for ${p.short} to the donor: it is late`, href: r.href });
  for (const p of projects) if (p.blocking && p.reports.some((r) => !r.late && r.days <= 14)) out.push({ id: `block:${p.code}`, text: `Clear what blocks the next ${p.short} report (${n(p.blocking, "thing", "things")})`, href: p.blockingHref });
  const approvals = projects.flatMap((p) => p.approvals).sort((a, b) => (a.since ?? "9").localeCompare(b.since ?? "9"));
  if (approvals.length) out.push({ id: "approvals", text: approvals.length === 1 ? `Decide: ${approvals[0].text}` : `Decide the ${approvals.length} approvals waiting on you`, href: approvals[0].href });
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
