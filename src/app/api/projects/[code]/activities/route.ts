import { NextResponse } from "next/server";
import { activityAction } from "@/lib/activities";
import { requireViewer } from "@/server/auth";
import { actOnActivity, loadActivities } from "@/server/activities-store";
import { loadReview } from "@/server/monthly-review-store";
import type { AppUser } from "@/lib/demo";
import { ourWork } from "@/lib/budget";
import { linksByActivity, type ActivityLinks } from "@/lib/connections";
import { loadGrantBook } from "@/server/grants-store";
import { loadBudget, loadWorkplan } from "@/server/plan-store";
import { loadPlan } from "@/server/procurement-plan-store";
import { loadProcurements } from "@/server/procurement-store";
import { loadUpdates } from "@/server/results-store";

const NONE: ActivityLinks = { procurements: [], grants: [], updates: [], budget: { lines: [], total: 0, spent: 0 } };

/** What serves each activity: procurements, grants, updates and spending (lib/connections.ts). Each part is left empty if it cannot be read. */
async function links(code: string, u: AppUser) {
  const [workplan, procurements, calendar, book, updates, budget] = await Promise.all([
    loadWorkplan(code).catch(() => []),
    u.procurementAccess === "none" ? Promise.resolve([]) : loadProcurements(code).catch(() => []),
    loadPlan(code).catch(() => []),
    loadGrantBook(code).catch(() => ({ items: [] })),
    loadUpdates(code).catch(() => []),
    loadBudget(code).catch(() => null),
  ]);
  return { ...linksByActivity({ workplan: ourWork(workplan), procurements, calendar, grants: book.items, updates, lines: budget?.lines ?? [] }), currency: budget?.currency ?? "USD" };
}

/** The activities, each with its indicator's result this year, so the page can say "target met". */
async function withResults(code: string, u: AppUser) {
  const [v, review, l] = await Promise.all([loadActivities(code, u), loadReview(code, new Date().toISOString().slice(0, 7), u).catch(() => null), links(code, u)]);
  return {
    ...v,
    unlinked: { procurements: l.unlinked.procurements.length, grants: l.unlinked.grants.length },
    budgetCurrency: l.currency,
    rows: v.rows.map((r) => {
      // Linked by the indicator's workplan code; an activity can deliver several indicators.
      const linked = (review?.indicators ?? []).filter((x) => x.workplanCode === r.code && x.yearTarget > 0);
      const i = linked[0];
      return {
        ...r,
        result: i ? { achieved: i.year, target: i.yearTarget, unit: i.unit } : null,
        links: l.by[r.code] ?? NONE,
        results: linked.map((x) => ({ indicator: x.code, code: x.donorCode, name: x.name, achieved: x.year, target: x.yearTarget, unit: x.unit })),
        allMet: linked.length > 0 && linked.every((x) => x.year >= x.yearTarget),
      };
    }),
  };
}
export type ActivitiesPageView = Awaited<ReturnType<typeof withResults>>;
import { handle } from "@/server/guard";

type Ctx = { params: Promise<{ code: string }> };

/** ROP's workplan activities as executed: status, owner, dates, blockers and tasks. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Activities are for project staff." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await withResults(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: "Activities are for project staff." });
    if (v instanceof NextResponse) return v;
    const parsed = activityAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const why = await actOnActivity(code, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    return NextResponse.json(await withResults(code, v.user));
  });
}
