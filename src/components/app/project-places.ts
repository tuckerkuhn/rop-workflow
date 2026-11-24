"use client";

import { useProjectModules } from "@/components/app/project-modules";
import { placeAllowed } from "@/lib/project-modules";
import { useCurrentProject } from "@/components/app/current-project";
import { useSession } from "@/components/app/session";
import { taskHref, taskSources } from "@/components/tasks/sources";
import { holdsType } from "@/lib/authority";
import { mayViewAudit } from "@/lib/audit";
import { canEditProject } from "@/lib/demo";
import type { MessageKey } from "@/lib/i18n";
import { acrossProjectsFor, orgAreasFor } from "@/lib/org-areas";

/**
 * The places under Projects, in groups: the work, progress against targets, the reports built
 * from both, the project's set-up (for the people who may change it) and what runs across
 * projects (for the roles that open it). One list, read by the sidebar and by the Projects page,
 * so the two never disagree. Staff only: a donor's Projects tab opens Progress directly.
 */

/** `also`: other addresses that are the same place (the three donor reports are one place, Reports). */
export type Place = { href: string; label: MessageKey; source?: string; exact?: boolean; also?: string[] };
export type PlaceGroup = { id: "work" | "progress" | "reports" | "setup" | "across"; label: MessageKey; places: Place[] };

const ACROSS_LABEL: Record<string, MessageKey> = { portfolio: "nav.allProjects", opportunities: "nav.opportunities", proposals: "nav.proposals" };

export function useProjectPlaces(): PlaceGroup[] {
  const { user } = useSession();
  const { project, projects } = useCurrentProject();
  // Parts this project does not use leave the menus (Settings, "What this project uses").
  const modules = useProjectModules();
  if (!user || user.kind !== "employee") return [];
  // The portfolio compares projects: with one project there is nothing to compare, so it is not listed.
  const several = projects.filter((p) => p.saved).length > 1;
  // All work first, then the workflows this person can open on this project: the order of the tabs on Work.
  const workflows: Place[] = taskSources(user, project).map((w) => ({ href: taskHref(w), label: w === "field" ? "tasks.field" : "tasks.procurement", source: w }));
  // The procurement calendar, suppliers and bills open for the roles lib/org-areas names (the same
  // check as their Organization cards); the monthly closeout for anyone with procurement access, as
  // its API allows. They are part of a project's work, so they are listed here too.
  const org = new Set(orgAreasFor(user, (r) => holdsType(user.id, r)).map((a) => a.id));
  const money: Place[] = [
    ...(org.has("plan") ? [{ href: "/work/plan", label: "nav.procCalendar" } as Place] : []),
    ...(org.has("suppliers") ? [{ href: "/work/suppliers", label: "nav.suppliers" } as Place] : []),
    ...(org.has("bills") ? [{ href: "/work/bills", label: "nav.bills" } as Place, { href: "/work/payments", label: "nav.payment" } as Place] : []),
    ...(user.procurementAccess !== "none" ? [{ href: "/work/register", label: "nav.register" } as Place, { href: "/work/closeout", label: "nav.closeout" } as Place] : []),
  ];
  const across: Place[] = acrossProjectsFor(user, (r) => holdsType(user.id, r)).filter((a) => a.id !== "portfolio" || several).map((a) => ({ href: a.href, label: ACROSS_LABEL[a.id] }));
  const groups: PlaceGroup[] = [
    {
      id: "work",
      label: "hub.work",
      // Tasks first, then the workplan's activities (a tab of Work, named here so it can be found), each workflow, and the money side.
      places: [
        { href: "/work", label: "tasks.all", exact: true },
        { href: "/work/activities", label: "nav.activities" },
        ...workflows,
        ...(project.workflows.includes("field") ? [{ href: "/work/selection", label: "nav.selection" } as Place] : []),
        ...money,
        { href: "/work/grants", label: "nav.grants" },
      ],
    },
    {
      id: "progress",
      label: "hub.progress",
      places: [
        // What happened and the proof of it, in the order it is gathered.
        { href: "/progress", label: "nav.overview", exact: true },
        { href: "/progress/weekly", label: "nav.weekly" },
        { href: "/progress/results", label: "nav.results" },
        { href: "/progress/stories", label: "nav.storiesPhotos", also: ["/progress/photos"] },
        { href: "/progress/feedback", label: "nav.feedback" },
        { href: "/progress/budget", label: "nav.budget" },
      ],
    },
    {
      // What management decides from it and what goes to the donor.
      id: "reports",
      label: "hub.reviewReport",
      places: [
        { href: "/progress/review", label: "nav.review", also: ["/progress/learning"] },
        // Quarterly, annual and final, and the funding request: one place, with its check on the page.
        { href: "/progress/report", label: "hub.reports", also: ["/progress/annual", "/progress/face", "/progress/preflight"] },
        // Shown to the people the server lets read it: plan approvers, report release, monthly review, MEL and administrators.
        ...(mayViewAudit(user) ? [{ href: "/progress/audit", label: "nav.audit" } as Place] : []),
      ],
    },
  ];
  // Set-up is for the people who may change the project: its manager, plan approvers and administrators.
  if (canEditProject(user) || user.admin)
    groups.push({
      id: "setup",
      label: "hub.setup",
      places: [
        { href: "/setup", label: "setup.editTitle" },
        { href: "/progress/framework", label: "nav.framework", also: ["/progress/targets"] },
        { href: "/settings#donors", label: "nav.donorSettings", exact: true },
        { href: "/settings/policy", label: "nav.rules" },
        { href: "/design", label: "setup.marketLink" },
      ],
    });
  if (across.length) groups.push({ id: "across", label: "hub.across", places: across });
  return groups.map((g) => ({ ...g, places: g.places.filter((pl) => placeAllowed(pl.href, modules)) }));
}

/** Whether this place is the page on screen. `source` is the ?source= of /work. */
export function placeIsOpen(pl: Place, path: string, source: string | null) {
  if (pl.source) return path === "/work" && source === pl.source;
  // A link to a section (/settings#donors) is open on its page.
  const href = pl.href.split("#")[0];
  if (pl.exact) return (path === href && !(href === "/work" && source)) || (pl.also ?? []).some((h) => path === h || path.startsWith(`${h}/`));
  return [href, ...(pl.also ?? [])].some((h) => path === h || path.startsWith(`${h}/`));
}
