import { z } from "zod";
import { quarterRange, totalsOf, type ResultRecord, type UpdateRecord } from "@/lib/results";

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

export const STATUSES = ["completed", "on_track", "delayed", "not_implemented", "not_started"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { completed: "Completed", on_track: "On track", delayed: "Delayed", not_implemented: "Not implemented", not_started: "Not yet started" };

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
  info: { title: string; agreement: string; locations: string; partner: string; director: string; duration?: string };
  /** Abbreviations listed at the front of the report; carried forward each quarter. */
  acronyms?: [string, string][];
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
  q.acronyms = prev.acronyms;
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
  z.object({ action: z.literal("info"), info: z.object({ title: z.string().max(300), agreement: z.string().max(100), locations: z.string().max(600), partner: z.string().max(200), director: z.string().max(200), duration: z.string().max(200).optional() }), quarterSpend: z.number().min(0).max(1e13).nullable() }),
  z.object({ action: z.literal("acronyms"), acronyms: z.array(z.tuple([z.string().trim().min(1).max(20), z.string().trim().min(1).max(200)])).max(80) }),
  z.object({ action: z.literal("risks"), risks: z.array(z.object({ risk: z.string().trim().max(600), mitigation: z.string().trim().max(1200) })).max(20) }),
  z.object({ action: z.literal("grm"), received: z.number().int().min(0).max(1e6).nullable(), resolved: z.number().int().min(0).max(1e6).nullable() }),
  z.object({ action: z.literal("draft"), keys: z.array(z.string().regex(/^[a-z0-9.]{1,40}$/)).min(1).max(20) }),
  z.object({ action: z.literal("release") }),
]);
export type QprPatch = z.infer<typeof qprPatchSchema>;

/** Spending for the report: from the imported budget against actual (every phase of the agreement, overhead included) when there is one, else the budget file. */
export type Spend = {
  currency: string;
  budget: number;
  /** Spent from the agreement's start to the end of the quarter. */
  cumulative: number;
  /** Spent in the quarter, from the import; null without one. */
  quarter: number | null;
  /** True when the figures include overhead (GMS 8%). */
  withOverhead: boolean;
  source: { kind: "import"; files: { name: string; sharepointUrl: string | null; by: string; at: string; period: string }[] } | { kind: "budget"; at: string | null };
  /** Each imported phase: its period, budget and spending, overhead included. */
  phases: { period: string; budget: number; actual: number }[];
  /** Months of the quarter the import does not cover yet. */
  missingMonths: string[];
  /** Per budget line of the current phase (overhead not included): budget, spent to the quarter's end, spent in the quarter. */
  byLine: Record<string, { budget: number; actual: number; quarter: number }>;
};

/** What the report says was spent this quarter: what the team typed, or the import. */
export const quarterSpendOf = (saved: Qpr, spend: Spend) => saved.quarterSpend ?? spend.quarter;

export type IndicatorInfo = { code: string; donorCode: string | null; name: string; unit: string; target: number; yearTargets: Record<string, number>; result: string | null; disaggregation: string[] | null; budgetRef: string | null; workplanCode?: string | null };

export type Row = {
  code: string;
  donorCode: string;
  activity: string;
  output: string;
  name: string;
  unit: string;
  /** The budget line that pays for it, e.g. "PRG-1.1.1.C". */
  budgetRef: string | null;
  yearTarget: number;
  quarter: number;
  year: number;
  /** Women and men, where the results record them. */
  women: number;
  men: number;
  womenLed: number;
  menLed: number;
  /** Provinces of this quarter's results; empty when any of them has no province recorded. */
  provinces: string[];
  /** Accepted records this quarter and this year, files on them, and records this year still waiting for (or queried by) MEL. */
  records: { quarter: number; year: number; files: number; open: number };
  /**
   * Quarters of this year (1–4) the workplan plans the work for; null when the indicator is not
   * linked to a workplan activity, so lateness cannot be judged from the plan.
   */
  planned: number[] | null;
  suggested: Status;
  status: Status;
  comment: string;
  edited: boolean;
};

