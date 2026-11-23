import { randomUUID } from "node:crypto";
import { canEditProject, type AppUser } from "@/lib/demo";
import type { Farmer } from "@/lib/field";
import { and, eq } from "drizzle-orm";
import { db, schema as t } from "@/db";
import { EMPTY_SELECTION, decisionProblem, sameRules, selectionCounts, type Criterion, type Selection, type SelectionAction } from "@/lib/selection";
import { logAudit } from "@/server/audit";
import { loadField, projectByCode } from "@/server/field-store";
import { loadProjectState, updateProjectState } from "@/server/project-state";

const KEY = "selection";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The project manager (the field manager) and plan approvers write the rules and decide; an
 * administrator may too. Everyone else who works with farmers reads them.
 */
export const mayDecide = (u: AppUser) => u.kind === "employee" && (!!u.admin || canEditProject(u));
/** Who may see the list: those who work with farmers, and those who decide (need to know). */
export const maySeeSelection = (u: AppUser) => u.kind === "employee" && (u.fieldAccess !== "none" || mayDecide(u));

export async function loadSelection(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const [s, field] = await Promise.all([loadProjectState<Selection>(project.id, KEY, EMPTY_SELECTION), loadField(code, u)]);
  // Names come already withheld for people who may not see them (server/field-store).
  const farmers = (field.items.filter((i) => i.kind === "farmer") as Farmer[])
    .map((f) => ({ id: f.id, name: f.name, gender: f.gender, community: f.community, hectares: f.hectares, enrolled: f.enrolled }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { project: { code, name: project.name }, selection: s, farmers, counts: selectionCounts(s, farmers), can: { rules: mayDecide(u), decide: mayDecide(u) } };
}
export type SelectionView = Awaited<ReturnType<typeof loadSelection>>;

export async function actOnSelection(code: string, a: SelectionAction, u: AppUser): Promise<string | null> {
  if (!mayDecide(u)) return a.action === "criteria" ? "Only the project manager and plan approvers write the selection rules." : "Only the project manager and plan approvers record a selection decision.";
  const project = await projectByCode(code);
  if (a.action !== "criteria") {
    const [known] = await db
      .select({ key: t.fieldItems.itemKey })
      .from(t.fieldItems)
      .where(and(eq(t.fieldItems.projectId, project.id), eq(t.fieldItems.itemKey, a.farmer), eq(t.fieldItems.kind, "farmer")))
      .limit(1);
    if (!known) return "No such farmer on this project's list.";
  }
  const me = { by: u.id, byName: u.name, on: today() };
  return updateProjectState<Selection, string | null>(project.id, KEY, EMPTY_SELECTION, async (s, tx) => {
    let next: Selection;
    let detail: Record<string, unknown>;
    let action: string;
    if (a.action === "criteria") {
      const decided = Object.keys(s.decisions).length;
      // Putting the same rules in another order is not a change of rules.
      const rulesChanged = !sameRules(s.criteria.map((c) => c.text), a.criteria);
      const orderChanged = s.criteria.map((c) => c.text).join("\n") !== a.criteria.join("\n");
      if (!rulesChanged && !orderChanged && s.outreach === a.outreach) return { data: null, result: "Nothing has changed." };
      if (decided && rulesChanged && a.reason.trim().length < 10) return { data: null, result: `${decided} ${decided === 1 ? "farmer has" : "farmers have"} already been decided under these rules. Say why the rules are changing.` };
      // A rule kept word for word keeps its id, so ticks made against it still stand.
      const used = new Set<string>();
      const criteria = a.criteria.map((text): Criterion => {
        const kept = s.criteria.find((c) => c.text === text && !used.has(c.id));
        if (kept) used.add(kept.id);
        return kept ?? { id: randomUUID().slice(0, 8), text };
      });
      next = { ...s, outreach: a.outreach, criteria, version: rulesChanged ? s.version + 1 : s.version, criteriaBy: me };
      action = "selection_rules_set";
      detail = { version: next.version, rules: criteria.map((c) => c.text), ...(a.reason ? { reason: a.reason } : {}) };
    } else if (a.action === "decide") {
      const problem = decisionProblem(s, a);
      if (problem) return { data: null, result: problem };
      const prior = s.decisions[a.farmer];
      const exception = a.selected && !s.criteria.every((c) => a.met.includes(c.id));
      // A changed decision keeps the one it replaces, with why it changed: the old reason is never lost.
      const earlier = prior ? [...(prior.earlier ?? []), { decision: (({ earlier: _e, ...d }) => (void _e, d))(prior), why: a.change.trim(), ...me }] : undefined;
      next = { ...s, decisions: { ...s.decisions, [a.farmer]: { selected: a.selected, met: a.met, reason: a.reason.trim(), version: s.version, of: s.criteria.length, exception, ...me, ...(earlier ? { earlier } : {}) } } };
      action = prior ? "selection_changed" : a.selected ? "selection_selected" : "selection_not_selected";
      detail = { farmer: a.farmer, selected: a.selected, met: a.met.length, of: s.criteria.length, ...(a.reason.trim() ? { reason: a.reason.trim() } : {}), ...(prior ? { was: prior.selected ? "selected" : "not selected", wasReason: prior.reason, why: a.change.trim() } : {}) };
    } else {
      if (!s.decisions[a.farmer]) return { data: null, result: "This farmer has no decision to reopen." };
      const rest = { ...s.decisions };
      delete rest[a.farmer];
      next = { ...s, decisions: rest };
      action = "selection_reopened";
      const was = s.decisions[a.farmer];
      detail = { farmer: a.farmer, reason: a.reason, was: was.selected ? "selected" : "not selected", wasReason: was.reason };
    }
    await logAudit(tx, project.id, { entity: "selection", entityId: a.action === "criteria" ? project.id : a.farmer, action, by: u.id, detail });
    return { data: next, result: null };
  });
}
