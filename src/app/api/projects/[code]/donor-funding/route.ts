import { NextResponse } from "next/server";
import { z } from "zod";
import { canEditProject, type AppUser } from "@/lib/demo";
import { donorFundingSchema } from "@/lib/donor-funding";
import { requireViewer } from "@/server/auth";
import { fundingSetup, saveDonorFunding } from "@/server/donor-view-store";
import { handle } from "@/server/guard";

const staff = (u: AppUser) => u.kind === "employee";
const input = donorFundingSchema.extend({ donorId: z.uuid() });

/** What each donor's grant pays for on this project, with the budget's lines to choose from. For staff. */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: staff, why: "What each donor funds is set by Roots of Peace staff." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await fundingSetup(code));
  });
}

/** Sets what one donor's grant pays for: the whole budget or chosen lines, and its cost-share lines. */
export async function PUT(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only the project manager and plan approvers can change donors." });
    if (v instanceof NextResponse) return v;
    const parsed = input.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid request." }, { status: 400 });
    const refused = await saveDonorFunding(code, parsed.data.donorId, { lines: parsed.data.lines, share: parsed.data.share }, v.user.id);
    return refused ? NextResponse.json({ error: refused }, { status: 400 }) : NextResponse.json({ ok: true });
  });
}
