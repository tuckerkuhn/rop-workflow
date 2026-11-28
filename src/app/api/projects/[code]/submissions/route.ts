import { NextResponse } from "next/server";
import { deciderNames, fieldRec, maySendBack, refusalFor } from "@/lib/kobo-approval";
import { gpsCheck, type Submission } from "@/lib/project";
import { isEmployee, onProject, people, requireViewer } from "@/server/auth";
import { roster } from "@/server/field-store";
import { handle } from "@/server/guard";
import { koboApprovalFor } from "@/server/kobo-approval";
import { listSubmissions } from "@/server/kobo";
import { selectionHold } from "@/lib/selection";
import { selectionOutcomes } from "@/server/selection-store";

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
    // Field data, from KoboCollect or a form filled in here, goes to the project's named approver.
    const rec = (s: Submission) => fieldRec({ source: s.source, by: s.enumerator }, rule, team);
    // `maySendBack`: the technical lead may send a field form back with a note, without accepting it.
    // Farmers left open on an accepted session record: what holds each one today (nothing, once they are selected).
    const outcomes = submissions.some((s) => s.held?.length) ? await selectionOutcomes(project.id) : null;
    const withHeld = (s: Submission): Submission => (s.held?.length ? { ...s, held: s.held.map((h) => ({ id: h.id, ...(selectionHold(outcomes, h.id) ? { why: selectionHold(outcomes, h.id)! } : {}) })) } : s);
    const annotated = submissions.map(withHeld).map((s) => {
      const mayDecide = !refusalFor(v.user, team, rec(s), rule);
      // The person, not the account: a KoboCollect account matched to someone on the team is shown by their name.
      const who = team.find((p) => p.id === rec(s).collector)?.name;
      return { ...s, mayDecide, maySendBack: !mayDecide && maySendBack(v.user, team, { ...rec(s), form: s.form }), deciders: deciderNames(team, rec(s), rule), ...(who ? { collectorName: who } : {}), ...(v.user.pii ? {} : { gps: null, gpsCheck: gpsCheck(s.gps) }) };
    });
    return NextResponse.json({ submissions: annotated, roster: await roster(project.id) });
  });
}
