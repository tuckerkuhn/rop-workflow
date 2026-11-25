import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { briefSchema, MATCH_ROLE_TYPES, readSchema, type CallReading, type OppAction, type OppDoc, type Opportunity } from "@/lib/opportunities";
import { draftStructured } from "@/server/ai-structured";
import { asIs } from "@/server/ai";
import { EXCEL_TYPE, loadFile, WORD_TYPE } from "@/server/hr-files";
import { FetchRefused, safeFetch, type Fetched } from "@/server/safe-fetch";
import { readWorkbook } from "@/lib/read-sheet";
import type { SetupFile } from "@/server/setup-extract";
import { loadHr } from "@/server/hr-store";
import { listProjects } from "@/server/project-store";
import { proposalLinks } from "@/server/funding-proposals-store";

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
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function save(orgId: string, data: Book, q: Tx | typeof db = db) {
  await q
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
    // The proposals this person may open, so each opportunity links to the one written for it.
    proposals: await proposalLinks(orgId, u).catch(() => []),
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
    opportunity: { title: o.title, donor: o.donor, source: o.source, link: o.link, country: o.country, deadline: o.deadline, value: o.value, currency: o.currency, need: o.need, donorPriorities: o.donorPriorities, capacity: o.capacity, risks: o.risks, teamNotes: o.notes ?? "", contactWithTheFunder: o.funderContact ?? "" },
    attachedDocuments: (o.documents ?? []).map((d) => `${d.label}: ${d.name}`),
  };
}

/** The attached call documents as the model reads them: a PDF as itself, a Word file as its text. */
async function callDocuments(o: Pick<Opportunity, "documents">): Promise<SetupFile[]> {
  const out: SetupFile[] = [];
  for (const d of o.documents ?? []) {
    const f = await loadFile(d.hash);
    if (!f) continue;
    const buf = Buffer.from(f.data as Uint8Array);
    if (f.type === "application/pdf") out.push({ name: d.name, kind: "pdf", data: buf.toString("base64") });
    else if (f.type === WORD_TYPE) {
      const { default: JSZip } = await import("jszip");
      const xml = (await (await JSZip.loadAsync(buf)).file("word/document.xml")?.async("string")) ?? "";
      const text = xml.replace(/<\/w:p>/g, "\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      out.push({ name: d.name, kind: "text", text: text.slice(0, 300_000) });
    } else if (f.type === EXCEL_TYPE) {
      const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
      const sheets = await readWorkbook(ab).catch(() => []);
      const text = sheets.map((sh) => `Sheet: ${sh.name}\n${sh.grid.map((r) => r.map((c) => (c == null ? "" : String(c).replace(/\s+/g, " ").trim())).join("\t").replace(/\t+$/, "")).filter(Boolean).join("\n")}`).join("\n\n");
      if (text.trim()) out.push({ name: d.name, kind: "text", text: text.slice(0, 200_000) });
    }
  }
  return out;
}

/**
 * Each change to an opportunity, the match call above all, is in the organization's audit log as
 * well as in the opportunity's own history: the history is saved with the list and could be
 * rewritten with it; the log is only ever added to.
 */
const logOpp = (q: Tx, orgId: string, action: string, by: string, detail: Record<string, unknown>) => q.insert(s.auditLog).values({ projectId: null, entity: "opportunity", entityId: orgId, action, detail: { by, ...detail } });

/**
 * The page a call's link points to, as the model can read it: a PDF as itself, a web page as its
 * text. Only a public https address; nothing on this network, and nothing large.
 */
async function linkDocument(link: string): Promise<SetupFile | null> {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  let res: Fetched | null;
  try {
    res = await safeFetch(url.href, { headers: { "User-Agent": "Mozilla/5.0 (compatible; grant-call-reader)" } });
  } catch (err) {
    if (err instanceof FetchRefused) {
      if (err.message === "too large") throw new Error("The page behind the link is over 4 MB. Download the call and attach it instead.");
      throw new Error(err.message === "Too many redirects." ? "The link did not open from here. Download the call and attach it instead." : err.message);
    }
    res = null;
  }
  if (res && (res.status === 401 || res.status === 403 || res.status === 429))
    throw new Error("This funder's site does not let the app read its pages. Open the link in your browser, save the page as a PDF (Print, then Save as PDF) and attach it here.");
  if (!res || res.status < 200 || res.status >= 300) throw new Error("The link did not open from here. Download the call and attach it instead.");
  const type = res.type;
  const buf = res.body;
  url = res.url;
  if (type.includes("pdf")) return { name: url.pathname.split("/").pop() || "call.pdf", kind: "pdf", data: buf.toString("base64") };
  if (!type.includes("html") && !type.includes("text")) throw new Error("The link is not a web page or a PDF. Download the call and attach it instead.");
  const text = buf
    .toString("utf8")
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 200) throw new Error("The page behind the link has almost no text (it may need a sign-in). Download the call and attach it instead.");
  return { name: url.hostname, kind: "text", text: text.slice(0, 200_000) };
}

