import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { quarterOf, resultActionSchema } from "@/lib/results";
import { sameResult } from "@/lib/results-import";
import { logAudit } from "@/server/audit";
import { FROM_KOBO, koboFedCodes } from "@/server/kobo-fed";
import { isMelOwner, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { projectByCode } from "@/server/field-store";
import { addProof, addResult, addResults, addUpdate, correctResult, loadResults, loadUpdates, reopenResult, reviewResult } from "@/server/results-store";
import { activityOf } from "@/lib/qpr";
import { loadQpr } from "@/server/qpr-store";
import { dataChecks } from "@/lib/data-checks";

type Ctx = { params: Promise<{ code: string }> };

/**
 * Results recorded with their proof (attendance sheets, verification reports, photos). Staff
 * with field access record them; the MEL owner accepts or queries each one, never their own.
 */

const mayRecord = (u: AppUser) => u.kind === "employee" && u.fieldAccess === "edit";

async function view(code: string, u: AppUser) {
  const project = await projectByCode(code);
  const kobo = await koboFedCodes(project.id);
  const indicators = await db
    .select({ code: s.indicators.code, donorCode: s.indicators.donorCode, name: s.indicators.name, unit: s.indicators.unit, target: s.indicators.target, result: s.indicators.result, disaggregation: s.indicators.disaggregation, verification: s.indicators.verification, source: s.indicators.source })
    .from(s.indicators)
    .where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.source, "results")))
    .orderBy(asc(s.indicators.position));
  const results = await loadResults(code);
  const updates = await loadUpdates(code);
  const mel = isMelOwner(u);
  const names = new Map<string, string>();
  for (const l of await db.selectDistinct({ c: s.budgetLines.activityCode, n: s.budgetLines.activity }).from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id))) if (l.c && l.n && !names.has(l.c)) names.set(l.c, l.n);
  const activities = [...new Set(indicators.map((i) => activityOf(i.donorCode, i.code)))].map((c) => ({ code: c, name: names.get(c) ?? `Activity ${c}` }));
  return {
    me: u.id,
    mayRecord: mayRecord(u),
    mayReview: mel,
    indicators: indicators.map((i) => ({ ...i, target: Number(i.target), fromKobo: kobo.has(i.code) })),
    // The data checker's flags, for MEL before accepting (and for the recorder to fix first).
    results: results.map((r) => ({ ...r, canReview: mel && r.status === "pending" && r.by !== u.id, canReopen: mel && r.status === "accepted" && r.by !== u.id, checks: dataChecks(r, results, indicators.find((i) => i.code === r.indicator)) })),
    activities,
    updates,
    mayUpdate: mayRecord(u) || mel,
    /** Proof can be added to any result, whoever recorded it: it never changes the figure. */
    mayAddProof: mayRecord(u) || mel,
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
    if (a.action === "update") {
      if (!(mayRecord(u) || isMelOwner(u))) return NextResponse.json({ error: "Only field staff and MEL can add activity updates." }, { status: 403 });
      if (a.update.date > new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "The date is in the future." }, { status: 400 });
      await addUpdate(code, a.update, u.id);
      return NextResponse.json(await view(code, u));
    }
    if (a.action === "correct") {
      // The same checks as a new result.
      if (a.changes.date > new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "The date is in the future." }, { status: 400 });
      if (a.changes.female !== undefined && a.changes.male !== undefined && a.changes.female + a.changes.male === 0) return NextResponse.json({ error: "Women and men are both 0: leave them blank if the result is not about people." }, { status: 400 });
      const err = await correctResult(code, a.id, a.changes, a.reply, u.id);
      if (err) return NextResponse.json({ error: err }, { status: 400 });
      return NextResponse.json(await view(code, u));
    }
    if (a.action === "reopen") {
      if (!isMelOwner(u)) return NextResponse.json({ error: "Only the MEL owner can reopen a result." }, { status: 403 });
      const r = (await loadResults(code)).find((x) => x.id === a.id);
      if (!r) return NextResponse.json({ error: "No such result." }, { status: 404 });
      if (r.by === u.id) return NextResponse.json({ error: "You recorded this result, so someone else must check it." }, { status: 403 });
      if (r.status !== "accepted") return NextResponse.json({ error: "Only an accepted result can be reopened." }, { status: 409 });
      // A released report is computed from accepted results: reopening one would change what the donor has.
      const q = quarterOf(r.date);
      if ((await loadQpr(code, q)).released) return NextResponse.json({ error: `The ${q} report has been released with this result in it. Correct it in the next report instead.` }, { status: 409 });
      const done = await reopenResult(code, a.id, u.id, a.note);
      if (!done) return NextResponse.json({ error: "Someone else has just changed this result. Reload to see it." }, { status: 409 });
      return NextResponse.json(await view(code, u));
    }
    if (a.action === "proof") {
      if (!(mayRecord(u) || isMelOwner(u))) return NextResponse.json({ error: "Only field staff and MEL can add proof." }, { status: 403 });
      const done = await addProof(code, a.id, { files: a.files, links: a.links, captions: a.captions, by: u.id });
      if (!done) return NextResponse.json({ error: "No such result." }, { status: 404 });
      return NextResponse.json(await view(code, u));
    }
    if (a.action === "import") {
      if (!mayRecord(u)) return NextResponse.json({ error: "Only staff who record field activities can import results." }, { status: 403 });
      const project = await projectByCode(code);
      const allowed = new Set((await db.select({ code: s.indicators.code }).from(s.indicators).where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.source, "results")))).map((r) => r.code));
      const today = new Date().toISOString().slice(0, 10);
      const existing = await loadResults(code);
      const fromKobo = await koboFedCodes(project.id);
      // All or none: one bad row refuses the file, with every row's reason.
      const problems: string[] = [];
      a.results.forEach((r, i) => {
        if (!allowed.has(r.indicator)) problems.push(`Row ${i + 1}: ${r.indicator} is not one this project records results for`);
        else if (fromKobo.has(r.indicator)) problems.push(`Row ${i + 1}: ${FROM_KOBO} (${r.indicator})`);
        if (r.date > today) problems.push(`Row ${i + 1}: the date is in the future`);
        if (existing.some((x) => sameResult(x, r))) problems.push(`Row ${i + 1}: already recorded (${r.indicator}, ${r.date}, ${r.value})`);
        if (a.results.some((x, j) => j < i && sameResult(x, r))) problems.push(`Row ${i + 1}: the same as an earlier row`);
      });
      if (problems.length) return NextResponse.json({ error: `Nothing imported. ${problems.slice(0, 8).join("; ")}${problems.length > 8 ? `; and ${problems.length - 8} more` : ""}.` }, { status: 400 });
      await addResults(code, a.results, u.id);
      await logAudit(db, project.id, { entity: "result", entityId: project.id, action: "results_imported", by: u.id, detail: { file: a.file, count: a.results.length } });
      return NextResponse.json(await view(code, u));
    }
    if (a.action === "record") {
      if (!mayRecord(u)) return NextResponse.json({ error: "Only staff who record field activities can record results." }, { status: 403 });
      const project = await projectByCode(code);
      const [ind] = await db.select({ code: s.indicators.code }).from(s.indicators).where(and(eq(s.indicators.projectId, project.id), eq(s.indicators.code, a.result.indicator), eq(s.indicators.source, "results")));
      if (!ind) return NextResponse.json({ error: "That indicator is not one this project records results for." }, { status: 400 });
      if ((await koboFedCodes(project.id)).has(a.result.indicator)) return NextResponse.json({ error: `${FROM_KOBO}: its results are counted from the form, not recorded here.` }, { status: 400 });
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
      const done = await reviewResult(code, a.id, a.action === "accept" ? "accepted" : "queried", u.id, a.action === "query" ? a.note : null);
      if (!done) return NextResponse.json({ error: "Someone else has just decided this result. Reload to see it." }, { status: 409 });
    }
    return NextResponse.json(await view(code, u));
  });
}
