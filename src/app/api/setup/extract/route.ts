import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject } from "@/lib/demo";
import { DraftingUnavailable } from "@/server/ai-drafts";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { aiAllowed } from "@/server/limits";
import { extractSetup } from "@/server/setup-extract";

/** Reads an agreement and logframe and proposes the project's design, for the person to check in setup. */
export const maxDuration = 180;

const body = z.object({
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
      return NextResponse.json(await extractSetup(parsed.data.files));
    } catch (e) {
      if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  });
}
