import { NextResponse } from "next/server";
import { frameworkAction } from "@/lib/framework";
import { requireViewer } from "@/server/auth";
import { loadFramework, setStatement } from "@/server/framework-store";
import { handle } from "@/server/guard";

type Ctx = { params: Promise<{ code: string }> };

/** The results framework as a tree, with progress on each indicator and activity. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadFramework(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true });
    if (v instanceof NextResponse) return v;
    const parsed = frameworkAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const why = await setStatement(code, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why }, { status: 403 });
    return NextResponse.json(await loadFramework(code, v.user));
  });
}
