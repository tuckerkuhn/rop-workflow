import type { Bucket, HomeAction, Lens } from "@/server/home-store";
import type { LoopItem, LoopOwner, NextReport } from "@/server/next-report";

/**
 * Home's list of what is waiting on one person, in three groups: Approve, Fix and Due (C1). One
 * row is one line with one tap to the place to act. The rows come from two places that already
 * exist: the actions Home works out for each role, and pre-flight's items for the next report,
 * so what Home says blocks the report is what the pre-flight screen says.
 */

export const BUCKETS: Bucket[] = ["approve", "fix", "due"];

/** Whose pre-flight items belong to each view of Home. */
export const OWNERS_FOR: Record<Lens, LoopOwner[]> = { lead: ["lead"], mel: ["mel", "writers"], field: ["field"], finance: ["finance"], procurement: [], hr: [] };

export type WaitingRow = {
  key: string;
  bucket: Bucket;
  href: string;
  /** Needs doing now: shown first, with a mark. */
  urgent: boolean;
  /** The row's words in English (from Home's actions), or a pre-flight item to be put in the reader's language. */
  text?: string;
  item?: LoopItem;
  /** A dated row: what is due and when. */
  due?: { what: "report" | "review"; label: string; date: string; days: number };
};

export type Deadline = { key: string; what: string; date: string; days: number; href: string };

export function waitingRows(a: { actions: HomeAction[]; lenses: Lens[]; report: NextReport | null; deadlines: Deadline[] }): Record<Bucket, WaitingRow[]> {
  const out: Record<Bucket, WaitingRow[]> = { approve: [], fix: [], due: [] };
  for (const x of a.actions) out[x.bucket].push({ key: x.key, bucket: x.bucket, href: x.href, urgent: x.urgent, text: x.text });

  // What stands between this person and the next report, from pre-flight: theirs only, blockers first.
  const mine = new Set(a.lenses.flatMap((l) => OWNERS_FOR[l]));
  if (a.report && !a.report.released)
    for (const [k, i] of a.report.items.filter((i) => mine.has(i.owner)).entries()) out.fix.push({ key: `pf-${k}`, bucket: "fix", href: i.href, urgent: i.blocks, item: i });

  // Dated things: the report (the date the team aims for, which keeps time for review) and the month's review.
  const writes = a.lenses.some((l) => l === "lead" || l === "mel");
  if (writes && a.report && !a.report.released && a.report.deadline.aim && a.report.daysLeft !== null)
    out.due.push({ key: "report-due", bucket: "due", href: `/progress/preflight?report=qpr&period=${a.report.quarter}`, urgent: a.report.daysLeft <= 7, due: { what: "report", label: a.report.quarter.replace("-", " "), date: a.report.deadline.aim, days: a.report.daysLeft } });
  const review = a.deadlines.find((d) => d.key === "review");
  if (review && a.lenses.includes("lead")) out.due.push({ key: "review-due", bucket: "due", href: review.href, urgent: review.days <= 3, due: { what: "review", label: review.what, date: review.date, days: review.days } });

  for (const b of BUCKETS) out[b].sort((x, y) => Number(y.urgent) - Number(x.urgent) || (x.due?.days ?? 0) - (y.due?.days ?? 0));
  return out;
}

export const waitingCount = (rows: Record<Bucket, WaitingRow[]>) => BUCKETS.reduce((n, b) => n + rows[b].length, 0);
