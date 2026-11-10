import { openClaims, overspentLines, SECTIONS } from "@/lib/qpr";
import { addDays, deadlineFor, type Deadline, type Preflight, type PreflightItem, type ReadyItem, type ReportRef } from "@/lib/preflight";
import { proofCount, quarterOf, quarterRange, type ResultRecord } from "@/lib/results";
import { weekOf } from "@/lib/weekly";
import { loadBudgetView } from "@/server/budget-view-store";
import { faceView } from "@/server/face-store";
import { projectByCode } from "@/server/field-store";
import { periodReport } from "@/server/period-report-store";
import { projectRules } from "@/server/policy-store";
import { qprData } from "@/server/qpr-store";
import { loadResults } from "@/server/results-store";
import { loadWeekly } from "@/server/weekly-store";
import { selfApprovedIn } from "@/server/solo";
import { listWorkItems } from "@/server/work-store";

/**
 * Pre-flight for a quarterly report, an annual report or a FACE form (lib/preflight). The
 * quarterly report's own checks (lib/qpr checksFor) are the base: every "stop" there blocks here
 * too, so the report page, pre-flight and Home never disagree. Pre-flight adds what the report's
 * checks do not cover: targets with nothing recorded, spending that matches no budget line, the plan
 * and budget sign-off, the claim check's findings, and the deadline.
 */

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

type Ctx = { code: string; items: PreflightItem[]; ready: ReadyItem[] };
const add = (c: Ctx, i: PreflightItem) => c.items.push(i);
const ok = (c: Ctx, key: string, vars?: ReadyItem["vars"]) => c.ready.push({ key, ...(vars ? { vars } : {}) });

/** Leaving Design is the plan and budget sign-off (server/stage-store). */
async function signOff(c: Ctx) {
  const p = await projectByCode(c.code);
  if (p.stage === "Design") add(c, { group: "blocks", owner: "lead", text: "The plan and budget are not signed off yet (the project is still in Design)", key: "pf.c.signOff", href: "/progress" });
  else ok(c, "pf.ok.signOff");
}

/** Spending rows in Finance's import that match no budget line. */
async function unmatchedSpend(c: Ctx) {
  const v = await loadBudgetView(c.code).catch(() => null);
  if (!v || !v.imported || !v.activities.length) return;
  const rows = v.notInBudget.filter((l) => Math.abs(l.actual) > 0.5);
  if (rows.length) add(c, { group: "fix", owner: "finance", text: `${n(rows.length, "spending row", "spending rows")} in Finance's import ${rows.length === 1 ? "matches" : "match"} no budget line (${rows.slice(0, 3).map((l) => l.code).join(", ")}${rows.length > 3 ? "…" : ""})`, key: "pf.c.unmatched", vars: { n: rows.length, codes: rows.slice(0, 3).map((l) => l.code).join(", ") }, href: "/progress/budget" });
  else ok(c, "pf.ok.unmatched");
}

/**
 * The deadline for a report on a period ending `end`: a "Report deadline" milestone in Tasks, else
 * the donor's rule in policy. The one function for it: pre-flight, Home's next-report line and
 * Home's deadline tile all call it.
 */
export async function reportDeadline(code: string, end: string, window: number, rule: "quarterlyReportDays" | "annualReportDays" | null): Promise<Deadline> {
  const rules = await projectRules(code);
  const line = (k: string) => rules.lines.find((l) => l.key === k);
  const reviewDays = Number(rules.values.reviewDays ?? 0) || 0;
  const days = rule && rules.values[rule] != null ? Number(rules.values[rule]) : null;
  const src = rule ? (line(rule)?.donor?.source ?? line(rule)?.org?.source ?? "") : "";
  const { items } = await listWorkItems(code);
  const ms = items.filter((i) => i.type === "milestone" && i.milestoneKind === "report_deadline").map((i) => ({ title: i.title, date: i.date ?? "", done: !!i.doneAt }));
  return deadlineFor(end, window, ms, days, src, reviewDays);
}

