import { NextResponse } from "next/server";
import { requireViewer } from "@/server/auth";
import { procurementBoard } from "@/server/boards-store";
import { handle } from "@/server/guard";
import { ROP } from "@/lib/policy";

/** Large procurements (and Medium ones with ?medium=1) in every project the person works on. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" && u.procurementAccess !== "none", why: "Procurement is not part of your role." });
    if (v instanceof NextResponse) return v;
    const medium = new URL(req.url).searchParams.get("medium") === "1";
    const limits = { large: Number(ROP.values.largeAboveUsd?.value ?? 25000), medium: Number(ROP.values.smallMaxUsd?.value ?? 5000) };
    return NextResponse.json({ ...(await procurementBoard(v, medium ? "Medium" : "Large")), limit: medium ? limits.medium : limits.large });
  });
}
