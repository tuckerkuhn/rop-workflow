import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import {
  accessOf,
  accessReason,
  assessSchema,
  itemId,
  itemsFrom,
  itemsFromPlan,
  mine,
  NO_BUDGET,
  OUTCOME_LABEL,
  planSchema,
  ratingRefusal,
  readiness,
  standardItems,
  STATUS_LABEL,
  statusRefusal,
  BAND_LABEL,
  type Access,
  type FundingProposal,
  type Item,
  type ProposalAction,
  type Staffer,
} from "@/lib/funding-proposals";
import type { Opportunity } from "@/lib/opportunities";
import { asIs } from "@/server/ai";
import { draftStructured } from "@/server/ai-structured";
import { people } from "@/server/auth";
import { loadHr } from "@/server/hr-store";

/**
 * Proposals, kept for the whole organization (lib/funding-proposals). One document holds them
 * all; who may open it is worked out from the HR record on every request, never stored, so a
 * change of title or office there changes access here at once.
 */

const KEY = "funding-proposals";
const today = () => new Date().toISOString().slice(0, 10);
type Book = { items: FundingProposal[] };

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

/** Each person's title and office from the HR record, falling back to the staff list's title when they are not in it. */
async function roster(): Promise<{ staff: Map<string, Staffer>; head: Set<string>; all: AppUser[] }> {
  const [hr, all] = [await loadHr().catch(() => null), await people()];
  const staff = new Map<string, Staffer>();
  for (const u of all) if (u.kind === "employee") staff.set(u.id, { id: u.id, title: u.title, office: null });
  for (const [id, p] of Object.entries(hr?.state.people ?? {})) {
    if (p.separated) {
      staff.delete(id);
      continue;
    }
    const f = p.current as { title?: string; office?: string };
    staff.set(id, { id, title: f.title ?? staff.get(id)?.title ?? "", office: f.office ?? null });
  }
  return { staff, head: new Set(hr?.state.rules?.holders?.ceo ?? []), all };
}

/** This person's standing: lead, member, or neither (lib/funding-proposals accessOf). Staff only. */
export async function proposalAccess(u: AppUser): Promise<Access> {
  if (u.kind !== "employee") return null;
  const r = await roster();
  return accessOf(r.staff.get(u.id) ?? null, r.head.has(u.id));
}

/** Who is in the three groups, by person id, for the menu: titles decide it, so it is no secret among staff. */
export async function proposalAccessMap(): Promise<Record<string, "lead" | "member">> {
  const r = await roster().catch(() => null);
  if (!r) return {};
  const out: Record<string, "lead" | "member"> = {};
  for (const x of r.staff.values()) {
    const a = accessOf(x, r.head.has(x.id));
    if (a) out[x.id] = a;
  }
  return out;
}

const sees = (p: FundingProposal, u: AppUser, a: Access) => !!a || p.team.includes(u.id);

/** What one person sees: every proposal for the three groups, and for a named contributor only the ones they are named on. */
export async function loadProposals(orgId: string, u: AppUser) {
  const r = await roster();
  const access = u.kind === "employee" ? accessOf(r.staff.get(u.id) ?? null, r.head.has(u.id)) : null;
  const b = await load(orgId);
  const items = b.items.filter((p) => sees(p, u, access));
  if (!access && !items.length) return null;
  const order: Record<string, number> = { drafting: 0, submitted: 1, won: 2, lost: 3, withdrawn: 4 };
  const name = new Map(r.all.map((x) => [x.id, x.name]));
  // Who can be given an item: the three groups, with why each is in. Contributors are added per proposal.
  const groups = [...r.staff.values()].map((x) => ({ id: x.id, name: name.get(x.id) ?? x.id, title: x.title, why: accessReason(x, r.head.has(x.id)) })).filter((x) => x.why);
  const others = [...r.staff.values()].filter((x) => !accessOf(x, r.head.has(x.id))).map((x) => ({ id: x.id, name: name.get(x.id) ?? x.id, title: x.title }));
  let matched: { id: string; title: string; donor: string }[] = [];
  if (access) {
    const [row] = await db
      .select()
      .from(s.organizationState)
      .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, "opportunities")))
      .limit(1);
    const used = new Set(b.items.map((p) => p.opportunityId));
    matched = (((row?.data as { items?: Opportunity[] })?.items ?? []) as Opportunity[]).filter((o) => o.status === "match" && !used.has(o.id)).map((o) => ({ id: o.id, title: o.title, donor: o.donor }));
  }
  return {
    items: [...items].sort((a, c) => order[a.outcome] - order[c.outcome] || (a.deadline?.at ?? "9999").localeCompare(c.deadline?.at ?? "9999")).map((p) => ({ ...p, readiness: readiness(p) })),
    access,
    can: { run: !!access, lead: access === "lead", ai: !!process.env.ANTHROPIC_API_KEY },
    groups: access ? groups : [],
    others: access === "lead" ? others : [],
    matched,
    names: Object.fromEntries(name),
  };
}
export type ProposalsView = NonNullable<Awaited<ReturnType<typeof loadProposals>>>;

