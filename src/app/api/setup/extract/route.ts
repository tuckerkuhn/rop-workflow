import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject } from "@/lib/demo";
import { DraftingUnavailable } from "@/server/ai-drafts";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { projectByCode } from "@/server/field-store";
import { aiAllowed } from "@/server/limits";
import { extractBudget, extractSetup, extractTerms } from "@/server/setup-extract";
import { logAudit } from "@/server/audit";
import { db } from "@/db";

/**
 * Reads the documents and proposes one part, for the person to confirm in setup: "design" (agreement
 * and logframe), "terms" (the agreement's reporting obligations and rules) or "budget" (a budget in
 * Word or PDF). The browser sends the three parts side by side.
 */
export const maxDuration = 180;

const projectOrNull = (code: string) => projectByCode(code).catch(() => null);

const body = z.object({
  part: z.enum(["design", "terms", "budget"]).default("design"),
  /** A running project the proposal is for, for the audit log. */
  project: z.string().max(40).optional(),
  files: z
    .array(z.discriminatedUnion("kind", [z.object({ name: z.string().max(200), kind: z.literal("pdf"), data: z.string().max(4_400_000) }), z.object({ name: z.string().max(200), kind: z.literal("text"), text: z.string().max(400_000) })]))
    .min(1)
    .max(4),
});

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => canEditProject(u) || !!u.admin, why: "Only programme leads and administrators set up projects." });
    if (v instanceof NextResponse) return v;
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Upload one to four documents, each under 3 MB." }, { status: 400 });
    const limit = await aiAllowed(v.user.id);
    if (limit) return limit;
    try {
      const { part, files, project } = parsed.data;
      const r = part === "terms" ? await extractTerms(files) : part === "budget" ? await extractBudget(files) : await extractSetup(files);
      // Proposals are on the record (what was read, by whom); what is confirmed is logged where it is saved.
      if (project) {
        const p = await projectOrNull(project);
        if (p) await logAudit(db, p.id, { entity: "project", entityId: p.id, action: "setup_documents_read", by: v.actor.id, detail: { part, files: files.map((f) => f.name), model: r.model } });
      }
      return NextResponse.json(r);
    } catch (e) {
      if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  });
}
