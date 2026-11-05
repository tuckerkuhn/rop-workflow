import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { resultActionSchema } from "@/lib/results";
import { isMelOwner, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { projectByCode } from "@/server/field-store";
import { addResult, loadResults, reviewResult } from "@/server/results-store";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Results recorded with their proof (attendance sheets, verification reports, photos). Staff
 * with field access record them; the MEL owner accepts or queries each one, never their own.
 */

const mayRecord = (u: AppUser) => u.kind === "employee" && u.fieldAccess === "edit";

async function view(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const indicators = await db
    .select({ code: s.indicators.code, donorCode: s.indicators.donorCode, name: s.indicators.name, unit: s.indicators.unit, target: s.indicators.target, result: s.indicators.result, disaggregation: s.indicators.disaggregation, verification: s.indicators.verification, source: s.indicators.source })
    .from(s.indicators)
    .where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.source, "results")))
    .orderBy(asc(s.indicators.position));
  const results = await loadResults(code);
  const mel = isMelOwner(u);
  return {
    me: u.id,
    mayRecord: mayRecord(u),
    mayReview: mel,
    indicators: indicators.map((i) => ({ ...i, target: Number(i.target) })),
    results: results.map((r) => ({ ...r, canReview: mel && r.status === "pending" && r.by !== u.id })),
  };
}
export type ResultsView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" && u.fieldAccess !== "none" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await view(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" && u.fieldAccess !== "none" });
    if (v instanceof NextResponse) return v;
    const parsed = resultActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    const a = parsed.data;
    const u = v.user;
    if (a.action === "record") {
      if (!mayRecord(u)) return NextResponse.json({ error: "Only staff who record field activities can record results." }, { status: 403 });
      const project = await projectByCode(code);
      const [ind] = await db.select({ code: s.indicators.code }).from(s.indicators).where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.code, a.result.indicator), eq(s.indicators.source, "results")));
      if (!ind) return NextResponse.json({ error: "That indicator is not one this project records results for." }, { status: 400 });
      if (a.result.date > new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "The date is in the future." }, { status: 400 });
      const { female, male } = a.result;
      if (female !== undefined && male !== undefined && female + male === 0) return NextResponse.json({ error: "Women and men are both 0: leave them blank if the result is not about people." }, { status: 400 });
      await addResult(code, a.result, u.id);
    } else {
      if (!isMelOwner(u)) return NextResponse.json({ error: "Only the MEL owner can accept or query results." }, { status: 403 });
      const r = (await loadResults(code)).find((x) => x.id === a.id);
      if (!r) return NextResponse.json({ error: "No such result." }, { status: 404 });
      if (r.by === u.id) return NextResponse.json({ error: "You recorded this result, so someone else must check it." }, { status: 403 });
      if (r.status !== "pending") return NextResponse.json({ error: "This result has already been checked." }, { status: 409 });
      await reviewResult(code, a.id, a.action === "accept" ? "accepted" : "queried", u.id, a.action === "query" ? a.note : null);
    }
    return NextResponse.json(await view(code, u));
  });
}
