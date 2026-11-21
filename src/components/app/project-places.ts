"use client";

import { useCurrentProject } from "@/components/app/current-project";
import { useSession } from "@/components/app/session";
import { taskHref, taskSources } from "@/components/tasks/sources";
import { holdsType } from "@/lib/authority";
import { mayViewAudit } from "@/lib/audit";
import { canEditProject } from "@/lib/demo";
import type { MessageKey } from "@/lib/i18n";
import { acrossProjectsFor } from "@/lib/org-areas";

/**
 * The places under Projects, in groups: the work, progress against targets, the reports built
 * from both, the project's set-up (for the people who may change it) and what runs across
 * projects (for the roles that open it). One list, read by the sidebar and by the Projects page,
 * so the two never disagree. Staff only: a donor's Projects tab opens Progress directly.
 */

export type Place = { href: string; label: MessageKey; source?: string; exact?: boolean };
export type PlaceGroup = { id: "work" | "progress" | "reports" | "setup" | "across"; label: MessageKey; places: Place[] };

const ACROSS_LABEL: Record<string, MessageKey> = { portfolio: "nav.allProjects", opportunities: "nav.opportunities", proposals: "nav.proposals" };

export function useProjectPlaces(): PlaceGroup[] {
  const { user } = useSession();
  const { project } = useCurrentProject();
  if (!user || user.kind !== "employee") return [];
  // All work first, then the workflows this person can open on this project: the order of the tabs on Work.
  const workflows: Place[] = taskSources(user, project).map((w) => ({ href: taskHref(w), label: w === "field" ? "tasks.field" : "tasks.procurement", source: w }));
  const across: Place[] = acrossProjectsFor(user, (r) => holdsType(user.id, r)).map((a) => ({ href: a.href, label: ACROSS_LABEL[a.id] }));
  const groups: PlaceGroup[] = [
    {
      id: "work",
      label: "hub.work",
      places: [{ href: "/work", label: "tasks.all", exact: true }, ...workflows, { href: "/work/activities", label: "nav.activities" }, { href: "/work/grants", label: "nav.grants" }],
    },
    {
      id: "progress",
      label: "hub.progress",
      places: [
        { href: "/progress", label: "nav.overview", exact: true },
        { href: "/progress/results", label: "nav.results" },
        { href: "/progress/review", label: "nav.review" },
        { href: "/progress/budget", label: "nav.budget" },
        // Shown to the people the server lets read it: plan approvers, report release, monthly review, MEL and administrators.
        ...(mayViewAudit(user) ? [{ href: "/progress/audit", label: "nav.audit" } as Place] : []),
      ],
    },
    {
      id: "reports",
      label: "hub.reports",
      places: [
        { href: "/progress/weekly", label: "nav.weekly" },
        { href: "/progress/report", label: "nav.quarterly" },
        { href: "/progress/annual", label: "nav.annual" },
        { href: "/progress/stories", label: "nav.stories" },
        { href: "/progress/photos", label: "nav.photos" },
        { href: "/progress/face", label: "nav.face" },
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
        { href: "/progress/framework", label: "nav.framework" },
        { href: "/progress/targets", label: "td.title" },
        { href: "/settings", label: "home.settings", exact: true },
        { href: "/settings/policy", label: "nav.rules" },
        { href: "/design", label: "setup.marketLink" },
      ],
    });
  if (across.length) groups.push({ id: "across", label: "hub.across", places: across });
  return groups;
}

/** Whether this place is the page on screen. `source` is the ?source= of /work. */
export function placeIsOpen(pl: Place, path: string, source: string | null) {
  if (pl.source) return path === "/work" && source === pl.source;
  if (pl.exact) return path === pl.href && !(pl.href === "/work" && source);
  return path === pl.href || path.startsWith(`${pl.href}/`);
}
