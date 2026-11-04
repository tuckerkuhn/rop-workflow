import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/server/auth";
import { DRAFT_KINDS, DraftingUnavailable, draftDocument } from "@/server/ai-drafts";
import { handle } from "@/server/guard";
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
    const p = (await loadProcurements(code)).find((x) => x.id === id);
    if (!p) return NextResponse.json({ error: "No such procurement." }, { status: 404 });
    try {
      const draft = await draftDocument(p, parsed.data.kind, v.user.name);
      const item = { ...p, drafts: { ...p.drafts, [DRAFT_KINDS[parsed.data.kind]]: draft } };
      await saveProcurements(code, [item]);
      return NextResponse.json({ item });
    } catch (e) {
      if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
      throw e;
    }
  });
}

export const maxDuration = 120;
