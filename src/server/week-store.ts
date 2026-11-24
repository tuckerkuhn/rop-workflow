import { and, asc, eq, inArray, like, or, sql } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import type { Bill } from "@/lib/bills";
import { blockers, fromBill, fromProcurement, monthsOf, type Closeouts } from "@/lib/closeout";
import { foldExpenses, nextFor } from "@/lib/expense";
import { nextSigners } from "@/lib/hr";
import { DONE, maySign, stepById, type Procurement } from "@/lib/procurement";
import { EMPTY_SELECTION, type Selection } from "@/lib/selection";
import { emptyWeekly, weekOf, type WeeklyState } from "@/lib/weekly";
import { lensesFor } from "@/server/home-store";
import { EMPTY_FEEDBACK, overdue, type FeedbackLog } from "@/lib/feedback";
import { MAX_PRIORITIES, mondayOf, safeHref, weekKindOf, withProject, suggestFor, weekScore, weekSummaryFor, withCarried, type FinanceWork, type MelWork, type OrgWeek, type Priority, type ProjectWeek, type ProjectWork, type WeekKind, type WeekAction, type WeekPlan } from "@/lib/week";
import { demoMode, onProject } from "@/server/auth";
import { early } from "@/server/early";
import { loadHr } from "@/server/hr-store";
import { loadHomeJoining } from "@/server/home-store";
import { joinRunning, nextReport } from "@/server/next-report";
import { orgIdForPerson } from "@/server/org-settings-store";
import { DEMO_PROJECT } from "@/server/procurement-guard";
import { PARKED } from "@/server/project-store";
import { reportCalendar } from "@/server/report-calendar";

/**
 * The week ahead (lib/week): the summary and the priorities, across every project the person
 * oversees. The person's confirmed priorities are kept per person and per week in organization
 * state (key "week:<person>:<monday>").
 *
 * Far from the database every query is a round trip, and a server instance has only a few
 * connections, so the week reads in as few queries as it can: the documents it needs for every
 * project in one query, the field records (counts only) in one, the procurements in one, both
 * weeks' plans in one; and only what this person's kind of week says. Home and the next report are
 * joined when Home's own page is reading them at the same moment (server/next-report joinRunning).
 */

const realToday = () => new Date().toISOString().slice(0, 10);
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5);
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
const prevMonth = (m: string) => (m.endsWith("-01") ? `${Number(m.slice(0, 4)) - 1}-12` : `${m.slice(0, 4)}-${String(Number(m.slice(5)) - 1).padStart(2, "0")}`);

/** Whose week it is, or null for people who have no week page (lib/week weekKindOf, the rule Home's page uses too). */
export function weekKindFor(u: AppUser): WeekKind | null {
  return weekKindOf(u, lensesFor(u));
}

/** What each kind of week reads. Leadership reads no field work; Finance and the technical lead need no report calendar. */
const NEEDS = {
  lead: { reports: true, feedback: true, work: false, finance: false, mel: false },
  manager: { reports: true, feedback: true, work: true, finance: false, mel: false },
  technical: { reports: false, feedback: false, work: true, finance: false, mel: false },
  finance: { reports: false, feedback: false, work: false, finance: true, mel: false },
  mel: { reports: true, feedback: false, work: false, finance: false, mel: true },
} satisfies Record<WeekKind, Record<string, boolean>>;

type Docs = { feedback: FeedbackLog; selection: Selection; weekly: WeeklyState | null; bills: Bill[]; closeouts: Closeouts; imports: { at: string }[]; released: Map<string, string> };
const emptyDocs = (): Docs => ({ feedback: EMPTY_FEEDBACK, selection: EMPTY_SELECTION, weekly: null, bills: [], closeouts: {}, imports: [], released: new Map() });
type FieldRow = { projectId: string; id: string | null; kind: string | null; issues: { status?: string }[] | null };
type Home = NonNullable<Awaited<ReturnType<typeof loadHomeJoining>>>;

/**
 * The project_state documents the week reads, for every project in one query. A quarterly report
 * is read only for the day it was released, and the spending imports only for their history: not
 * the whole report or workbook.
 */