/** A target with nothing recorded: planned this period (or with a target this year) and no result of any kind. */
function noResult(c: Ctx, rows: { code: string; donorCode: string; name: string }[], results: ResultRecord[], from: string, to: string, q: string | null) {
  const empty = rows.filter((r) => !results.some((x) => x.indicator === r.code && x.date >= from && x.date <= to));
  for (const r of empty) add(c, { group: "fix", owner: "field", text: `${r.donorCode} (${r.name}) has a target but no result recorded in the period`, key: "pf.c.noResult", vars: { code: r.donorCode, name: r.name }, href: `/progress/results?indicator=${r.code}${q ? `&q=${q}` : ""}` });
  if (!empty.length && rows.length) ok(c, "pf.ok.noResult");
}

async function qpr(c: Ctx, quarter: string): Promise<Omit<Preflight, "items" | "ready">> {
  const d = await qprData(c.code, quarter);
  const { from, to } = quarterRange(quarter);
  const q = `q=${quarter}`;
  const inQ = d.results.filter((r) => r.date >= from && r.date <= to);
  const pending = inQ.filter((r) => r.status === "pending").length;
  const queried = inQ.filter((r) => r.status === "queried").length;
  const noProof = inQ.filter((r) => r.status === "accepted" && !proofCount(r)).length;
  if (pending) add(c, { group: "blocks", owner: "mel", text: `${n(pending, "result", "results")} waiting for MEL to accept or query; they do not count until then`, href: `/progress/results?${q}` });
  else ok(c, "pf.ok.accepted");
  if (queried) add(c, { group: "fix", owner: "field", text: `${n(queried, "result", "results")} queried by MEL, to correct`, href: `/progress/results?${q}` });
  if (noProof) add(c, { group: "fix", owner: "mel", text: `${n(noProof, "accepted result", "accepted results")} with no proof attached`, href: `/progress/results?${q}` });
  else if (inQ.length) ok(c, "pf.ok.proof");

  // Targets for the quarter: planned in the workplan for it, or (no workplan dates) a year target with nothing at all this year.
  const qn = Number(quarter.slice(-1));
  const due = d.rows.filter((r) => (r.planned ? r.planned.includes(qn) : r.yearTarget > 0 && r.year === 0 && r.records.open === 0));
  noResult(c, due, d.results, from, to, quarter);
  await soloCount(c, from, to);

  // Each row lands on the place in the report where it is fixed (the page scrolls to the #part once loaded).
  if (!d.saved.released) {
    const keys = [...SECTIONS.filter((s) => s.key !== "story").map((s) => ({ key: s.key as string, heading: s.heading as string })), ...d.activities.map((a) => ({ key: `act.${a.code}`, heading: `Activity ${a.code}` }))];
    const empty = keys.filter((k) => !d.saved.sections[k.key]?.text.trim());
    const drafted = keys.filter((k) => d.saved.sections[k.key]?.drafted);
    const copied = keys.filter((k) => d.saved.sections[k.key]?.from);
    if (empty.length) add(c, { group: "fix", owner: "writers", text: `${n(empty.length, "section", "sections")} not written yet (${empty.slice(0, 3).map((k) => k.heading).join(", ")}${empty.length > 3 ? "…" : ""})`, href: `/progress/report?${q}#sec-${empty[0].key}` });
    else ok(c, "pf.ok.written");
    if (drafted.length) add(c, { group: "fix", owner: "writers", text: `${n(drafted.length, "AI draft", "AI drafts")} to read and correct`, href: `/progress/report?${q}#sec-${drafted[0].key}` });
    if (copied.length) add(c, { group: "fix", owner: "writers", text: `${n(copied.length, "section", "sections")} copied from last quarter, to review`, href: `/progress/report?${q}#sec-${copied[0].key}` });
    // The claim check (lib/qpr ClaimCheck): its findings are worth a look; people decide.
    const cc = d.saved.claimCheck;
    // Findings a person decided to keep as written are settled; the rest are still to look at.
    const openCc = openClaims(cc);
    if (openCc.length) add(c, { group: "fix", owner: "writers", text: `The claim check questioned ${n(openCc.length, "sentence", "sentences")} against the evidence`, key: "pf.c.claims", vars: { n: openCc.length }, href: `/progress/report?${q}#claims` });
    else if (cc) ok(c, "pf.ok.claims");
    else if (!empty.length) add(c, { group: "fix", owner: "writers", text: "The text has not been checked against the evidence yet (claim check)", key: "pf.c.claimsNotRun", href: `/progress/report?${q}#claims` });
  }

  if (d.spend.source.kind === "import" && d.spend.missingMonths.length) add(c, { group: "blocks", owner: "finance", text: `Spending not imported for ${d.spend.missingMonths.join(", ")}`, href: "/progress/budget" });
  else if (d.spend.source.kind === "import") ok(c, "pf.ok.spend");
  // The report prints the typed figure in place of Finance's: say so before it goes out.
  if (d.saved.quarterSpend !== null && d.spend.quarter !== null && Math.abs(d.saved.quarterSpend - d.spend.quarter) > 1)
    add(c, { group: "fix", owner: "finance", text: `This quarter's spending is typed in as ${d.saved.quarterSpend.toLocaleString("en-US")}, but Finance's import says ${d.spend.quarter.toLocaleString("en-US")}: the report will print the typed figure`, key: "pf.c.typedSpend", vars: { typed: d.saved.quarterSpend.toLocaleString("en-US"), imported: d.spend.quarter.toLocaleString("en-US") }, href: `/progress/report?${q}#info` });
  const unexplained = overspentLines(d.spend, d.saved).filter((l) => l.explanation.length < 10);
  if (unexplained.length) add(c, { group: "fix", owner: "finance", text: `${n(unexplained.length, "budget line", "budget lines")} over budget without an explanation (${unexplained.map((l) => l.code).join(", ")})`, href: `/progress/report?${q}#overspend` });
  await unmatchedSpend(c);

  // Every other stop the report's own checks raise, so nothing that blocks release is missed.
  const covered = /waiting for MEL|spending import does not include/;
  for (const x of d.checks.filter((x) => x.level === "stop" && !covered.test(x.text))) add(c, { group: "blocks", owner: "writers", text: x.text, href: `/progress/report?${q}` });

  await signOff(c);

  // Weekly updates feed the narrative: only for the quarter under way.
  const today = new Date().toISOString().slice(0, 10);
  if (quarterOf(today) === quarter) {
    const weekly = await loadWeekly(c.code);
    const thisWeek = weekOf(today);
    const lastWeek = weekOf(addDays(thisWeek.from, -2));
    const find = (w: { from: string; to: string }) => weekly.weeks.find((x) => x.from <= w.to && w.from <= x.to);
    const last = find(lastWeek);
    if (weekly.weeks.length && (!last || !last.sent)) add(c, { group: "fix", owner: "field", text: `Last week's weekly update (${lastWeek.from} to ${lastWeek.to}) ${last ? "is not marked sent" : "was not written"}`, href: `/progress/weekly?from=${last?.from ?? lastWeek.from}` });
    if (!find(thisWeek) && today <= thisWeek.to) add(c, { group: "fix", owner: "field", text: "This week's weekly update is not started", href: "/progress/weekly" });
  }

  return {
    report: { kind: "qpr", quarter },
    label: `Quarterly report ${quarter.replace("-", " ")}`,
    released: !!d.saved.released,
    deadline: await reportDeadline(c.code, to, 60, "quarterlyReportDays"),
    href: `/progress/report?${q}`,
  };
}
async function soloCount(c: Ctx, from: string, to: string) {
  const k = await selfApprovedIn(c.code, from, to);
  if (k) add(c, { group: "fix", owner: "lead", text: `${n(k, "sign-off", "sign-offs")} in the period ${k === 1 ? "was" : "were"} approved by the person who prepared ${k === 1 ? "it" : "them"} (solo mode): worth a second look before release`, key: "so.pf", vars: { n: k }, href: "/progress/audit" });
}

