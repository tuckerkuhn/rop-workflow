import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { FundingProposal, Item } from "@/lib/funding-proposals";
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

/**
 * What the sample proposal's team prepared and submitted: a fictional donor package, every item
 * final, owned by demo staff. Due days fall before the submission, `submitted` days before `today`.
 */
export function demoProposalItems(today: string): Item[] {
  const due = (n: number) => addDays(today, -160 - n);
  const item = (id: string, ref: string, title: string, owner: string, todo: string, final: string, upload: number | null, days: number, signer: string | null = null): Item => ({
    id,
    ref,
    title,
    kind: "checkbox",
    owner,
    signer,
    due: due(days),
    status: "final",
    todo,
    working: "",
    final,
    points: null,
    criteria: "",
    guidance: "",
    rating: null,
    upload,
    unchecked: false,
  });
  return [
    item("I001", "Section A", "Technical narrative", "karim", "Write the need, the approach in Village B, the results and how they are measured, in the donor's twelve pages.", "13.01", 1, 6, "marcus"),
    item("I002", "Annex 1", "Budget", "peter", "Complete the donor's budget form inside the ceiling, with the baseline survey and the audit included.", "13.02", 2, 5),
    item("I003", "Annex 2", "Budget notes", "peter", "Explain each budget line and how its cost was worked out.", "13.03", 3, 5),
    item("I004", "Annex 3", "Logframe", "omar", "Complete the donor's logframe: results, indicators, baselines, targets and assumptions, matching the narrative.", "13.04", 4, 4),
    item("I005", "Annex 4", "Registration certificate", "daniel", "Attach the current registration in the country of work.", "13.05", 5, 8),
    item("I006", "Annex 5", "Audited accounts, last two years", "omid", "Attach the audited accounts for the two years the call asks for.", "13.06", 6, 8),
    item("I007", "", "Upload and submit", "marcus", "Upload the files in order through the donor's portal, submit and save the confirmation of receipt.", "13.99", null, 0),
  ];
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
  const existing = props.items.find((p) => p.id === DEMO_PROPOSAL_ID);
  if (existing && !existing.items?.length) {
    // Saved before the sample had its checklist: fill it in place, so a demo reset shows it.
    await saveOrgDoc(organizationId, "funding-proposals", { ...props, items: props.items.map((p) => (p.id === DEMO_PROPOSAL_ID ? { ...p, items: demoProposalItems(today) } : p)) });
  }
  if (!existing) {
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
      items: demoProposalItems(today),
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