/**
 * Documents a person may put on an opportunity: files they uploaded themselves, or ones already on
 * it. Otherwise a fingerprint copied from elsewhere (an HR file) could be attached and so opened.
 */
async function docsAllowed(docs: OppDoc[], u: AppUser, already: OppDoc[] = []): Promise<string | null> {
  for (const d of docs) {
    if (already.some((x) => x.hash === d.hash)) continue;
    const f = await loadFile(d.hash);
    if (!f || f.uploadedBy !== u.id) return `${d.name} is not a file you attached. Attach it again.`;
  }
  return null;
}

/** Reads a call from its link or attached documents and proposes the form's fields. Nothing is saved. */
export async function readCall(link: string, documents: OppDoc[], u: AppUser): Promise<CallReading> {
  const bad = await docsAllowed(documents, u);
  if (bad) throw new Error(bad);
  const files = await callDocuments({ documents });
  if (link) {
    const page = await linkDocument(link);
    if (page) files.unshift(page);
  }
  if (!files.length) throw new Error("Add the link to the call or attach the call first.");
  // Without a working AI key (or when the reading fails) the person fills in the form from the call.
  const read = await draftStructured({
    job: "opportunityRead",
    by: u.id,
    system: "You read a funding call (a call for proposals, request for proposals or applications, or a notice of funding) so a small organization can record it. Take every value from the documents; never invent. Leave a value empty when it is not there, and say so in missing. Plain, short sentences.",
    task: `Read this funding call and fill in the fields. Today is ${today()}.`,
    facts: asIs(null, "the funding call the person linked or attached"),
    documents: files,
    schema: readSchema,
    effort: "low",
    maxTokens: 6000,
  }).catch(() => null);
  if (!read) throw new Error("The app could not read this call for you. Fill in the fields below from the call.");
  const out = read.out;
  return { ...out, deadline: /^\d{4}-\d{2}-\d{2}$/.test(out.deadline) ? out.deadline : "", currency: /^[A-Z]{3}$/.test(out.currency) ? out.currency : "" };
}

export async function actOnOpportunity(orgId: string, a: Exclude<OppAction, { action: "read" }>, u: AppUser): Promise<string | null> {
  const b = await load(orgId);
  const ev = (what: string) => ({ at: today(), by: u.id, byName: u.name, what });
  if (a.action === "add") {
    if (u.kind !== "employee") return "Opportunities are recorded by staff.";
    const bad = await docsAllowed(a.fields.documents ?? [], u);
    if (bad) return bad;
    const o: Opportunity = { id: `OPP-${randomUUID().slice(0, 6).toUpperCase()}`, ...a.fields, brief: null, status: "tracking", decision: null, projectCode: null, history: [ev("Recorded")] };
    // Saved and logged together: one is never there without the other.
    await db.transaction(async (tx) => {
      await save(orgId, { items: [...b.items, o] }, tx);
      await logOpp(tx, orgId, "opportunity_recorded", u.id, { opportunity: o.id, name: o.title, donor: o.donor });
    });
    return null;
  }
  const o = b.items.find((x) => x.id === a.id);
  if (!o) return "No such opportunity.";
  let next: Opportunity;
  if (a.action === "edit") {
    if (o.status !== "tracking") return "Decided already: reopen it to change it.";
    const bad = await docsAllowed(a.fields.documents ?? [], u, o.documents ?? []);
    if (bad) return bad;
    next = { ...o, ...a.fields, history: [...o.history, ev("Details changed")] };
  } else if (a.action === "brief") {
    if (o.status !== "tracking") return "Decided already.";
    const { out, model } = await draftStructured({
      job: "opportunityBrief",
      by: u.id,
      system: "You draft the match brief for Roots of Peace's match call on a funding opportunity. Read the attached call documents first: what the donor will fund, who is eligible, the deadline and the value come from them before the team's notes. Use only the facts and documents given; where a fact is missing, say so plainly rather than guessing. You inform the decision; you do not make it. Plain, short sentences.",
      task: "Draft the match brief for this opportunity.",
      facts: asIs(await briefFacts(o, b.items), "the opportunity's details, project names and stages, and earlier no-match reasons; no record about a person"),
      // The donor's own call documents, attached by staff: no record about a person.
      documents: await callDocuments(o),
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
  // Read again before saving: the AI brief takes a while, and others may have changed the list since.
  const latest = await load(orgId);
  await db.transaction(async (tx) => {
    await save(orgId, { items: latest.items.map((x) => (x.id === o.id ? next : x)) }, tx);
    if (a.action === "edit") await logOpp(tx, orgId, "opportunity_edited", u.id, { opportunity: o.id, name: o.title });
    else if (a.action === "decide") await logOpp(tx, orgId, a.match ? "opportunity_matched" : "opportunity_not_matched", u.id, { opportunity: o.id, name: o.title, reason: a.reason });
    else if (a.action === "reopen") await logOpp(tx, orgId, "opportunity_reopened", u.id, { opportunity: o.id, name: o.title, reason: a.reason });
    else if (a.action !== "brief") await logOpp(tx, orgId, "opportunity_design_started", u.id, { opportunity: o.id, name: o.title, project: a.projectCode });
  });
  return null;
}
