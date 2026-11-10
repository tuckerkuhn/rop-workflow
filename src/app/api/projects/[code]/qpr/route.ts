import { NextResponse } from "next/server";
import { db } from "@/db";
import type { AppUser } from "@/lib/demo";
import { mergeQuestions, qprPatchSchema, SECTIONS, type Qpr } from "@/lib/qpr";
import { requireViewer } from "@/server/auth";
import { DraftingUnavailable } from "@/server/ai-drafts";
import { handle } from "@/server/guard";
import { donorPhotoRule } from "@/server/photo-consent";
import { preflight } from "@/server/preflight";
import { aiAllowed } from "@/server/limits";
import { holdsRole } from "@/server/hr-store";
import { draftQpr } from "@/server/qpr-drafts";
import { addCopy, copyOf, loadCopies, qprData, reportWork, saveQpr } from "@/server/qpr-store";
import { differences } from "@/lib/report-copy";
import { checkClaims } from "@/server/claim-check";
import { loadUpdates } from "@/server/results-store";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";

type Ctx = { params: Promise<{ code: string }> };
export const maxDuration = 120;

/**
 * The donor's quarterly progress report for one quarter (?q=2026-Q3). Staff see it; the MEL
 * owner and programme leads write it; the person who releases reports marks it final.
 */

const mayEdit = (u: AppUser) => u.kind === "employee" && (u.admin || u.project.some((r) => ["mel-owner", "report-release", "plan-approver", "monthly-review"].includes(r)));
const mayRelease = (u: AppUser) => u.kind === "employee" && u.project.includes("report-release");
const copyAtOf = (req: Request) => new URL(req.url).searchParams.get("copy");
const quarterOf = (req: Request) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return /^\d{4}-Q[1-4]$/.test(q) ? q : null;
};

/**
 * The report for a quarter. Once released it is the frozen copy made at release, with what has
 * changed since; ?copy=<time> opens a practice copy the same way. Otherwise the live report.
 */