/** For Home: what this person owns or must sign across the proposals they can open. */
export async function proposalWork(orgId: string, u: AppUser) {
  const access = await proposalAccess(u);
  const b = await load(orgId);
  return mine(b.items.filter((p) => sees(p, u, access)), u.id);
}

const log = (orgId: string, action: string, by: string, detail: Record<string, unknown>) => db.insert(s.auditLog).values({ projectId: null, entity: "proposal", entityId: orgId, action, detail: { by, ...detail } });

/** Applies one action. Returns why it was refused, or null when it was saved. */
export async function actOnProposal(orgId: string, a: ProposalAction, u: AppUser): Promise<string | null> {
  const r = await roster();
  const access = u.kind === "employee" ? accessOf(r.staff.get(u.id) ?? null, r.head.has(u.id)) : null;
  const b = await load(orgId);
  const ev = (what: string) => ({ at: today(), by: u.id, byName: u.name, what });
  const nameOf = (id: string | null) => (id ? (r.all.find((x) => x.id === id)?.name ?? id) : "nobody");

  if (a.action === "create") {
    if (!access) return "Proposals are started by Country Directors, Home Office directors and Home Office program staff.";
    const taken = b.items.map((p) => p.id);
    let id = "";
    do id = `PRO-${randomUUID().slice(0, 6).toUpperCase()}`;
    while (taken.includes(id));
    if (a.opportunityId && b.items.some((p) => p.opportunityId === a.opportunityId)) return "That opportunity already has a proposal.";
    const earlier = b.items.find((p) => p.id === a.from);
    if (a.from !== "standard" && a.from !== "blank" && !earlier) return "No such proposal to start from.";
    const items = earlier ? itemsFrom(earlier) : a.from === "standard" ? standardItems() : [];
    const started = earlier ? `Started from ${earlier.title}` : a.from === "standard" ? "Started from the standard list" : "Started with an empty list";
    const p: FundingProposal = { id, opportunityId: a.opportunityId, ...a.fields, budget: { ...NO_BUDGET, ...a.fields.budget }, themes: earlier?.themes ?? [], team: [], items, outcome: "drafting", confirmation: "", history: [ev(started)] };
    await save(orgId, { items: [...b.items, p] });
    await log(orgId, "proposal_started", u.id, { proposal: id, from: a.from });
    return null;
  }

  const p = b.items.find((x) => x.id === a.id);
  if (!p || !sees(p, u, access)) return "No such proposal.";
  const runs = !!access;
  const open = p.outcome === "drafting";
  const put = async (next: FundingProposal) => {
    // Read again before saving: an AI run takes a while, and others may have changed the list since.
    const latest = await load(orgId);
    await save(orgId, { items: latest.items.map((x) => (x.id === p.id ? next : x)) });
    return null;
  };
  const withItem = (id: string, f: (i: Item) => Item, what: string) => put({ ...p, items: p.items.map((i) => (i.id === id ? f(i) : i)), history: [...p.history, ev(what)] });
  const ownerOk = (id: string | null) => !id || !!accessOf(r.staff.get(id) ?? null, r.head.has(id)) || p.team.includes(id);

  if (a.action === "outcome") {
    if (access !== "lead") return "A Country Director or a Home Office director records the outcome.";
    if (a.outcome === "submitted") {
      const blockers = readiness(p).blockers;
      if (blockers.length) return `Not ready to submit. ${blockers[0]}`;
      if (!a.confirmation) return "Say where the donor's confirmation of receipt is saved.";
    }
    await log(orgId, "proposal_outcome", u.id, { proposal: p.id, outcome: a.outcome });
    return put({ ...p, outcome: a.outcome, confirmation: a.confirmation || p.confirmation, history: [...p.history, ev(`${OUTCOME_LABEL[a.outcome]}${a.note ? `: ${a.note}` : ""}`)] });
  }
  if (!open) return "This proposal is closed. A lead can reopen it by setting it back to in preparation.";

  if (a.action === "status") {
    const i = p.items.find((x) => x.id === a.item);
    if (!i) return "No such item.";
    const why = statusRefusal(i, a.status, u.id, runs);
    if (why) return why;
    return withItem(i.id, (x) => ({ ...x, status: a.status, unchecked: false }), `${i.title}: ${STATUS_LABEL[a.status]}${a.note ? ` (${a.note})` : ""}`);
  }
  if (a.action === "assess") {
    const i = p.items.find((x) => x.id === a.item);
    if (!i || i.kind !== "scored") return "Only scored items are rated.";
    if (!i.criteria) return "Write what the grid asks for on this item first: a rating needs something to rate against.";
    const { out, model } = await draftStructured({
      job: "proposalAssess",
      by: u.id,
      system:
        "You help a proposal team see how one section of their draft would stand against other applicants. Judge only against the grid's criteria given, the way a donor's evaluator would. Be exact about what is answered and what is missing; do not flatter and do not rewrite the text. You suggest a band; a named reviewer confirms it. Plain, short sentences.",
      task: "Rate this section draft against what the grid asks for.",
      facts: asIs({ section: i.title, reference: i.ref, whatTheGridAsksFor: i.criteria, mostPoints: i.points, whatEarnsTheBestScore: i.guidance, winThemes: p.themes, draft: a.text }, "a draft proposal section pasted by a person running the proposal; an organization's document, not a record about a person"),
      schema: assessSchema,
      effort: "medium",
      maxTokens: 4000,
    });
    await log(orgId, "proposal_section_assessed", u.id, { proposal: p.id, item: i.id, model, band: out.band });
    return withItem(i.id, (x) => ({ ...x, rating: { band: out.band, why: out.why, next: out.next, by: u.id, byName: u.name, at: today(), suggested: true } }), `${i.title}: AI suggests ${BAND_LABEL[out.band]}`);
  }
  if (a.action === "rate") {
    const i = p.items.find((x) => x.id === a.item);
    if (!i) return "No such item.";
    const why = ratingRefusal(i, u.id, runs);
    if (why) return why;
    await log(orgId, "proposal_section_rated", u.id, { proposal: p.id, item: i.id, band: a.band });
    return withItem(i.id, (x) => ({ ...x, rating: { band: a.band, why: a.why, next: a.next, by: u.id, byName: u.name, at: today(), suggested: false } }), `${i.title}: rated ${BAND_LABEL[a.band]}`);
  }

  // Everything below changes the plan itself: the people running the proposal only.
  if (!runs) return "Only the people running the proposal change its plan. You can update the status of your own items.";

  if (a.action === "head") return put({ ...p, ...a.fields, budget: { ...NO_BUDGET, ...a.fields.budget }, history: [...p.history, ev("Details changed")] });
  if (a.action === "themes") return put({ ...p, themes: a.themes, history: [...p.history, ev(a.themes.length ? `Win themes set: ${a.themes.join("; ")}` : "Win themes cleared")] });
  if (a.action === "team") {
    if (access !== "lead") return "A Country Director or a Home Office director names contributors.";
    if (!r.staff.has(a.person)) return "No such person in the staff list.";
    if (a.add && accessOf(r.staff.get(a.person) ?? null, r.head.has(a.person))) return "They can already open every proposal.";
    if (!a.add && p.items.some((i) => (i.owner === a.person || i.signer === a.person) && i.status !== "final" && i.status !== "na")) return "They still own or sign an open item. Give it to someone else first.";
    await log(orgId, a.add ? "proposal_contributor_added" : "proposal_contributor_removed", u.id, { proposal: p.id, person: a.person });
    return put({ ...p, team: a.add ? [...new Set([...p.team, a.person])] : p.team.filter((x) => x !== a.person), history: [...p.history, ev(`${nameOf(a.person)} ${a.add ? "named as a contributor: can open this proposal only" : "removed as a contributor"}`)] });
  }
  if (a.action === "addItem" || a.action === "editItem") {
    const f = a.fields;
    if (!ownerOk(f.owner)) return `${nameOf(f.owner)} cannot open proposals. A lead names them as a contributor on this one first.`;
    if (!ownerOk(f.signer)) return `${nameOf(f.signer)} cannot open proposals. A lead names them as a contributor on this one first.`;
    const scored = f.kind === "scored";
    const clean = { ...f, points: scored ? f.points : null, criteria: scored ? f.criteria : "", guidance: scored ? f.guidance : "" };
    if (a.action === "addItem") {
      const i: Item = { id: itemId(p.items.map((x) => x.id)), ...clean, status: "todo", rating: null, unchecked: false };
      return put({ ...p, items: [...p.items, i], history: [...p.history, ev(`Added: ${i.title}`)] });
    }
    const i = p.items.find((x) => x.id === a.item);
    if (!i) return "No such item.";
    // A rating stands for what the grid asked when it was given: change the criteria and it is asked again.
    const rating = scored && i.criteria === clean.criteria ? i.rating : null;
    const handed = i.owner !== clean.owner ? `, now with ${nameOf(clean.owner)}` : "";
    return withItem(i.id, (x) => ({ ...x, ...clean, rating, unchecked: false }), `Changed: ${clean.title}${handed}`);
  }
  if (a.action === "removeItem") {
    const i = p.items.find((x) => x.id === a.item);
    if (!i) return "No such item.";
    return put({ ...p, items: p.items.filter((x) => x.id !== i.id), history: [...p.history, ev(`Removed: ${i.title}`)] });
  }
  // plan: the call's requirements, listed by AI for a person to check.
  const { out, model } = await draftStructured({
    job: "proposalPlan",
    by: u.id,
    system:
      "You read a donor's call for proposals and list exactly what an applicant must produce, so a team can give each item to one person. Use only what the call says. Keep the call's own references and limits. Mark each item as a checkbox item (the donor only checks it is there and correct), a scored item (evaluators score it against the grid) or a decision the applicant must make. For scored items, say what the grid looks for and what kind of evidence would earn the best score, written against the win themes given where they fit; never invent facts about the applicant. Plain, short sentences.",
    task: "List every item this call requires, in the call's order, and the hard limits that apply to the whole proposal.",
    facts: asIs({ proposal: p.title, donor: p.donor, winThemes: p.themes, call: a.call }, "a donor's public call for proposals pasted by a person running the proposal; no record about a person"),
    schema: planSchema,
    effort: "high",
    maxTokens: 16000,
  });
  const added = itemsFromPlan(out, p.items.map((x) => x.id));
  if (!added.length) return "Nothing to list was found in that text. Paste the part of the call that says what to submit and how it is scored.";
  await log(orgId, "proposal_planned", u.id, { proposal: p.id, model, items: added.length });
  const limits = out.limits.slice(0, 8).map((x) => x.slice(0, 300));
  return put({ ...p, items: [...p.items, ...added], rules: [...new Set([...p.rules, ...limits])].slice(0, 8), history: [...p.history, ev(`${added.length} items listed from the call with AI: each is marked to check`)] });
}
