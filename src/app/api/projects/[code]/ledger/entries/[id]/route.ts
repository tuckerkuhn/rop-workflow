import { NextResponse } from "next/server";
import { guard, handle } from "@/server/guard";
import { entryView } from "@/server/ledger-view";

type Ctx = { params: Promise<{ code: string; id: string }> };

/** One entry of this project with what it wrote, line by line (staff on the project). */
export async function GET(req: Request, { params }: Ctx) {
  const { code, id } = await params;
  return handle(async () => {
    const v = await guard(req, { allow: (u) => u.kind === "employee" });
    return NextResponse.json(await entryView(code, id, v.user));
  }, "ledger");
}