async function annual(c: Ctx, year: number): Promise<Omit<Preflight, "items" | "ready">> {
  const v = await periodReport(c.code, { kind: "annual", year });
  const { from, to } = v.range;
  const today = new Date().toISOString().slice(0, 10);
  const ended = [1, 2, 3, 4].map((k) => `${year}-Q${k}`).filter((q) => quarterRange(q).to < today);
  const released = new Set(v.quarters.filter((q) => q.released).map((q) => q.quarter));
  const open = ended.filter((q) => !released.has(q));
  for (const q of open) add(c, { group: "blocks", owner: "writers", text: `The ${q.replace("-", " ")} quarterly report is not released, so its text and figures are not final`, key: "pf.c.quarterOpen", vars: { q: q.replace("-", " ") }, href: `/progress/report?q=${q}` });
  if (ended.length && !open.length) ok(c, "pf.ok.quarters");
  const results = await loadResults(c.code);
  const inY = results.filter((r) => r.date >= from && r.date <= to);
  const pending = inY.filter((r) => r.status === "pending").length;
  const noProof = inY.filter((r) => r.status === "accepted" && !proofCount(r)).length;
  if (pending) add(c, { group: "blocks", owner: "mel", text: `${n(pending, "result", "results")} this year waiting for MEL to accept or query`, key: "pf.c.pendingYear", vars: { n: pending }, href: "/progress/results" });
  else ok(c, "pf.ok.accepted");
  if (noProof) add(c, { group: "fix", owner: "mel", text: `${n(noProof, "accepted result", "accepted results")} this year with no proof attached`, key: "pf.c.noProofYear", vars: { n: noProof }, href: "/progress/results" });
  else if (inY.length) ok(c, "pf.ok.proof");
  noResult(c, v.rows.filter((r) => r.target > 0), results, from, to, null);
  await soloCount(c, from, to);
  await unmatchedSpend(c);
  await signOff(c);
  return {
    report: { kind: "annual", year },
    label: `Annual report ${year}`,
    released: false,
    deadline: await reportDeadline(c.code, to, 120, "annualReportDays"),
    href: "/progress/annual",
  };
}

