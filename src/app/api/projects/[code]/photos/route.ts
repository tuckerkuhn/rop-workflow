import { after, NextResponse } from "next/server";
import { photoActionSchema } from "@/lib/photos";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { coachNew, photoAction, photosView } from "@/server/photos-store";

/** Photos and posts: coaching for everyone who takes photos; the library and posts for communications, MEL and leads. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const view = await photosView(code, v.user);
    // Photos not looked at yet are coached after the page has its answer.
    if (view.waiting > 0) after(() => coachNew(code, 4).catch(() => 0));
    return NextResponse.json(view);
  });
}

export const maxDuration = 120;

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const parsed = photoActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    try {
      const out = await photoAction(code, v.user, parsed.data);
      if (out.error) return NextResponse.json({ error: out.error }, { status: 400 });
      return NextResponse.json(await photosView(code, v.user));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  });
}
