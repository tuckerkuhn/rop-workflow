import { addDays, blockers, daysBetween, type Owner } from "@/lib/preflight";
import { early } from "@/server/early";
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
  // Both read together: one after the other each is a round trip to the database.
  const deadline = early(reportDeadline(code, end, 60, "quarterlyReportDays"));
  if ((await rawQpr(project.id, prev))?.released) return now;
  const d = await deadline;
  return today <= (d.due ?? addDays(end, 60)) ? prev : now;
}

/**
 * The same read asked for twice at once: Home's page asks for its project's summary and next
 * report, and the week ahead asks for them again for every project, in two requests that start
 * together. `shareRunning` runs a read and lets others join it while it runs; `joinRunning` takes
 * the answer of the same read already under way (a copy of it), or reads for itself when none is
 * (or when that answer cannot be copied, or that read failed).
 * Nothing is kept once the read is done, so no answer is older than one that was already running.
 * Only the week ahead joins: a screen read again after a change never takes an answer started before it.
 */
const running = new Map<string, Promise<unknown>>();
export function shareRunning<T>(key: string, read: () => Promise<T>): Promise<T> {
  const p = read();
  running.set(key, p);
  const done = () => {
    if (running.get(key) === p) running.delete(key);
  };
  p.then(done, done);
  return p;
}
export function joinRunning<T>(key: string, read: () => Promise<T>): Promise<T> {
  const p = running.get(key) as Promise<T> | undefined;
  if (!p) return read();
  // A copy, so neither request can change the other's answer. An answer that cannot be copied, or
  // a read that failed for the other request, is never passed on as nothing: this one reads for itself.
  return p.then(
    (v) => {
      try {
        return structuredClone(v);
      } catch {
        return read();
      }
    },
    () => read(),
  );
}

export function nextReport(code: string) {
  return shareRunning(`next-report:${code}`, () => readNextReport(code));
}
async function readNextReport(code: string) {
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
export type NextReport = Awaited<ReturnType<typeof readNextReport>>;
