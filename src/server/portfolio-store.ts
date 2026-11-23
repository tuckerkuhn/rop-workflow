import type { AppUser } from "@/lib/demo";
import { demoMode, onProject } from "@/server/auth";
import { loadHome } from "@/server/home-store";
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
  const rows = await Promise.all(
    projects.map(async (p) => {
      const short = p.name.match(/\(([^)]+)\)\s*$/)?.[1] ?? p.code;
      if (p.stage === "Develop") return { code: p.code, name: p.name, short, stage: p.stage, ready: false as const };
      const [home, sum] = await Promise.all([loadHome(p.code, u).catch(() => null), loadProgressSummary(p.code, u).catch(() => null)]);
      if (!home) return { code: p.code, name: p.name, short, stage: p.stage, ready: false as const };
      // The shared words (lib/target-status), as Progress and the report say them: a target
      // marked under way with no accepted result is "No data", not "On track".
      const w = home.schedule.words;
      return {
        code: p.code,
        name: p.name,
        short,
        stage: p.stage,
        ready: true as const,
        indicators: home.schedule.total,
        met: w.done,
        onTrack: w.on_track,
        noData: w.no_data,
        late: home.schedule.late.length,
        level: home.schedule.level,
        lateNames: home.schedule.late.slice(0, 3).map((l) => `${l.code} ${l.name}`),
        budget: { currency: home.budget.currency, approved: home.budget.approved, spentPct: home.budget.spentPct, timePct: home.budget.timePct, ahead: home.budget.ahead, overspent: home.budget.overspent.length },
        // Impact first: a slipping result or activity before money or workflow.
        topConcern: (sum?.concerns.find((c) => /^(late-|due$|acts-|unplanned-)/.test(c.key)) ?? sum?.concerns[0])?.text ?? null,
        topWin: sum?.wins[0]?.text ?? null,
      };
    }),
  );
  return { rows };
}
export type PortfolioView = Awaited<ReturnType<typeof loadPortfolio>>;
