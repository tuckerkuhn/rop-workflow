import { NextResponse } from "next/server";
import { confirmLinksSchema } from "@/lib/target-details";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { confirmLinks, loadTargetDetails } from "@/server/target-details";

type Ctx = { params: Promise<{ code: string }> };

/** Saves the suggested workplan items and budget lines a plan approver confirmed ("Use this", "Use all suggestions"). */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const parsed = confirmLinksSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    const why = await confirmLinks(code, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why.error }, { status: why.status });
    return NextResponse.json(await loadTargetDetails(code, v.user));
  });
}
