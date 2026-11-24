import { NextResponse } from "next/server";
import { reviewAction } from "@/lib/internal-review";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { actOnReview, loadBook, maySee, reviewView } from "@/server/internal-review-store";
import { orgIdForPerson } from "@/server/org-settings-store";

/**
 * The quarterly internal review (lib/internal-review): for administrators and the four people it
 * names (the lead, the independent reviewer, the country office's focal point and the CEO).
 */
async function org(personId: string) {
  const id = await orgIdForPerson(personId);
  if (!id) throw new Error("No organization is set up yet.");
  return id;
}

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "The internal review is for staff." });
    if (v instanceof NextResponse) return v;
    const orgId = await org(v.user.id);
    const book = await loadBook(orgId);
    if (!maySee(v.user, book.roles)) return NextResponse.json({ error: "The internal review is open to administrators and the people it names." }, { status: 403 });
    return NextResponse.json(await reviewView(orgId, v.user));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: "The internal review is for staff." });
    if (v instanceof NextResponse) return v;
    const parsed = reviewAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    const orgId = await org(v.user.id);
    const why = await actOnReview(orgId, parsed.data, v.user);
    if (why) return NextResponse.json({ error: why }, { status: 409 });
    return NextResponse.json(await reviewView(orgId, v.user));
  });
}
