import { NextResponse } from "next/server";
import { storyActionSchema } from "@/lib/stories";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { mayWriteStory, storiesView, storyAction } from "@/server/stories-store";

/** Success stories: field staff, MEL and leads write them; MEL and leads approve. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await storiesView(code, v.user));
  });
}

export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: mayWriteStory, why: "Field staff, MEL and programme leads write stories." });
    if (v instanceof NextResponse) return v;
    const parsed = storyActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    try {
      const out = await storyAction(code, v.user, parsed.data);
      if (out.error) return NextResponse.json({ error: out.error }, { status: 400 });
      return NextResponse.json({ ...(await storiesView(code, v.user)), id: out.id });
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  });
}
