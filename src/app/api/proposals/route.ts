import { NextResponse } from "next/server";
import { proposalAction } from "@/lib/funding-proposals";
import { DraftingUnavailable } from "@/server/ai-drafts";
import { requireViewer } from "@/server/auth";
import { actOnProposal, loadProposals } from "@/server/funding-proposals-store";
import { handle } from "@/server/guard";
import { aiAllowed } from "@/server/limits";
import { orgIdForPerson } from "@/server/org-settings-store";

/**
 * Proposals, for the whole organization. Open to the organization's core (the role types and
 * people it names to start proposals); a contributor added to a proposal sees that one. Anyone
 * else gets the same answer as if there were none: what exists is not shown.
 */
const NOT_FOR_YOU = "Proposals are open to the people your organization has named to start them, and to anyone added to a proposal.";

async function org(personId: string) {
  const id = await orgIdForPerson(personId);
  if (!id) throw new Error("No organization is set up yet.");
  return id;
}

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee", why: NOT_FOR_YOU });
    if (v instanceof NextResponse) return v;
    const view = await loadProposals(await org(v.user.id), v.user);
    return view ? NextResponse.json(view) : NextResponse.json({ error: NOT_FOR_YOU }, { status: 403 });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => u.kind === "employee", why: NOT_FOR_YOU });
    if (v instanceof NextResponse) return v;
    const orgId = await org(v.user.id);
    // Checked before the body is read: someone outside learns nothing from how a request fails.
    if (!(await loadProposals(orgId, v.user))) return NextResponse.json({ error: NOT_FOR_YOU }, { status: 403 });
    const parsed = proposalAction.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "That is not complete." }, { status: 400 });
    if (parsed.data.action === "assess" || parsed.data.action === "plan") {
      const limit = await aiAllowed(v.user.id);
      if (limit) return limit;
    }
    try {
      const why = await actOnProposal(orgId, parsed.data, v.user);
      if (why) return NextResponse.json({ error: why }, { status: 409 });
    } catch (e) {
      if (e instanceof DraftingUnavailable) return NextResponse.json({ error: e.message }, { status: 503 });
      throw e;
    }
    return NextResponse.json(await loadProposals(orgId, v.user));
  });
}
