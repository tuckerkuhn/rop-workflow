import { NextResponse } from "next/server";
import { z } from "zod";
import { requireViewer } from "@/server/auth";
import { handle } from "@/server/guard";
import { getPrefs, itemsFor, setPrefs } from "@/server/notify-store";
import { orgIdForPerson } from "@/server/org-settings-store";

/** Your own daily email: whether it is on, when it was last sent, and what it would say today. */
export async function GET(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req);
    if (v instanceof NextResponse) return v;
    const org = await orgIdForPerson(v.actor.id);
    if (!org) return NextResponse.json({ error: "No organization." }, { status: 400 });
    const preview = new URL(req.url).searchParams.get("preview") === "1" ? await itemsFor(v.actor, new Date().toISOString().slice(0, 10)) : null;
    return NextResponse.json({ ...(await getPrefs(org, v.actor.id)), preview, configured: !!process.env.RESEND_API_KEY && !!process.env.CRON_SECRET });
  });
}

export async function POST(req: Request) {
  return handle(async () => {
    const v = await requireViewer(req, { write: true });
    if (v instanceof NextResponse) return v;
    const parsed = z.object({ off: z.boolean() }).safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Say on or off." }, { status: 400 });
    const org = await orgIdForPerson(v.actor.id);
    if (!org) return NextResponse.json({ error: "No organization." }, { status: 400 });
    await setPrefs(org, v.actor.id, parsed.data.off);
    return NextResponse.json(await getPrefs(org, v.actor.id));
  });
}