async function readDocs(ids: string[], kind: WeekKind): Promise<Map<string, Docs>> {
  const need = NEEDS[kind];
  const keys = [...(need.feedback ? ["feedback"] : []), ...(need.work ? ["selection", "weekly"] : []), ...(need.finance ? ["bills", "closeout", "actuals"] : [])];
  const out = new Map<string, Docs>(ids.map((id) => [id, emptyDocs()]));
  if (!ids.length || (!keys.length && !need.reports)) return out;
  const t = s.projectState;
  const rows = await db
    .select({
      projectId: t.projectId,
      key: t.key,
      data: sql<Record<string, unknown>>`case when ${t.key} like 'qpr:%' then jsonb_build_object('released', ${t.data}->'released') when ${t.key} = 'actuals' then jsonb_build_object('history', ${t.data}->'history') else ${t.data} end`,
    })
    .from(t)
    .where(and(inArray(t.projectId, ids), or(...(keys.length ? [inArray(t.key, keys)] : []), ...(need.reports ? [like(t.key, "qpr:%")] : []))));
  for (const r of rows) {
    const d = out.get(r.projectId);
    if (!d || !r.data) continue;
    // As server/project-state loadProjectState reads them: the saved fields over the empty document.
    if (r.key === "feedback") d.feedback = { ...EMPTY_FEEDBACK, ...r.data } as FeedbackLog;
    else if (r.key === "selection") d.selection = { ...EMPTY_SELECTION, ...r.data } as Selection;
    else if (r.key === "weekly") d.weekly = { ...emptyWeekly, ...r.data } as WeeklyState;
    else if (r.key === "bills") d.bills = ((r.data as { items?: Bill[] }).items ?? []) as Bill[];
    else if (r.key === "closeout") d.closeouts = r.data as Closeouts;
    else if (r.key === "actuals") d.imports = ((r.data as { history?: { at: string }[] }).history ?? []) as { at: string }[];
    else if (r.key.startsWith("qpr:")) {
      const at = (r.data as { released?: { at?: string } | null }).released?.at;
      if (at) d.released.set(r.key.slice(4), at);
    }
  }
  return out;
}

/** The field records the week counts (farmers, open issues), for every project in one query, without the rest of each record. */
async function readField(ids: string[]): Promise<FieldRow[]> {
  if (!ids.length) return [];
  const f = s.fieldItems;
  return db
    .select({ projectId: f.projectId, id: sql<string | null>`${f.data}->>'id'`, kind: sql<string | null>`${f.data}->>'kind'`, issues: sql<{ status?: string }[] | null>`${f.data}->'issues'` })
    .from(f)
    .where(inArray(f.projectId, ids));
}

async function readProcurements(ids: string[]): Promise<Map<string, Procurement[]>> {
  const out = new Map<string, Procurement[]>(ids.map((id) => [id, []]));
  if (!ids.length) return out;
  for (const r of await db.select({ projectId: s.procurements.projectId, data: s.procurements.data }).from(s.procurements).where(inArray(s.procurements.projectId, ids))) out.get(r.projectId)?.push(r.data as Procurement);
  return out;
}

