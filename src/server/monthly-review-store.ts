import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { describeChange, emptyReview, quarterOfMonth, type Change, type ChangeInput, type MonthlyReview, type ReviewAction } from "@/lib/monthly-review";
import { yearShare } from "@/lib/qpr";
import { logAudit } from "@/server/audit";
import { loadBudgetView } from "@/server/budget-view-store";
import { projectByCode } from "@/server/field-store";
import { qprData } from "@/server/qpr-store";

/** Monthly reviews, kept as project_state "review:2026-10". See lib/monthly-review.ts. */

const KEY = (month: string) => `review:${month}`;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export const mayEditReview = (u: AppUser) => u.kind === "employee" && (u.admin || u.project.some((r) => ["monthly-review", "plan-approver", "mel-owner"].includes(r)));
export const mayDecideReview = (u: AppUser) => u.kind === "employee" && u.project.some((r) => ["monthly-review", "plan-approver"].includes(r));

async function rawReview(projectId: string, month: string): Promise<MonthlyReview> {
  const [row] = await db
    .select({ data: s.projectState.data })
    .from(s.projectState)
    .where(and(eq(s.projectState.projectId, projectId), eq(s.projectState.key, KEY(month))))
    .limit(1);
  return (row?.data as MonthlyReview | undefined) ?? emptyReview(month);
}

async function saveReview(exec: Tx, projectId: string, r: MonthlyReview) {
  await exec
    .insert(s.projectState)
    .values({ projectId, key: KEY(r.month), data: r })
    .onConflictDoUpdate({
      target: [s.projectState.projectId, s.projectState.key],
      set: { data: r, updatedAt: new Date() },
    });
}

/** ROP's rows when the workplan lists several partners. */
async function ourWorkplan(projectId: string) {
  const rows = await db.select().from(s.workplanItems).where(eq(s.workplanItems.projectId, projectId));
  return rows.some((w) => w.org === "ROP") ? rows.filter((w) => w.org === "ROP") : rows;
}

/** Everything the review screen needs: the saved review plus where results and money stand. */
export async function loadReview(code: string, month: string, u: AppUser) {
  const project = await projectByCode(code);
  const review = await rawReview(project.id, month);
  const quarter = quarterOfMonth(month);
  const report = await qprData(code, quarter);
  const budget = await loadBudgetView(code);
  const pending = report.results.filter((r) => r.status === "pending").length;
  const queried = report.results.filter((r) => r.status === "queried").length;
  const lines = await db
    .select({
      code: s.budgetLines.code,
      description: s.budgetLines.description,
      amount: s.budgetLines.amount,
      spent: s.budgetLines.spent,
      currency: s.budgetLines.currency,
    })
    .from(s.budgetLines)
    .where(eq(s.budgetLines.projectId, project.id));
  const workplan = await ourWorkplan(project.id);
  const activities = [
    ...new Map(
      workplan.map((w) => [
        w.code,
        {
          code: w.code,
          title: w.title,
          quarters: ((w.active as string[]) ?? []).filter((d) => d >= `${month.slice(0, 4)}-01-01`).sort(),
        },
      ]),
    ).values(),
  ];
  const year = month.slice(0, 4);
  return {
    project: { code, name: project.name, stage: project.stage },
    month,
    quarter,
    review,
    indicators: report.rows.map((r) => ({
      code: r.code,
      donorCode: r.donorCode,
      name: r.name,
      unit: r.unit,
      yearTarget: r.yearTarget,
      year: r.year,
      quarterValue: r.quarter,
      status: r.status,
      planned: r.planned,
    })),
    year,
    budget: {
      totals: budget.totals,
      timeGone: budget.timeGone,
      period: budget.period,
      currency: budget.currency,
      flagged: budget.activities.flatMap((a) =>
        a.lines
          .filter((l) => l.flags.length)
          .map((l) => ({
            code: l.code,
            description: l.description,
            flags: l.flags,
          })),
      ),
    },
    open: { pending, queried },
    lines: lines.map((l) => ({
      code: l.code,
      description: l.description,
      amount: l.amount === null ? null : Number(l.amount),
      spent: l.spent === null ? 0 : Number(l.spent),
      currency: l.currency,
    })),
    activities,
    mayEdit: mayEditReview(u) && !review.signedOff,
    mayDecide: mayDecideReview(u) && !review.signedOff,
    me: u.id,
  };
}
export type ReviewView = Awaited<ReturnType<typeof loadReview>>;

