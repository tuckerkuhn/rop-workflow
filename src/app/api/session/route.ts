import { NextResponse } from "next/server";
import { authConfigured, demoMode, getViewer, people } from "@/server/auth";
import { serverPlan } from "@/lib/plans";
import { handle } from "@/server/guard";

/**
 * What the browser needs to start: the sign-in mode, who is signed in (live mode), and the
 * people directory used to name owners and colleagues, and the organization's plan.
 */
export async function GET(req: Request) {
  return handle(async () => {
    const plan = serverPlan();
    if (demoMode()) return NextResponse.json({ mode: "demo", configured: true, user: null, actor: null, viewingAs: false, people: await people(), plan });
    if (!authConfigured()) return NextResponse.json({ mode: "live", configured: false, user: null, actor: null, viewingAs: false, people: [], plan });
    const v = await getViewer(req);
    if (!v) return NextResponse.json({ mode: "live", configured: true, user: null, actor: null, viewingAs: false, people: [], plan });
    return NextResponse.json({ mode: "live", configured: true, user: v.user, actor: v.actor, viewingAs: v.viewingAs, people: await people(), plan });
  });
}
