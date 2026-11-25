import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { activityLinksSchema } from "@/lib/kobo-activities";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { koboState, readable, saveActivityLinks } from "@/server/kobo-link";

/** Replaces which workplan activities each KoboCollect form records. Same people as the mappings. */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only the project manager and plan approvers can map questions." });
    if (v instanceof NextResponse) return v;
    const parsed = activityLinksSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid activity links." }, { status: 400 });
    return readable(async () => {
      await saveActivityLinks(code, parsed.data.links, v.actor.id);
      return NextResponse.json(await koboState(code));
    });
  });
}
