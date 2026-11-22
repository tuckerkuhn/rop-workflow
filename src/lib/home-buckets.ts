import { fieldSteps, ownerOfItem, type FieldItem } from "@/lib/field";
import { DONE, maySign, stepById, type Procurement } from "@/lib/procurement";
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

/** A pre-flight item and the Home action that asks for the same thing: shown once, as the action. */
export const SAME_AS: Record<string, string> = {
  "pf.c.signOff": "signoff",
  "pf.c.pending": "accept",
  "pf.c.queried": "queried",
  "pf.c.unexplained": "overspent",
  "pf.c.notImported": "import",
};

export type WaitingRow = {
  key: string;
  bucket: Bucket;
  href: string;
  /** Needs doing now: shown first, with a mark. */
  urgent: boolean;
  /** The row's words in English (from Home's actions), or a pre-flight item to be put in the reader's language. */
  text?: string;
  /** The same words as a message key, put in the reader's language on screen. */
  msg?: HomeAction["msg"];
  item?: LoopItem;
  /** The day the oldest thing in the row began to wait (Home's action `since`). */
  since?: string;
  /** A dated row: what is due and when. */
  due?: { what: "report" | "review"; label: string; date: string; days: number };
};

export type Deadline = { key: string; what: string; date: string; days: number; href: string };

export function waitingRows(a: { actions: HomeAction[]; lenses: Lens[]; report: NextReport | null; deadlines: Deadline[] }): Record<Bucket, WaitingRow[]> {
  const out: Record<Bucket, WaitingRow[]> = { approve: [], fix: [], due: [] };
  for (const x of a.actions) out[x.bucket].push({ key: x.key, bucket: x.bucket, href: x.href, urgent: x.urgent, text: x.text, msg: x.msg, ...(x.since ? { since: x.since } : {}) });

  // What stands between this person and the next report, from pre-flight: theirs only, blockers first.
  const mine = new Set(a.lenses.flatMap((l) => OWNERS_FOR[l]));
  if (a.report && !a.report.released)
    for (const [k, i] of a.report.items.filter((i) => mine.has(i.owner)).entries()) {
      // Already on the list as the thing to do ("Accept or query 4 results"): not said a second
      // time as what blocks the report. The row that stays is marked as needing doing now.
      const said = i.key ? SAME_AS[i.key] : undefined;
      const row = said ? BUCKETS.flatMap((b) => out[b]).find((r) => r.key === said) : undefined;
      if (row) {
        if (i.blocks) row.urgent = true;
        continue;
      }
      out.fix.push({ key: `pf-${k}`, bucket: "fix", href: i.href, urgent: i.blocks, item: i });
    }

  // Dated things: the report (the date the team aims for, which keeps time for review) and the month's review.
  const writes = a.lenses.some((l) => l === "lead" || l === "mel");
  if (writes && a.report && !a.report.released && a.report.deadline.aim && a.report.daysLeft !== null)
    out.due.push({ key: "report-due", bucket: "due", href: `/progress/report?q=${a.report.quarter}#checks`, urgent: a.report.daysLeft <= 7, due: { what: "report", label: a.report.quarter.replace("-", " "), date: a.report.deadline.aim, days: a.report.daysLeft } });
  const review = a.deadlines.find((d) => d.key === "review");
  if (review && a.lenses.includes("lead")) out.due.push({ key: "review-due", bucket: "due", href: review.href, urgent: review.days <= 3, due: { what: "review", label: review.what, date: review.date, days: review.days } });

  for (const b of BUCKETS) out[b].sort((x, y) => Number(y.urgent) - Number(x.urgent) || (x.due?.days ?? 0) - (y.due?.days ?? 0));
  return out;
}

