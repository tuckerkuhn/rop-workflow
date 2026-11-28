import { fileStoresFor, orgIdForPerson } from "@/server/org-settings-store";
import { NextResponse } from "next/server";
import { authConfigured, demoMode, getViewer, people, roleHolders } from "@/server/auth";
import { handle } from "@/server/guard";
import { planDetails } from "@/server/plans";
import { proposalMenuMap } from "@/server/funding-proposals-store";
import { requestOnlyReads } from "@/server/request-memo";
import { ratesNow } from "@/server/fx-store";

/**
 * Who holds each role type, from the HR record, with anyone acting for an away holder beside them
 * (lib/delegation). Names of roles are not secret; pay and records are not included.
 */
const authority = () => roleHolders().catch(() => ({}));

/**
 * What the browser needs to start: the sign-in mode, who is signed in (live mode), and the
 * people directory used to name owners and colleagues, and the organization's plan.
 */
export async function GET(req: Request) {
  return handle(async () => {
    // Only reads: the directory, the HR record and the settings are each read once for the whole answer (server/request-memo).
    requestOnlyReads();
    if (demoMode()) {
      const [list, plan, fileStores, holders, proposalAccess, fx] = await Promise.all([
        people(),
        planDetails(null),
        fileStoresFor("", null),
        authority(),
        orgIdForPerson("")
          .catch(() => null)
          .then((org) => proposalMenuMap(org)),
        ratesNow(),
      ]);
      return NextResponse.json({ mode: "demo", configured: true, user: null, actor: null, viewingAs: false, people: list, ...plan, fileStores, authority: holders, proposalAccess, fxRates: fx.rates });
    }
    if (!authConfigured()) return NextResponse.json({ mode: "live", configured: false, user: null, actor: null, viewingAs: false, people: [], plan: "free" });
    const v = await getViewer(req);
    if (!v) return NextResponse.json({ mode: "live", configured: true, user: null, actor: null, viewingAs: false, people: [], plan: "free" });
    // The second step still to do: say so, and nothing more.
    if (v.twoStep) return NextResponse.json({ mode: "live", configured: true, user: null, actor: null, viewingAs: false, people: [], plan: "free", twoStep: v.twoStep, email: v.user.name });
    const [list, plan, fileStores, holders, proposalAccess] = await Promise.all([
      people(),
      planDetails(v),
      fileStoresFor(v.user.id, v.organizationId),
      authority(),
      // The signed-in person's organization (live mode always knows it; the lookup is the old fallback).
      (v.organizationId ? Promise.resolve(v.organizationId) : orgIdForPerson(v.user.id).catch(() => null)).then((org) => proposalMenuMap(org, v.user.id)),
    ]);
    // The signed-in person carries the same reporting line as the directory (server/reporting-line).
    const lined = <U extends { id: string; reportsTo?: string }>(u: U): U => ({ ...u, reportsTo: list.find((p) => p.id === u.id)?.reportsTo ?? u.reportsTo });
    const fx = await ratesNow();
    return NextResponse.json({ mode: "live", configured: true, user: lined(v.user), actor: lined(v.actor), viewingAs: v.viewingAs, people: list, ...plan, fileStores, authority: holders, proposalAccess, fxRates: fx.rates });
  });
}
