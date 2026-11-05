import { z } from "zod";
import { quarterRange, totalsOf, type ResultRecord } from "@/lib/results";

/**
 * The UNDP quarterly progress report (QPR), in the layout ROP sends for ACRP (Q3 2026): project
 * information with spending, the indicator table (2026 target, achieved this quarter, achieved
 * this year, comment with status), a narrative per activity, cross-cutting issues, challenges,
 * risks, lessons and the way forward. UNDP's terms of reference also ask for gender and
 * complaints (GRM) reporting, so those sections are included.
 *
 * Every figure is computed from accepted results and links to the records behind it; staff
 * write or edit the text, and Claude can draft it from the result notes.
 */

export const STATUSES = ["completed", "on_track", "delayed", "not_implemented"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { completed: "Completed", on_track: "On track", delayed: "Delayed", not_implemented: "Not implemented" };

/** Fixed sections, in the report's order. Activity narratives come between progress and cross-cutting. */
export const SECTIONS = [
  { key: "summary", heading: "Executive Summary", draft: true, help: "One paragraph per output with the quarter's headline numbers." },
  { key: "background", heading: "I. Situational Background", draft: false, help: "Security, logistics, water, markets and banking, gender context. Usually updated from last quarter." },
  { key: "gender", heading: "3.1 Gender Equality", draft: true, help: "Women reached and women-led businesses this quarter, and what the project did to include women." },
  { key: "principled", heading: "3.2 Principled Approach", draft: false, help: "" },
  { key: "partnerships", heading: "3.3 Partnerships", draft: false, help: "" },
  { key: "safeguards", heading: "3.4 Social and Environmental Safeguards", draft: false, help: "" },
  { key: "grm", heading: "3.5 Complaints and Feedback (GRM)", draft: false, help: "Cases received, resolved and open this quarter, and the main themes. Required by UNDP's terms of reference." },
  { key: "story", heading: "3.6 Human Interest Story", draft: false, help: "Optional." },
  { key: "challenges", heading: "IV. Issues and Challenges", draft: false, help: "Operational and staffing; programmatic." },
  { key: "lessons", heading: "VI. Lessons Learned", draft: false, help: "" },
  { key: "next", heading: "VII. Way Forward", draft: true, help: "Priorities for next quarter, from what is behind." },
] as const;
export type SectionKey = (typeof SECTIONS)[number]["key"];

/** The activity an indicator belongs to: "1.1.1.4" and "2.1.1.1-a" give "1.1.1" and "2.1.1". */
export const activityOf = (donorCode: string | null, code: string) => (donorCode ?? code).split("-")[0].split(".").slice(0, 3).join(".");

export type Text = { text: string; by: string; at: string; drafted?: boolean; from?: string };
export type Qpr = {
  /** Project information box; carried forward from the last quarter. */
  info: { title: string; agreement: string; locations: string; partner: string; director: string };
  /** Spent this quarter in the budget currency, until the monthly spending import fills it. */
  quarterSpend: number | null;
  sections: Partial<Record<string, Text>>;
  /** Per indicator: a status or comment that replaces the suggestion. */
  rows: Record<string, { status?: Status; comment?: string; by: string; at: string }>;
  risks: { risk: string; mitigation: string }[];
  grm: { received: number | null; resolved: number | null };
  released?: { by: string; at: string };
};

export const emptyQpr = (projectName: string): Qpr => ({
  info: { title: projectName, agreement: "", locations: "", partner: "Roots of Peace", director: "" },
  quarterSpend: null,
  sections: {},
  rows: {},
  risks: [],
  grm: { received: null, resolved: null },
});

/** Starts a quarter from the one before: the info box, risks and slow-changing sections, marked for review. */
export function carryForward(prev: Qpr | null, projectName: string, prevQuarter: string): Qpr {
  const q = emptyQpr(projectName);
  if (!prev) return q;
  q.info = prev.info;
  q.risks = prev.risks;
  for (const k of ["background", "principled", "partnerships", "safeguards", "challenges", "lessons"]) {
    const t = prev.sections[k];
    if (t?.text.trim()) q.sections[k] = { ...t, from: prevQuarter };
  }
  return q;
}

export const prevQuarterOf = (q: string) => {
  const [y, n] = [Number(q.slice(0, 4)), Number(q.slice(6))];
  return n === 1 ? `${y - 1}-Q4` : `${y}-Q${n - 1}`;
};

export const qprPatchSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("section"), key: z.string().regex(/^[a-z0-9.]{1,40}$/), text: z.string().max(20000) }),
  z.object({ action: z.literal("row"), indicator: z.string().regex(/^IND-\d+$/), status: z.enum(STATUSES).nullable(), comment: z.string().max(2000).nullable() }),
  z.object({ action: z.literal("info"), info: z.object({ title: z.string().max(300), agreement: z.string().max(100), locations: z.string().max(600), partner: z.string().max(200), director: z.string().max(200) }), quarterSpend: z.number().min(0).max(1e13).nullable() }),
  z.object({ action: z.literal("risks"), risks: z.array(z.object({ risk: z.string().trim().max(600), mitigation: z.string().trim().max(1200) })).max(20) }),
  z.object({ action: z.literal("grm"), received: z.number().int().min(0).max(1e6).nullable(), resolved: z.number().int().min(0).max(1e6).nullable() }),
  z.object({ action: z.literal("draft"), keys: z.array(z.string().regex(/^[a-z0-9.]{1,40}$/)).min(1).max(20) }),
  z.object({ action: z.literal("release") }),
]);
export type QprPatch = z.infer<typeof qprPatchSchema>;