/** Whole days a row has waited as of `today`; null when unknown or under two days (not worth saying). */
export function daysWaited(since: string | undefined, today: string): number | null {
  if (!since) return null;
  const n = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${since.slice(0, 10)}T00:00:00Z`)) / 864e5);
  return n >= 2 ? n : null;
}

export const waitingCount = (rows: Record<Bucket, WaitingRow[]>) => BUCKETS.reduce((n, b) => n + rows[b].length, 0);

/* ---------- tasks made at a handoff ---------- */

export type OpenTask = { id: string; title: string; date: string | null; assignee: string | null; sourceKey: string | null };

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

/**
 * An open task as a row on Home, or null when it is not this person's to see. A handoff that makes
 * a task (a distribution sent back, a readiness correction, a payment to release) is only owned
 * once its owner meets it on Home, one tap from the place to act:
 *
 * - theirs: every task the app made for them, and tasks someone gave them that are due within a
 *   week or late;
 * - nobody's: a task the app made that has no owner goes to the people who lead the project, so it
 *   cannot sit unseen.
 */
export function taskRow(t: OpenTask, a: { me: string; lead: boolean; code: string; today: string; lens: Lens }): HomeAction | null {
  const made = !!t.sourceKey && !t.sourceKey.startsWith("demo:") && !t.sourceKey.startsWith("donor:");
  const mine = t.assignee === a.me;
  const orphan = made && !t.assignee && a.lead;
  if (!mine && !orphan) return null;
  if (mine && !made && !(t.date && t.date <= addDays(a.today, 7))) return null;
  const key = t.sourceKey ?? "";
  const at = key.indexOf(":");
  const [kind, ref] = at < 0 ? [key, ""] : [key.slice(0, at), key.slice(at + 1)];
  const project = encodeURIComponent(a.code);
  const fix = kind === "dist-fix" || kind === "correction";
  const href =
    kind === "dist-fix" ? `/approve/${project}/${ref}` : kind === "pay-ready" ? `/work?source=procurement&open=${encodeURIComponent(ref)}&project=${project}` : kind === "correction" ? `/work?source=field&project=${project}` : `/work?project=${project}`;
  const late = !!t.date && t.date < a.today;
  return { key: `task:${t.id}`, for: a.lens, bucket: fix ? "fix" : "due", urgent: fix || late, text: orphan ? `No one is assigned: ${t.title}` : t.title, href };
}

/* ---------- field work waiting on this person ---------- */

/**
 * Field activities as rows on Home: one row per step that waits on a role this person holds, with
 * how many farmers are at it, opening the first of them. A storekeeper sees "Distribute the input
 * package: 2 farmers are waiting for you" before anything about reports.
 */
export function fieldRows(items: Pick<FieldItem, "id" | "kind" | "step">[], roles: string[], code: string, lens: Lens): HomeAction[] {
  const by = new Map<string, string[]>();
  for (const i of items) {
    const owner = ownerOfItem(i as FieldItem);
    if (!owner || !roles.includes(owner)) continue;
    // Recorded and waiting for the project manager: nothing for the field team to do yet.
    if ((i as { awaiting?: { status: string } }).awaiting?.status === "pending") continue;
    by.set(i.step, [...(by.get(i.step) ?? []), i.id]);
  }
  return [...by.entries()]
    .sort((a, b) => (fieldSteps[a[0]]?.stage ?? 0) - (fieldSteps[b[0]]?.stage ?? 0) || a[0].localeCompare(b[0]))
    .map(([step, ids]) => {
      const farmers = items.find((i) => i.id === ids[0])?.kind === "farmer";
      const n = ids.length;
      const who = farmers ? (n === 1 ? "1 farmer is" : `${n} farmers are`) : n === 1 ? "1 finding is" : `${n} findings are`;
      return { key: `field:${step}`, for: lens, bucket: "due" as const, urgent: false, text: `${fieldSteps[step]?.title ?? step}: ${who} waiting for you`, href: `/work?source=field&open=${encodeURIComponent(ids.sort()[0])}&project=${encodeURIComponent(code)}` };
    });
}

/* ---------- purchases waiting on this person ---------- */

/** How many purchases Home lists one by one before it folds the rest into a single row. */
export const PURCHASE_ROWS = 4;

/**
 * Purchases as rows on Home: one row per purchase whose current step this person may sign, saying
 * the step and the purchase, opening that purchase. An approval goes under Approve, everything
 * else under Due. Beyond a handful, the rest fold into one row that opens the whole list, so a
 * procurement officer with twenty open purchases still sees the rest of Home.
 */
export function purchaseRows(procs: Pick<Procurement, "id" | "title" | "step" | "route" | "plan" | "signatures">[], u: Parameters<typeof maySign>[0], code: string, lens: Lens): HomeAction[] {
  const project = encodeURIComponent(code);
  const mine = procs
    .filter((p) => p.step !== DONE && !!stepById[p.step] && maySign(u, p as Procurement, stepById[p.step].owner))
    .sort((a, b) => Number(stepById[b.step].owner === "approver") - Number(stepById[a.step].owner === "approver") || a.id.localeCompare(b.id));
  const row = (p: (typeof mine)[number]): HomeAction => {
    const approve = stepById[p.step].owner === "approver";
    return { key: `purchase:${p.id}`, for: lens, bucket: approve ? "approve" : "due", urgent: approve, text: `${stepById[p.step].title}: ${p.id} ${p.title}`, href: `/work?source=procurement&open=${encodeURIComponent(p.id)}&project=${project}` };
  };
  if (mine.length <= PURCHASE_ROWS) return mine.map(row);
  const rest = mine.length - (PURCHASE_ROWS - 1);
  return [...mine.slice(0, PURCHASE_ROWS - 1).map(row), { key: "purchase:more", for: lens, bucket: "due", urgent: false, text: `${rest} more purchases are waiting for you`, href: `/work?source=procurement&project=${project}` }];
}
