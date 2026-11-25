import { and, eq, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import { canEditProject, type AppUser } from "@/lib/demo";
import { OUTCOME_LABEL, type FundingProposal } from "@/lib/funding-proposals";
import type { Opportunity } from "@/lib/opportunities";
import { againstCeiling, ORIGIN_KEY, type CeilingCheck, type OriginChoice, type ProjectOrigin, type SetupDefaults } from "@/lib/project-origin";
import { COUNTRIES } from "@/lib/project-setup";
import { logAudit } from "@/server/audit";
import { projectByCode } from "@/server/field-store";
import { loadProjectStateRaw } from "@/server/project-state";

/**
 * A won proposal becomes the project (lib/project-origin). Setup opens with what the proposal and
 * its opportunity already hold, for the person to confirm; nothing is created until they save it.
 * Saving writes the project's `origin` and puts the project's code on the proposal (and on its
 * opportunity), so each side links to the other. Allowed to the people who may set up projects.
 */

const today = () => new Date().toISOString().slice(0, 10);
const NOT_ALLOWED = "Only the people who set up projects can set one up from a proposal.";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Q = Tx | typeof db;

async function readOrg<T>(orgId: string, key: string, q: Q = db, lock = false): Promise<{ items: T[] }> {
  const where = and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, key));
  const query = q.select().from(s.organizationState).where(where).limit(1);
  const [row] = lock ? await query.for("update") : await query;
  return { items: [], ...((row?.data as { items?: T[] }) ?? {}) } as { items: T[] };
}
async function writeOrg(orgId: string, key: string, data: unknown, q: Q) {
  await q.update(s.organizationState).set({ data, updatedAt: new Date() }).where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, key)));
}

/** The day a proposal was recorded as won: kept since this change, else read from its history. */
const wonOn = (p: FundingProposal) => p.decidedAt ?? [...p.history].reverse().find((h) => h.what.startsWith(OUTCOME_LABEL.won))?.at ?? null;

/** A country named in the opportunity's free text, when exactly one of setup's countries is. */
function countryOf(text: string): string | null {
  if (!text.trim()) return null;
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  // A code only in capitals ("US", not "us"); a name in any case.
  const found = COUNTRIES.filter((c) => new RegExp(`\\b${c}\\b`).test(text) || text.toLowerCase().includes((names.of(c) ?? c).toLowerCase()));
  return found.length === 1 ? found[0] : null;
}

type Source = { proposal: FundingProposal | null; opportunity: Opportunity | null };

/**
 * The proposal (or matched opportunity) a project would come from, or why it cannot. An
 * opportunity whose proposal is won is the same as that proposal: one entry, never two.
 */
async function source(orgId: string, from: { proposalId?: string | null; opportunityId?: string | null }, u: AppUser, q: Q = db, lock = false): Promise<Source | string> {
  if (u.kind !== "employee" || !canEditProject(u)) return NOT_ALLOWED;
  const [props, opps] = [await readOrg<FundingProposal>(orgId, "funding-proposals", q, lock), await readOrg<Opportunity>(orgId, "opportunities", q, lock)];
  let proposal = from.proposalId ? (props.items.find((p) => p.id === from.proposalId) ?? null) : null;
  if (from.proposalId && !proposal) return "No such proposal.";
  if (!proposal && from.opportunityId) proposal = props.items.find((p) => p.opportunityId === from.opportunityId) ?? null;
  const opportunity = opps.items.find((o) => o.id === (proposal?.opportunityId ?? from.opportunityId)) ?? null;
  if (proposal) {
    if (proposal.outcome !== "won") return `${proposal.title} is not recorded as won yet. Set the project up once the award comes.`;
    if (proposal.projectCode) return `${proposal.title} is already set up as ${proposal.projectCode}.`;
    return { proposal, opportunity };
  }
  if (!opportunity) return "No such opportunity.";
  if (opportunity.status !== "match") return opportunity.projectCode ? `${opportunity.title} is already set up as ${opportunity.projectCode}.` : "Only a matched opportunity is set up as a project.";
  return { proposal: null, opportunity };
}

/** What setup opens with. Editable defaults only: nothing is saved here. */
export async function setupDefaults(orgId: string, from: { proposalId?: string | null; opportunityId?: string | null }, u: AppUser): Promise<SetupDefaults | string> {
  const src = await source(orgId, from, u);
  if (typeof src === "string") return src;
  const { proposal: p, opportunity: o } = src;
  const ceiling = p ? (p.budget.ceiling ?? p.budget.total ?? o?.value ?? null) : (o?.value ?? null);
  const country = countryOf(o?.country ?? "");
  const decided = p ? wonOn(p) : (o?.decision?.at ?? null);
  const missing = [
    "The project's start and end dates: the proposal does not hold the project period. Take them from the award letter.",
    ...(country ? [] : ["The country: choose it in its step."]),
    ...(ceiling === null ? ["The award ceiling: neither the proposal nor its opportunity gives one."] : []),
  ];
  return {
    proposalId: p?.id ?? null,
    opportunityId: o?.id ?? null,
    title: p?.title ?? o!.title,
    name: p?.title ?? o!.title,
    donor: p?.donor ?? o!.donor,
    currency: (p?.currency || o?.currency || "USD").toUpperCase(),
    ceiling,
    startDate: decided,
    country,
    winThemes: p?.themes ?? [],
    documents: o?.documents?.length ?? 0,
    missing,
  };
}

