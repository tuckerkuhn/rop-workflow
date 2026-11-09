import { NextResponse } from "next/server";
import { db } from "@/db";
import type { AppUser } from "@/lib/demo";
import { mergeQuestions, qprPatchSchema, SECTIONS, type Qpr } from "@/lib/qpr";
import { requireViewer } from "@/server/auth";
import { DraftingUnavailable } from "@/server/ai-drafts";
import { handle } from "@/server/guard";
import { aiAllowed } from "@/server/limits";
import { holdsRole } from "@/server/hr-store";
import { draftQpr } from "@/server/qpr-drafts";
import { qprData, saveQpr } from "@/server/qpr-store";
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
const quarterOf = (req: Request) => {
  const q = new URL(req.url).searchParams.get("q") ?? "";
  return /^\d{4}-Q[1-4]$/.test(q) ? q : null;
};

async function view(code: string, quarter: string, u: AppUser) {
  const d = await qprData(code, quarter);
  return { ...d, mayEdit: mayEdit(u) && !d.saved.released, mayRelease: mayRelease(u) && !d.saved.released, aiReady: !!process.env.ANTHROPIC_API_KEY, mayImport: u.kind === "employee" && (u.project.includes("finance-import") || (await holdsRole(u.id, "finance"))) };
}
export type QprView = Awaited<ReturnType<typeof view>>;

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const q = quarterOf(req);
    if (!q) return NextResponse.json({ error: "Choose a quarter, e.g. ?q=2026-Q3." }, { status: 400 });
    return NextResponse.json(await view(code, q, v.user));
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

    if (a.action === "release") {
      if (!mayRelease(u)) return NextResponse.json({ error: "Only the person who releases reports can mark it final." }, { status: 403 });
      const stops = d.checks.filter((c) => c.level === "stop");
      if (stops.length) return NextResponse.json({ error: `Fix these first: ${stops.map((c) => c.text).join(" ")}` }, { status: 409 });
      next.released = { by: u.id, at: now };
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
          const parts = await Promise.all(groups.map((g) => draftQpr(d, g)));
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
      action: a.action === "release" ? "qpr_released" : "qpr_edited",
      by: u.id,
      detail: { quarter: q, part: a.action, ...(a.action === "section" ? { key: a.key, cleared: !a.text.trim() } : a.action === "row" ? { key: a.indicator, status: a.status, comment: a.comment } : a.action === "overspend" ? { key: a.line, cleared: !a.text } : {}) },
    });
    return NextResponse.json(await view(code, q, u));
  });
}