async function view(code: string, quarter: string, u: AppUser, copyAt: string | null = null) {
  const d = await qprData(code, quarter);
  const copies = await loadCopies(code, quarter);
  const release = copies.find((c) => c.kind === "release");
  const shown = d.saved.released && release ? release : copyAt ? (copies.find((c) => c.kind === "practice" && c.at === copyAt) ?? null) : null;
  const live = copyOf(d);
  // A frozen copy made before the consent rule keeps its text and figures; its photos follow the rule as it stands now.
  const photoOk = await donorPhotoRule((await projectByCode(code)).id);
  const frozen = shown ? { ...shown.data, photos: shown.data.photos.filter((ph) => photoOk(ph.hash).ok) } : null;
  const base = frozen ? { ...d, ...frozen } : d;
  const editable = !d.saved.released && !shown;
  return {
    ...base,
    mayEdit: mayEdit(u) && editable,
    mayRelease: mayRelease(u) && editable,
    mayPractice: mayEdit(u) && editable,
    aiReady: !!process.env.ANTHROPIC_API_KEY,
    mayImport: editable && u.kind === "employee" && (u.project.includes("finance-import") || (await holdsRole(u.id, "finance"))),
    /** The frozen copy shown, if any, and how it differs from the report as it would be now. */
    frozen: shown ? { kind: shown.kind, by: shown.by, at: shown.at } : null,
    changes: shown ? differences(shown.data, live) : [],
    copies: copies.map((c) => ({ kind: c.kind, by: c.by, at: c.at, minutes: c.work.minutes })),
    work: shown ? shown.work : await reportWork(code, quarter),
  };
}
export type QprView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const q = quarterOf(req);
    if (!q) return NextResponse.json({ error: "Choose a quarter, e.g. ?q=2026-Q3." }, { status: 400 });
    return NextResponse.json(await view(code, q, v.user, copyAtOf(req)));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const q = quarterOf(req);
    if (!q) return NextResponse.json({ error: "Choose a quarter." }, { status: 400 });
    const parsed = qprPatchSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    const a = parsed.data;
    const u = v.user;
    const d = await qprData(code, q);
    if (d.saved.released) return NextResponse.json({ error: "This report has been released and can no longer be changed." }, { status: 409 });
    const now = new Date().toISOString();
    const next: Qpr = structuredClone(d.saved);
    const validKey = (k: string) => SECTIONS.some((s) => s.key === k) || d.activities.some((x) => `act.${x.code}` === k);

    if (a.action === "check-claims") {
      if (!mayEdit(u)) return NextResponse.json({ error: "Only the MEL owner and programme leads check the report." }, { status: 403 });
      const limit = await aiAllowed(u.id);
      if (limit) return limit;
      try {
        next.claimCheck = await checkClaims(d, await loadUpdates(code), u.id);
      } catch (e) {
        if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
        return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
      }
      await saveQpr(code, q, next);
      const project = await projectByCode(code);
      await logAudit(db, project.id, { entity: "qpr", entityId: project.id, action: "qpr_claims_checked", by: u.id, detail: { quarter: q, issues: next.claimCheck.issues.length } });
      return NextResponse.json(await view(code, q, u));
    }
    if (a.action === "practice") {
      if (!mayEdit(u)) return NextResponse.json({ error: "Only the MEL owner and programme leads can do a practice release." }, { status: 403 });
      await addCopy(code, q, { kind: "practice", by: u.id, at: now, work: await reportWork(code, q), data: copyOf(d) });
      const project = await projectByCode(code);
      await logAudit(db, project.id, { entity: "qpr", entityId: project.id, action: "qpr_practice", by: u.id, detail: { quarter: q } });
      return NextResponse.json({ ...(await view(code, q, u, now)), copyAt: now });
    }
    if (a.action === "release") {
      if (!mayRelease(u)) return NextResponse.json({ error: "Only the person who releases reports can mark it final." }, { status: 403 });
      // Pre-flight (server/preflight) includes every "stop" in the report's own checks, and more.
      const blocks = (await preflight(code, { kind: "qpr", quarter: q })).items.filter((i) => i.group === "blocks");
      if (blocks.length) return NextResponse.json({ error: `Pre-flight lists what blocks the report; fix these first: ${blocks.map((c) => c.text).join("; ")}.` }, { status: 409 });
      next.released = { by: u.id, at: now };
      // The copy the donor receives: shown and downloaded from now on, whatever changes later.
      await addCopy(code, q, { kind: "release", by: u.id, at: now, work: await reportWork(code, q), data: copyOf({ ...d, saved: next }) });
    } else {
      if (!mayEdit(u)) return NextResponse.json({ error: "Only the MEL owner and programme leads can write the report." }, { status: 403 });
      if (a.action === "section") {
        if (!validKey(a.key)) return NextResponse.json({ error: "No such section." }, { status: 400 });
        if (a.text.trim()) next.sections[a.key] = { text: a.text, by: u.id, at: now };
        else delete next.sections[a.key];
      } else if (a.action === "row") {
        if (!d.rows.some((r) => r.code === a.indicator)) return NextResponse.json({ error: "No such indicator." }, { status: 400 });
        if (a.status === null && a.comment === null) delete next.rows[a.indicator];
        else next.rows[a.indicator] = { ...(a.status ? { status: a.status } : {}), ...(a.comment?.trim() ? { comment: a.comment.trim() } : {}), by: u.id, at: now };
      } else if (a.action === "claim-decide") {
        const issue = next.claimCheck?.issues[a.index];
        if (!issue) return NextResponse.json({ error: "That finding is no longer there. Run the check again to see the current list." }, { status: 409 });
        if (a.choice) issue.decided = { choice: a.choice, by: u.id, name: u.name, at: now };
        else delete issue.decided;
      } else if (a.action === "info") {
        next.info = a.info;
        next.quarterSpend = a.quarterSpend;
      } else if (a.action === "acronyms") {
        next.acronyms = [...a.acronyms].sort((x, y) => x[0].localeCompare(y[0]));
      } else if (a.action === "risks") {
        next.risks = a.risks.filter((r) => r.risk || r.mitigation);
      } else if (a.action === "grm") {
        if (a.received !== null && a.resolved !== null && a.resolved > a.received) return NextResponse.json({ error: "More cases resolved than received." }, { status: 400 });
        next.grm = { received: a.received, resolved: a.resolved };
      } else if (a.action === "overspend") {
        if (!(d.spend.byLine[a.line] && d.spend.byLine[a.line].actual > d.spend.byLine[a.line].budget)) return NextResponse.json({ error: "That budget line is not overspent." }, { status: 400 });
        const o = { ...(next.overspend ?? {}) };
        if (a.text) o[a.line] = { text: a.text, by: u.id, at: now };
        else delete o[a.line];
        next.overspend = o;
      } else if (a.action === "draft") {
        const limit = await aiAllowed(u.id);
        if (limit) return limit;
        const bad = a.keys.find((k) => !validKey(k) || (!k.startsWith("act.") && !SECTIONS.find((s) => s.key === k)?.draft));
        if (bad) return NextResponse.json({ error: `"${bad}" cannot be drafted.` }, { status: 400 });
        try {
          // Two sections per request, all at once: each finishes well inside the server's time limit.
          const groups = Array.from({ length: Math.ceil(a.keys.length / 2) }, (_, i) => a.keys.slice(i * 2, i * 2 + 2));
          const parts = await Promise.all(groups.map((g) => draftQpr(d, g, u.id)));
          const out = { sections: parts.flatMap((x) => x.sections), questions: mergeQuestions(parts.flatMap((x) => x.questions)) };
          for (const s of out.sections) next.sections[s.key] = { text: s.text, by: u.id, at: now, drafted: true };
          await saveQpr(code, q, next);
          const project = await projectByCode(code);
          await logAudit(db, project.id, { entity: "qpr", entityId: project.id, action: "qpr_ai_drafted", by: u.id, detail: { quarter: q, keys: out.sections.map((s) => s.key), questions: out.questions.length } });
          return NextResponse.json({ ...(await view(code, q, u)), questions: out.questions });
        } catch (e) {
          if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
          return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
        }
      }
    }
    await saveQpr(code, q, next);
    const project = await projectByCode(code);
    await logAudit(db, project.id, {
      entity: "qpr",
      entityId: project.id,
      action: a.action === "release" ? "qpr_released" : a.action === "claim-decide" ? "qpr_claim_decided" : "qpr_edited",
      by: u.id,
      detail: { quarter: q, part: a.action, ...(a.action === "claim-decide" ? { choice: a.choice ?? "undone", section: next.claimCheck?.issues[a.index]?.section, kind: next.claimCheck?.issues[a.index]?.kind, sentence: next.claimCheck?.issues[a.index]?.sentence.slice(0, 300), why: next.claimCheck?.issues[a.index]?.problem.slice(0, 300) } : {}), ...(a.action === "section" ? { key: a.key, cleared: !a.text.trim() } : a.action === "row" ? { key: a.indicator, status: a.status, comment: a.comment } : a.action === "overspend" ? { key: a.line, cleared: !a.text } : {}) },
    });
    return NextResponse.json(await view(code, q, u));
  });
}
