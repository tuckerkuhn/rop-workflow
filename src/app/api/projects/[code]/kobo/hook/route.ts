/**
 * Automatic sync. KoboToolbox calls this from each linked form's REST Service
 * (Form > Settings > REST Services) whenever a submission arrives.
 *
 * Each project's link has its own password (HTTP Basic auth), made in Setup and stored only as a
 * hash, so one leaked password exposes one project and can be replaced without touching others.
 * The call only triggers the project's normal sync; the posted body is used only to ignore
 * forms that are not linked to the project.
 */
import { NextResponse } from "next/server";
import { koboToResults } from "@/server/kobo-results";
import { handle } from "@/server/guard";
import { hookAllowed, isProjectForm, sync } from "@/server/kobo-link";

export const maxDuration = 60;

export async function POST(req: Request, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return handle(async () => {
    if (!(await hookAllowed(code, req.headers.get("authorization")))) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const body = (await req.json().catch(() => null)) as { _xform_id_string?: unknown } | null;
    const form = typeof body?._xform_id_string === "string" ? body._xform_id_string : undefined;
    if (!(await isProjectForm(code, form))) return NextResponse.json({ ok: true, ignored: "form not linked to this project" });

    try {
      const result = await sync(code);
      return NextResponse.json({ ok: true, result, results: await koboToResults(code) });
    } catch (e) {
      // Not a 2xx, so KoboToolbox retries later.
      console.error(e);
      return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
    }
  });
}
