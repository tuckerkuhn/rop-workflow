import { NextResponse } from "next/server";
import { db } from "@/db";
import { canEditProject } from "@/lib/demo";
import { logAudit } from "@/server/audit";
import { requireViewer } from "@/server/auth";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { readable } from "@/server/kobo-link";
import { suggestMappings } from "@/server/kobo-suggest";
import { aiAllowed } from "@/server/limits";

export const maxDuration = 120;

/** Whether suggestions are available on this server (no AI key: the step works as before, without them). */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: canEditProject });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ ai: !!process.env.ANTHROPIC_API_KEY });
  });
}

/** Suggested mappings for the project's indicators (server/kobo-suggest). Nothing is saved: the person accepts each one. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only the project manager and plan approvers map questions." });
    if (v instanceof NextResponse) return v;
    if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "AI is not set up on this server." }, { status: 503 });
    const limit = await aiAllowed(v.user.id);
    if (limit) return limit;
    return readable(async () => {
      const r = await suggestMappings(code);
      const project = await projectByCode(code);
      await logAudit(db, project.id, { entity: "project", entityId: project.id, action: "kobo_mappings_suggested", by: v.actor.id, detail: { model: r.model, suggestions: r.suggestions.map((x) => ({ indicator: x.indicatorCode, question: x.mapping?.question ?? null, method: x.mapping?.method ?? null, confidence: x.confidence })) } });
      return NextResponse.json(r);
    });
  });
}
