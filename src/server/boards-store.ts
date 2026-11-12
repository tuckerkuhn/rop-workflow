import type { AppUser } from "@/lib/demo";
import { DEFAULT_STEP_SETTINGS, approverFor, blockers, contributed, type Grant } from "@/lib/grants";
import { procurementCards, type ProcCard } from "@/lib/boards";
import { levelFor, setProcurementRules } from "@/lib/procurement";
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
  const cards: ProcCard[] = [];
  for (const p of projects) {
    const [items, eff] = await Promise.all([loadProcurements(p.code).catch(() => []), projectRules(p.code).catch(() => null)]);
    const values = eff ? Object.fromEntries(eff.lines.filter((l) => !l.conflict || l.decision).map((l) => [l.key, l.value as Value])) : null;
    // The level is read under this project's own thresholds, with no await in between.
    setProcurementRules(values);
    const keep = items.filter((x) => (min === "Large" ? ["Large"] : ["Large", "Medium"]).includes(levelFor(x.qty * x.unitPrice)));
    cards.push(...procurementCards(keep, { code: p.code, name: p.name, sandbox: p.kind === "sandbox" }));
  }
  setProcurementRules(null);
  return { cards };
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
  const cards: GrantCard[] = [];
  for (const p of projects) {
    const view = await loadGrants(p.code, u).catch(() => null);
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
        left: blockers(g, view.rules).length,
        approver: approverFor(g, view.rules),
        contributed: contributed(g),
        owed: Math.max(0, g.investment - g.value),
      });
  }
  return { cards, steps: DEFAULT_STEP_SETTINGS };
}
