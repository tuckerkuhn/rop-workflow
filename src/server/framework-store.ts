import { db } from "@/db";
import { ancestors, EMPTY_FRAMEWORK, levelOf, SUGGESTED, type Framework, type FrameworkAction } from "@/lib/framework";
import { ourWork } from "@/lib/budget";
import type { AppUser } from "@/lib/demo";
import { logAudit } from "@/server/audit";
import { loadActivities } from "@/server/activities-store";
import { projectByCode } from "@/server/field-store";
import { loadReview } from "@/server/monthly-review-store";
import { loadWorkplan } from "@/server/plan-store";
import { loadProjectState, saveProjectState } from "@/server/project-state";

const KEY = "framework";
const today = () => new Date().toISOString().slice(0, 10);

type Leaf = { code: string; donorCode: string; name: string; unit: string; year: number; yearTarget: number; status: string };
type Sub = { code: string; title: string; status: string; timing: string; owner: string | null };
export type TreeNode = { key: string; level: string; text: string | null; source: string | null; suggested: { text: string; source: string } | null; children: TreeNode[]; indicators: Leaf[]; activities: Sub[] };

export async function loadFramework(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const month = today().slice(0, 7);
  const [fw, review, acts, plan] = await Promise.all([loadProjectState<Framework>(project.id, KEY, EMPTY_FRAMEWORK), loadReview(code, month, u), loadActivities(code, u).catch(() => null), loadWorkplan(code)]);
  const sugg = SUGGESTED[code] ?? {};
  const nodes = new Map<string, TreeNode>();
  const node = (key: string): TreeNode => {
    let n = nodes.get(key);
    if (!n) {
      const st = fw.nodes[key];
      n = { key, level: levelOf(key), text: st?.text ?? null, source: st?.source ?? null, suggested: st ? null : (sugg[key] ?? null), children: [], indicators: [], activities: [] };
      nodes.set(key, n);
      const parts = key.split(".");
      if (parts.length > 1) node(parts.slice(0, -1).join(".")).children.push(n);
    }
    return n;
  };
  // Activity names come from the workplan.
  const activityNames = new Map(plan.filter((w) => w.activityCode).map((w) => [w.activityCode!, w.activity ?? ""]));
  for (const i of review.indicators) {
    const chain = ancestors(i.donorCode ?? "");
    if (!chain.length) continue;
    node(chain[chain.length - 1]).indicators.push({ code: i.code, donorCode: i.donorCode ?? "", name: i.name, unit: i.unit, year: i.year, yearTarget: i.yearTarget, status: i.status });
  }
  for (const w of ourWork(plan)) {
    const a = w.activityCode ?? ancestors(w.code).at(-1);
    if (!a) continue;
    const rec = acts?.rows.find((r) => r.code === w.code);
    node(a).activities.push({ code: w.code, title: w.title, status: rec?.status ?? "not_started", timing: rec?.timing ?? "", owner: rec?.ownerName ?? null });
  }
  // An activity's wording defaults to the workplan's name for it.
  for (const n of nodes.values()) if (n.level === "Activity" && !n.text) n.text = (activityNames.get(n.key) ?? "").replace(/\s*\([^)]*\)\s*$/, "") || null;
  const sort = (list: TreeNode[]) => list.sort((a, b) => a.key.localeCompare(b.key, "en", { numeric: true })).forEach((c) => sort(c.children));
  const outcomes = [...nodes.values()].filter((n) => n.level === "Outcome");
  sort(outcomes);
  return {
    project: { code, name: project.name },
    year: review.year,
    goal: { text: fw.goal?.text ?? null, source: fw.goal?.source ?? null, suggested: fw.goal ? null : (sugg.goal ?? null) },
    outcomes,
    can: { edit: !!u.admin || u.project.includes("plan-approver") },
  };
}
export type FrameworkView = Awaited<ReturnType<typeof loadFramework>>;

export async function setStatement(code: string, a: FrameworkAction, u: AppUser): Promise<string | null> {
  if (!u.admin && !u.project.includes("plan-approver")) return "Only a plan approver words the results framework.";
  const project = await projectByCode(code);
  const fw = await loadProjectState<Framework>(project.id, KEY, EMPTY_FRAMEWORK);
  const st = { text: a.text, source: a.source, by: u.id, byName: u.name, at: today() };
  const prev = a.key === "goal" ? fw.goal : fw.nodes[a.key];
  const next: Framework = a.key === "goal" ? { ...fw, goal: st } : { ...fw, nodes: { ...fw.nodes, [a.key]: st } };
  await saveProjectState(project.id, KEY, next);
  await logAudit(db, project.id, { entity: "framework", entityId: project.id, action: "framework_worded", by: u.id, detail: { key: a.key, level: levelOf(a.key), from: prev?.text ?? null, to: a.text, source: a.source } });
  return null;
}
