import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { FundingProposal } from "@/lib/funding-proposals";
import { NO_BUDGET } from "@/lib/funding-proposals";
import type { Opportunity } from "@/lib/opportunities";
import { ORIGIN_KEY, type ProjectOrigin } from "@/lib/project-origin";

/**
 * Where the demo project came from, so the whole chain can be shown: a fictional funding call
 * (an opportunity), the proposal written for it, marked won, and the project set up from it
 * (project_state `origin`, the proposal's projectCode). Added to the organization's lists only when
 * missing, by fixed ids: real opportunities and proposals are never touched.
 */

export const DEMO_OPPORTUNITY_ID = "OPP-DEMO01";
export const DEMO_PROPOSAL_ID = "PRP-DEMO01";
const CODE = "A-2027";
const DONOR = "Demo Foundation (fictional)";
const TITLE = "Maize productivity and market access for smallholders, Village B (fictional call)";
const THEMES = ["Twenty years of farmer training in the region", "Field team already in Village B", "Inputs reach women farmers directly"];

const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

async function orgDoc<T>(organizationId: string, key: string, empty: T): Promise<T> {
  const [row] = await db.select().from(s.organizationState).where(and(eq(s.organizationState.organizationId, organizationId), eq(s.organizationState.key, key))).limit(1);
  return { ...empty, ...((row?.data as Partial<T>) ?? {}) };
}
async function saveOrgDoc(organizationId: string, key: string, data: unknown) {
  await db
    .insert(s.organizationState)
    .values({ organizationId, key, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}

/** `today` is the demo's today; the call was won about four months before it. */
export async function seedDemoOrigin(projectId: string, organizationId: string, today: string) {
  const won = addDays(today, -120);
  const submitted = addDays(today, -160);
  const history = (what: string, at: string) => ({ at, by: "tucker", byName: "Tucker Kuhn", what });

  const opps = await orgDoc<{ items: Opportunity[] }>(organizationId, "opportunities", { items: [] });
  if (!opps.items.some((o) => o.id === DEMO_OPPORTUNITY_ID)) {
    const o: Opportunity = {
      id: DEMO_OPPORTUNITY_ID,
      title: TITLE,
      donor: DONOR,
      source: "Donor call",
      link: "",
      country: "Afghanistan",
      deadline: addDays(today, -165),
      value: 346200,
      currency: "USD",
      need: "Smallholder maize yields in Village B are low; farmers sell at harvest at the lowest price.",
      donorPriorities: "Higher net farm income, women reached directly, and a market link that lasts beyond the grant.",
      capacity: "Field team already in the village, a storekeeper and an MEL officer.",
      risks: "Late input delivery before planting; security on market days.",
      grossIncome: "",
      notes: "Sample record for the demo: a fictional call.",
      funderContact: "Programme officer call before submission (fictional).",
      documents: [],
      brief: null,
      status: "designing",
      decision: { match: true, reason: "Fits our maize work and the team is already in Village B.", by: "tucker", byName: "Tucker Kuhn", at: addDays(today, -175) },
      projectCode: CODE,
      history: [history("Recorded", addDays(today, -180)), history("Match: fits our maize work and the team is already in Village B.", addDays(today, -175)), history(`Design started as ${CODE}`, won)],
    };
    await saveOrgDoc(organizationId, "opportunities", { ...opps, items: [...opps.items, o] });
  }

  const props = await orgDoc<{ items: FundingProposal[] }>(organizationId, "funding-proposals", { items: [] });
  if (!props.items.some((p) => p.id === DEMO_PROPOSAL_ID)) {
    const p: FundingProposal = {
      id: DEMO_PROPOSAL_ID,
      opportunityId: DEMO_OPPORTUNITY_ID,
      title: TITLE.replace(" (fictional call)", ""),
      donor: DONOR,
      portal: "",
      folder: "",
      currency: "USD",
      deadline: { at: `${addDays(today, -165)}T17:00`, zone: "Asia/Kabul" },
      targets: [],
      themes: THEMES,
      rules: [],
      budget: { ...NO_BUDGET, ceiling: 346200, total: 346200 },
      team: [],
      outside: [],
      items: [],
      outcome: "won",
      confirmation: "",
      history: [history("Started from the opportunity", addDays(today, -174)), history("Submitted", submitted), history("Won", won), history(`Set up as ${CODE}`, won)],
      decidedAt: won,
      projectCode: CODE,
    };
    await saveOrgDoc(organizationId, "funding-proposals", { ...props, items: [...props.items, p] });
  }

  const origin: ProjectOrigin = {
    proposalId: DEMO_PROPOSAL_ID,
    opportunityId: DEMO_OPPORTUNITY_ID,
    title: TITLE.replace(" (fictional call)", ""),
    donor: DONOR,
    winThemes: THEMES,
    documents: [],
    decidedAt: won,
    currency: "USD",
    ceiling: 346200,
    by: "tucker",
    at: `${won}T12:00:00.000Z`,
  };
  await db
    .insert(s.projectState)
    .values({ projectId, key: ORIGIN_KEY, data: origin })
    .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data: origin, updatedAt: new Date() } });
}
