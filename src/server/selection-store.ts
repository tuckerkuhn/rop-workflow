import { randomUUID } from "node:crypto";
import { canEditProject, type AppUser } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { EMPTY_SELECTION, decisionProblem, selectionCounts, type Selection, type SelectionAction } from "@/lib/selection";
import { logAudit } from "@/server/audit";
import { loadField, projectByCode } from "@/server/field-store";
import { loadProjectState, updateProjectState } from "@/server/project-state";

const KEY = "selection";
const today = () => new Date().toISOString().slice(0, 10);

/** The rules are written by the people who may change the project; a decision is made by them or by the field manager. */
const mayWriteRules = (u: AppUser) => u.kind === "employee" && (!!u.admin || canEditProject(u));
const mayDecide = (u: AppUser) => mayWriteRules(u) || (u.kind === "employee" && u.fieldAccess === "edit" && u.field.includes("manager"));

export async function loadSelection(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const [s, field] = await Promise.all([loadProjectState<Selection>(project.id, KEY, EMPTY_SELECTION), loadField(code, u)]);
  // Names come already withheld for people who may not see them (server/field-store).
  const farmers = (field.items.filter((i) => i.kind === "farmer") as Farmer[])
    .map((f) => ({ id: f.id, name: f.name, gender: f.gender, community: f.community, hectares: f.hectares, enrolled: f.enrolled }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { project: { code, name: project.name }, selection: s, farmers, counts: selectionCounts(s, farmers), can: { rules: mayWriteRules(u), decide: mayDecide(u) } };
}
export type SelectionView = Awaited<ReturnType<typeof loadSelection>>;

export async function actOnSelection(code: string, a: SelectionAction, u: AppUser): Promise<string | null> {
  if (a.action === "criteria" ? !mayWriteRules(u) : !mayDecide(u)) return a.action === "criteria" ? "Only the project manager and plan approvers write the selection rules." : "Only the project manager, plan approvers and the field manager record a selection decision.";
  const project = await projectByCode(code);
  if (a.action !== "criteria") {
    const known = new Set((await loadField(code, u)).items.filter((i) => i.kind === "farmer").map((i) => i.id));
    if (!known.has(a.farmer)) return "No such farmer on this project's list.";
  }
  const me = { by: u.id, byName: u.name, on: today() };
  return updateProjectState<Selection, string | null>(project.id, KEY, EMPTY_SELECTION, async (s, tx) => {
    let next: Selection;
    let detail: Record<string, unknown>;
    let action: string;
    if (a.action === "criteria") {
      const decided = Object.keys(s.decisions).length;
      const same = s.outreach === a.outreach && s.criteria.length === a.criteria.length && s.criteria.every((c, k) => c.text === a.criteria[k]);
      if (same) return { data: null, result: "Nothing has changed." };
      const rulesChanged = !(s.criteria.length === a.criteria.length && s.criteria.every((c, k) => c.text === a.criteria[k]));
      if (decided && rulesChanged && a.reason.trim().length < 10) return { data: null, result: `${decided} ${decided === 1 ? "farmer has" : "farmers have"} already been decided under these rules. Say why the rules are changing.` };
      // A rule kept word for word keeps its id, so ticks made against it still stand.
      const criteria = a.criteria.map((t) => s.criteria.find((c) => c.text === t) ?? { id: randomUUID().slice(0, 8), text: t });
      next = { ...s, outreach: a.outreach, criteria, version: rulesChanged ? s.version + 1 : s.version, criteriaBy: me };
      action = "selection_rules_set";
      detail = { version: next.version, rules: criteria.map((c) => c.text), ...(a.reason ? { reason: a.reason } : {}) };
    } else if (a.action === "decide") {
      const problem = decisionProblem(s, a);
      if (problem) return { data: null, result: problem };
      next = { ...s, decisions: { ...s.decisions, [a.farmer]: { selected: a.selected, met: a.met, reason: a.reason.trim(), version: s.version, ...me } } };
      action = a.selected ? "selection_selected" : "selection_not_selected";
      detail = { farmer: a.farmer, met: a.met.length, of: s.criteria.length, ...(a.reason.trim() ? { reason: a.reason.trim() } : {}) };
    } else {
      if (!s.decisions[a.farmer]) return { data: null, result: "This farmer has no decision to reopen." };
      const rest = { ...s.decisions };
      delete rest[a.farmer];
      next = { ...s, decisions: rest };
      action = "selection_reopened";
      detail = { farmer: a.farmer, reason: a.reason };
    }
    await logAudit(tx, project.id, { entity: "selection", entityId: a.action === "criteria" ? project.id : a.farmer, action, by: u.id, detail });
    return { data: next, result: null };
  });
}
