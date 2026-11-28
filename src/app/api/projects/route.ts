import { NextResponse } from "next/server";
import { canEditProject } from "@/lib/demo";
import { originChoice } from "@/lib/project-origin";
import { projectDesignSchema } from "@/lib/project-setup";
import { fundedBy, onProject, requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { handRecordedCounts } from "@/server/target-counts";
import { orgIdForPerson, sampleOf } from "@/server/org-settings-store";
import { createProject, listProjects } from "@/server/project-store";
import { checkOrigin, linkOrigin } from "@/server/project-origin";
import { projectsWithField } from "@/server/field-store";

/** Projects in the database, for the project picker. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    // Everything read side by side.
    const [hand, withField, sample, funded, all] = await Promise.all([
      // Only the projects this person works on, each with how many indicators take results by hand.
      handRecordedCounts(),
      projectsWithField(),
      // The sample (C5): this organization's own, unless an administrator has hid it. A signed-in
      // person's organization is known from sign-in; the lookup remains for the demo cast.
      (async () => {
        const orgId = v.organizationId ?? (await orgIdForPerson(v.user.id));
        return orgId ? sampleOf(orgId) : null;
      })(),
      // A donor sees only the projects their organization funds: never the training sample or anyone else's grant.
      v.user.kind === "donor" ? fundedBy(v.user.org) : null,
      listProjects({ all: true }),
    ]);
    const shown = (p: { code: string; kind: string }) => (funded ? funded.has(p.code) : p.kind !== "sample" || (!!sample && !sample.hidden && sample.code === p.code));
    return NextResponse.json({ projects: all.filter((p) => shown(p) && onProject(v.user, p.code)).map((p) => ({ ...p, handRecorded: hand.get(p.code) ?? 0, field: withField.has(p.code) })) });
  });
}

/** Creates a project from setup. */
export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: canEditProject, why: "Only project managers and plan approvers can create projects." });
    if (v instanceof NextResponse) return v;
    const body = (await req.json().catch(() => null)) as { origin?: unknown } | null;
    const parsed = projectDesignSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Invalid project." }, { status: 400 });
    // Set up from a won proposal (lib/project-origin): checked before the project is made, linked after.
    const from = body?.origin ? originChoice.safeParse(body.origin) : null;
    if (from && !from.success) return NextResponse.json({ error: from.error.issues[0]?.message ?? "Invalid proposal." }, { status: 400 });
    const orgId = from ? (v.organizationId ?? (await orgIdForPerson(v.user.id))) : null;
    if (from && !orgId) return NextResponse.json({ error: "No organization is set up yet." }, { status: 404 });
    const refused = from && orgId ? await checkOrigin(orgId, from.data!, v.user) : null;
    if (refused) return NextResponse.json({ error: refused }, { status: 409 });
    const code = await createProject(parsed.data);
    await audit(code, { entity: "project", entityId: crypto.randomUUID(), action: "project_created", by: v.user.id, detail: { name: parsed.data.name, startDate: parsed.data.startDate, endDate: parsed.data.endDate, indicators: parsed.data.indicators.length, donors: parsed.data.donors ?? [] } });
    const unlinked = from && orgId ? await linkOrigin(orgId, code, from.data!, v.user) : null;
    // The project stands either way; say plainly if someone else linked the proposal in the meantime.
    return NextResponse.json({ code, ...(unlinked ? { warning: `The project was created, but not linked to the proposal: ${unlinked}` } : {}) }, { status: 201 });
  });
}
