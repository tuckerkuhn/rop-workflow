import { NextResponse } from "next/server";
import type { FieldItem, Stock } from "@/lib/field";
import { loadField, saveItems, saveStock } from "@/server/field-store";
import { demoUser, handle, writesBlocked } from "@/server/guard";

/** Field activities state for a project. Names are included only for roles allowed to see them. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => NextResponse.json(await loadField(code, demoUser(req))));
}

/** Saves changed items and/or the store stock. */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const blocked = writesBlocked();
  if (blocked) return blocked;
  const { code } = await params;
  return handle(async () => {
    const body = (await req.json()) as { items?: FieldItem[]; stock?: Stock };
    if (body.items?.length) await saveItems(code, body.items);
    if (body.stock) await saveStock(code, body.stock);
    return NextResponse.json({ ok: true });
  });
}
