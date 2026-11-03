import { NextResponse } from "next/server";
import { newWorkItemSchema } from "@/lib/work-items";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { createWorkItem, listWorkItems } from "@/server/work-store";

/** Tasks and milestones on a project. Staff only; donors follow progress, not to-dos. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await listWorkItems(code));
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const parsed = newWorkItemSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid item." }, { status: 400 });
    return NextResponse.json({ item: await createWorkItem(code, parsed.data, v.user.id) }, { status: 201 });
  });
}
