import { NextResponse } from "next/server";
import { authConfigured, demoMode, getViewer, people } from "@/server/auth";
import { handle } from "@/server/guard";
import { planFor } from "@/server/plans";
import { loadHr } from "@/server/hr-store";

/** Who holds each role type, from the HR record. Names of roles are not secret; pay and records are not included. */
const authority = async () => (await loadHr().catch(() => null))?.state.rules?.holders ?? {};

/**
 * What the browser needs to start: the sign-in mode, who is signed in (live mode), and the
 * people directory used to name owners and colleagues, and the organization's plan.
 */
export async function GET(req: Request) {
  return handle(async () => {
    if (demoMode()) return NextResponse.json({ mode: "demo", configured: true, user: null, actor: null, viewingAs: false, people: await people(), plan: await planFor(null), authority: await authority() });
    if (!authConfigured()) return NextResponse.json({ mode: "live", configured: false, user: null, actor: null, viewingAs: false, people: [], plan: "free" });
    const v = await getViewer(req);
    if (!v) return NextResponse.json({ mode: "live", configured: true, user: null, actor: null, viewingAs: false, people: [], plan: "free" });
    // The second step still to do: say so, and nothing more.
    if (v.twoStep) return NextResponse.json({ mode: "live", configured: true, user: null, actor: null, viewingAs: false, people: [], plan: "free", twoStep: v.twoStep, email: v.user.name });
    return NextResponse.json({ mode: "live", configured: true, user: v.user, actor: v.actor, viewingAs: v.viewingAs, people: await people(), plan: await planFor(v), authority: await authority() });
  });
}
