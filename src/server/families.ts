import type { Story } from "@/lib/stories";
import { quarterOf, quarterRange } from "@/lib/results";
import { projectByCode } from "@/server/field-store";
import { loadProjectState } from "@/server/project-state";
import { qprData } from "@/server/qpr-store";

/**
 * Home's first line: what the project's work came to for people this quarter, from accepted
 * results, and one family's story. Women and men are given per result, never added across
 * results: the same person can be counted under several indicators.
 */

const prevQ = (q: string) => (q.endsWith("Q1") ? `${Number(q.slice(0, 4)) - 1}-Q4` : `${q.slice(0, 5)}Q${Number(q.slice(6)) - 1}`);
/** "Commercial greenhouses constructed (400 m2 each) for off-season production" → "Commercial greenhouses constructed". */
const short = (name: string) => {
  const cut = name.split(/[(,;:]| for | to | with | through /i)[0].trim();
  if (cut.length <= 60) return cut;
  // At a word boundary, never mid-word.
  return `${cut.slice(0, 60).replace(/\s+\S*$/, "")}…`;
};

export async function familiesView(code: string) {
  const now = quarterOf(new Date().toISOString().slice(0, 10));
  // This quarter once something is accepted in it; until then, the quarter just ended.
  let quarter = now;
  let d = await qprData(code, quarter);
  if (!d.rows.some((r) => r.quarter > 0)) {
    quarter = prevQ(now);
    d = await qprData(code, quarter);
  }
  const results = d.rows
    .filter((r) => r.quarter > 0)
    .sort((a, b) => Number(b.women + b.men > 0) - Number(a.women + a.men > 0) || b.records.quarter - a.records.quarter)
    .slice(0, 3)
    .map((r) => ({ code: r.donorCode || r.code, value: r.quarter, unit: r.unit, what: short(r.name), women: r.women, men: r.men, womenLed: r.womenLed, menLed: r.menLed }));
  const project = await projectByCode(code);
  const stories = (await loadProjectState<{ stories: Story[] }>(project.id, "stories", { stories: [] })).stories.filter((s) => s.status === "approved");
  const latest = stories.sort((a, b) => (b.approved?.at ?? b.at).localeCompare(a.approved?.at ?? a.at))[0] ?? null;
  const story = latest
    ? { id: latest.id, title: latest.title, excerpt: latest.text.replace(/\s+/g, " ").slice(0, 220), firstName: latest.firstName ?? null, place: [latest.district, latest.province].filter(Boolean).join(", "), photo: latest.photos.find((p) => p.caption.trim()) ?? latest.photos[0] ?? null }
    : null;
  return { quarter, current: quarter === now, range: quarterRange(quarter), results, more: Math.max(0, d.rows.filter((r) => r.quarter > 0).length - results.length), story };
}
export type FamiliesView = Awaited<ReturnType<typeof familiesView>>;