const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * The status UNDP's table asks for, worded the way ROP's team reports. The workplan decides
 * whether work that is short of target is late or simply not due yet:
 * - target reached: completed;
 * - the planned window has not opened yet: not started (planned for later in the year);
 * - the window is open now, however broad: on track once anything is recorded; with nothing
 *   recorded, not started until the window's last quarter and delayed in it;
 * - the window has closed short of target: delayed (not implemented if nothing happened at all);
 * - in Q4, written after the year ends, anything short of the year's target is delayed (or not
 *   implemented), whatever the plan said.
 * Without a workplan link, before Q4: on track if anything is recorded, not started if not.
 * The team changes it where they know better.
 *
 * `underWay`: anything recorded against the indicator this year, counted or not.
 * `planned`: quarters of this year with work planned (see Row.planned).
 */
export function suggestStatus(year: number, target: number, quarterNo: number, underWay = year > 0, planned: number[] | null = null): Status {
  if (target > 0 && year >= target) return "completed";
  if (target === 0 && year === 0) return "not_started";
  const late = (none: boolean) => (none ? "not_implemented" : "delayed");
  // The Q4 report is written after the year ends: whatever is short of the year's target is late.
  if (quarterNo >= 4) return late(!underWay);
  // Linked, but the workplan has nothing for it this year.
  if (planned && !planned.length) return underWay ? "on_track" : "not_started";
  if (planned && planned.length) {
    const first = Math.min(...planned);
    const last = Math.max(...planned);
    if (quarterNo < first) return underWay ? "on_track" : "not_started";
    // In the window: on track once work is recorded; nothing yet is fine until its last quarter.
    if (quarterNo < last) return underWay ? "on_track" : "not_started";
    if (quarterNo === last) return underWay ? "on_track" : "delayed";
    return late(!underWay);
  }
  return underWay ? "on_track" : "not_started";
}

/** "Q3", "Q3–Q4" or "Q2 and Q4" for the planned quarters. */
export function plannedLabel(planned: number[], year: string) {
  const q = [...new Set(planned)].sort();
  const runs: string[] = [];
  for (let i = 0; i < q.length; i++) {
    let j = i;
    while (j + 1 < q.length && q[j + 1] === q[j] + 1) j++;
    runs.push(i === j ? `Q${q[i]}` : `Q${q[i]}–Q${q[j]}`);
    i = j;
  }
  return `${runs.join(" and ")} ${year}`;
}

/** "1 events" reads "1 event". */
const units = (v: number, unit: string) => (v === 1 && /[^s]s$/.test(unit) ? unit.slice(0, -1) : unit);

export function suggestComment(r: Omit<Row, "suggested" | "status" | "comment" | "edited">, status: Status, quarterLabel: string) {
  const where = r.provinces.length ? ` in ${r.provinces.join(" and ")}` : "";
  const people = r.women + r.men > 0 ? ` (${n(r.women)} women, ${n(r.men)} men)` : r.womenLed + r.menLed > 0 ? ` (${n(r.womenLed)} women-led, ${n(r.menLed)} men-led)` : "";
  const pct = r.yearTarget ? ` (${Math.round((r.year / r.yearTarget) * 100)}% of the annual target)` : "";
  const waiting = r.records.open > 0 ? ` ${r.records.open} ${r.records.open === 1 ? "record is" : "records are"} waiting for MEL review.` : "";
  const done = r.quarter > 0 ? `During ${quarterLabel}, ${n(r.quarter)} ${units(r.quarter, r.unit)}${where}${people}.` : `Nothing was counted during ${quarterLabel}.${waiting}`;
  const year = quarterLabel.slice(-4);
  const plan = r.planned ? (r.planned.length ? ` The workplan schedules it for ${plannedLabel(r.planned, year)}.` : ` The workplan does not schedule it in ${year}.`) : "";
  if (!r.yearTarget && !r.year) return `${STATUS_LABEL[status]}: ${done} None is planned for this year; the work is planned for a later year.`;
  if (status === "not_started") return `${STATUS_LABEL[status]}: nothing has been recorded yet against the ${n(r.yearTarget)} ${r.unit} planned for this year.${plan}`;
  return `${STATUS_LABEL[status]}: ${done} ${n(r.year)} of ${n(r.yearTarget)} ${r.unit} so far this year${pct}.${plan}`;
}

/**
 * This year's part of the target. Year targets are stored as running totals from the project's
 * start (expected total by 31 December), but the report counts this year's results only, so the
 * year's part is this year's total less last year's (none before the first year).
 */
export function yearShare(i: Pick<IndicatorInfo, "target" | "yearTargets">, y: number) {
  const byEnd = i.yearTargets[String(y)] ?? i.target;
  const before = i.yearTargets[String(y - 1)] ?? 0;
  return Math.max(0, byEnd - before);
}

