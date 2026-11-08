import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { briefSchema, MATCH_ROLE_TYPES, type OppAction, type Opportunity } from "@/lib/opportunities";
import { draftStructured } from "@/server/ai-structured";
import { loadHr } from "@/server/hr-store";
import { listProjects } from "@/server/project-store";

const KEY = "opportunities";
const today = () => new Date().toISOString().slice(0, 10);
type Book = { items: Opportunity[] };

async function load(orgId: string): Promise<Book> {
  const [row] = await db
    .select()
    .from(s.organizationState)
    .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, KEY)))
    .limit(1);
  return { items: [], ...((row?.data as Partial<Book>) ?? {}) };
}
async function save(orgId: string, data: Book) {
  await db
    .insert(s.organizationState)
    .values({ organizationId: orgId, key: KEY, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}

export async function mayMatch(u: AppUser) {
  if (u.admin) return true;
  const holders = ((await loadHr().catch(() => null))?.state.rules?.holders ?? {}) as Record<string, string[]>;
  return MATCH_ROLE_TYPES.some((t) => holders[t]?.includes(u.id));
}

export async function loadOpportunities(orgId: string, u: AppUser) {
  const b = await load(orgId);
  const order: Record<string, number> = { tracking: 0, match: 1, designing: 2, no_match: 3 };
  return {
    items: [...b.items].sort((a, c) => order[a.status] - order[c.status] || (a.deadline ?? "9999").localeCompare(c.deadline ?? "9999")),
    can: { add: u.kind === "employee", decide: await mayMatch(u), brief: !!process.env.ANTHROPIC_API_KEY },
  };
}
export type OpportunitiesView = Awaited<ReturnType<typeof loadOpportunities>>;

/** The facts the match brief is drafted from: the opportunity and ROP's own projects. */
async function briefFacts(o: Opportunity, all: Opportunity[]) {
  const projects = (await listProjects()).filter((p) => p.code !== "A-2027").map((p) => ({ name: p.name, stage: p.stage }));
  const earlierNoMatch = all.filter((x) => x.id !== o.id && x.decision && !x.decision.match).map((x) => ({ title: x.title, donor: x.donor, reason: x.decision!.reason }));
  return {
    rop: "Roots of Peace (ROP): an international NGO that turns former conflict areas into productive farmland. Its model: market-led agricultural livelihoods for smallholder farmers (high-value crops, post-harvest handling, market linkages, agribusiness and MSME support, water and climate resilience), working through local staff and partners, mainly in Afghanistan and Central America.",
    ropProjects: projects,
    earlierNoMatchDecisions: earlierNoMatch,
    opportunity: { title: o.title, donor: o.donor, source: o.source, link: o.link, country: o.country, deadline: o.deadline, value: o.value, currency: o.currency, need: o.need, donorPriorities: o.donorPriorities, capacity: o.capacity, risks: o.risks, grossIncomeAnalysis: o.grossIncome },
  };
}

export async function actOnOpportunity(orgId: string, a: OppAction, u: AppUser): Promise<string | null> {
  const b = await load(orgId);
  const ev = (what: string) => ({ at: today(), by: u.id, byName: u.name, what });
  if (a.action === "add") {
    if (u.kind !== "employee") return "Opportunities are recorded by staff.";
    const o: Opportunity = { id: `OPP-${randomUUID().slice(0, 6).toUpperCase()}`, ...a.fields, brief: null, status: "tracking", decision: null, projectCode: null, history: [ev("Recorded")] };
    await save(orgId, { items: [...b.items, o] });
    return null;
  }
  const o = b.items.find((x) => x.id === a.id);
  if (!o) return "No such opportunity.";
  let next: Opportunity;
  if (a.action === "edit") {
    if (o.status !== "tracking") return "Decided already: reopen it to change it.";
    next = { ...o, ...a.fields, history: [...o.history, ev("Details changed")] };
  } else if (a.action === "brief") {
    if (o.status !== "tracking") return "Decided already.";
    const { out, model } = await draftStructured({
      system: "You draft the match brief for Roots of Peace's match call on a funding opportunity. Use only the facts given; where a fact is missing, say so plainly rather than guessing. You inform the decision; you do not make it. Plain, short sentences.",
      task: "Draft the match brief for this opportunity.",
      facts: await briefFacts(o, b.items),
      schema: briefSchema,
      effort: "medium",
      maxTokens: 8000,
    });
    next = { ...o, brief: { ...out, model, at: today(), by: u.id }, history: [...o.history, ev("Match brief drafted with AI")] };
    // Counted with the other AI runs (server/limits.ts).
    await db.insert(s.auditLog).values({ projectId: null, entity: "opportunity", entityId: orgId, action: "opportunity_briefed", detail: { by: u.id, opportunity: o.id, model } });
  } else if (a.action === "decide") {
    if (!(await mayMatch(u))) return "Programme management or the executive head makes the match call.";
    if (o.status !== "tracking") return "Already decided.";
    next = { ...o, status: a.match ? "match" : "no_match", decision: { match: a.match, reason: a.reason, by: u.id, byName: u.name, at: today() }, history: [...o.history, ev(a.match ? `Match: ${a.reason}` : `No match: ${a.reason}`)] };
  } else if (a.action === "reopen") {
    if (!(await mayMatch(u))) return "Programme management or the executive head reopens a decision.";
    next = { ...o, status: "tracking", decision: null, history: [...o.history, ev(`Reopened: ${a.reason}`)] };
  } else {
    if (o.status !== "match") return "Only a matched opportunity goes into design.";
    next = { ...o, status: "designing", projectCode: a.projectCode, history: [...o.history, ev(`Design started as ${a.projectCode}`)] };
  }
  await save(orgId, { items: b.items.map((x) => (x.id === o.id ? next : x)) });
  return null;
}