export type IndicatorInfo = { code: string; donorCode: string | null; name: string; unit: string; target: number; yearTargets: Record<string, number>; result: string | null; disaggregation: string[] | null; budgetRef: string | null };

export type Row = {
  code: string;
  donorCode: string;
  activity: string;
  output: string;
  name: string;
  unit: string;
  yearTarget: number;
  quarter: number;
  year: number;
  /** Women and men, where the results record them. */
  women: number;
  men: number;
  womenLed: number;
  menLed: number;
  provinces: string[];
  records: { quarter: number; year: number; files: number };
  suggested: Status;
  status: Status;
  comment: string;
  edited: boolean;
};

const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The status UNDP's table asks for. Work is often planned for the second half of the year, so
 * anything under way before Q4 is suggested as on track, as ROP's team judged it in Q3 2026;
 * the team changes it where the plan says otherwise.
 */
export function suggestStatus(year: number, target: number, quarterNo: number): Status {
  if (target > 0 && year >= target) return "completed";
  if (quarterNo >= 4) return year > 0 ? "delayed" : "not_implemented";
  if (year > 0) return "on_track";
  return quarterNo >= 3 ? "delayed" : "on_track";
}

/** "1 events" reads "1 event". */
const units = (v: number, unit: string) => (v === 1 && /[^s]s$/.test(unit) ? unit.slice(0, -1) : unit);

export function suggestComment(r: Omit<Row, "suggested" | "status" | "comment" | "edited">, status: Status, quarterLabel: string) {
  const where = r.provinces.length ? ` in ${r.provinces.join(" and ")}` : "";
  const people = r.women + r.men > 0 ? ` (${n(r.women)} women, ${n(r.men)} men)` : r.womenLed + r.menLed > 0 ? ` (${n(r.womenLed)} women-led, ${n(r.menLed)} men-led)` : "";
  const pct = r.yearTarget ? ` (${Math.round((r.year / r.yearTarget) * 100)}% of the annual target)` : "";
  const done = r.quarter > 0 ? `During ${quarterLabel}, ${n(r.quarter)} ${units(r.quarter, r.unit)}${where}${people}.` : `Nothing was achieved during ${quarterLabel}.`;
  return `${STATUS_LABEL[status]}: ${done} ${n(r.year)} of ${n(r.yearTarget)} ${r.unit} so far this year${pct}.`;
}

/** The indicator table for a quarter, from accepted results. */
export function buildRows(indicators: IndicatorInfo[], results: ResultRecord[], quarter: string, saved: Qpr): Row[] {
  const { from, to } = quarterRange(quarter);
  const y = quarter.slice(0, 4);
  const yearFrom = `${y}-01-01`;
  const quarterNo = Number(quarter.slice(6));
  const label = `Q${quarterNo} ${y}`;
  return indicators.map((i) => {
    const mine = results.filter((r) => r.indicator === i.code);
    const q = totalsOf(mine, from, to);
    const yr = totalsOf(mine, yearFrom, to);
    const base = {
      code: i.code,
      donorCode: i.donorCode ?? i.code,
      activity: activityOf(i.donorCode, i.code),
      output: i.result ?? "",
      name: i.name,
      unit: i.unit,
      yearTarget: i.yearTargets[y] ?? i.target,
      quarter: q.value,
      year: yr.value,
      women: q.female,
      men: q.male,
      womenLed: q.womenLed,
      menLed: q.menLed,
      provinces: q.provinces,
      records: { quarter: q.records, year: yr.records, files: q.files },
    };
    const suggested = suggestStatus(base.year, base.yearTarget, quarterNo);
    const o = saved.rows[i.code];
    const status = o?.status ?? suggested;
    return { ...base, suggested, status, comment: o?.comment ?? suggestComment(base, status, label), edited: !!(o?.status || o?.comment) };
  });
}