/** The indicator table for a quarter, from accepted results. */
/**
 * `plans`: for each workplan activity code, the first days of the quarters with work planned
 * (workplan_items.active, e.g. ["2026-07-01"]), for the partner whose report this is.
 */
export function buildRows(indicators: IndicatorInfo[], results: ResultRecord[], quarter: string, saved: Qpr, plans: Record<string, string[]> = {}): Row[] {
  const { from, to } = quarterRange(quarter);
  const y = quarter.slice(0, 4);
  const yearFrom = `${y}-01-01`;
  const quarterNo = Number(quarter.slice(6));
  const label = `Q${quarterNo} ${y}`;
  return indicators.map((i) => {
    const mine = results.filter((r) => r.indicator === i.code);
    const q = totalsOf(mine, from, to);
    const yr = totalsOf(mine, yearFrom, to);
    // Recorded this year but not counted yet: waiting for MEL, or queried.
    const open = mine.filter((r) => r.status !== "accepted" && r.date >= yearFrom && r.date <= to).length;
    // Name the provinces only when every counted record has one: a record without a province
    // (training across both provinces, say) would otherwise be put down to the others.
    const unplaced = mine.some((r) => r.status === "accepted" && r.date >= from && r.date <= to && !r.province);
    const base = {
      code: i.code,
      donorCode: i.donorCode ?? i.code,
      activity: activityOf(i.donorCode, i.code),
      output: i.result ?? "",
      name: i.name,
      unit: i.unit,
      budgetRef: i.budgetRef,
      yearTarget: yearShare(i, Number(y)),
      quarter: q.value,
      year: yr.value,
      women: q.female,
      men: q.male,
      womenLed: q.womenLed,
      menLed: q.menLed,
      provinces: unplaced ? [] : q.provinces,
      records: { quarter: q.records, year: yr.records, files: q.files, open },
      planned: i.workplanCode && plans[i.workplanCode] ? plans[i.workplanCode].filter((d) => d.startsWith(y)).map((d) => Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1) : null,
    };
    const suggested = suggestStatus(base.year, base.yearTarget, quarterNo, base.year > 0 || open > 0, base.planned);
    const o = saved.rows[i.code];
    const status = o?.status ?? suggested;
    return { ...base, suggested, status, comment: o?.comment ?? suggestComment(base, status, label), edited: !!(o?.status || o?.comment) };
  });
}

