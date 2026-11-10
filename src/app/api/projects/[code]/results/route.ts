import { and, asc, eq } from "drizzle-orm";
import { after, NextResponse } from "next/server";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { quarterOf, resultActionSchema } from "@/lib/results";
import { sameResult } from "@/lib/results-import";
import { logAudit } from "@/server/audit";
import { FROM_KOBO, koboFedCodes } from "@/server/kobo-fed";
import { isMelOwner, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { selfApproval, soloFor } from "@/server/solo";
import { projectByCode } from "@/server/field-store";
import { addProof, addResult, addResults, addUpdate, correctResult, editUpdate, loadResults, loadUpdates, removeUpdate, reopenResult, reviewResult, updateById } from "@/server/results-store";
import { activityOf } from "@/lib/qpr";
import { loadQpr } from "@/server/qpr-store";
import { sentWeekFor } from "@/lib/weekly";
import { loadWeekly } from "@/server/weekly-store";
import { toEnglish } from "@/server/translate";
import { dataChecks } from "@/lib/data-checks";
import { coachNew } from "@/server/photos-store";

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
  const solo = mel ? await soloFor(code).catch(() => ({ on: false, blocked: null })) : { on: false, blocked: null };
  const names = new Map<string, string>();
  for (const l of await db.selectDistinct({ c: s.budgetLines.activityCode, n: s.budgetLines.activity }).from(s.budgetLines).where(eq(s.budgetLines.projectId, project.id))) if (l.c && l.n && !names.has(l.c)) names.set(l.c, l.n);
  const activities = [...new Set(indicators.map((i) => activityOf(i.donorCode, i.code)))].map((c) => ({ code: c, name: names.get(c) ?? `Activity ${c}` }));
  return {
    me: u.id,
    mayRecord: mayRecord(u),
    mayReview: mel,
    indicators: indicators.map((i) => ({ ...i, target: Number(i.target), fromKobo: kobo.has(i.code) })),
    // The data checker's flags, for MEL before accepting (and for the recorder to fix first).
    results: results.map((r) => ({ ...r, canReview: mel && r.status === "pending" && r.by !== u.id, canSelfAccept: mel && solo.on && !solo.blocked && r.status === "pending" && r.by === u.id, canReopen: mel && r.status === "accepted" && r.by !== u.id, checks: dataChecks(r, results, indicators.find((i) => i.code === r.indicator)) })),
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

/** Text written in Dari or Pashto is saved in English for the report, with the original kept beside it. */
async function inEnglish<T extends { title?: string; note: string; captions?: Record<string, string>; original?: unknown }>(item: T, by: string, maxNote: number): Promise<T> {
  const { original: _forged, ...rest } = item;
  void _forged;
  const t = await toEnglish(by, { title: rest.title, note: rest.note, captions: rest.captions });
  if (!t) return rest as T;
  return { ...rest, ...(t.title !== undefined ? { title: t.title } : {}), note: (t.note ?? rest.note).slice(0, maxNote), ...(t.captions ? { captions: t.captions } : {}), original: t.original } as T;
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
    // New photos get their coaching once the answer has gone back.
    if (["update", "update-edit", "record", "proof"].includes(a.action)) after(() => coachNew(code, 3).catch(() => 0));
    if (a.action === "update") {
      if (!(mayRecord(u) || isMelOwner(u))) return NextResponse.json({ error: "Only field staff and MEL can add activity updates." }, { status: 403 });
      if (a.update.date > new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "The date is in the future." }, { status: 400 });
      const sent = sentWeekFor(await loadWeekly(code), a.update.date);
      if (sent) return NextResponse.json({ error: `Weekly update #${sent.n} (${sent.from} to ${sent.to}) has been sent: date this in a week that is still open.` }, { status: 409 });
      await addUpdate(code, await inEnglish(a.update, u.id, 4000), u.id);
      return NextResponse.json(await view(code, u));
    }
    if (a.action === "update-edit" || a.action === "update-remove") {
      if (!(mayRecord(u) || isMelOwner(u))) return NextResponse.json({ error: "Only field staff and MEL can change activity updates." }, { status: 403 });
      const old = await updateById(code, a.id);
      if (!old) return NextResponse.json({ error: "No such update." }, { status: 404 });
      if (old.by !== u.id && !isMelOwner(u)) return NextResponse.json({ error: "Only the person who wrote it, or MEL, can change it." }, { status: 403 });
      const weekly = await loadWeekly(code);
      const sent = sentWeekFor(weekly, old.date) ?? (a.action === "update-edit" ? sentWeekFor(weekly, a.update.date) : null);
      if (sent) return NextResponse.json({ error: `Weekly update #${sent.n} has been sent, so this can no longer be changed.` }, { status: 409 });
      if (a.action === "update-edit") {
        if (a.update.date > new Date().toISOString().slice(0, 10)) return NextResponse.json({ error: "The date is in the future." }, { status: 400 });
        await editUpdate(code, a.id, await inEnglish(a.update, u.id, 4000), u.id);
      } else await removeUpdate(code, a.id, u.id);
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
    if (a.action === "accept-many") {
      if (!isMelOwner(u)) return NextResponse.json({ error: "Only the MEL owner can accept results." }, { status: 403 });
      const project = await projectByCode(code);
      const all = await loadResults(code);
      const indicators = await db.select().from(s.indicators).where(eq(s.indicators.projectId, project.id));
      let accepted = 0;
      for (const id of a.ids) {
        const r = all.find((x) => x.id === id);
        if (!r || r.status !== "pending" || r.by === u.id) continue;
        const ind = indicators.find((i) => i.code === r.indicator);
        if (dataChecks(r, all, ind ? { code: ind.code, unit: ind.unit, disaggregation: ind.disaggregation } : undefined).length) continue;
        if (await reviewResult(code, id, "accepted", u.id, null)) accepted++;
      }
      return NextResponse.json({ ...(await view(code, u)), accepted });
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
      const done = await addProof(code, a.id, { files: a.files, links: a.links, captions: a.captions, taken: a.taken, by: u.id });
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
      // Only a KoboToolbox sync may say a result came from Kobo, with its location.
      await addResults(code, a.results.map(({ kobo: _k, gps: _g, ...r }) => (void [_k, _g], r)), u.id);
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
      {
        const { kobo: _k, gps: _g, original: _o, ...typed } = a.result;
        void [_k, _g, _o];
        await addResult(code, await inEnglish(typed, u.id, 2000), u.id);
      }
    } else {
      if (!isMelOwner(u)) return NextResponse.json({ error: "Only the MEL owner can accept or query results." }, { status: 403 });
      const r = (await loadResults(code)).find((x) => x.id === a.id);
      if (!r) return NextResponse.json({ error: "No such result." }, { status: 404 });
      // Solo mode (server/solo.ts): a small team's MEL may accept their own result, confirming it; never query it.
      let self: Record<string, unknown> | undefined;
      if (r.by === u.id) {
        const refusal = "You recorded this result, so someone else must check it.";
        if (a.action !== "accept") return NextResponse.json({ error: refusal }, { status: 403 });
        const ok = selfApproval(await soloFor(code), a.self, refusal);
        if (!ok.ok) return NextResponse.json({ error: ok.why }, { status: 403 });
        self = ok.detail;
      }
      if (r.status !== "pending") return NextResponse.json({ error: "This result has already been checked." }, { status: 409 });
      // What the data checker had flagged when the person decided: kept with their choice on the audit trail.
      const [ind] = await db.select().from(s.indicators).where(and(eq(s.indicators.projectId, (await projectByCode(code)).id), eq(s.indicators.code, r.indicator))).limit(1);
      const flags = dataChecks(r, await loadResults(code), ind ? { code: ind.code, unit: ind.unit, disaggregation: ind.disaggregation } : undefined);
      const done = await reviewResult(code, a.id, a.action === "accept" ? "accepted" : "queried", u.id, a.action === "query" ? a.note : null, { ...(self ?? {}), ...(flags.length ? { flags } : {}) });
      if (!done) return NextResponse.json({ error: "Someone else has just decided this result. Reload to see it." }, { status: 409 });
    }
    return NextResponse.json(await view(code, u));
  });
}
