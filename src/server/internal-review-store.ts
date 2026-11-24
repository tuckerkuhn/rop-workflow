import { randomUUID } from "node:crypto";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import { foldExpenses } from "@/lib/expense";
import { drawSample, dueFor, quarterRange, STEPS, type Candidate, type Finding, type ReviewAction, type ReviewBook, type Roles } from "@/lib/internal-review";
import { orderUsd } from "@/lib/payments";
import { people } from "@/server/auth";
import { loadBills } from "@/server/bills-store";
import { loadHr } from "@/server/hr-store";
import { loadProcurements } from "@/server/procurement-store";

/**
 * The quarterly internal review (lib/internal-review), kept as one organization_state document.
 * The sample is drawn once from the app's records and then kept as drawn, so the review can be
 * checked against what was sampled. Every action is also in the audit log.
 */

const KEY = "internal-review";
const today = () => new Date().toISOString().slice(0, 10);

export async function loadBook(orgId: string): Promise<ReviewBook> {
  const [row] = await db
    .select()
    .from(s.organizationState)
    .where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, KEY)))
    .limit(1);
  return { roles: null, reviews: [], findings: [], ...((row?.data as Partial<ReviewBook>) ?? {}) };
}
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function saveBook(orgId: string, data: ReviewBook, q: Tx | typeof db) {
  await q
    .insert(s.organizationState)
    .values({ organizationId: orgId, key: KEY, data })
    .onConflictDoUpdate({ target: [s.organizationState.organizationId, s.organizationState.key], set: { data, updatedAt: new Date() } });
}

/** Names to person ids: procurement signatures keep the signer's name. */
async function idsByName() {
  const map = new Map<string, string>();
  for (const u of await people()) map.set(u.name.trim().toLowerCase(), u.id);
  return (name: string) => map.get(name.trim().toLowerCase()) ?? name;
}

