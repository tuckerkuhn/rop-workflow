import { NextResponse } from "next/server";
import type { FieldItem, Stock } from "@/lib/field";
import { requireViewer } from "@/server/auth";
import { loadField, saveItems, saveStock } from "@/server/field-store";
import { handle } from "@/server/guard";

/** Field activities state for a project. Names are included only for roles allowed to see them. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.fieldAccess !== "none" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadField(code, v.user));
  });
}

/** Saves changed items and/or the store stock. */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.fieldAccess === "edit", why: "You can view Field activities but not change them." });
    if (v instanceof NextResponse) return v;
    const body = (await req.json()) as { items?: FieldItem[]; stock?: Stock };
    if (body.items?.length) await saveItems(code, body.items);
    if (body.stock) await saveStock(code, body.stock);
    return NextResponse.json({ ok: true });
  });
}