/** What the plan says now for the thing a change touches. */
async function currentValue(projectId: string, c: ChangeInput): Promise<number | string[] | null> {
  if (c.kind === "target") {
    const [i] = await db
      .select()
      .from(s.indicators)
      .where(and(eq(s.indicators.projectId, projectId), eq(s.indicators.code, c.indicator)));
    if (!i) return null;
    return yearShare(
      {
        target: Number(i.target),
        yearTargets: Object.fromEntries(Object.entries((i.forecast as Record<string, number>) ?? {}).map(([k, v]) => [k, Number(v)])),
      },
      Number(c.year),
    );
  }
  if (c.kind === "budget") {
    const [l] = await db
      .select({ amount: s.budgetLines.amount })
      .from(s.budgetLines)
      .where(and(eq(s.budgetLines.projectId, projectId), eq(s.budgetLines.code, c.fromLine)));
    return l?.amount === null || l?.amount === undefined ? null : Number(l.amount);
  }
  const rows = (await ourWorkplan(projectId)).filter((w) => w.code === c.activity);
  return rows.length ? [...new Set(rows.flatMap((w) => (w.active as string[]) ?? []))].sort() : null;
}

/** Applies an approved change to the plan. Throws a plain-language error when it no longer fits. */
export async function applyChange(tx: Tx, projectId: string, c: Change): Promise<Record<string, unknown>> {
  if (c.kind === "target") {
    const [i] = await tx
      .select()
      .from(s.indicators)
      .where(and(eq(s.indicators.projectId, projectId), eq(s.indicators.code, c.indicator)));
    if (!i) throw new Error(`Indicator ${c.indicator} no longer exists.`);
    const forecast = Object.fromEntries(Object.entries((i.forecast as Record<string, number>) ?? {}).map(([k, v]) => [k, Number(v)]));
    const now = yearShare({ target: Number(i.target), yearTargets: forecast }, Number(c.year));
    const delta = c.to - now;
    // Year targets are running totals, so this year and every later year move by the same amount.
    for (const k of Object.keys(forecast)) if (k >= c.year) forecast[k] += delta;
    const target = Number(i.target) + delta;
    if (target < 0 || Object.values(forecast).some((v) => v < 0)) throw new Error("That target would make a running total negative.");
    await tx
      .update(s.indicators)
      .set({ forecast, target: String(target), updatedAt: new Date() })
      .where(eq(s.indicators.id, i.id));
    return {
      indicator: c.indicator,
      year: c.year,
      from: now,
      to: c.to,
      wholeTarget: { from: Number(i.target), to: target },
    };
  }
  if (c.kind === "budget") {
    const rows = await tx.select().from(s.budgetLines).where(eq(s.budgetLines.projectId, projectId));
    const a = rows.find((l) => l.code === c.fromLine);
    const b = rows.find((l) => l.code === c.toLine);
    if (!a || !b) throw new Error("One of the budget lines no longer exists.");
    if (a.currency !== b.currency) throw new Error(`${a.code} is in ${a.currency} and ${b.code} in ${b.currency}: move money within one currency.`);
    const left = Number(a.amount ?? 0) - c.amount;
    if (left < Number(a.spent ?? 0))
      throw new Error(`${a.code} has already spent ${Math.round(Number(a.spent)).toLocaleString("en-US")}; it cannot drop to ${Math.round(left).toLocaleString("en-US")}.`);
    await tx
      .update(s.budgetLines)
      .set({ amount: String(left), updatedAt: new Date() })
      .where(eq(s.budgetLines.id, a.id));
    await tx
      .update(s.budgetLines)
      .set({
        amount: String(Number(b.amount ?? 0) + c.amount),
        updatedAt: new Date(),
      })
      .where(eq(s.budgetLines.id, b.id));
    return {
      from: { line: a.code, before: Number(a.amount), after: left },
      to: {
        line: b.code,
        before: Number(b.amount),
        after: Number(b.amount ?? 0) + c.amount,
      },
      amount: c.amount,
      currency: a.currency,
    };
  }
  const all = await tx.select().from(s.workplanItems).where(eq(s.workplanItems.projectId, projectId));
  const ours = all.some((w) => w.org === "ROP") ? all.filter((w) => w.org === "ROP") : all;
  const rows = ours.filter((w) => w.code === c.activity);
  if (!rows.length) throw new Error(`Activity ${c.activity} is not in the workplan.`);
  const before = [...new Set(rows.flatMap((w) => (w.active as string[]) ?? []))].sort();
  const quarters = [...new Set(c.quarters)].sort();
  for (const w of rows) await tx.update(s.workplanItems).set({ active: quarters, updatedAt: new Date() }).where(eq(s.workplanItems.id, w.id));
  return { activity: c.activity, from: before, to: quarters };
}

