import { NextResponse } from "next/server";
import { z } from "zod";
import { holderFor, stepById } from "@/lib/procurement";
import { requireViewer } from "@/server/auth";
import { CHECKABLE_STEPS, DRAFT_MODEL, DraftingUnavailable, checkProcurement } from "@/server/ai-drafts";
import { db } from "@/db";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { handle } from "@/server/guard";
import { aiAllowed } from "@/server/limits";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";

const bodySchema = z.object({ step: z.string() });

/** Runs the AI check for the procurement's current step and saves the findings for its owner to read. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string; id: string }> }) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.procurementAccess === "edit" || !!u.admin, why: "You can view Procurement but not change it." });
    if (v instanceof NextResponse) return v;
    const limit = await aiAllowed(v.user.id);
    if (limit) return limit;
    const parsed = bodySchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success || !CHECKABLE_STEPS.includes(parsed.data.step)) return NextResponse.json({ error: "This step has no AI check." }, { status: 400 });
    const p = (await loadProcurements(code)).find((x) => x.id === id);
    if (!p) return NextResponse.json({ error: "No such procurement." }, { status: 404 });
    if (p.step !== parsed.data.step) return NextResponse.json({ error: "The procurement has moved on from that step." }, { status: 409 });
    const owner = stepById[p.step].owner;
    const ok = v.user.procurement.includes(owner) || holderFor(p, owner)?.id === v.user.id || !!v.user.admin;
    if (!ok) return NextResponse.json({ error: "Only the person working on this step runs its AI check." }, { status: 403 });
    try {
      const findings = await checkProcurement(p, p.step);
      // Applied to the latest copy (the check took a while), and the version raised.
      const latest = (await loadProcurements(code)).find((x) => x.id === id) ?? p;
      const item = { ...latest, ai: { ...latest.ai, [p.step]: findings }, rev: (latest.rev ?? 0) + 1 };
      await saveProcurements(code, [item]);
      const project = await projectByCode(code);
      await logAudit(db, project.id, { entity: "procurement", entityId: project.id, action: "ai_checked", by: v.user.id, detail: { procurement: p.id, step: p.step, model: DRAFT_MODEL, findings: findings.length } });
      return NextResponse.json({ item });
    } catch (e) {
      if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
      throw e;
    }
  });
}

export const maxDuration = 120;
