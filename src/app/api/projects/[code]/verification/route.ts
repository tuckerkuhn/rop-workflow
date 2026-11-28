import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/server/auth";
import { handle, readBody } from "@/server/guard";
import { drawThisMonth, recordVisit, verificationView } from "@/server/verification-store";

/** The monthly verification sample (MF-10): staff on the project see it; MEL draws; the assignee records the visit. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await verificationView(code, v.user), { headers: { "Cache-Control": "private, no-store" } });
  });
}

const body = z.union([
  z.object({ action: z.literal("draw") }),
  z.object({ action: z.literal("visit"), month: z.string().regex(/^\d{4}-\d{2}$/), farmer: z.string().min(1).max(40), result: z.enum(["confirmed", "discrepancy"]), note: z.string().trim().min(5, "Say what you saw.").max(1000) }),
]);

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee" });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, body, "That is not complete.");
    if (b.action === "draw") await drawThisMonth(code, v.user);
    else await recordVisit(code, b.month, b.farmer, b.result, b.note, v.user);
    return NextResponse.json(await verificationView(code, v.user));
  });
}
