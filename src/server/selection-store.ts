import { randomUUID } from "node:crypto";
import { canEditProject, type AppUser } from "@/lib/demo";
import { leaveTrain, type Farmer } from "@/lib/field";
import { stampHistory } from "@/lib/history";
import { mirrorFarmer } from "@/server/farmer-mirror";
import { and, eq } from "drizzle-orm";
import { db, schema as t } from "@/db";
import { EMPTY_SELECTION, decisionProblem, selectionHold, outcomeLabel, outcomeOf, outcomesById, rulesFrom, sameRules, selectionCounts, type Criterion, type Selection, type SelectionAction, type Shown } from "@/lib/selection";
import { logAudit } from "@/server/audit";
import { loadField, projectByCode, setupFor } from "@/server/field-store";
import { ruleCheck, type RuleCheck } from "@/lib/eligibility";
import { loadProjectState, updateProjectState, type Reader } from "@/server/project-state";

const KEY = "selection";
const today = () => new Date().toISOString().slice(0, 10);

/**
 * The project manager (the field manager) and plan approvers write the rules and decide; an
 * administrator may too. Everyone else who works with farmers reads them.
 */
export const mayDecide = (u: AppUser) => u.kind === "employee" && (!!u.admin || canEditProject(u) || u.project.includes("technical-lead"));
/** Who may see the list: those who work with farmers, and those who decide (need to know). */
export const maySeeSelection = (u: AppUser) => u.kind === "employee" && (u.fieldAccess !== "none" || mayDecide(u));

