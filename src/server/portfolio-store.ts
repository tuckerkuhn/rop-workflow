import type { AppUser } from "@/lib/demo";
import { demoMode, onProject } from "@/server/auth";
import { homeStanding } from "@/server/home-store";
import { loadReview } from "@/server/monthly-review-store";
import { listProjects } from "@/server/project-store";
import { loadProgressSummary } from "@/server/progress-summary-store";
import { DEMO_PROJECT } from "@/server/procurement-guard";

/**
 * Every project the person works on, side by side: where results stand against this year's
 * targets, what is late, and money against time. Projects still in Develop have no plan yet and
 * are listed by stage only. The demo project is left out of a live organization's portfolio; in
 * demo mode it is the portfolio, so the page is never empty in front of an audience.
 */
export async function loadPortfolio(u: AppUser) {
  const projects = (await listProjects()).filter((p) => (demoMode() || p.code !== DEMO_PROJECT) && onProject(u, p.code));
  // As of this month, the month Home and the summary judge by. In a read-only request the summary
  // shares this same review (server/request-memo), so it is built once per project.
  const month = new Date().toISOString().slice(0, 7);
  const rows = await Promise.all(
    projects.map(async (p) => {
      const short = p.name.match(/\(([^)]+)\)\s*$/)?.[1] ?? p.code;
      if (p.stage === "Develop") return { code: p.code, name: p.name, short, stage: p.stage, ready: false as const };
      const [review, sum] = await Promise.all([loadReview(p.code, month, u).catch(() => null), loadProgressSummary(p.code, u).catch(() => null)]);
      if (!review) return { code: p.code, name: p.name, short, stage: p.stage, ready: false as const };
      // The shared words (lib/target-status), as Progress and the report say them: a target
      // marked under way with no accepted result is "No data", not "On track".
      // Judged exactly as Home's "On time" and "On budget" panels judge it (server/home-store homeStanding).
      const { schedule, budget } = homeStanding(review);
      const w = schedule.words;
      return {
        code: p.code,
        name: p.name,
        short,
        stage: p.stage,
        ready: true as const,
        indicators: schedule.total,
        met: w.done,
        onTrack: w.on_track,
        noData: w.no_data,
        late: schedule.late.length,
        level: schedule.level,
        lateNames: schedule.late.slice(0, 3).map((i) => `${i.code} ${i.name}`),
        budget: { currency: budget.currency, approved: budget.approved, spentPct: budget.spentPct, timePct: budget.timePct, ahead: budget.ahead, overspent: budget.overspent.length },
        // Impact first: a slipping result or activity before money or workflow.
        topConcern: (sum?.concerns.find((c) => /^(late-|due$|acts-|unplanned-)/.test(c.key)) ?? sum?.concerns[0])?.text ?? null,
        topWin: sum?.wins[0]?.text ?? null,
      };
    }),
  );
  return { rows };
}
export type PortfolioView = Awaited<ReturnType<typeof loadPortfolio>>;
