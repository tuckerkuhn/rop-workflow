import { and, asc, eq, inArray } from "drizzle-orm";
import { db, schema as s } from "@/db";
import type { AppUser } from "@/lib/demo";
import type { Story } from "@/lib/stories";
import { onProject } from "@/server/auth";
import { donorNameOf } from "@/server/field-store";
import { loadHome } from "@/server/home-store";
import { DEMO_PROJECT } from "@/server/procurement-guard";
import { listProjects } from "@/server/project-store";
import { loadProjectState } from "@/server/project-state";
import { loadResults } from "@/server/results-store";
import { qprData } from "@/server/qpr-store";
import { quarterOf } from "@/lib/results";
import { measured, RESULT_SOURCES } from "@/lib/measure";
import { measuresFor } from "@/server/measures";

/**
 * ROP's track record for proposals: each project's donor, dates and budget, what it has achieved
 * (accepted results against life-of-project targets), and its approved stories whose consent
 * covers ROP's own communications. Only those stories' photos are used: the pack goes to other
 * donors, beyond what people agreed to for one donor's report.
 */
export async function trackRecord(u: AppUser) {
  const projects = (await listProjects()).filter((p) => p.code && p.code !== DEMO_PROJECT && p.stage !== "Develop" && onProject(u, p.code));
  const out = [];
  for (const p of projects) {
    const code = p.code!;
    const [row] = await db.select().from(s.projects).where(eq(s.projects.code, code)).limit(1);
    const home = await loadHome(code, u).catch(() => null);
    // The quarterly report holds the whole agreement: its budget across phases, and its duration as the agreement states it.
    const q = await qprData(code, quarterOf(new Date().toISOString().slice(0, 10))).catch(() => null);
    const indicators = await db.select().from(s.indicators).where(and(eq(s.indicators.projectId, row.id), inArray(s.indicators.source, RESULT_SOURCES))).orderBy(asc(s.indicators.position));
    const results = (await loadResults(code)).filter((r) => r.status === "accepted");
    const measureOf = await measuresFor(row.id);
    const achieved = indicators
      .map((i) => {
        const mine = results.filter((r) => r.indicator === i.code);
        // The same figure as the reports (lib/measure): a sum, or for a survey target its latest figure. Women and records stay those of every accepted result.
        const m = measured({ baseline: i.baseline === null ? null : Number(i.baseline), unit: i.unit }, mine, measureOf(i));
        return { code: i.donorCode ?? i.code, name: i.name, unit: i.unit, total: m.value, target: Number(i.target), women: mine.reduce((t, r) => t + (r.female ?? 0), 0), proof: mine.filter((r) => r.files.length || (r.links ?? []).length).length, records: mine.length };
      })
      .filter((x) => x.total > 0);
    const stories = (await loadProjectState<{ stories: Story[] }>(row.id, "stories", { stories: [] })).stories
      .filter((st) => st.status === "approved" && st.consent?.uses.includes("comms"))
      .map((st) => ({ title: st.title, text: st.text, place: [st.district, st.province].filter(Boolean).join(", "), photo: st.photos.find((ph) => ph.caption.trim()) ?? null }));
    out.push({
      code,
      name: row.name,
      donor: await donorNameOf(row),
      country: row.country,
      start: row.startDate,
      end: row.endDate,
      duration: q?.saved.info.duration?.trim() || null,
      budget: q && q.spend.budget ? { amount: q.spend.budget, currency: q.spend.currency, spentPct: q.spend.budget ? Math.round((q.spend.cumulative / q.spend.budget) * 100) : null } : home ? { amount: home.budget.approved, currency: home.budget.currency, spentPct: home.budget.spentPct } : null,
      achieved,
      // Never a sum across indicators: the same woman can be counted under several. The largest
      // single indicator is what can honestly be said for the project: "at least N women".
      womenAtLeast: Math.max(0, ...achieved.map((a) => a.women)),
      stories,
    });
  }
  return { asOf: new Date().toISOString().slice(0, 10), projects: out };
}
export type TrackRecord = Awaited<ReturnType<typeof trackRecord>>;
