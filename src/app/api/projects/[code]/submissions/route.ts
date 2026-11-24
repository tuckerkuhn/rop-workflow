import { NextResponse } from "next/server";
import { collectorOf, deciderNames, maySendBack, refusalFor } from "@/lib/kobo-approval";
import type { Submission } from "@/lib/project";
import { isEmployee, onProject, people, requireViewer } from "@/server/auth";
import { roster } from "@/server/field-store";
import { handle } from "@/server/guard";
import { koboApprovalFor } from "@/server/kobo-approval";
import { listSubmissions } from "@/server/kobo";

/**
 * The review queue: field forms (KoboCollect and sample records) with the farmer roster for the data
 * checker. Each record says whether the viewer may decide it and who does, by the same rule the
 * decision route applies (lib/kobo-approval).
 */
export async function GET(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    const v = await requireViewer(req, { allow: isEmployee });
    if (v instanceof NextResponse) return v;
    const { project, submissions } = await listSubmissions(code);
    const rule = await koboApprovalFor(code);
    const team = (await people()).filter((p) => onProject(p, code));
    const rec = (s: Submission) => {
      const fromKobo = s.source === "kobo";
      return { fromKobo, collector: fromKobo ? collectorOf(s.enumerator, rule, team) : s.enumerator };
    };
    // `maySendBack`: the technical lead may send a field form back with a note, without accepting it.
    const annotated = submissions.map((s) => {
      const mayDecide = !refusalFor(v.user, team, rec(s), rule);
      return { ...s, mayDecide, maySendBack: !mayDecide && maySendBack(v.user, team, { ...rec(s), form: s.form }), deciders: deciderNames(team, rec(s), rule) };
    });
    return NextResponse.json({ submissions: annotated, roster: await roster(project.id) });
  });
}
