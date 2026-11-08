"use client";

import { useProcurements } from "@/components/app/use-project-data";

import { useEffect, useMemo, useState } from "react";
import { useCloseouts, useFieldData, usePlan, useSubmissions, useWorkItems } from "@/components/app/use-project-data";
import { PROJECT_KEY } from "@/components/project/project-page";
import { workFor } from "@/components/tasks/work";
import { usePersistentState } from "@/components/workspace/ui";
import type { AppUser, ProjectInfo } from "@/lib/demo";
import { seedProject, type ProjectState } from "@/lib/project";
import type { Row } from "@/lib/work-items";
import { procRolesFor } from "@/lib/procurement";
import type { HomeView } from "@/server/home-store";

const STATUS_WORD: Record<string, string> = { not_started: "Not started", in_progress: "Under way", on_hold: "On hold" };

/**
 * A database project's own work for this person, from the same view as Home: what needs them,
 * the activities they own this quarter, and (for leads) the activities nobody owns yet.
 */
function useProjectWork(user: AppUser, project: ProjectInfo): Row[] {
  const [home, setHome] = useState<HomeView | null>(null);
  useEffect(() => {
    if (!project.saved || user.kind !== "employee") return setHome(null);
    let live = true;
    fetch(`/api/projects/${project.id}/home`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setHome(d));
    return () => {
      live = false;
    };
  }, [project.saved, project.id, user.id, user.kind]);
  return useMemo(() => {
    if (!home) return [];
    const today = new Date().toISOString().slice(0, 10);
    const rows: Row[] = home.actions.map((a) => ({ key: `home:${a.key}`, kind: "task", title: a.text, date: a.urgent ? today : null, done: false, late: false, source: "project", step: "Needs you", href: a.href }));
    for (const a of home.season.now.filter((x) => x.owner === user.name && x.status !== "done" && x.status !== "cancelled"))
      rows.push({ key: `act:${a.code}`, kind: "task", title: `${a.code} ${a.title}`, date: home.season.quarterEnd, done: false, late: a.timing === "late", source: "activity", step: STATUS_WORD[a.status] ?? "", href: "/work/activities" });
    const unowned = home.season.now.filter((x) => !x.owner && x.status !== "done" && x.status !== "cancelled").length;
    if (unowned && home.lenses.includes("lead"))
      rows.push({ key: "act:unowned", kind: "task", title: `Assign owners to ${unowned} ${unowned === 1 ? "activity" : "activities"} due this quarter`, date: today, done: false, late: false, source: "project", step: "Needs you", href: "/work/activities" });
    return rows;
  }, [home, user.name]);
}

/**
 * Everything Tasks shows for one person on one project, as rows: tasks and milestones added in
 * Tasks, plus the workflow steps that are theirs now. Projected future steps are left out.
 */
export function useTaskRows(user: AppUser, project: ProjectInfo) {
  const work = useWorkItems(project.id);
  // The workflows only run on the demo project with field and procurement data.
  const hasWorkflows = project.workflows.length > 0;
  const { items: field } = useFieldData(project.id);
  const { submissions } = useSubmissions(project.id);
  const { items: procs } = useProcurements(project.id);
  const plan = usePlan(project.saved ? project.id : null);
  const closeouts = useCloseouts(project.saved && procRolesFor(user).includes("finance") ? project.id : null);
  const [local] = usePersistentState<ProjectState>(PROJECT_KEY, seedProject);
  const projectWork = useProjectWork(user, project);

  const rows = useMemo<Row[]>(() => {
    const stored: Row[] = work.items
      // Tasks for this person, for anyone, or that they asked someone else to do.
      .filter((i) => i.type === "milestone" || !i.assignee || i.assignee === user.id || i.createdBy === user.id)
      .map((i): Row =>
        i.type === "milestone"
          ? { key: i.id, kind: "milestone", id: i.id, title: i.title, date: i.date!, end: i.endDate, milestoneKind: i.milestoneKind!, automatic: i.automatic, donorId: i.donorId, createdBy: i.createdBy, notes: i.notes }
          : { key: i.id, kind: "task", id: i.id, title: i.title, date: i.date, done: !!i.doneAt, late: false, source: "manual", assignee: i.assignee, createdBy: i.createdBy, doneBy: i.doneBy, doneAt: i.doneAt, notes: i.notes },
      );
    if (!hasWorkflows) return [...projectWork, ...stored].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
    // The demo project's sample sign-offs belong to it alone.
    const demo = project.workflows.includes("field");
    const steps: Row[] = workFor(user, { field: demo ? field : [], procs, project: { ...local, submissions }, stages: {}, plan: plan.items, closeouts: closeouts.months }, user, { projectCards: demo })
      .filter((c) => c.now)
      .map((c) => ({
        key: c.key,
        kind: "task",
        title: c.title,
        step: c.step,
        date: c.date,
        done: false,
        late: c.late,
        source: c.space === "Field" ? "field" : c.space === "Procurement" ? "procurement" : "project",
        href: c.href,
      }));
    return [...projectWork, ...stored, ...steps].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  }, [projectWork, work.items, hasWorkflows, user, field, procs, local, submissions, plan.items, project.workflows, closeouts.months]);

  return { rows, work };
}
