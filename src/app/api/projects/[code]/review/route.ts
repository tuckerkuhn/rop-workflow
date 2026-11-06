import { NextResponse } from "next/server";
import { lastMonth, monthOk, reviewActionSchema } from "@/lib/monthly-review";
import { isEmployee, requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { actOnReview, loadReview } from "@/server/monthly-review-store";

type Ctx = { params: Promise<{ code: string }> };

/** The monthly review for ?month=2026-10 (default: last month). Staff see it; reviewers write and decide. */
const monthOf = (req: Request) => {
  const m = new URL(req.url).searchParams.get("month") ?? "";
  return monthOk.test(m) ? m : lastMonth(new Date().toISOString().slice(0, 10));
};

export async function GET(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadReview(code, monthOf(req), v.user));
  });
}

export async function POST(req: Request, { params }: Ctx) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const parsed = reviewActionSchema.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Check the form." }, { status: 400 });
    const month = monthOf(req);
    const error = await actOnReview(code, month, parsed.data, v.user);
    if (error) return NextResponse.json({ error }, { status: 400 });
    return NextResponse.json(await loadReview(code, month, v.user));
  });
}
