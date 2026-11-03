import { NextResponse } from "next/server";
import { isMelOwner, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { pushFarmerList } from "@/server/kobo";

/** Uploads farmers.csv to the readiness form as media and redeploys it. */
export async function POST(req: Request) {
  const code = new URL(req.url).searchParams.get("project") ?? "A-2027";
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => isMelOwner(u) || u.field.includes("manager"), why: "Only MEL or the project manager can update the farmer list on Kobo." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await pushFarmerList(code));
  });
}
