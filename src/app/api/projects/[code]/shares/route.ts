import { NextResponse } from "next/server";
import { z } from "zod";
import type { AppUser } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { createShare, loadShares, revokeShare } from "@/server/share-store";

/** Read-only links to a quarter's report, for the donor. The MEL owner and programme leads make and withdraw them. */

const mayShare = (u: AppUser) => u.kind === "employee" && (u.admin || u.project.some((r) => ["mel-owner", "report-release", "plan-approver", "monthly-review"].includes(r)));
const body = z.discriminatedUnion("action", [z.object({ action: z.literal("create"), quarter: z.string().regex(/^\d{4}-Q[1-4]$/) }), z.object({ action: z.literal("revoke"), token: z.string().min(10).max(80) })]);

async function list(code: string, quarter: string | null) {
  return (await loadShares(code)).filter((s) => !quarter || s.quarter === quarter).map((s) => ({ ...s, active: !s.revoked && s.expires > new Date().toISOString() }));
}

export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: mayShare, why: "Only the MEL owner and programme leads share reports." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json({ shares: await list(code, new URL(req.url).searchParams.get("q")) });
  });
}

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: mayShare, why: "Only the MEL owner and programme leads share reports." });
    if (v instanceof NextResponse) return v;
    const parsed = body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Check the request." }, { status: 400 });
    const a = parsed.data;
    if (a.action === "create") {
      const s = await createShare(code, a.quarter, v.user.id);
      return NextResponse.json({ shares: await list(code, a.quarter), created: s.token });
    }
    if (!(await revokeShare(code, a.token, v.user.id))) return NextResponse.json({ error: "No such link, or it is already withdrawn." }, { status: 404 });
    return NextResponse.json({ shares: await list(code, null) });
  });
}