/** Checked before the project is created, so a refusal never leaves a project half made. */
export async function checkOrigin(orgId: string, choice: OriginChoice, u: AppUser): Promise<string | null> {
  const src = await source(orgId, choice, u);
  return typeof src === "string" ? src : null;
}

/**
 * Links the new project and the record it came from both ways, then logs it. Read again with the
 * rows locked, so two people saving from the same proposal at once cannot both link it.
 */
export async function linkOrigin(orgId: string, code: string, choice: OriginChoice, u: AppUser): Promise<string | null> {
  const project = await projectByCode(code);
  return db.transaction(async (tx) => {
    const src = await source(orgId, choice, u, tx, true);
    if (typeof src === "string") return src;
    const { proposal: p, opportunity: o } = src;
    const origin: ProjectOrigin = {
      proposalId: p?.id ?? null,
      opportunityId: o?.id ?? null,
      title: p?.title ?? o!.title,
      donor: p?.donor ?? o!.donor,
      winThemes: p?.themes ?? [],
      documents: (o?.documents ?? []).map((d) => ({ hash: d.hash, name: d.name, type: d.type, size: d.size, label: d.label })),
      decidedAt: p ? wonOn(p) : (o?.decision?.at ?? null),
      currency: choice.currency,
      ceiling: choice.ceiling,
      by: u.id,
      at: today(),
    };
    await tx
      .insert(s.projectState)
      .values({ projectId: project.id, key: ORIGIN_KEY, data: origin })
      .onConflictDoUpdate({ target: [s.projectState.projectId, s.projectState.key], set: { data: origin, updatedAt: new Date() } });
    const ev = { at: today(), by: u.id, byName: u.name, what: `Set up as ${code}` };
    if (p) {
      const props = await readOrg<FundingProposal>(orgId, "funding-proposals", tx);
      await writeOrg(orgId, "funding-proposals", { ...props, items: props.items.map((x) => (x.id === p.id ? { ...x, projectCode: code, history: [...x.history, ev] } : x)) }, tx);
    }
    // The opportunity moves into design with the project's code, as its own "designing" step does.
    if (o && o.status === "match") {
      const opps = await readOrg<Opportunity>(orgId, "opportunities", tx);
      await writeOrg(orgId, "opportunities", { ...opps, items: opps.items.map((x) => (x.id === o.id ? { ...x, status: "designing", projectCode: code, history: [...x.history, { ...ev, what: `Design started as ${code}` }] } : x)) }, tx);
    }
    const detail = { proposal: origin.proposalId, opportunity: origin.opportunityId, title: origin.title, currency: origin.currency, ceiling: origin.ceiling, documents: origin.documents.length };
    await logAudit(tx, project.id, { entity: "project", entityId: project.id, action: "project_linked_to_proposal", by: u.id, detail });
    await tx.insert(s.auditLog).values({ projectId: null, entity: "proposal", entityId: orgId, action: "proposal_set_up_as_project", detail: { by: u.id, project: code, ...detail } });
    return null;
  });
}

/** The project's origin, or null when it was set up without one. */
export async function loadOrigin(code: string): Promise<ProjectOrigin | null> {
  const project = await projectByCode(code);
  return ((await loadProjectStateRaw(project.id, ORIGIN_KEY)) as ProjectOrigin | null) ?? null;
}

/** The award as confirmed at setup (currency and ceiling), for the budget; null when the project has no origin. */
export async function loadAward(code: string): Promise<Pick<ProjectOrigin, "currency" | "ceiling"> | null> {
  const o = await loadOrigin(code).catch(() => null);
  return o ? { currency: o.currency, ceiling: o.ceiling } : null;
}

/** The saved budget's total against the award ceiling (lib/project-origin againstCeiling); null without a ceiling or a budget. */
export async function budgetCeiling(code: string): Promise<CeilingCheck | null> {
  const award = await loadAward(code);
  if (award?.ceiling == null) return null;
  const project = await projectByCode(code);
  const [row] = await db
    .select({ total: sql<string | null>`sum(${s.budgetLines.amount})`, currency: sql<string | null>`min(${s.budgetLines.currency})` })
    .from(s.budgetLines)
    .where(eq(s.budgetLines.projectId, project.id));
  if (!row?.currency) return null;
  return againstCeiling(Number(row.total ?? 0), row.currency, award);
}

/**
 * The win themes, for an AI draft's facts: what the proposal told the donor, so a draft can
 * choose its emphasis. Never results: the drafting rules say so where this is used.
 */
export async function winThemesContext(code: string): Promise<{ win_themes_context?: string[] }> {
  const o = await loadOrigin(code).catch(() => null);
  return o?.winThemes.length ? { win_themes_context: o.winThemes } : {};
}