/** What waits on this person in the HR book: expense reports at Finance's step, and payroll runs to approve. */
async function readOrg(u: AppUser): Promise<OrgWeek> {
  const empty: OrgWeek = { expenses: { n: 0, since: null }, payroll: [] };
  const book = await loadHr().catch(() => null);
  if (!book) return empty;
  const { state: hr, entries } = book;
  const lastSigned = (x: { at: string; signatures: { at: string }[] }) => (x.signatures.at(-1)?.at ?? x.at).slice(0, 10);
  const expenses = foldExpenses(entries, hr).reports.filter((r) => nextFor(r, hr)?.people.includes(u.id));
  const payroll = hr.proposals.filter((p) => p.type === "payroll" && p.status === "pending" && nextSigners(p, hr)?.people.includes(u.id));
  return {
    expenses: { n: expenses.length, since: expenses.map(lastSigned).sort()[0] ?? null },
    payroll: payroll.map((p) => ({ month: String((p as { month?: string }).month ?? ""), since: lastSigned(p) })).filter((p) => /^\d{4}-\d{2}$/.test(p.month)).sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/** What a manager or technical lead reads beyond leadership: money, checks, the field, selection and the weekly updates. */
function projectWork(home: Home, field: FieldRow[], docs: Docs, today: string): ProjectWork {
  const { selection: sel, weekly } = docs;
  const farmers = field.filter((i) => i.kind === "farmer");
  const thisWeek = weekOf(today);
  const lastWeek = weekOf(addDays(thisWeek.from, -2));
  const find = (w: { from: string; to: string }) => weekly?.weeks.find((x) => x.from <= w.to && w.from <= x.to);
  return {
    overBudget: home.budget.overspent.length,
    toCheck: home.mel.pending,
    queried: home.mel.queried,
    fieldIssues: field.reduce((t, i) => t + (Array.isArray(i.issues) ? i.issues : []).filter((x) => x?.status === "open").length, 0),
    farmers: farmers.length,
    undecided: sel.criteria.length ? farmers.filter((f) => !sel.decisions[f.id ?? ""]).length : 0,
    rulesWritten: sel.criteria.length > 0,
    // A project that has never written a weekly update is not behind on one.
    lastWeekSent: !weekly?.weeks.length || !!find(lastWeek)?.sent,
    thisWeekStarted: !weekly?.weeks.length || !!find(thisWeek),
    weeklyKept: !!weekly?.weeks.length,
  };
}

/** Finance's part of one project: month close, spending imports, budget lines, purchases and bills waiting on them. */
function financeWork(home: Home, procs: Procurement[], docs: Docs, u: AppUser, today: string): FinanceWork {
  const weekAgo = addDays(today, -7);
  const month = today.slice(0, 7);
  const items = [...procs.flatMap((p) => fromProcurement(p, p.step)), ...docs.bills.map(fromBill)];
  const lastEvent = (p: Procurement) => (p.timeline ?? []).map((e) => e.date).filter(Boolean).sort().at(-1)?.slice(0, 10) ?? null;
  return {
    unclosed: monthsOf(items)
      .filter(([m]) => m < month && !docs.closeouts[m])
      .map(([m, list]) => ({ month: m, blockers: blockers(list).length }))
      .sort((a, b) => a.month.localeCompare(b.month)),
    importWanted: prevMonth(month),
    importedTo: home.budget.importedTo,
    overspent: home.budget.overspent.map((l) => l.code),
    ahead: home.budget.ahead,
    purchases: procs
      .filter((p) => p.step !== DONE && !!stepById[p.step] && maySign(u, p, stepById[p.step].owner))
      .map((p) => ({ id: p.id, title: p.title, step: stepById[p.step].title, since: lastEvent(p) }))
      .sort((a, b) => (a.since ?? "9").localeCompare(b.since ?? "9") || a.id.localeCompare(b.id)),
    billsToVoucher: docs.bills.filter((b) => b.status === "approved").map((b) => ({ id: b.id, since: b.approval?.at?.slice(0, 10) ?? null })),
    imported: docs.imports.filter((h) => (h.at ?? "").slice(0, 10) >= weekAgo).length,
    closed: Object.entries(docs.closeouts)
      .filter(([, c]) => (c.at ?? "").slice(0, 10) >= weekAgo)
      .map(([m]) => m)
      .sort(),
    filed: docs.bills.filter((b) => b.status === "filed" && (b.voucher?.at ?? "").slice(0, 10) >= weekAgo).length,
  };
}

/** MEL's part of one project, all from Home's own rows: what waits to be checked, what was sent back, where the targets stand. */
function melWork(home: Home): MelWork {
  const row = (key: string) => home.actions.find((a) => a.key === key);
  const count = (key: string) => {
    const a = row(key);
    return a ? Number(a.msg?.vars?.n ?? Number.parseInt(a.text.replace(/^\D+/, ""), 10)) || 0 : 0;
  };
  return {
    results: { n: count("accept"), since: row("accept")?.since ?? null },
    forms: { n: count("field-forms"), since: row("field-forms")?.since ?? null },
    queried: home.mel.queried,
    mismatched: Number.parseInt(row("kobo-mismatch")?.text ?? "", 10) || 0,
    noData: home.schedule.words.no_data ?? 0,
    behind: home.schedule.late.map((l) => l.code ?? l.name),
  };
}

type Reads = { docs: Promise<Map<string, Docs>>; field: Promise<FieldRow[]>; procs: Promise<Map<string, Procurement[]>> };

async function projectWeek(p: { code: string; name: string; id: string }, u: AppUser, today: string, kind: WeekKind, reads: Reads): Promise<ProjectWeek | null> {
  const need = NEEDS[kind];
  const weekAgo = addDays(today, -7);
  const label = (r: { kind: "qpr" | "annual"; period: string }) => (r.kind === "qpr" ? `${r.period.slice(5)} ${r.period.slice(0, 4)} quarterly report` : `${r.period} annual report`);
  // All read together. Home and its next report are what Home's own page is reading for the open
  // project at this moment: joined, not read twice (server/next-report joinRunning).
  const [home, nr, cal, docs] = await Promise.all([
    loadHomeJoining(p.code, u).catch(() => null),
    need.reports ? joinRunning(`next-report:${p.code}`, () => nextReport(p.code)).catch(() => null) : null,
    need.reports ? reportCalendar(p.code, today).catch(() => ({ rows: [] as Awaited<ReturnType<typeof reportCalendar>>["rows"] })) : { rows: [] as Awaited<ReturnType<typeof reportCalendar>>["rows"] },
    reads.docs.then((m) => m.get(p.id) ?? emptyDocs()),
  ]);
  if (!home) return null;
  // "Afghanistan Community Resilience Programme (ACRP)" reads as "ACRP" in a sentence; a long name with no short form reads as its code.
  const short = p.name.match(/\(([^)]+)\)\s*$/)?.[1] ?? (p.name.length <= 24 ? p.name : p.code);
  const owed = cal.rows.filter((r) => !r.released && r.due && daysBetween(today, r.due) <= 30);
  const log = docs.feedback;
  return {
    code: p.code,
    short,
    late: home.schedule.late.length,
    reports: owed.map((r) => ({ label: label(r), due: r.due!, days: daysBetween(today, r.due!), late: today > r.due!, href: withProject(r.href, p.code) })),
    blocking: nr && !nr.released ? nr.blocking : 0,
    blockingHref: `/progress/report?q=${nr?.quarter ?? ""}&project=${encodeURIComponent(p.code)}#checks`,
    approvals: home.actions.filter((a) => a.bucket === "approve").map((a) => ({ text: a.text, href: withProject(a.href, p.code), since: a.since ?? null, short, key: a.key })),
    complaintsLate: log.entries.filter((e) => overdue(e, today)).length,
    complaintsNew: log.entries.filter((e) => e.date >= weekAgo && e.kind !== "thanks").length,
    complaintsAnswered: log.entries.filter((e) => e.answer && e.answer.on >= weekAgo).length,
    // Released in the last seven days: the quarterly reports the calendar lists as released, by their release date.
    // (Annual reports are written outside the app and never marked released, so none is listed.)
    released: cal.rows.filter((r) => r.released && r.kind === "qpr" && (docs.released.get(r.period) ?? "").slice(0, 10) >= weekAgo).map(label),
    ...(need.work ? { work: projectWork(home, (await reads.field).filter((f) => f.projectId === p.id), docs, today) } : {}),
    ...(need.finance ? { finance: financeWork(home, (await reads.procs).get(p.id) ?? [], docs, u, today) } : {}),
    ...(need.mel ? { mel: melWork(home) } : {}),
  };
}

const keyOf = (u: AppUser, week: string) => `week:${u.id}:${week}`;
const asPlan = (week: string, data: unknown): WeekPlan => ({ week, items: [], confirmedAt: null, ...((data as Partial<WeekPlan> | undefined) ?? {}) });
export async function planOf(orgId: string | null, u: AppUser, week: string): Promise<WeekPlan> {
  if (!orgId) return asPlan(week, undefined);
  const [row] = await db.select().from(s.organizationState).where(and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, keyOf(u, week)))).limit(1);
  return asPlan(week, row?.data);
}
/** This week's plan and last week's, in one query. */
async function plansOf(orgId: string | null, u: AppUser, weeks: [string, string]): Promise<[WeekPlan, WeekPlan]> {
  if (!orgId) return [asPlan(weeks[0], undefined), asPlan(weeks[1], undefined)];
  const rows = await db.select({ key: s.organizationState.key, data: s.organizationState.data }).from(s.organizationState).where(and(eq(s.organizationState.organizationId, orgId), inArray(s.organizationState.key, weeks.map((w) => keyOf(u, w)))));
  const of = (w: string) => asPlan(w, rows.find((r) => r.key === keyOf(u, w))?.data);
  return [of(weeks[0]), of(weeks[1])];
}