async function face(c: Ctx, month: string): Promise<Omit<Preflight, "items" | "ready">> {
  const v = await faceView(c.code, month);
  if (!v.imported) add(c, { group: "blocks", owner: "finance", text: `Spending for ${month} is not imported from Finance's workbook`, key: "pf.c.faceImport", vars: { month }, href: "/progress/budget" });
  else ok(c, "pf.ok.spend");
  if (!v.header.signer.trim() || !v.header.signerTitle.trim()) add(c, { group: "blocks", owner: "finance", text: "Who signs the form, and their title, are not filled in", key: "pf.c.faceSigner", href: "/progress/face" });
  else ok(c, "pf.ok.faceSigner");
  if (!v.header.programme.trim()) add(c, { group: "fix", owner: "finance", text: "The programme title is not filled in", key: "pf.c.faceProgramme", href: "/progress/face" });
  await unmatchedSpend(c);
  await signOff(c);
  return {
    report: { kind: "face", month },
    label: `FACE form ${month}`,
    released: false,
    deadline: { due: null, aim: null, reviewDays: 0, source: null },
    href: "/progress/face",
  };
}

export async function preflight(code: string, report: ReportRef): Promise<Preflight> {
  const c: Ctx = { code, items: [], ready: [] };
  const head = report.kind === "qpr" ? await qpr(c, report.quarter) : report.kind === "annual" ? await annual(c, report.year) : await face(c, report.month);
  // Released: what is left is history, not a to-do.
  const items = head.released ? [] : c.items.sort((a, b) => Number(b.group === "blocks") - Number(a.group === "blocks"));
  return { ...head, items, ready: c.ready };
}