/** Everything the quarter's sample can be drawn from, read from the app's records. */
export async function candidatesFor(orgId: string, quarter: string): Promise<Candidate[]> {
  const { start, end, months } = quarterRange(quarter);
  const inQuarter = (d: string | null | undefined) => !!d && d.slice(0, 10) >= start && d.slice(0, 10) <= end;
  const out: Candidate[] = [];
  const idOf = await idsByName();

  // Cash and bank: each bank account for each month, reconciled or not.
  const banks = await db.select({ id: s.bankAccounts.id, name: s.bankAccounts.name }).from(s.bankAccounts).where(eq(s.bankAccounts.organizationId, orgId));
  const recs = banks.length
    ? await db
        .select()
        .from(s.reconciliations)
        .where(and(inArray(s.reconciliations.bankAccountId, banks.map((b) => b.id)), gte(s.reconciliations.period, start), lte(s.reconciliations.period, end)))
    : [];
  for (const b of banks)
    for (const m of months) {
      const r = recs.find((x) => x.bankAccountId === b.id && String(x.period).slice(0, 7) === m);
      const done = !!r?.completedAt;
      out.push({ area: "cash", ref: `bank:${b.id}:${m}`, what: `${b.name}, ${m}: ${done ? "reconciliation completed" : "no completed reconciliation"}`, date: `${m}-01`, usd: 0, preparedBy: r?.completedBy ? [r.completedBy] : [], approvedBy: [], href: `/work/closeout?bank=${b.id}&month=${m}#bank` });
    }

  // Payments: posted payments in the books, bills paid directly, and approved expense reports.
  const entries = await db
    .select({ id: s.journalEntries.id, memo: s.journalEntries.memo, date: s.journalEntries.entryDate, by: s.journalEntries.recordedBy, posted: s.journalEntries.postedBy, project: s.journalEntries.projectId })
    .from(s.journalEntries)
    .where(and(eq(s.journalEntries.organizationId, orgId), eq(s.journalEntries.status, "posted"), eq(s.journalEntries.kind, "payment"), gte(s.journalEntries.period, start), lte(s.journalEntries.period, end)));
  const lines = entries.length ? await db.select({ entry: s.journalLines.entryId, dr: s.journalLines.functionalDebit }).from(s.journalLines).where(inArray(s.journalLines.entryId, entries.map((e) => e.id))) : [];
  for (const e of entries) {
    const usd = lines.filter((l) => l.entry === e.id).reduce((t, l) => t + Number(l.dr), 0);
    out.push({ area: "payments", ref: `payment:${e.id}`, what: `Payment: ${e.memo}`, date: String(e.date), usd, preparedBy: [e.by], approvedBy: e.posted && e.posted !== e.by ? [e.posted] : [] });
  }

  const projects = await db.select({ id: s.projects.id, code: s.projects.code, kind: s.projects.kind }).from(s.projects).where(eq(s.projects.organizationId, orgId));
  const real = projects.filter((p) => p.kind === "real" && p.code);
  for (const p of real) {
    const bills = await loadBills(p.code!).catch(() => null);
    for (const b of bills?.items ?? []) {
      const when = b.approval?.at ?? b.invoiceDate;
      if (!b.approval || !inQuarter(when)) continue;
      out.push({ area: "payments", ref: `bill:${p.code}/${b.id}`, what: `Bill: ${b.payee}, ${b.description} (${p.code})`, date: String(when).slice(0, 10), usd: b.usd ?? (b.currency === "USD" ? b.amount : 0), preparedBy: [b.raised.by], approvedBy: [b.approval.by], href: "/work/bills" });
    }
  }

  const { state: hr, entries: hrEntries } = await loadHr();
  for (const r of foldExpenses(hrEntries, hr).reports) {
    if (!months.includes(r.report.month) || !["approved", "accepted"].includes(r.status)) continue;
    out.push({ area: "payments", ref: `expense:${r.n}`, what: `Expense report: ${String(hr.people[r.person]?.current.name ?? r.person)}, ${r.report.month}`, date: `${r.report.month}-01`, usd: r.total, preparedBy: [r.person, r.by], approvedBy: r.signatures.map((x) => x.by), href: "/expenses" });
  }

  // Payroll: each approved run in the quarter; one month is taken in full.
  for (const p of hr.proposals) {
    if (p.type !== "payroll" || p.status !== "approved" || !months.includes(p.month)) continue;
    const gross = p.lines.reduce((t, l) => t + (Number(l.gross) || 0), 0);
    out.push({ area: "payroll", ref: `payroll:${p.id}`, what: `Payroll ${p.month}${p.group ? `, ${p.group}` : ""}${p.supplemental ? " (supplemental)" : ""}`, date: `${p.month}-01`, usd: gross, preparedBy: [p.by], approvedBy: p.signatures.map((x) => x.by), group: p.month, href: "/payroll" });
  }

  // Procurement: every purchase that moved in the quarter.
  for (const p of real) {
    for (const r of await loadProcurements(p.code!).catch(() => [])) {
      const sigs = Object.values(r.signatures ?? {}).flat();
      const dates = [...(r.timeline ?? []).map((e) => e.date), ...sigs.map((x) => x.date)];
      if (!dates.some(inQuarter)) continue;
      const approved = sigs.filter((x) => /^(approved|award approved|signed for)/i.test(x.as)).map((x) => idOf(x.name));
      const prepared = sigs.filter((x) => !/^(approved|award approved|signed for)/i.test(x.as)).map((x) => idOf(x.name));
      out.push({ area: "procurement", ref: `procurement:${p.code}/${r.id}`, what: `${r.id} ${r.title} (${p.code})`, date: dates.filter(inQuarter).sort()[0]!.slice(0, 10), usd: orderUsd(r), preparedBy: [...new Set(prepared)], approvedBy: [...new Set(approved)], href: `/work?source=procurement&open=${encodeURIComponent(r.id)}&project=${encodeURIComponent(p.code!)}` });
    }
  }

  // Donor compliance: each active award.
  for (const p of real) out.push({ area: "donor", ref: `award:${p.code}`, what: `Award ${p.code}: costs eligible and on the right budget line, reports filed on time`, date: end, usd: 0, preparedBy: [], approvedBy: [], href: "/progress/budget" });

  return out;
}

/* ---------------- Who may do what ---------------- */

export type ReviewRole = keyof Roles | "admin";
export function rolesOf(u: AppUser, roles: Roles | null): ReviewRole[] {
  const out: ReviewRole[] = [];
  if (u.admin) out.push("admin");
  if (roles) for (const k of ["lead", "reviewer", "focal", "ceo"] as const) if (roles[k] === u.id) out.push(k);
  return out;
}
export const maySee = (u: AppUser, roles: Roles | null) => rolesOf(u, roles).length > 0;

export async function reviewView(orgId: string, u: AppUser) {
  const book = await loadBook(orgId);
  const names: Record<string, string> = {};
  for (const p of await people()) names[p.id] = p.name;
  return { ...book, me: u.id, mine: rolesOf(u, book.roles), today: today(), names, staff: (await people()).filter((p) => p.kind === "employee").map((p) => ({ id: p.id, name: p.name })) };
}
export type ReviewView = Awaited<ReturnType<typeof reviewView>>;

const log = (q: Tx, orgId: string, action: string, by: string, detail: Record<string, unknown>) => q.insert(s.auditLog).values({ projectId: null, entity: "internal_review", entityId: orgId, action, detail: { by, ...detail } });

