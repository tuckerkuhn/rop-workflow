import { NextResponse } from "next/server";
import { selectionAction } from "@/lib/selection";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { actOnSelection, loadSelection } from "@/server/selection-store";

type Ctx = { params: Promise<{ code: string }> };
const WHY = "Farmer selection is for project staff.";

/** The project's selection rules and the decision for each farmer on its list. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: WHY });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadSelection(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: WHY });
    if (v instanceof NextResponse) return v;
    const parsed = selectionAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const why = await actOnSelection(code, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    return NextResponse.json(await loadSelection(code, v.user));
  });
}