export async function loadWeek(u: AppUser, today = realToday()) {
  const week = mondayOf(today);
  const kind = weekKindFor(u) ?? "lead";
  const need = NEEDS[kind];
  // The person's own plan does not depend on the projects: read alongside them.
  // This week's plan, and last week's for what was left undone.
  const planLater = early(orgIdForPerson(u.id).catch(() => null).then((orgId) => plansOf(orgId, u, [week, addDays(week, -7)])));
  const orgLater = need.finance ? early(readOrg(u)) : null;
  // The running projects this person is on, as server/project-store listProjects lists them (real, not parked), with their ids, in one query.
  const listed = (await db.select({ id: s.projects.id, code: s.projects.code, name: s.projects.name, stage: s.projects.stage, kind: s.projects.kind }).from(s.projects).orderBy(asc(s.projects.createdAt)))
    .filter((p): p is typeof p & { code: string } => !!p.code && p.kind !== PARKED && p.kind !== "sample" && p.kind !== "sandbox")
    .filter((p) => (demoMode() || p.code !== DEMO_PROJECT) && onProject(u, p.code) && p.stage !== "Develop");
  const ids = listed.map((p) => p.id);
  const reads: Reads = {
    // A read that fails leaves its part of the week empty, as each read on its own did before.
    docs: early(readDocs(ids, kind).catch(() => new Map<string, Docs>())),
    field: need.work ? early(readField(ids).catch(() => [])) : Promise.resolve([]),
    procs: need.finance ? early(readProcurements(ids).catch(() => new Map<string, Procurement[]>())) : Promise.resolve(new Map()),
  };
  const projects = (await Promise.all(listed.map((p) => projectWeek({ code: p.code, name: p.name, id: p.id }, u, today, kind, reads)))).filter((x): x is ProjectWeek => !!x);
  const [plan, lastWeek] = await planLater;
  const org = (await orgLater) ?? undefined;
  return {
    week,
    today,
    kind,
    summary: weekSummaryFor(kind, projects, today, org),
    /** Proposed from the records; the person's own list once confirmed. */
    suggestions: withCarried(lastWeek, suggestFor(kind, projects, org)),
    /** How last week's confirmed list ended, for the line under the heading. */
    lastWeek: weekScore(lastWeek),
    plan,
    projects: projects.map((p) => ({ code: p.code, short: p.short })),
    max: MAX_PRIORITIES,
  };
}
export type WeekView = Awaited<ReturnType<typeof loadWeek>>;