export async function actOnReview(orgId: string, a: ReviewAction, u: AppUser): Promise<string | null> {
  const book = await loadBook(orgId);
  const mine = rolesOf(u, book.roles);
  const r = book.roles;
  let detail: Record<string, unknown> = {};

  if (a.action === "roles") {
    if (!u.admin) return "An administrator names who runs the internal review.";
    if (a.roles.lead === a.roles.reviewer) return "The lead and the independent reviewer must be two people.";
    if (a.roles.focal === a.roles.lead || a.roles.focal === a.roles.reviewer) return "The country office's focal point cannot also test the sample.";
    book.roles = a.roles;
    detail = { ...a.roles };
  } else {
    if (!r) return "Name the lead, the reviewer, the focal point and the CEO first.";
    if (a.action === "draw") {
      if (!mine.includes("lead")) return "The internal audit lead draws the sample.";
      const { end } = quarterRange(a.quarter);
      if (today() <= end) return "The sample is drawn after the quarter ends.";
      if (book.reviews.some((x) => x.quarter === a.quarter)) return "This quarter's sample is drawn already: it stays as drawn.";
      const items = drawSample(await candidatesFor(orgId, a.quarter), a.quarter, r);
      book.reviews.push({ quarter: a.quarter, drawnAt: today(), drawnBy: u.id, items, steps: {} });
      detail = { quarter: a.quarter, items: items.length };
    } else if (a.action === "step") {
      const rv = book.reviews.find((x) => x.quarter === a.quarter);
      if (!rv) return "Draw the quarter's sample first.";
      const def = STEPS.find((x) => x.id === a.step)!;
      if (!mine.includes(def.by as keyof Roles)) return `This step is for the ${def.by === "focal" ? "country office's focal point" : def.by === "lead" ? "internal audit lead" : "independent reviewer"}.`;
      if (rv.steps[a.step]) return "Done already.";
      const before = STEPS.slice(0, STEPS.findIndex((x) => x.id === a.step)).filter((x) => !rv.steps[x.id]);
      if (before.length) return `First: ${before[0].title.toLowerCase()}.`;
      if ((a.step === "testingDone" || a.step === "finalSigned") && rv.items.some((i) => !i.result)) return "Every item in the sample needs a result first.";
      rv.steps[a.step] = { by: u.id, at: today() };
      detail = { quarter: a.quarter, step: a.step };
    } else if (a.action === "test") {
      const rv = book.reviews.find((x) => x.quarter === a.quarter);
      const item = rv?.items.find((x) => x.ref === a.ref);
      if (!rv || !item) return "No such item in the sample.";
      if (rv.steps.finalSigned) return "The final report is signed: the results stand.";
      const touched = [...item.preparedBy, ...item.approvedBy].includes(u.id);
      if (touched) return "You prepared or approved this one: someone else tests it.";
      const allowed = item.tester === "lead" ? mine.includes("lead") : item.tester === "reviewer" ? mine.includes("reviewer") : mine.includes("admin") && u.id !== r.focal;
      if (!allowed) return item.tester === "someone else" ? "Both the lead and the reviewer touched this one: an administrator who did not tests it." : `The ${item.tester} tests this one.`;
      if (!a.ok && a.note.trim().length < 10) return "Say what is wrong, then record it as a finding.";
      item.result = { ok: a.ok, note: a.note, by: u.id, at: today() };
      detail = { quarter: a.quarter, ref: a.ref, ok: a.ok };
    } else if (a.action === "finding") {
      if (!mine.includes("lead") && !mine.includes("reviewer")) return "The lead or the reviewer records a finding.";
      const f: Finding = { id: `F-${randomUUID().slice(0, 6).toUpperCase()}`, quarter: a.quarter, area: a.area, ref: a.ref, rating: a.rating, text: a.text, by: u.id, at: today(), due: dueFor(a.rating, today(), a.quarter) };
      book.findings.push(f);
      detail = { finding: f.id, quarter: a.quarter, rating: a.rating };
    } else {
      const f = book.findings.find((x) => x.id === a.finding);
      if (!f) return "No such finding.";
      if (f.closed) return "This finding is closed.";
      if (a.action === "respond") {
        if (!mine.includes("focal")) return "The country office's focal point writes the management response.";
        f.response = { text: a.text, by: u.id, at: today() };
      } else if (a.action === "approve") {
        if (!mine.includes("ceo")) return "The CEO approves the corrective action.";
        if (!f.response) return "Wait for the country office's response first.";
        f.approved = { by: u.id, at: today() };
      } else {
        if (!mine.includes("lead")) return "The lead closes a finding after re-testing it.";
        if (!f.response) return "A finding closes after the country office has responded and the fix is re-tested.";
        f.closed = { by: u.id, at: today(), note: a.note };
      }
      detail = { finding: f.id };
    }
  }
  await db.transaction(async (tx) => {
    await saveBook(orgId, book, tx);
    await log(tx, orgId, `internal_review_${a.action}`, u.id, detail);
  });
  return null;
}
