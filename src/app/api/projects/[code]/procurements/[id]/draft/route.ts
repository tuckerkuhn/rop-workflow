import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/server/auth";
import { DRAFT_KINDS, DraftingUnavailable, draftDocument } from "@/server/ai-drafts";
import { db } from "@/db";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { aiAllowed } from "@/server/limits";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";

const bodySchema = z.object({ kind: z.enum(["rfq", "solicitation", "sole", "package"]) });

/** Drafts a procurement document with Claude and saves it on the record for procurement to correct. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await requireViewer(req, {
      write: true,
      allow: (u) => (u.procurementAccess === "edit" && u.procurement.includes("procurement")) || !!u.admin,
      why: "Only procurement staff draft procurement documents.",
    });
    if (v instanceof NextResponse) return v;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Say which document to draft." }, { status: 400 });
    const limit = await aiAllowed(v.user.id);
    if (limit) return limit;
    const p = (await loadProcurements(code)).find((x) => x.id === id);
    if (!p) return NextResponse.json({ error: "No such procurement." }, { status: 404 });
    try {
      const draft = await draftDocument(p, parsed.data.kind, v.user.name);
      // Applied to the latest copy (the draft took a while), and the version raised.
      const latest = (await loadProcurements(code)).find((x) => x.id === id) ?? p;
      const item = { ...latest, drafts: { ...latest.drafts, [DRAFT_KINDS[parsed.data.kind]]: draft }, rev: (latest.rev ?? 0) + 1 };
      await saveProcurements(code, [item]);
      const project = await projectByCode(code);
      await logAudit(db, project.id, { entity: "procurement", entityId: project.id, action: "ai_drafted", by: v.user.id, detail: { procurement: p.id, document: DRAFT_KINDS[parsed.data.kind], model: draft.model, questions: draft.questions.length } });
      return NextResponse.json({ item });
    } catch (e) {
      if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
      throw e;
    }
  });
}

export const maxDuration = 120;
