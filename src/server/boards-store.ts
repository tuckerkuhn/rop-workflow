import { eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { DEFAULT_STEP_SETTINGS, approverFor, blockers, contributed, type Grant } from "@/lib/grants";
import { procurementCards, type ProcCard } from "@/lib/boards";
import { levelFor, setProcurementRules, type Procurement } from "@/lib/procurement";
import type { Value } from "@/lib/policy";
import { inOwnOrganization, onProject, type Viewer } from "@/server/auth";
import { loadGrants } from "@/server/grants-store";
import { projectRules } from "@/server/policy-store";
import { DEMO_PROJECT } from "@/server/procurement-guard";
import { loadProcurements } from "@/server/procurement-store";
import { listProjects } from "@/server/project-store";

/**
 * The boards across every project the person works on (lib/boards.ts): large procurements by step,
 * and agribusiness grants by step. The sample and the fictional demo project are left out; sandboxes are shown, marked, since they
 * are where the team tries things.
 */

async function projectsFor(v: Viewer) {
  const all = (await listProjects({ all: true })).filter((p) => p.kind !== "sample" && p.code !== DEMO_PROJECT && onProject(v.user, p.code));
  const mine = await Promise.all(all.map(async (p) => ((await inOwnOrganization(v, p.code)) ? p : null)));
  return mine.filter((p) => p !== null);
}

/** Procurements at or above `min` ("Large", or "Medium" to include those too), each by its own project's thresholds. */
export async function procurementBoard(v: Viewer, min: "Large" | "Medium"): Promise<{ cards: ProcCard[] }> {
  if (v.user.procurementAccess === "none") return { cards: [] };
  const projects = await projectsFor(v);
  // Every project's purchases in one query, with each project's rules read at the same time: one
  // project after another, each is a round trip to the database. A failed read shows that project
  // with no cards, as before. Cards keep the projects' order.
  const [items, rules] = await Promise.all([
    procurementsOf(projects.map((p) => p.code)).catch(() => new Map<string, Procurement[]>()),
    Promise.all(projects.map((p) => projectRules(p.code).catch(() => null))),
  ]);
  return { cards: projects.flatMap((p, k) => cardsAtLeast({ code: p.code, name: p.name, sandbox: p.kind === "sandbox" }, min, items.get(p.code) ?? [], rules[k])) };
}

/** One project's procurements at or above `min`, by that project's own thresholds. */
export async function projectProcurementCards(project: ProcCard["project"], min: "Large" | "Medium"): Promise<ProcCard[]> {
  const [items, eff] = await Promise.all([loadProcurements(project.code).catch(() => []), projectRules(project.code).catch(() => null)]);
  return cardsAtLeast(project, min, items, eff);
}

/**
 * The purchases of several projects by code, newest first within each (as server/procurement-store
 * loadProcurements lists one project's). A code that names no project has none.
 */
async function procurementsOf(codes: string[]): Promise<Map<string, Procurement[]>> {
  const out = new Map<string, Procurement[]>(codes.map((c) => [c, []]));
  if (!codes.length) return out;
  const rows = await db
    .select({ code: s.projects.code, data: s.procurements.data })
    .from(s.procurements)
    .innerJoin(s.projects, eq(s.procurements.projectId, s.projects.id))
    .where(inArray(s.projects.code, codes));
  for (const r of rows) out.get(r.code!)?.push(r.data as Procurement);
  for (const list of out.values()) list.sort((a, b) => b.id.localeCompare(a.id));
  return out;
}

/** The cards at or above `min`. Synchronous: the project's thresholds are set and cleared with nothing in between. */
function cardsAtLeast(project: ProcCard["project"], min: "Large" | "Medium", items: Procurement[], eff: Awaited<ReturnType<typeof projectRules>> | null): ProcCard[] {
  const values = eff ? Object.fromEntries(eff.lines.filter((l) => !l.conflict || l.decision).map((l) => [l.key, l.value as Value])) : null;
  // The level is read under this project's own thresholds, with no await in between, so projects
  // read at the same time never see each other's thresholds.
  setProcurementRules(values);
  const keep = items.filter((x) => (min === "Large" ? ["Large"] : ["Large", "Medium"]).includes(levelFor(x.qty * x.unitPrice)));
  setProcurementRules(null);
  return procurementCards(keep, project);
}

export type GrantCard = Pick<Grant, "id" | "business" | "province" | "type" | "value" | "womenOwned" | "step" | "since" | "status"> & {
  project: { code: string; name: string; sandbox: boolean };
  /** How many things stand between it and the next step. */
  left: number;
  approver: "cop" | "ho";
  contributed: number;
  owed: number;
};

/** Every grant in every project the person works on. */
export async function grantBoard(v: Viewer, u: AppUser) {
  const projects = await projectsFor(v);
  // Read at the same time, listed in the projects' order.
  const views = await Promise.all(projects.map((p) => loadGrants(p.code, u).catch(() => null)));
  const cards: GrantCard[] = [];
  for (const [k, p] of projects.entries()) {
    const view = views[k];
    if (!view) continue;
    for (const g of view.items)
      cards.push({
        id: g.id,
        business: g.business,
        province: g.province,
        type: g.type,
        value: g.value,
        womenOwned: g.womenOwned,
        step: g.step,
        since: g.since,
        status: g.status,
        project: { code: p.code, name: p.name, sandbox: p.kind === "sandbox" },
        left: blockers(g, view.rules, view.procs[g.id]).length,
        approver: approverFor(g, view.rules),
        contributed: contributed(g),
        owed: Math.max(0, g.investment - g.value),
      });
  }
  return { cards, steps: DEFAULT_STEP_SETTINGS };
}
