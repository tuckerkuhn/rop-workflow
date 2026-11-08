import { NextResponse } from "next/server";
import { oppAction } from "@/lib/opportunities";
import { requireViewer } from "@/server/auth";
import { DraftingUnavailable } from "@/server/ai-drafts";
import { handle } from "@/server/guard";
import { aiAllowed } from "@/server/limits";
import { actOnOpportunity, loadOpportunities } from "@/server/opportunities-store";
import { orgIdForPerson } from "@/server/org-settings-store";

/** Develop: opportunities and their match calls, for the whole organization. Staff only. */
async function org(personId: string) {
  const id = await orgIdForPerson(personId);
  if (!id) throw new Error("No organization is set up yet.");
  return id;
}

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: "Opportunities are for staff." });
    if (v instanceof NextResponse) return v;
    return NextResponse.json(await loadOpportunities(await org(v.user.id), v.user));
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: "Opportunities are for staff." });
    if (v instanceof NextResponse) return v;
    const parsed = oppAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    if (parsed.data.action === "brief") {
      const limit = await aiAllowed(v.user.id);
      if (limit) return limit;
    }
    const orgId = await org(v.user.id);
    try {
      const why = await actOnOpportunity(orgId, parsed.data, v.user);
      if (why) return NextResponse.json({ error: why }, { status: 409 });
    } catch (e) {
      if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
      throw e;
    }
    return NextResponse.json(await loadOpportunities(orgId, v.user));
  });
}
