import { SECTIONS, STATUS_LABEL, type Breakdown, type Photo, type Qpr, type QprCheck, type Row, type Spend } from "@/lib/qpr";

/**
 * A frozen copy of a quarterly report: what it said when it was released (or practice-released),
 * so a released report always shows and downloads what the donor received, and later changes to
 * the results show as differences instead of quietly changing it.
 */

export type CopyData = {
  project: { code: string; name: string; goal: string | null; donor: string | null; start: string | null; end: string | null };
  quarter: string;
  saved: Qpr;
  rows: Row[];
  photos: Photo[];
  breakdowns: Breakdown[];
  spend: Spend;
  activities: { code: string; name: string }[];
  /** Copies saved before the checks had keys show their English text. */
  checks: QprCheck[];
  /** The accepted results counted in the report's figures (this year to the quarter's end). */
  counted: { id: string; indicator: string; date: string; value: number }[];
};
export type WorkTime = { minutes: number; sittings: number; first: string | null; last: string | null };
export type ReportCopy = { kind: "release" | "practice"; by: string; at: string; work: WorkTime; data: CopyData };

/** Copies kept per report: the release, and the latest practice runs. */
export const MAX_PRACTICE = 10;

/**
 * Time spent writing a report, from the times of its edits: edits less than 30 minutes apart are
 * one sitting, and each sitting counts from its first edit to its last, plus 5 minutes for the
 * work before the first save. A rough measure of effort, not of the days between start and end.
 */
export function workTime(times: string[]): WorkTime {
  const t = [...times].sort().map((x) => Date.parse(x));
  if (!t.length) return { minutes: 0, sittings: 0, first: null, last: null };
  let ms = 0;
  let sittings = 1;
  let start = t[0];
  for (let i = 1; i < t.length; i++) {
    if (t[i] - t[i - 1] > 30 * 60_000) {
      ms += t[i - 1] - start + 5 * 60_000;
      start = t[i];
      sittings++;
    }
  }
  ms += t[t.length - 1] - start + 5 * 60_000;
  return { minutes: Math.round(ms / 60_000), sittings, first: new Date(t[0]).toISOString(), last: new Date(t[t.length - 1]).toISOString() };
}

export const formatMinutes = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`);

const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** What differs between a frozen copy and the report as it would be now, in plain sentences. */
export function differences(copy: CopyData, now: CopyData): string[] {
  const out: string[] = [];
  for (const r of copy.rows) {
    const n = now.rows.find((x) => x.code === r.code);
    const label = `${r.donorCode || r.code}`;
    if (!n) {
      out.push(`${label} is no longer in the report.`);
      continue;
    }
    if (n.quarter !== r.quarter) out.push(`${label} this quarter: ${num(r.quarter)} then, ${num(n.quarter)} now.`);
    if (n.year !== r.year) out.push(`${label} this year: ${num(r.year)} then, ${num(n.year)} now.`);
    if (n.yearTarget !== r.yearTarget) out.push(`${label} target: ${num(r.yearTarget)} then, ${num(n.yearTarget)} now.`);
    if (n.status !== r.status) out.push(`${label} status: ${STATUS_LABEL[r.status]} then, ${STATUS_LABEL[n.status]} now.`);
    else if (n.comment !== r.comment) out.push(`${label} comment changed.`);
  }
  for (const n of now.rows) if (!copy.rows.some((x) => x.code === n.code)) out.push(`${n.donorCode || n.code} has been added to the report.`);
  const was = new Set(copy.counted.map((c) => c.id));
  const is = new Set(now.counted.map((c) => c.id));
  const gone = copy.counted.filter((c) => !is.has(c.id));
  const added = now.counted.filter((c) => !was.has(c.id));
  if (gone.length) out.push(`${gone.length} ${gone.length === 1 ? "result counted then is" : "results counted then are"} no longer counted (reopened, queried or removed).`);
  if (added.length) out.push(`${added.length} ${added.length === 1 ? "result" : "results"} accepted since would now count.`);
  for (const s of SECTIONS) if ((copy.saved.sections[s.key]?.text ?? "") !== (now.saved.sections[s.key]?.text ?? "")) out.push(`${s.heading}: the text has changed.`);
  for (const a of copy.activities) if ((copy.saved.sections[`act.${a.code}`]?.text ?? "") !== (now.saved.sections[`act.${a.code}`]?.text ?? "")) out.push(`Activity ${a.code}: the narrative has changed.`);
  const ph = (p: Photo[]) => new Set(p.map((x) => x.hash));
  const pa = ph(copy.photos);
  const pb = ph(now.photos);
  const lost = [...pa].filter((h) => !pb.has(h)).length;
  const gained = [...pb].filter((h) => !pa.has(h)).length;
  if (lost || gained) out.push(`Photos: ${gained} added and ${lost} removed since.`);
  if (copy.spend.cumulative !== now.spend.cumulative) out.push(`Cumulative spending: ${num(copy.spend.cumulative)} then, ${num(now.spend.cumulative)} now.`);
  return out;
}
