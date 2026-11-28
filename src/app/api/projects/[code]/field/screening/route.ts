import { NextResponse } from "next/server";
import { farmerScreeningInput } from "@/lib/farmer-screening";
import { requireViewer } from "@/server/auth";
import { mayScreenFarmers, screenFarmer } from "@/server/farmer-screening";
import { handle, readBody } from "@/server/guard";

/** Records a farmer's sanctions screening (MF-04): needed before a package above the limit goes out. */
export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code: raw } = await params;
  const code = decodeURIComponent(raw);
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => mayScreenFarmers(u, code), why: "Only staff who may see farmers' names and record field work screen a farmer: the check is made by name." });
    if (v instanceof NextResponse) return v;
    const b = await readBody(req, farmerScreeningInput, "Give the date, the lists checked and the result.");
    await screenFarmer(code, b, v.user);
    return NextResponse.json({ ok: true });
  });
}
