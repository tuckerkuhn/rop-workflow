import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject } from "@/lib/demo";
import { donorInputSchema } from "@/lib/progress";
import { requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { InputError, deleteDonor, saveDonor } from "@/server/progress-store";

type Ctx = { params: Promise<{ code: string; id: string }> };
const WHY = "Only the project manager and plan approvers can change donors.";
const uuid = z.uuid();

/** Updates a donor; its report deadlines in Tasks change to match. */
export async function PUT(req: Request, { params }: Ctx) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: WHY });
    if (v instanceof NextResponse) return v;
    const parsed = donorInputSchema.safeParse(await req.json().catch(() => null));
    if (!uuid.safeParse(id).success || !parsed.success) return NextResponse.json({ error: parsed.error?.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    try {
      const saved = await saveDonor(code, id, parsed.data);
      await audit(code, { entity: "donor", entityId: saved, action: "donor_changed", by: v.user.id, detail: { name: parsed.data.name, reportFormat: parsed.data.reportFormat, deadlines: parsed.data.deadlines.map((d) => ({ title: d.title, date: d.date })) } });
      return NextResponse.json({ id: saved });
    } catch (e) {
      if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  });
}

/** Removes the donor and its report deadlines. */
export async function DELETE(req: Request, { params }: Ctx) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: WHY });
    if (v instanceof NextResponse) return v;
    if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    if (!(await deleteDonor(code, id))) return NextResponse.json({ error: "No such donor on this project." }, { status: 404 });
    // Its report deadlines in Tasks went with it.
    await audit(code, { entity: "donor", entityId: id, action: "donor_removed", by: v.user.id });
    return NextResponse.json({ ok: true });
  });
}
