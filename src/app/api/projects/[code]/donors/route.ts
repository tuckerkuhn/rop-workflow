import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { donorInputSchema } from "@/lib/progress";
import { requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { InputError, listDonors, saveDonor } from "@/server/progress-store";

const WHY = "Only the project manager and plan approvers can change donors.";

/** The project's donors with their report deadlines. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ donors: await listDonors(code, v.user) });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: WHY });
    if (v instanceof NextResponse) return v;
    const parsed = donorInputSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid donor." }, { status: 400 });
    try {
      const id = await saveDonor(code, null, parsed.data);
      await audit(code, { entity: "donor", entityId: id, action: "donor_added", by: v.user.id, detail: { name: parsed.data.name, reportFormat: parsed.data.reportFormat, deadlines: parsed.data.deadlines.map((d) => ({ title: d.title, date: d.date })) } });
      return NextResponse.json({ id }, { status: 201 });
    } catch (e) {
      if (e instanceof InputError) return NextResponse.json({ error: e.message }, { status: 400 });
      throw e;
    }
  });
}
