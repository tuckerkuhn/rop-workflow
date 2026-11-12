import { NextResponse } from "next/server";
import { isEmployee, requireViewer } from "@/server/auth";
import { grantBoard } from "@/server/boards-store";
import { handle } from "@/server/guard";

/** Grants in every project the person works on, for the all-projects board. Staff only. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee, why: "Grants are for staff." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await grantBoard(v, v.user));
  });
}
