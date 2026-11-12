import { NextResponse } from "next/server";
import { grantAction } from "@/lib/grants";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { actOnGrant, loadGrants } from "@/server/grants-store";

type Ctx = { params: Promise<{ code: string }> };
const why = "Grants are for staff.";

/** The project's agribusiness grants (lib/grants.ts). */
export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee, why });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadGrants(code, v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee, why });
    if (v instanceof NextResponse) return v;
    const parsed = grantAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const refused = await actOnGrant(code, parsed.data, v.user);
    if (refused) return NextResponse.json({ error: refused, view: await loadGrants(code, v.user) }, { status: 409 });
    return NextResponse.json(await loadGrants(code, v.user));
  });
}
