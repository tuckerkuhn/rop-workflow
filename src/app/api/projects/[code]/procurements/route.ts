import { NextResponse } from "next/server";
import { z } from "zod";
import type { Procurement } from "@/lib/procurement";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { loadProcurements, saveProcurements } from "@/server/procurement-store";

/** The project's procurements. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.procurementAccess !== "none" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ items: await loadProcurements(code) });
  });
}

const bodySchema = z.object({
  items: z.array(z.object({ id: z.string().regex(/^[A-Z0-9-]{3,40}$/), step: z.string().min(1), title: z.string() }).passthrough()).max(200),
});

/** Saves the procurements that changed. */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.procurementAccess === "edit", why: "You can view Procurement but not change it." });
    if (v instanceof NextResponse) return v;
    const parsed = bodySchema.safeParse(await req.json());
    if (!parsed.success) return NextResponse.json({ error: "That procurement could not be saved: the record is incomplete." }, { status: 400 });
    await saveProcurements(code, parsed.data.items as unknown as Procurement[]);
    return NextResponse.json({ ok: true });
  });
}
