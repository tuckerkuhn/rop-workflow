import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { realToday } from "@/lib/clock";
import type { AppUser } from "@/lib/demo";
import {
  CHECKLIST,
  DEFAULT_STEP_SETTINGS,
  GRANT_STEPS,
  REQUIRED_STEPS,
  approverFor,
  blockers,
  itemsFor,
  nextStepOf,
  type Grant,
  type GrantAction,
  type GrantRules,
  type StepSettings,
} from "@/lib/grants";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { loadHr } from "@/server/hr-store";
import { projectRules } from "@/server/policy-store";

/**
 * A project's agribusiness grants (lib/grants.ts): one project_state document, "grants", changed
 * under a row lock so two people saving at once cannot lose each other's change.
 */

const KEY = "grants";
type Book = { items: Grant[]; steps: StepSettings };
const EMPTY: Book = { items: [], steps: DEFAULT_STEP_SETTINGS };

export async function grantRules(code: string): Promise<GrantRules> {
  const v = (await projectRules(code)).values;
  const n = (k: string, d: number) => (typeof v[k] === "number" ? (v[k] as number) : d);
  return { costSharePct: n("costSharePct", 50), costShareWomenPct: n("costShareWomenPct", 25), hoAboveUsd: n("grantHoAboveUsd", 25000), capUsd: typeof v.grantCapUsd === "number" ? v.grantCapUsd : null };
}

async function holders() {
  return ((await loadHr().catch(() => null))?.state.rules?.holders ?? {}) as Record<string, string[]>;
}
/** Chief of Party: programme management (or the executive head). Home Office: the executive head. */
export async function mayApprove(u: AppUser, as: "cop" | "ho") {
  const h = await holders();
  return (as === "ho" ? ["ceo"] : ["management", "ceo"]).some((t) => h[t]?.includes(u.id));
}
async function mayChangeSteps(u: AppUser) {
  if (u.admin) return true;
  const h = await holders();
  return ["management", "ceo"].some((t) => h[t]?.includes(u.id));
}

export async function loadGrants(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const [row] = await db.select().from(s.projectState).where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, KEY))).limit(1);
  const book: Book = { ...EMPTY, ...((row?.data as Partial<Book>) ?? {}) };
  const rules = await grantRules(code);
  return {
    code,
    items: book.items,
    steps: book.steps,
    rules,
    can: { add: u.kind === "employee", approveCop: await mayApprove(u, "cop"), approveHo: await mayApprove(u, "ho"), steps: await mayChangeSteps(u) },
  };
}
export type GrantsView = Awaited<ReturnType<typeof loadGrants>>;

