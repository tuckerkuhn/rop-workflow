import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { orgIdForPerson } from "@/server/org-settings-store";
import { setupDefaults } from "@/server/project-origin";

/**
 * What setup opens with when a project comes from a won proposal (or a matched opportunity):
 * editable defaults read from the proposal and its opportunity. Nothing is saved here.
 */
const WHY = "Only the people who set up projects can set one up from a proposal.";

export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { allow: (u) => u.kind === "employee" && canEditProject(u), why: WHY });
    if (v instanceof NextResponse) return v;
    const orgId = v.organizationId ?? (await orgIdForPerson(v.user.id));
    if (!orgId) return NextResponse.json({ error: "No organization is set up yet." }, { status: 404 });
    const q = new URL(req.url).searchParams;
    const out = await setupDefaults(orgId, { proposalId: q.get("proposal"), opportunityId: q.get("opportunity") }, v.user);
    return typeof out === "string" ? NextResponse.json({ error: out }, { status: 409 }) : NextResponse.json(out);
  });
}
