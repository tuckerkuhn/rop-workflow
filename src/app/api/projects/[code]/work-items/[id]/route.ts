import { NextResponse } from "next/server";
import { z } from "zod";
import { workItemPatchSchema } from "@/lib/work-items";
import { isEmployee, requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { deleteWorkItem, setNotes, setTaskDone } from "@/server/work-store";

type Ctx = { params: Promise<{ code: string; id: string }> };
const uuid = z.uuid();

/** Ticks a task off or back on, or changes the notes on a task or milestone. */
export async function PATCH(req: Request, { params }: Ctx) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const parsed = workItemPatchSchema.safeParse(await req.json().catch(() => null));
    if (!uuid.safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    let item = parsed.data.notes !== undefined ? await setNotes(code, id, parsed.data.notes) : null;
    if (parsed.data.done !== undefined) item = await setTaskDone(code, id, parsed.data.done, v.user.id);
    if (!item) return NextResponse.json({ error: "No such item on this project." }, { status: 404 });
    await audit(code, { entity: "work_item", entityId: id, action: parsed.data.done === undefined ? "work_item_notes_changed" : parsed.data.done ? "work_item_done" : "work_item_reopened", by: v.user.id, detail: { title: item.title } });
    return NextResponse.json({ item });
  });
}

export async function DELETE(req: Request, { params }: Ctx) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee });
    if (v instanceof NextResponse) return v;
    if (!uuid.safeParse(id).success) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
    const result = await deleteWorkItem(code, id);
    if (result === "missing") return NextResponse.json({ error: "No such item on this project." }, { status: 404 });
    if (result === "automatic") return NextResponse.json({ error: "This date comes from the project settings. Change it there." }, { status: 409 });
    await audit(code, { entity: "work_item", entityId: id, action: "work_item_deleted", by: v.user.id, detail: { title: result.title, type: result.type, date: result.date } });
    return NextResponse.json({ ok: true });
  });
}