/** Things to fix before the report goes out. Each one names the indicator or section. */
export function checksFor(rows: Row[], results: ResultRecord[], quarter: string, saved: Qpr, spend: { budget: number; cumulative: number }, activities: string[]) {
  const { from, to } = quarterRange(quarter);
  const inQ = results.filter((r) => r.date >= from && r.date <= to);
  const code = (ind: string) => rows.find((r) => r.code === ind)?.donorCode ?? ind;
  const out: { level: "stop" | "check"; text: string }[] = [];
  const pending = inQ.filter((r) => r.status === "pending");
  for (const c of [...new Set(pending.map((r) => r.indicator))]) out.push({ level: "stop", text: `${code(c)}: ${pending.filter((r) => r.indicator === c).length} result(s) this quarter still waiting for MEL, so not counted.` });
  const queried = inQ.filter((r) => r.status === "queried");
  for (const c of [...new Set(queried.map((r) => r.indicator))]) out.push({ level: "check", text: `${code(c)}: ${queried.filter((r) => r.indicator === c).length} result(s) this quarter were queried by MEL and are not counted.` });
  const noProof = inQ.filter((x) => x.status === "accepted" && !x.files.length);
  for (const c of [...new Set(noProof.map((r) => r.indicator))]) {
    const list = noProof.filter((r) => r.indicator === c);
    out.push({ level: "check", text: `${code(c)}: ${list.length} result(s) this quarter have no proof attached${list[0].noFile ? ` (${list[0].noFile})` : ""}.` });
  }
  for (const r of rows) {
    if (r.status === "completed" && r.year < r.yearTarget) out.push({ level: "stop", text: `${r.donorCode}: marked Completed, but ${n(r.year)} of ${n(r.yearTarget)} ${r.unit} have been achieved this year.` });
    if (r.status === "not_implemented" && r.year > 0) out.push({ level: "stop", text: `${r.donorCode}: marked Not implemented, but ${n(r.year)} ${r.unit} were achieved this year.` });
    if (r.edited) {
      const pcts = [...r.comment.matchAll(/(\d{1,3})\s?%/g)].map((m) => Number(m[1]));
      const real = r.yearTarget ? Math.round((r.year / r.yearTarget) * 100) : null;
      if (real !== null && pcts.some((p) => Math.abs(p - real) > 1)) out.push({ level: "stop", text: `${r.donorCode}: the comment says ${pcts.join("%, ")}%, but the year's achievement is ${real}% of the target.` });
      if (!r.comment.toLowerCase().startsWith(STATUS_LABEL[r.status].toLowerCase())) out.push({ level: "check", text: `${r.donorCode}: the comment does not start with its status (${STATUS_LABEL[r.status]}).` });
    }
  }
  if (spend.cumulative > spend.budget && spend.budget > 0) out.push({ level: "stop", text: `Cumulative spending (${n(spend.cumulative)}) is more than the budget (${n(spend.budget)}).` });
  if (saved.quarterSpend !== null && saved.quarterSpend > spend.cumulative) out.push({ level: "stop", text: "This quarter's spending is more than cumulative spending." });
  if (saved.quarterSpend === null) out.push({ level: "check", text: "This quarter's spending is not entered (Project information)." });
  for (const s of SECTIONS) if (s.key !== "story" && !saved.sections[s.key]?.text.trim()) out.push({ level: "check", text: `${s.heading} is empty.` });
  for (const s of SECTIONS) if (saved.sections[s.key]?.from) out.push({ level: "check", text: `${s.heading} is copied from ${saved.sections[s.key]!.from}: review it for this quarter.` });
  for (const a of activities) {
    const has = rows.some((r) => r.activity === a && r.quarter > 0);
    if (has && !saved.sections[`act.${a}`]?.text.trim()) out.push({ level: "check", text: `Activity ${a} had results this quarter but no narrative.` });
  }
  if (!saved.risks.length) out.push({ level: "check", text: "The risk table is empty." });
  if (saved.grm.received === null) out.push({ level: "check", text: "Complaints (GRM) numbers are not entered." });
  return out;
}
