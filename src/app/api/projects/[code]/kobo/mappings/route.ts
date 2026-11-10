import { NextResponse } from "next/server";
import { koboToResults } from "@/server/kobo-results";
import { canEditProject } from "@/lib/demo";
import { mappingsSchema } from "@/lib/kobo-setup";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { koboState, readable, saveMappings } from "@/server/kobo-link";

/** Replaces how each indicator is counted from form questions. */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only the project manager and plan approvers can map questions." });
    if (v instanceof NextResponse) return v;
    const parsed = mappingsSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid mappings." }, { status: 400 });
    return readable(async () => {
      await saveMappings(code, parsed.data.mappings, v.actor.id);
      // A new or changed mapping turns the submissions it counts into results for MEL.
      await koboToResults(code);
      return NextResponse.json(await koboState(code));
    });
  });
}
