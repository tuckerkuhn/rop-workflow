import { SECTIONS, overspentLines } from "@/lib/qpr";
import { proofCount, quarterOf, quarterRange } from "@/lib/results";
import { weekOf } from "@/lib/weekly";
import { qprData } from "@/server/qpr-store";
import { loadWeekly } from "@/server/weekly-store";

/**
 * What stands between the project and its next donor report, grouped by who has to act. Built
 * from the same figures and checks as the report itself, so Home and the report never disagree.
 * "Blocks" marks what stops the report going out; the rest is worth doing before it does.
 */

export type LoopOwner = "field" | "mel" | "writers" | "finance";
export type LoopItem = { owner: LoopOwner; text: string; href: string; blocks: boolean };

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 864e5).toISOString().slice(0, 10);

export async function nextReport(code: string) {
  const today = new Date().toISOString().slice(0, 10);
  const quarter = quarterOf(today);
  const { to } = quarterRange(quarter);
  // ROP sends the quarterly report about the 10th of the month after the quarter.
  const due = `${addDays(to, 1).slice(0, 7)}-10`;
  const d = await qprData(code, quarter);
  const inQ = d.results.filter((r) => r.date >= quarterRange(quarter).from && r.date <= to);
  const items: LoopItem[] = [];
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;

  const pending = inQ.filter((r) => r.status === "pending").length;
  const queried = inQ.filter((r) => r.status === "queried").length;
  const noProof = inQ.filter((r) => r.status === "accepted" && !proofCount(r)).length;
  if (pending) items.push({ owner: "mel", text: `${n(pending, "result", "results")} waiting for MEL to accept or query; they do not count until then`, href: "/progress/results", blocks: true });
  if (queried) items.push({ owner: "field", text: `${n(queried, "result", "results")} queried by MEL, to correct`, href: "/progress/results", blocks: false });
  if (noProof) items.push({ owner: "mel", text: `${n(noProof, "accepted result", "accepted results")} with no proof attached`, href: "/progress/results", blocks: false });

  if (!d.saved.released) {
    const keys = [...SECTIONS.filter((s) => s.key !== "story").map((s) => ({ key: s.key as string, heading: s.heading as string })), ...d.activities.map((a) => ({ key: `act.${a.code}`, heading: `Activity ${a.code}` }))];
    const empty = keys.filter((k) => !d.saved.sections[k.key]?.text.trim());
    const drafted = keys.filter((k) => d.saved.sections[k.key]?.drafted);
    const copied = keys.filter((k) => d.saved.sections[k.key]?.from);
    if (empty.length) items.push({ owner: "writers", text: `${n(empty.length, "section", "sections")} not written yet (${empty.slice(0, 3).map((k) => k.heading).join(", ")}${empty.length > 3 ? "…" : ""})`, href: "/progress/report", blocks: false });
    if (drafted.length) items.push({ owner: "writers", text: `${n(drafted.length, "AI draft", "AI drafts")} to read and correct`, href: "/progress/report", blocks: false });
    if (copied.length) items.push({ owner: "writers", text: `${n(copied.length, "section", "sections")} copied from last quarter, to review`, href: "/progress/report", blocks: false });
  }

  // Months that are over and not yet in Finance's workbook: the report's own check stops on them too.
  if (d.spend.source.kind === "import" && d.spend.missingMonths.length) items.push({ owner: "finance", text: `Spending not imported for ${d.spend.missingMonths.join(", ")}`, href: "/progress/report", blocks: true });
  const unexplained = overspentLines(d.spend, d.saved).filter((l) => l.explanation.length < 10);
  if (unexplained.length) items.push({ owner: "finance", text: `${n(unexplained.length, "budget line", "budget lines")} over budget without an explanation (${unexplained.map((l) => l.code).join(", ")})`, href: "/progress/report", blocks: false });

  // Any other stop item the report's own checks raise, so nothing that blocks release is missed.
  const covered = /waiting for MEL|spending import does not include/;
  for (const c of d.checks.filter((x) => x.level === "stop" && !covered.test(x.text))) items.push({ owner: "writers", text: c.text, href: "/progress/report", blocks: true });

  const weekly = await loadWeekly(code);
  const thisWeek = weekOf(today);
  const lastWeek = weekOf(addDays(thisWeek.from, -2));
  const find = (w: { from: string; to: string }) => weekly.weeks.find((x) => x.from <= w.to && w.from <= x.to);
  const last = find(lastWeek);
  if (weekly.weeks.length && (!last || !last.sent)) items.push({ owner: "field", text: `Last week's weekly update (${lastWeek.from} to ${lastWeek.to}) ${last ? "is not marked sent" : "was not written"}`, href: `/progress/weekly?from=${last?.from ?? lastWeek.from}`, blocks: false });
  if (!find(thisWeek) && today <= thisWeek.to) items.push({ owner: "field", text: "This week's weekly update is not started", href: "/progress/weekly", blocks: false });

  const order: LoopOwner[] = ["field", "mel", "writers", "finance"];
  items.sort((a, b) => Number(b.blocks) - Number(a.blocks) || order.indexOf(a.owner) - order.indexOf(b.owner));
  return { quarter, due, daysLeft: Math.round((Date.parse(due) - Date.parse(today)) / 864e5), released: !!d.saved.released, items };
}
export type NextReport = Awaited<ReturnType<typeof nextReport>>;
