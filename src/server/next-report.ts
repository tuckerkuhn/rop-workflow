import { addDays, blockers, daysBetween, type Owner } from "@/lib/preflight";
import { prevQuarterOf } from "@/lib/qpr";
import { quarterOf, quarterRange } from "@/lib/results";
import { projectByCode } from "@/server/field-store";
import { preflight, reportDeadline } from "@/server/preflight";
import { rawQpr } from "@/server/qpr-store";

/**
 * Home's "Next report": the pre-flight of the quarter under way (server/preflight), grouped by who
 * has to act. The same function as the pre-flight screen, so the two never disagree. "Blocks" marks
 * what stops the report going out; the rest is worth doing before it does.
 */

export type LoopOwner = Owner;
export type LoopItem = { owner: LoopOwner; text: string; key?: string; vars?: Record<string, string | number>; href: string; blocks: boolean };

/**
 * The quarter "the next report" is about, everywhere (Home, pre-flight, the report page's first
 * screen, the Progress summary and export): the quarter just ended while its report is still being
 * written (not released, and its donor date not passed), else the quarter under way. In early
 * January that is still Q4, not a Q1 nobody reports on yet.
 */
export async function reportQuarter(code: string, today = new Date().toISOString().slice(0, 10)) {
  const now = quarterOf(today);
  const prev = prevQuarterOf(now);
  const end = quarterRange(prev).to;
  const project = await projectByCode(code);
  if (project.startDate && project.startDate > end) return now;
  if ((await rawQpr(project.id, prev))?.released) return now;
  const d = await reportDeadline(code, end, 60, "quarterlyReportDays");
  return today <= (d.due ?? addDays(end, 60)) ? prev : now;
}

export async function nextReport(code: string) {
  const today = new Date().toISOString().slice(0, 10);
  const quarter = await reportQuarter(code, today);
  const p = await preflight(code, { kind: "qpr", quarter });
  const order: LoopOwner[] = ["lead", "field", "mel", "writers", "finance"];
  const items: LoopItem[] = p.items
    .map((i) => ({ owner: i.owner, text: i.text, ...(i.key ? { key: i.key, vars: i.vars } : {}), href: i.href, blocks: i.group === "blocks" }))
    .sort((a, b) => Number(b.blocks) - Number(a.blocks) || order.indexOf(a.owner) - order.indexOf(b.owner));
  return {
    quarter,
    deadline: p.deadline,
    /** Days to the date the team aims for (the deadline less internal review), or null with no deadline set. */
    daysLeft: p.deadline.aim ? daysBetween(today, p.deadline.aim) : null,
    released: p.released,
    blocking: blockers(p),
    items,
  };
}
export type NextReport = Awaited<ReturnType<typeof nextReport>>;
