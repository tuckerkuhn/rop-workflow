import { NextResponse } from "next/server";
import { z } from "zod";
import { amountOf, blockers, monthsOf } from "@/lib/closeout";
import { TODAY } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { loadCloseouts, saveCloseouts } from "@/server/closeout-store";
import { handle } from "@/server/guard";
import { loadProcurements } from "@/server/procurement-store";

type Ctx = { params: Promise<{ code: string }> };

/** Months already closed. */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.procurementAccess !== "none" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ months: await loadCloseouts(code) });
  });
}

/** Finance closes a month once every voucher in it is filed in SharePoint and posted in NetSuite. */
export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.procurement.includes("finance") || !!u.admin, why: "Only Finance closes a month." });
    if (v instanceof NextResponse) return v;
    const parsed = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Say which month." }, { status: 400 });
    const { month } = parsed.data;
    if (month >= TODAY.slice(0, 7)) return NextResponse.json({ error: "A month closes after it ends." }, { status: 400 });
    const closeouts = await loadCloseouts(code);
    if (closeouts[month]) return NextResponse.json({ error: "That month is already closed." }, { status: 409 });
    const list = monthsOf(await loadProcurements(code)).find(([m]) => m === month)?.[1] ?? [];
    const open = blockers(list);
    if (open.length) return NextResponse.json({ error: `Not yet: ${open.join("; ")}.` }, { status: 409 });
    closeouts[month] = { by: v.user.id, name: v.user.name, at: TODAY, count: list.length, totalUsd: Math.round(list.reduce((s, p) => s + amountOf(p), 0) * 100) / 100 };
    await saveCloseouts(code, closeouts);
    return NextResponse.json({ months: closeouts });
  });
}
