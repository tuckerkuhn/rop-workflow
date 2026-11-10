import { NextResponse } from "next/server";
import { inOwnOrganization, isMelOwner, NO_PROJECT, onProject, requireViewer } from "@/server/auth";
import { audit, handle } from "@/server/guard";
import { pushFarmerList } from "@/server/kobo";
import { readable } from "@/server/kobo-link";

/** Uploads farmers.csv to the project's readiness form(s) as media and redeploys. */
export async function POST(req: Request) {
  const code = new URL(req.url).searchParams.get("project") ?? "A-2027";
  return handle(async () => {
    const v = await requireViewer(req, { write: true, allow: (u) => isMelOwner(u) || u.field.includes("manager"), why: "Only MEL or the project manager can update the farmer list on Kobo." });
    if (v instanceof NextResponse) return v;
    // The project comes from ?project=, which the path-based check in requireViewer does not see.
    if (!onProject(v.user, code)) return NextResponse.json({ error: "You do not work on this project." }, { status: 403 });
    if (!(await inOwnOrganization(v, code))) return NextResponse.json({ error: NO_PROJECT(code) }, { status: 404 });
    return readable(async () => {
      const sent = await pushFarmerList(code);
      // The farmer list left the app for KoboToolbox: on the record, without the list itself.
      await audit(code, { entity: "kobo", entityId: crypto.randomUUID(), action: "kobo_farmer_list_sent", by: v.user.id });
      return NextResponse.json(sent);
    });
  });
}