/** Changes the person's own plan for this week. Read and saved with the row locked, so two taps never undo each other. */
export async function actOnWeek(u: AppUser, a: WeekAction, today = realToday()): Promise<string | null> {
  const week = mondayOf(today);
  const orgId = await orgIdForPerson(u.id).catch(() => null);
  if (!orgId) return "No organization is set up yet.";
  const key = keyOf(u, week);
  const where = and(eq(s.organizationState.organizationId, orgId), eq(s.organizationState.key, key));
  return db.transaction(async (tx) => {
    await tx.insert(s.organizationState).values({ organizationId: orgId, key, data: { week, items: [], confirmedAt: null } }).onConflictDoNothing();
    const [row] = await tx.select().from(s.organizationState).where(where).for("update");
    const plan: WeekPlan = { week, items: [], confirmedAt: null, ...((row?.data as Partial<WeekPlan> | undefined) ?? {}) };
    let next: WeekPlan;
    if (a.action === "confirm") {
      const was = new Map(plan.items.map((i) => [i.id, i]));
      const items: Priority[] = a.items.map((i, k) => ({ id: i.own && !was.has(i.id) ? `own:${Date.now()}:${k}` : i.id, text: i.text, href: i.own ? "" : safeHref(i.href), own: i.own, done: was.get(i.id)?.done ?? false }));
      if (new Set(items.map((i) => i.id)).size !== items.length) return "The same priority is on the list twice.";
      next = { week, items, confirmedAt: new Date().toISOString() };
    } else if (a.action === "done") {
      if (!plan.items.some((i) => i.id === a.id)) return "That priority is no longer on this week's list.";
      next = { ...plan, items: plan.items.map((i) => (i.id === a.id ? { ...i, done: a.done } : i)) };
    } else next = { ...plan, confirmedAt: null };
    await tx.update(s.organizationState).set({ data: next, updatedAt: new Date() }).where(where);
    return null;
  });
}
