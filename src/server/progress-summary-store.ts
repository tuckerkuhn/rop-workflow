import type { AppUser } from "@/lib/demo";
import { proofCount, quarterRange } from "@/lib/results";
import { loadBudgetView } from "@/server/budget-view-store";
import { loadReview } from "@/server/monthly-review-store";
import { loadActivities } from "@/server/activities-store";

/**
 * The top of Progress: what deserves celebrating and what needs attention, each item specific and
 * linked to where to act. Celebrations come from accepted results only; attention items are ranked,
 * most serious first, and say why they matter.
 */

export type Win = { key: string; text: string; detail: string; href: string };
export type Concern = { key: string; level: "critical" | "warning"; text: string; why: string; href: string };

const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });
const qLabel = (d: string) => `Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1} ${d.slice(0, 4)}`;
const quarterOf = (d: string) => `${d.slice(0, 4)}-Q${Math.floor((Number(d.slice(5, 7)) - 1) / 3) + 1}`;
const prevQuarter = (q: string) => (q.endsWith("Q1") ? `${Number(q.slice(0, 4)) - 1}-Q4` : `${q.slice(0, 5)}Q${Number(q.slice(6)) - 1}`);

export async function loadProgressSummary(code: string, u: AppUser) {
  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);
  const v = await loadReview(code, month, u);
  const thisQ = quarterOf(today);
  const qNo = Number(thisQ.slice(6));
  const lastQ = prevQuarter(thisQ);
  const accepted = v.results.filter((r) => r.status === "accepted");
  const nameOf = (code: string) => v.indicators.find((i) => i.code === code);

  // ---- Worth celebrating ----
  const wins: Win[] = [];
  const done = v.indicators.filter((i) => i.status === "completed" && i.yearTarget > 0).sort((a, b) => b.year / b.yearTarget - a.year / a.yearTarget);
  for (const i of done)
    wins.push({
      key: `done-${i.code}`,
      // The numbers first: indicator names are long and get cut on screen.
      text: `${n(i.year)} of ${n(i.yearTarget)} ${i.unit} · ${i.name}`,
      detail: i.year > i.yearTarget ? `${Math.round((i.year / i.yearTarget) * 100)}% of the ${v.year} target (${i.donorCode})` : `${v.year} target met (${i.donorCode})`,
      href: "/progress/results",
    });
  // The quarter just ended (or this one, once it has results): the biggest accepted totals.
  for (const q of [thisQ, lastQ]) {
    const { from, to } = quarterRange(q);
    const inQ = accepted.filter((r) => r.date >= from && r.date <= to);
    if (!inQ.length) continue;
    const by = new Map<string, number>();
    for (const r of inQ) by.set(r.indicator, (by.get(r.indicator) ?? 0) + r.value);
    const top = [...by.entries()].filter(([c]) => nameOf(c)).sort((a, b) => b[1] / (nameOf(b[0])!.yearTarget || 1) - a[1] / (nameOf(a[0])!.yearTarget || 1)).slice(0, 3);
    wins.push({
      key: `quarter-${q}`,
      text: `${qLabel(from)} delivered ${top.map(([c, val]) => `${n(val)} ${nameOf(c)!.unit} (${nameOf(c)!.donorCode})`).join(", ")}`,
      detail: `${inQ.length} accepted ${inQ.length === 1 ? "result" : "results"} in the quarter`,
      href: "/progress/results",
    });
    break;
  }
  // Work finished within its budget line: said on the target win it belongs to, not as a second win.
  const bv = await loadBudgetView(code);
  for (const l of bv.activities.flatMap((a) => a.lines)) {
    if (!l.results.length || !l.approved || l.spentPct === null || l.spentPct > 100) continue;
    if (!l.results.every((r) => r.target > 0 && r.achieved >= r.target)) continue;
    for (const r of l.results) {
      const w = wins.find((x) => x.key === `done-${r.indicator}`);
      if (w) w.detail += `, for ${Math.round(l.spentPct)}% of its budget line`;
    }
  }
  if (v.review.signedOff) wins.push({ key: "review", text: `The ${v.month} monthly review is signed off`, detail: "Plan changes decided and recorded", href: "/progress/review" });

  // ---- Needs attention ----
  const concerns: Concern[] = [];
  for (const i of v.indicators.filter((x) => x.status === "delayed" || x.status === "not_implemented"))
    concerns.push({ key: `late-${i.code}`, level: "critical", text: `${i.donorCode} ${i.name} is ${i.status === "delayed" ? "delayed" : "not implemented"}: ${n(i.year)} of ${n(i.yearTarget)} ${i.unit}`, why: "Its workplan window has closed short of the target.", href: "/progress/review" });
  // Due this quarter and nothing recorded yet: the last chance is now. One line for all of them.
  const due = v.indicators.filter((x) => x.status === "not_started" && x.planned?.length && Math.max(...x.planned) === qNo && x.yearTarget > 0);
  if (due.length)
    concerns.push({
      key: "due",
      level: "warning",
      text: `${due.length} ${due.length === 1 ? "target is" : "targets are"} due this quarter with nothing recorded: ${due.map((i) => i.donorCode).join(", ")}`,
      why: `Their workplan windows end in ${qLabel(today)}. Record progress, or re-plan them in the monthly review.`,
      href: "/progress/review",
    });
  for (const i of v.indicators.filter((x) => x.planned && x.planned.length === 0 && x.yearTarget > x.year))
    concerns.push({ key: `unplanned-${i.code}`, level: "warning", text: `${i.donorCode} ${i.name} has a ${v.year} target of ${n(i.yearTarget)} ${i.unit} but no quarter in the workplan`, why: "Without a scheduled window nobody owns when it happens; re-plan it in the monthly review.", href: "/progress/review" });
  const overspent = v.budget.flagged.filter((l) => l.flags.some((f) => f.level === "stop"));
  for (const l of overspent) concerns.push({ key: `over-${l.code}`, level: "critical", text: `${l.code} is ${Math.round(l.spentPct ?? 0)}% spent: ${l.description}`, why: "Spending above the approved line needs an explanation or an approved realignment before the donor sees it.", href: "/progress/budget" });
  const above = v.budget.flagged.filter((l) => l.flags.some((f) => f.level === "check" && /forecast/i.test(f.text)));
  if (above.length) concerns.push({ key: "forecast", level: "warning", text: `${above.length} budget ${above.length === 1 ? "line is" : "lines are"} forecast more than 10% above approved`, why: "Check the donor has agreed the revision for each.", href: "/progress/budget" });
  const acts = await loadActivities(code, u).catch(() => null);
  if (acts) {
    const late = acts.rows.filter((r) => r.timing === "late");
    if (late.length) concerns.push({ key: "acts-late", level: "warning", text: `${late.length} workplan ${late.length === 1 ? "activity is" : "activities are"} past ${late.length === 1 ? "its" : "their"} planned quarter and not done: ${late.slice(0, 4).map((r) => r.code).join(", ")}${late.length > 4 ? "…" : ""}`, why: "Mark them done, or say what is in the way and re-plan them in the monthly review.", href: "/work/activities" });
    const unowned = acts.rows.filter((r) => r.timing === "due_now" && !r.owner);
    if (unowned.length) concerns.push({ key: "acts-owner", level: "warning", text: `${unowned.length} ${unowned.length === 1 ? "activity" : "activities"} due this quarter ${unowned.length === 1 ? "has" : "have"} no owner`, why: "Work nobody owns slips: assign each to a person.", href: "/work/activities" });
  }
  const pending = v.results.filter((r) => r.status === "pending").length;
  if (pending) concerns.push({ key: "pending", level: "warning", text: `${pending} ${pending === 1 ? "result is" : "results are"} waiting for MEL`, why: "They do not count in reports until accepted.", href: "/progress/results" });
  const queried = v.results.filter((r) => r.status === "queried").length;
  if (queried) concerns.push({ key: "queried", level: "warning", text: `${queried} ${queried === 1 ? "result was" : "results were"} queried by MEL`, why: "The person who recorded each needs to answer it.", href: "/progress/results" });
  const noProof = accepted.filter((r) => r.date >= `${today.slice(0, 4)}-01-01` && !proofCount(r)).length;
  if (noProof) concerns.push({ key: "proof", level: "warning", text: `${noProof} accepted ${noProof === 1 ? "result has" : "results have"} no proof attached this year`, why: "Every figure in a donor report should click through to its evidence.", href: "/progress/results" });
  const stops = v.checks.filter((c) => c.level === "stop").length;
  if (stops) concerns.push({ key: "stops", level: "warning", text: `The ${qLabel(today)} report has ${stops} stop ${stops === 1 ? "item" : "items"}`, why: "It cannot be released until they are fixed.", href: "/progress/report" });
  // Impact first: results and the activities that deliver them, then money, then evidence and
  // workflow. Within each, what needs action now before what needs it soon.
  const group = (k: string) => (/^(late-|due$|unplanned-|acts-)/.test(k) ? 0 : /^(over-|forecast$)/.test(k) ? 1 : 2);
  concerns.sort((a, b) => group(a.key) - group(b.key) || Number(b.level === "critical") - Number(a.level === "critical"));

  return { project: v.project, quarter: qLabel(today), year: v.year, wins, concerns };
}
export type ProgressSummary = Awaited<ReturnType<typeof loadProgressSummary>>;
