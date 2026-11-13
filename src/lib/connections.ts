import { workplanFor, type BudgetLine, type WorkplanItem } from "@/lib/budget";
import type { Grant, GrantProc } from "@/lib/grants";
import { DONE, stages, stepById, valueOf, type Procurement } from "@/lib/procurement";
import type { PlanItem } from "@/lib/procurement-plan";

/**
 * How the workflows hang together. The workplan sub-activity is the hub: procurements, grants,
 * activity updates, results and spending all serve one, and each record links up to it and the
 * activity links down to each of them. Nothing here is stored: every link is read from fields
 * the records already carry (a procurement's calendar item or budget line, a grant's activity).
 */

/** Goods received: past the Receive stage, or finished. */
export const received = (p: Pick<Procurement, "step">) => p.step === DONE || (stepById[p.step]?.stage ?? -1) > stages.indexOf("Receive");

/**
 * The workplan sub-activity a procurement serves: its procurement calendar item's, else the code
 * its activity text starts with, else its budget line's. Null when none can be told.
 */
export function workplanOfProcurement(p: Pick<Procurement, "plan" | "activity" | "budgetLine">, calendar: Pick<PlanItem, "key" | "workplanCode">[], workplan: WorkplanItem[], lines: BudgetLine[] = []): string | null {
  const codes = new Set(workplan.map((w) => w.code));
  const fromPlan = p.plan ? calendar.find((i) => i.key === p.plan!.key)?.workplanCode : null;
  if (fromPlan && codes.has(fromPlan)) return fromPlan;
  const lead = p.activity?.match(/^\s*(\d+(?:\.\d+)+)/)?.[1];
  if (lead) {
    if (codes.has(lead)) return lead;
    const under = workplan.filter((w) => w.code.startsWith(`${lead}.`));
    if (under.length === 1) return under[0].code;
  }
  const line = lines.find((l) => l.code === p.budgetLine);
  return line ? (workplanFor(line, workplan)?.code ?? null) : null;
}

/** A grant's procurements: the ones linked on the grant, and requests started from it. */
export const grantProcurementIds = (g: Pick<Grant, "id" | "procurements">, procs: Pick<Procurement, "id" | "grant">[]) => [...new Set([...g.procurements, ...procs.filter((p) => p.grant === g.id).map((p) => p.id)])];

export function grantProcs(g: Pick<Grant, "id" | "procurements">, procs: Procurement[]): (GrantProc & { title: string; stage: string })[] {
  return grantProcurementIds(g, procs).map((id) => {
    const p = procs.find((x) => x.id === id);
    return { id, title: p?.title ?? id, received: !!p && received(p), stage: !p ? "?" : p.step === DONE ? "Done" : (stages[stepById[p.step]?.stage ?? 0] ?? "") };
  });
}

/**
 * Money left on a budget line for a new grant: the line less what is spent, less the open grants
 * already charged to it (a finished grant's payments are in what is spent).
 */
export function lineLeft(line: Pick<BudgetLine, "code" | "total" | "spent">, grants: Pick<Grant, "id" | "budgetLine" | "status" | "value">[], except?: string) {
  const open = grants.filter((g) => g.id !== except && g.budgetLine === line.code && g.status === "open").reduce((s, g) => s + g.value, 0);
  return Math.round((line.total - (line.spent ?? 0) - open) * 100) / 100;
}

export type ActivityLinks = {
  procurements: { id: string; title: string; value: number; stage: string; done: boolean }[];
  grants: { id: string; business: string; value: number; step: string; status: Grant["status"] }[];
  updates: { id: string; date: string; title: string }[];
  /** The budget lines that pay for it, by the same matching as the procurement calendar. */
  budget: { lines: string[]; total: number; spent: number };
};

const EMPTY = (): ActivityLinks => ({ procurements: [], grants: [], updates: [], budget: { lines: [], total: 0, spent: 0 } });

/** Everything that serves each workplan sub-activity, by its code. */
export function linksByActivity(a: {
  workplan: WorkplanItem[];
  procurements: Procurement[];
  calendar: Pick<PlanItem, "key" | "workplanCode">[];
  grants: Grant[];
  updates: { id: string; activity: string; date: string; title?: string; note: string }[];
  lines: BudgetLine[];
}): { by: Record<string, ActivityLinks>; unlinked: { procurements: string[]; grants: string[] } } {
  const by: Record<string, ActivityLinks> = {};
  const at = (code: string) => (by[code] ??= EMPTY());
  const codes = new Set(a.workplan.map((w) => w.code));
  const unlinked = { procurements: [] as string[], grants: [] as string[] };
  for (const p of a.procurements) {
    const code = workplanOfProcurement(p, a.calendar, a.workplan, a.lines);
    if (!code) {
      unlinked.procurements.push(p.id);
      continue;
    }
    const step = p.step === DONE ? null : stepById[p.step];
    at(code).procurements.push({ id: p.id, title: p.title, value: valueOf(p), stage: step ? stages[step.stage] : "Done", done: !step });
  }
  for (const g of a.grants) {
    if (!g.activity || !codes.has(g.activity)) {
      if (g.status === "open") unlinked.grants.push(g.id);
      continue;
    }
    at(g.activity).grants.push({ id: g.id, business: g.business, value: g.value, step: g.step, status: g.status });
  }
  for (const u of a.updates) if (codes.has(u.activity)) at(u.activity).updates.push({ id: u.id, date: u.date, title: u.title || u.note.slice(0, 80) });
  for (const l of a.lines) {
    const w = workplanFor(l, a.workplan);
    if (!w) continue;
    const b = at(w.code).budget;
    b.lines.push(l.code);
    b.total += l.total;
    b.spent += l.spent ?? 0;
  }
  for (const v of Object.values(by)) v.updates.sort((x, y) => y.date.localeCompare(x.date));
  return { by, unlinked };
}

/** Shortens text for a one-line link: at a word break, with an ellipsis, never mid-word. */
export function clip(s: string, n: number) {
  if (s.length <= n) return s;
  const cut = s.slice(0, n + 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > n * 0.6 ? cut.slice(0, at) : s.slice(0, n)).replace(/[\s,.:;·(-]+$/, "")}…`;
}

/** The link that opens one activity on the activity page. */
export const activityHref = (project: string, code: string) => `/work/activities?project=${encodeURIComponent(project)}&open=${encodeURIComponent(code)}`;

/**
 * The Results page, with a result filled in from another record for a person to check and send.
 * It goes to MEL as pending like any other; nothing is counted until it is accepted.
 */
export function resultHref(project: string, r: { indicator?: string | null; value?: number; female?: number; male?: number; womenLed?: number; menLed?: number; date?: string; province?: string; note: string; from: string }) {
  const q = new URLSearchParams({ project, record: "1", from: r.from, note: r.note });
  if (r.indicator) q.set("indicator", r.indicator);
  for (const k of ["value", "female", "male", "womenLed", "menLed"] as const) if (r[k] !== undefined && r[k]! >= 0) q.set(k, String(r[k]));
  if (r.date) q.set("date", r.date);
  if (r.province) q.set("province", r.province);
  return `/progress/results?${q}`;
}
