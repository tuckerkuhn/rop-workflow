import { blockers, daysBetween, type Owner } from "@/lib/preflight";
import { quarterOf } from "@/lib/results";
import { preflight } from "@/server/preflight";

/**
 * Home's "Next report": the pre-flight of the quarter under way (server/preflight), grouped by who
 * has to act. The same function as the pre-flight screen, so the two never disagree. "Blocks" marks
 * what stops the report going out; the rest is worth doing before it does.
 */

export type LoopOwner = Owner;
export type LoopItem = { owner: LoopOwner; text: string; key?: string; vars?: Record<string, string | number>; href: string; blocks: boolean };

export async function nextReport(code: string) {
  const today = new Date().toISOString().slice(0, 10);
  const quarter = quarterOf(today);
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