/** Runs one action on the month's review. Returns an error message for the person, or null. */
export async function actOnReview(code: string, month: string, a: ReviewAction, u: AppUser): Promise<string | null> {
  const project = await projectByCode(code);
  const review = await rawReview(project.id, month);
  if (review.signedOff) return "This review has been signed off and can no longer be changed.";
  const now = new Date().toISOString();
  const log = (tx: Tx, action: string, detail: Record<string, unknown>) =>
    logAudit(tx, project.id, {
      entity: "monthly_review",
      entityId: project.id,
      action,
      by: u.id,
      detail: { month, ...detail },
    });

  if (a.action === "decide") {
    if (!mayDecideReview(u)) return "Only the monthly reviewers and plan approvers can approve changes.";
    const c = review.changes.find((x) => x.id === a.id);
    if (!c) return "No such change.";
    if (c.status !== "proposed") return "This change has already been decided.";
    if (c.proposedBy === u.id) return "You proposed this change, so someone else must decide it.";
    try {
      await db.transaction(async (tx) => {
        const applied = a.decision === "approve" ? await applyChange(tx, project.id, c) : null;
        Object.assign(c, {
          status: a.decision === "approve" ? "approved" : "rejected",
          decidedBy: u.id,
          decidedAt: now,
          ...(a.note ? { note: a.note } : {}),
        });
        await saveReview(tx, project.id, review);
        await log(tx, a.decision === "approve" ? "review_change_approved" : "review_change_rejected", {
          change: describeChange(c),
          kind: c.kind,
          reason: c.reason,
          proposedBy: c.proposedBy,
          note: a.note ?? null,
          applied,
        });
      });
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
    return null;
  }

  if (!mayEditReview(u)) return "Only the monthly reviewers, plan approvers and MEL can write the review.";
  try {
    await db.transaction(async (tx) => {
      if (a.action === "summary" || a.action === "attention") {
        if (a.text) review[a.action] = { text: a.text, by: u.id, at: now };
        else delete review[a.action];
        await log(tx, "review_edited", { part: a.action });
      } else if (a.action === "propose") {
        const from = await currentValue(project.id, a.change);
        const c: Change = {
          ...a.change,
          id: randomUUID(),
          from,
          status: "proposed",
          proposedBy: u.id,
          proposedAt: now,
        };
        review.changes.push(c);
        await log(tx, "review_change_proposed", {
          change: describeChange(c),
          kind: c.kind,
          reason: c.reason,
        });
      } else if (a.action === "withdraw") {
        const c = review.changes.find((x) => x.id === a.id);
        if (!c || c.status !== "proposed" || c.proposedBy !== u.id) throw new Error("Only a change you proposed, and not yet decided, can be withdrawn.");
        review.changes = review.changes.filter((x) => x.id !== a.id);
        await log(tx, "review_change_withdrawn", { change: describeChange(c) });
      } else if (a.action === "signoff") {
        if (!mayDecideReview(u)) throw new Error("Only the monthly reviewers and plan approvers can sign off the review.");
        if (review.changes.some((c) => c.status === "proposed")) throw new Error("Decide or withdraw every proposed change first.");
        review.signedOff = { by: u.id, at: now };
        await log(tx, "review_signed_off", {
          changes: review.changes.filter((c) => c.status === "approved").length,
        });
      }
      await saveReview(tx, project.id, review);
    });
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return null;
}
