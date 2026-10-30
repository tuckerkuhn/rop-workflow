import { NextResponse } from "next/server";
import { handle, writesBlocked } from "@/server/guard";
import { pushFarmerList } from "@/server/kobo";

/** Uploads farmers.csv to the readiness form as media and redeploys it. */
export async function POST(req: Request) {
  const blocked = writesBlocked();
  if (blocked) return blocked;
  const code = new URL(req.url).searchParams.get("project") ?? "A-2027";
  return handle(async () => NextResponse.json(await pushFarmerList(code)));
}
