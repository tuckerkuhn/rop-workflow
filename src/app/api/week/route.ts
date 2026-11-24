import { NextResponse } from "next/server";
import { weekAction } from "@/lib/week";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { actOnWeek, loadWeek, planOf, weekKindFor } from "@/server/week-store";
import { orgIdForPerson } from "@/server/org-settings-store";
import { mondayOf } from "@/lib/week";

const WHY = "The week ahead is for staff.";

/**
 * The person's own calendar day (?day=YYYY-MM-DD), so a week starts on their Monday and not on the
 * server's. Taken only when it is within a day of the server's date; otherwise the server's is used.
 */
function dayOf(req: Request): string | undefined {
  const day = new URL(req.url).searchParams.get("day") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  return Math.abs(Date.parse(`${day}T00:00:00Z`) - Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)) <= 864e5 ? day : undefined;
}

/** A manager's week ahead: the summary, three numbers and their priorities (server/week-store). */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => !!weekKindFor(u), why: WHY });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadWeek(v.user, dayOf(req)));
  });
}

/**
 * Confirms, ticks or reopens the person's own priorities for this week. Nobody changes another person's list.
 * Answers with the plan alone: the summary and numbers do not change when a priority is ticked, and
 * reading every project again on each tap kept the checkbox waiting.
 */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => !!weekKindFor(u), why: WHY });
    if (v instanceof NextResponse) return v;
    const parsed = weekAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const why = await actOnWeek(v.user, parsed.data, dayOf(req));
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    const today = dayOf(req) ?? new Date().toISOString().slice(0, 10);
    return NextResponse.json({ plan: await planOf(await orgIdForPerson(v.user.id).catch(() => null), v.user, mondayOf(today)) });
  });
}