export async function loadSelection(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const [s, field, setup] = await Promise.all([loadProjectState<Selection>(project.id, KEY, EMPTY_SELECTION), loadField(code, u), setupFor(code)]);
  // Names come already withheld for people who may not see them (server/field-store).
  const farmers = (field.items.filter((i) => i.kind === "farmer") as Farmer[])
    .map((f) => ({
      id: f.id,
      name: f.name,
      gender: f.gender,
      community: f.community,
      hectares: f.hectares,
      enrolled: f.enrolled,
      package: f.package ?? null,
      // What the record says for each rule the app checks (MF-12), by rule id.
      checks: Object.fromEntries(s.criteria.filter((c) => c.rule).map((c) => [c.id, ruleCheck(c.rule!, f, setup)])) as Record<string, RuleCheck>,
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  return { project: { code, name: project.name }, packages: (setup?.packages ?? []).map((p) => ({ key: p.key, name: p.name })), selection: s, farmers, counts: selectionCounts(s, farmers), can: { rules: mayDecide(u), decide: mayDecide(u) } };
}
export type SelectionView = Awaited<ReturnType<typeof loadSelection>>;

/**
 * Each decided farmer's outcome, by farmer number only (no names), for Field activities: farmers
 * waitlisted or who did not qualify are not trained or served. Null when the project does not use
 * selection (no rules written), so its field queue is unchanged.
 */
export async function selectionOutcomes(projectId: string, q?: Reader): Promise<Record<string, Shown> | null> {
  return outcomesById(await loadProjectState<Selection>(projectId, KEY, EMPTY_SELECTION, q));
}

export async function actOnSelection(code: string, a: SelectionAction, u: AppUser): Promise<string | null> {
  if (!mayDecide(u)) return a.action === "criteria" ? "Only the project manager, plan approvers and the technical lead write the selection rules." : "Only the project manager, plan approvers and the technical lead record a selection decision.";
  const project = await projectByCode(code);
  if (a.action !== "criteria") {
    const [known] = await db
      .select({ key: t.fieldItems.itemKey })
      .from(t.fieldItems)
      .where(and(eq(t.fieldItems.projectId, project.id), eq(t.fieldItems.itemKey, a.farmer), eq(t.fieldItems.kind, "farmer")))
      .limit(1);
    if (!known) return "No such farmer on this project's list.";
  }
  // The project's packages, for rules set per package: read before the rules are opened for writing.
  const packagesNow = a.action === "criteria" ? await setupFor(code) : null;
  // The farmer's record and the package, read before the rules are opened for writing (MF-12 checks).
  const record =
    a.action === "decide"
      ? await Promise.all([loadField(code, u), setupFor(code)]).then(([field, setup]) => {
          const f = field.items.find((i) => i.kind === "farmer" && i.id === a.farmer) as Farmer | undefined;
          return f ? { f, setup } : null;
        })
      : null;
  const me = { by: u.id, byName: u.name, on: today() };
  return updateProjectState<Selection, string | null>(project.id, KEY, EMPTY_SELECTION, async (s, tx) => {
    let next: Selection;
    let detail: Record<string, unknown>;
    let action: string;
    if (a.action === "criteria") {
      const decided = Object.keys(s.decisions).length;
      // Putting the same rules in another order is not a change of rules.
      const made = rulesFrom(a.criteria, a.checks, (packagesNow?.packages ?? []).map((p) => ({ key: p.key, name: p.name })));
      if ("problem" in made) return { data: null, result: made.problem };
      const texts = made.list.map((r) => r.text);
      const rulesChanged = !sameRules(s.criteria.map((c) => c.text), texts);
      const orderChanged = s.criteria.map((c) => c.text).join("\n") !== texts.join("\n");
      if (!rulesChanged && !orderChanged && s.outreach === a.outreach) return { data: null, result: "Nothing has changed." };
      if (decided && rulesChanged && a.reason.trim().length < 10) return { data: null, result: `${decided} ${decided === 1 ? "farmer has" : "farmers have"} already been decided under these rules. Say why the rules are changing.` };
      // A rule kept word for word keeps its id, so ticks made against it still stand.
      const used = new Set<string>();
      const criteria = made.list.map(({ text, rule }): Criterion => {
        const kept = s.criteria.find((c) => c.text === text && !used.has(c.id));
        if (kept) used.add(kept.id);
        return { ...(kept ?? { id: randomUUID().slice(0, 8), text }), ...(rule ? { rule } : {}) };
      });
      next = { ...s, outreach: a.outreach, criteria, version: rulesChanged ? s.version + 1 : s.version, criteriaBy: me };
      action = "selection_rules_set";
      detail = { version: next.version, rules: criteria.map((c) => c.text), ...(a.reason ? { reason: a.reason } : {}) };
    } else if (a.action === "decide") {
      const problem = decisionProblem(s, a);
      if (problem) return { data: null, result: problem };
      // A rule the record shows is not met cannot be ticked: the record is corrected first (MF-12).
      const checked = s.criteria.filter((c) => c.rule && a.met.includes(c.id));
      const failed = record ? checked.find((c) => ruleCheck(c.rule!, record.f, record.setup).ok === false) : undefined;
      if (failed && record) return { data: null, result: `"${failed.text}" is not met: ${ruleCheck(failed.rule!, record.f, record.setup).detail} Correct the farmer's record first, or leave the rule unticked.` };
      const prior = s.decisions[a.farmer];
      const selected = a.outcome === "selected";
      const exception = selected && !s.criteria.every((c) => a.met.includes(c.id));
      // A changed decision keeps the one it replaces, with why it changed: the old reason is never lost.
      const earlier = prior ? [...(prior.earlier ?? []), { decision: (({ earlier: _e, ...d }) => (void _e, d))(prior), why: a.change.trim(), ...me }] : undefined;
      next = { ...s, decisions: { ...s.decisions, [a.farmer]: { selected, outcome: a.outcome, met: a.met, reason: a.reason.trim(), version: s.version, of: s.criteria.length, exception, ...me, ...(earlier ? { earlier } : {}) } } };
      action = prior ? "selection_changed" : `selection_${a.outcome}`;
      detail = { farmer: a.farmer, outcome: a.outcome, met: a.met.length, of: s.criteria.length, ...(a.reason.trim() ? { reason: a.reason.trim() } : {}), ...(prior ? { was: outcomeLabel[outcomeOf(s, prior)], wasReason: prior.reason, why: a.change.trim() } : {}) };
    } else {
      if (!s.decisions[a.farmer]) return { data: null, result: "This farmer has no decision to reopen." };
      const rest = { ...s.decisions };
      delete rest[a.farmer];
      next = { ...s, decisions: rest };
      action = "selection_reopened";
      const was = s.decisions[a.farmer];
      detail = { farmer: a.farmer, reason: a.reason, was: outcomeLabel[outcomeOf(s, was)], wasReason: was.reason };
    }
    await logAudit(tx, project.id, { entity: "selection", entityId: a.action === "criteria" ? project.id : a.farmer, action, by: u.id, detail });
    // Selection is one of the Train rule's inputs (lib/field leaveTrain): a farmer whose training and
    // contribution are recorded moves on once selected (or reopened), in the same step as the decision.
    if (a.action !== "criteria" && !selectionHold(outcomesById(next), a.farmer)) {
      const [item] = await tx.select().from(t.fieldItems).where(and(eq(t.fieldItems.projectId, project.id), eq(t.fieldItems.itemKey, a.farmer))).limit(1);
      const f = item?.data as Farmer | undefined;
      const moved = f?.kind === "farmer" ? leaveTrain(f, today(), a.action === "decide" ? `Selected in Farmer selection by ${u.name}` : `Selection decision reopened by ${u.name}`) : f;
      if (item && f && moved && moved !== f) {
        const saved = { ...moved, timeline: stampHistory(f.timeline, moved.timeline) };
        await tx.update(t.fieldItems).set({ data: saved, updatedAt: new Date() }).where(eq(t.fieldItems.id, item.id));
        await mirrorFarmer(tx, project.id, saved);
      }
    }
    return { data: next, result: null };
  });
}
