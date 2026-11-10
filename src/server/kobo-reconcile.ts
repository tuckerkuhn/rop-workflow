import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { sync } from "@/server/kobo-link";
import { koboToResults } from "@/server/kobo-results";

/**
 * The nightly reconcile (B4): runs the same sync as the button and the webhook for every project
 * connected to KoboToolbox, so edits and deletions made in KoboToolbox after the webhook fired are
 * caught. Nothing new is decided here: the sync already updates a result still waiting for MEL,
 * and never changes an accepted one silently (it flags it and writes the
 * `kobo_changed_after_acceptance` audit entry; a deleted accepted result is flagged, not removed).
 * Each run leaves one audit row per project, which the health page reads.
 */

export const RECONCILED = "kobo_reconciled";
export const RECONCILE_FAILED = "kobo_reconcile_failed";

export type ReconcileRun = {
  project: string;
  ok: boolean;
  /** Submissions on the forms, new ones stored, ones edited or deleted in KoboToolbox since the last sync. */
  fetched: number;
  added: number;
  updated: number;
  removed: number;
  /** Results for MEL: new, changed while still waiting, and accepted ones flagged because KoboToolbox changed under them. */
  results: { added: number; updated: number; removed: number; flagged: number };
  /** Why it could not run, in plain words. */
  error?: string;
};

const EMPTY = { fetched: 0, added: 0, updated: 0, removed: 0, results: { added: 0, updated: 0, removed: 0, flagged: 0 } };

/** What the health page says about one run, in one line. */
export function reconcileLine(r: Pick<ReconcileRun, "ok" | "fetched" | "added" | "updated" | "removed" | "results" | "error">): string {
  if (!r.ok) return `Did not run: ${r.error ?? "unknown reason"}`;
  const changed = r.added + r.updated + r.removed;
  const flagged = r.results.flagged ? ` ${r.results.flagged} accepted ${r.results.flagged === 1 ? "result was" : "results were"} changed in KoboToolbox and flagged for MEL.` : "";
  return changed ? `${r.fetched} submissions checked: ${r.added} new, ${r.updated} edited, ${r.removed} deleted in KoboToolbox.${flagged}` : `${r.fetched} submissions checked: nothing had changed.${flagged}`;
}

/** Runs the sync for every connected project, one after another; one project's failure does not stop the rest. */
export async function reconcileAll(): Promise<ReconcileRun[]> {
  const projects = await db.select({ id: s.projects.id, code: s.projects.code }).from(s.koboConnections).innerJoin(s.projects, eq(s.projects.id, s.koboConnections.projectId));
  const runs: ReconcileRun[] = [];
  for (const p of projects) {
    if (!p.code) continue;
    let run: ReconcileRun;
    try {
      const c = await sync(p.code);
      const r = await koboToResults(p.code);
      run = { project: p.code, ok: true, fetched: c.fetched, added: c.added, updated: c.updated, removed: c.removed, results: { added: r.added, updated: r.updated, removed: r.removed, flagged: r.flagged } };
    } catch (e) {
      // Kept short: a message from KoboToolbox or the network, never a token.
      run = { project: p.code, ok: false, ...EMPTY, error: (e instanceof Error ? e.message : String(e)).slice(0, 300) };
    }
    runs.push(run);
    const { project: _code, ...detail } = run;
    void _code;
    await db.insert(s.auditLog).values({ projectId: p.id, entity: "kobo", entityId: randomUUID(), action: run.ok ? RECONCILED : RECONCILE_FAILED, detail: { by: "nightly", ...detail } });
  }
  return runs;
}

/** The latest run for each project in the last week, for the health page. */
export async function lastReconciles(): Promise<(ReconcileRun & { at: string })[]> {
  const rows = await db
    .select({ at: s.auditLog.at, action: s.auditLog.action, detail: s.auditLog.detail, code: s.projects.code })
    .from(s.auditLog)
    .innerJoin(s.projects, eq(s.projects.id, s.auditLog.projectId))
    .where(and(inArray(s.auditLog.action, [RECONCILED, RECONCILE_FAILED]), gte(s.auditLog.at, new Date(Date.now() - 7 * 86400_000))))
    .orderBy(desc(s.auditLog.at))
    .limit(500);
  const seen = new Set<string>();
  const out: (ReconcileRun & { at: string })[] = [];
  for (const r of rows) {
    const code = r.code ?? "";
    if (!code || seen.has(code)) continue;
    seen.add(code);
    const d = (r.detail ?? {}) as Partial<ReconcileRun>;
    out.push({ project: code, at: r.at.toISOString(), ok: r.action === RECONCILED, fetched: d.fetched ?? 0, added: d.added ?? 0, updated: d.updated ?? 0, removed: d.removed ?? 0, results: d.results ?? EMPTY.results, ...(d.error ? { error: d.error } : {}) });
  }
  return out.sort((a, b) => a.project.localeCompare(b.project));
}