/** Things to fix before the report goes out. Each one names the indicator or section. */
export function checksFor(rows: Row[], results: ResultRecord[], quarter: string, saved: Qpr, spend: Spend, activities: string[]) {
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
  const qs = quarterSpendOf(saved, spend);
  if (qs !== null && qs > spend.cumulative) out.push({ level: "stop", text: "This quarter's spending is more than cumulative spending." });
  if (qs === null) out.push({ level: "check", text: "This quarter's spending is not entered: import Finance's budget-against-actual workbook, or type it in (Project information)." });
  const over = Object.entries(spend.byLine).filter(([, l]) => l.budget > 0 && l.actual > l.budget + 1);
  for (const [code, l] of over) out.push({ level: "check", text: `Budget line ${code} has spent ${n(l.actual)} of ${n(l.budget)} ${spend.currency} (${Math.round((l.actual / l.budget) * 100)}%): explain the overspend or the budget revision.` });
  if (spend.source.kind === "import" && spend.missingMonths.length) out.push({ level: "stop", text: `The spending import does not include ${spend.missingMonths.join(", ")}: import the latest workbook from Finance.` });
  if (saved.quarterSpend !== null && spend.quarter !== null && Math.abs(saved.quarterSpend - spend.quarter) > 1) out.push({ level: "check", text: `This quarter's spending is typed in as ${n(saved.quarterSpend)}, but the import says ${n(spend.quarter)}.` });
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

/** Abbreviations a UNDP report on Afghanistan usually needs; the team edits the list. */
export const DEFAULT_ACRONYMS: [string, string][] = [
  ["CSA", "Climate-Smart Agriculture"],
  ["DAIL", "Directorate of Agriculture, Irrigation and Livestock"],
  ["GEWE", "Gender Equality and Women's Empowerment"],
  ["GMS", "General Management Support"],
  ["GRM", "Grievance Redress Mechanism"],
  ["HVC", "High-Value Crop"],
  ["IWRM", "Integrated Water Resources Management"],
  ["MAIL", "Ministry of Agriculture, Irrigation and Livestock"],
  ["MSME", "Micro, Small and Medium Enterprise"],
  ["SES", "Social and Environmental Safeguards"],
  ["UNDP", "United Nations Development Programme"],
  ["WUA", "Water Users Association"],
];

/** A captioned photo from an accepted result or an activity update in the quarter, for the report. */
export type Photo = { hash: string; name: string; type: string; caption: string; activity: string; date: string };

export function photosFor(rows: Row[], results: ResultRecord[], updates: UpdateRecord[], quarter: string): Photo[] {
  const { from, to } = quarterRange(quarter);
  const out: Photo[] = [];
  for (const r of results.filter((x) => x.status === "accepted" && x.date >= from && x.date <= to)) {
    const activity = rows.find((x) => x.code === r.indicator)?.activity ?? "";
    for (const f of r.files) if (f.type.startsWith("image/") && r.captions?.[f.hash]) out.push({ hash: f.hash, name: f.name, type: f.type, caption: r.captions[f.hash], activity, date: r.date });
  }
  for (const u of updates.filter((x) => x.date >= from && x.date <= to))
    for (const f of u.files) if (f.type.startsWith("image/") && u.captions?.[f.hash]) out.push({ hash: f.hash, name: f.name, type: f.type, caption: u.captions[f.hash], activity: u.activity, date: u.date });
  const seen = new Set<string>();
  return out.filter((p) => !seen.has(p.hash) && !!seen.add(p.hash)).sort((a, b) => a.activity.localeCompare(b.activity) || a.date.localeCompare(b.date));
}

/**
 * A breakdown table for an indicator, like ROP's "Summary of Commercial Greenhouses Constructed
 * by Province and Beneficiary Gender": one row per province and district, from the quarter's
 * accepted results. Only where at least two places are recorded, or people are broken down.
 */
export type Breakdown = { indicator: string; title: string; columns: string[]; rows: (string | number)[][] };

export function breakdownsFor(rows: Row[], results: ResultRecord[], quarter: string): Breakdown[] {
  const { from, to } = quarterRange(quarter);
  const out: Breakdown[] = [];
  for (const row of rows) {
    // Every accepted result of the quarter, so the table's total is the indicator's; a result with no place gets its own row.
    const list = results.filter((r) => r.indicator === row.code && r.status === "accepted" && r.date >= from && r.date <= to);
    if (!list.some((r) => r.province || r.district)) continue;
    const people = list.some((r) => r.female !== undefined || r.male !== undefined);
    const lead = list.some((r) => r.womenLed !== undefined || r.menLed !== undefined);
    const places = new Map<string, { province: string; district: string; value: number; a: number; b: number }>();
    for (const r of list) {
      const k = `${r.province ?? ""}|${r.district ?? ""}`;
      const p = places.get(k) ?? { province: r.province ?? (r.district ? "" : "Not recorded"), district: r.district ?? "", value: 0, a: 0, b: 0 };
      p.value += r.value;
      p.a += people ? (r.female ?? 0) : (r.womenLed ?? 0);
      p.b += people ? (r.male ?? 0) : (r.menLed ?? 0);
      places.set(k, p);
    }
    if (places.size < 2 && !people && !lead) continue;
    const sorted = [...places.values()].sort((x, y) => Number(x.province === "Not recorded") - Number(y.province === "Not recorded") || x.province.localeCompare(y.province) || x.district.localeCompare(y.district));
    const extra = people ? ["Women", "Men"] : lead ? ["Women-led", "Men-led"] : [];
    const cells = (p: { value: number; a: number; b: number }) => [p.value, ...(extra.length ? [p.a, p.b] : [])];
    const total = sorted.reduce((t, p) => ({ value: t.value + p.value, a: t.a + p.a, b: t.b + p.b }), { value: 0, a: 0, b: 0 });
    out.push({
      indicator: row.code,
      title: `${row.donorCode}: ${row.name}, by province and district${people ? " and sex" : lead ? " and who leads the business" : ""} (${quarter.replace("-", " ")})`,
      columns: ["Province", "District", `Quantity (${row.unit})`, ...extra],
      rows: [...sorted.map((p) => [p.province || "—", p.district || "—", ...cells(p)]), ["Total", "", ...cells(total)]],
    });
  }
  return out;
}