/** Applies one action. Returns the reason it was refused, or null. */
export async function actOnGrant(code: string, a: GrantAction, u: AppUser): Promise<string | null> {
  const project = await projectByCode(code);
  const rules = await grantRules(code);
  const can = { cop: await mayApprove(u, "cop"), ho: await mayApprove(u, "ho"), steps: await mayChangeSteps(u) };
  const at = realToday();
  const ev = (what: string) => ({ at, by: u.id, byName: u.name, what });

  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(s.projectState)
      .where(and(eq(s.projectState.projectId, project.id), eq(s.projectState.key, KEY)))
      .for("update");
    const book: Book = { ...EMPTY, ...((row?.data as Partial<Book>) ?? {}) };
    const save = async (next: Book, action: string, ref: string, detail: Record<string, unknown> = {}) => {
      await tx
        .insert(s.projectState)
        .values({ projectId: project.id, key: KEY, data: next })
        .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data: next, updatedAt: new Date() } });
      await logAudit(tx, project.id, { entity: "grant", entityId: ref, action, by: u.id, detail });
      return null;
    };

    if (a.action === "steps") {
      if (!can.steps) return "Programme management or the executive head sets the project's grant steps.";
      const skip = a.skip.filter((x) => !REQUIRED_STEPS.includes(x));
      const names = Object.fromEntries(Object.entries(a.names).filter(([k, v]) => (GRANT_STEPS as readonly string[]).includes(k) && v));
      return save({ ...book, steps: { names, skip, source: a.source } }, "grant_steps_set", project.id, { skip, names, source: a.source });
    }
    if (a.action === "add") {
      if (u.kind !== "employee") return "Grants are recorded by staff.";
      const n = Math.max(0, ...book.items.map((g) => Number(g.id.slice(2)) || 0)) + 1;
      const first = GRANT_STEPS.find((x) => !book.steps.skip.includes(x) || REQUIRED_STEPS.includes(x))!;
      const g: Grant = { id: `G-${String(n).padStart(3, "0")}`, rev: 1, ...a.fields, step: first, since: at, status: "open", checks: {}, approval: null, contributions: [], procurements: [], closedWhy: null, history: [ev("Recorded")] };
      return save({ ...book, items: [...book.items, g] }, "grant_added", g.id, { business: g.business, value: g.value, type: g.type });
    }

    const g = book.items.find((x) => x.id === a.id);
    if (!g) return "No such grant on this project.";
    if (g.rev !== a.rev) return `${g.id} was changed by someone else just now. The latest copy is loaded; make your change again.`;
    const put = (next: Grant, action: string, detail: Record<string, unknown> = {}) =>
      save({ ...book, items: book.items.map((x) => (x.id === g.id ? { ...next, rev: g.rev + 1 } : x)) }, action, g.id, detail);
    const open = g.status === "open";

    switch (a.action) {
      case "edit": {
        if (!open) return "This grant is closed: reopen it to change it.";
        // Once approved, the amounts are the ones approved: a change goes through an agreement modification.
        if (g.approval && (a.fields.value !== g.value || a.fields.investment !== g.investment || a.fields.type !== g.type)) return "The amounts and type were approved as they stand. A change needs an agreement modification, signed by the Chief of Party and the grantee.";
        return put({ ...g, ...a.fields, history: [...g.history, ev("Details changed")] }, "grant_edited", a.fields);
      }
      case "check": {
        if (!open) return "This grant is closed.";
        const item = CHECKLIST.find((c) => c.id === a.item);
        if (!item || !itemsFor(g, item.step).some((c) => c.id === a.item)) return "That item is not on this grant's checklist.";
        if (GRANT_STEPS.indexOf(item.step) > GRANT_STEPS.indexOf(g.step)) return "That belongs to a later step.";
        const checks = { ...g.checks };
        if (a.done) checks[a.item] = { by: u.id, byName: u.name, at, ...(a.note ? { note: a.note } : {}) };
        else delete checks[a.item];
        return put({ ...g, checks, history: [...g.history, ev(`${a.done ? "Ticked" : "Unticked"}: ${a.item}${a.note ? ` (${a.note})` : ""}`)] }, a.done ? "grant_checked" : "grant_unchecked", { item: a.item });
      }
      case "approve": {
        if (!open || g.step !== "approval") return "Only a grant at the approval step is approved.";
        const as = approverFor(g, rules);
        if (!(as === "ho" ? can.ho : can.cop)) return as === "ho" ? `Above $${rules.hoAboveUsd.toLocaleString("en-US")}, the Home Office (the executive head) approves.` : "The Chief of Party (programme management) approves this grant.";
        return put({ ...g, approval: { by: u.id, byName: u.name, at, as }, history: [...g.history, ev(as === "ho" ? "Approved by the Home Office" : "Approved by the Chief of Party")] }, "grant_approved", { as, value: g.value });
      }
      case "advance": {
        if (!open) return "This grant is closed.";
        const left = blockers(g, rules);
        if (left.length) return "Finish this step's checklist first.";
        const next = nextStepOf(g.step, book.steps);
        if (!next) return put({ ...g, status: "done", history: [...g.history, ev("Closed out")] }, "grant_closed_out");
        return put({ ...g, step: next, since: at, history: [...g.history, ev(`Moved to ${next}`)] }, "grant_advanced", { from: g.step, to: next });
      }
      case "contribution": {
        if (!open || (g.step !== "implementation" && g.step !== "agreement")) return "The grantee's contribution is recorded once the agreement is signed.";
        return put({ ...g, contributions: [...g.contributions, { amount: a.amount, proof: a.proof, by: u.id, byName: u.name, at }], history: [...g.history, ev(`Contribution of $${a.amount.toLocaleString("en-US")}: ${a.proof}`)] }, "grant_contribution", { amount: a.amount });
      }
      case "link": {
        if (g.type !== "inKind") return "Only in-kind grants buy through the project's procurement.";
        if (g.procurements.includes(a.procurement)) return null;
        return put({ ...g, procurements: [...g.procurements, a.procurement], history: [...g.history, ev(`Linked ${a.procurement}`)] }, "grant_linked", { procurement: a.procurement });
      }
      case "close": {
        if (!open) return "Already closed.";
        if (g.step === "implementation" || g.step === "closeout") return "A signed grant ends with closeout, or by terminating the agreement outside the app.";
        return put({ ...g, status: a.outcome, closedWhy: a.reason, history: [...g.history, ev(`${a.outcome === "rejected" ? "Rejected" : "Withdrawn"}: ${a.reason}`)] }, "grant_closed", { outcome: a.outcome, reason: a.reason });
      }
      case "reopen": {
        if (open) return "It is open.";
        if (g.status === "done") return "A closed-out grant stays closed.";
        return put({ ...g, status: "open", closedWhy: null, since: at, history: [...g.history, ev(`Reopened: ${a.reason}`)] }, "grant_reopened", { reason: a.reason });
      }
    }
  });
}
