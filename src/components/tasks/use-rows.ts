"use client";

import { useProcurements } from "@/components/app/use-project-data";

import { useMemo } from "react";
import { useCloseouts, useFieldData, usePlan, useSubmissions, useWorkItems } from "@/components/app/use-project-data";
import { PROJECT_KEY } from "@/components/project/project-page";
import { workFor } from "@/components/tasks/work";
import { usePersistentState } from "@/components/workspace/ui";
import type { AppUser, ProjectInfo } from "@/lib/demo";
import { seedProject, type ProjectState } from "@/lib/project";
import type { Row } from "@/lib/work-items";
import { procRolesFor } from "@/lib/procurement";

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

  const rows = useMemo<Row[]>(() => {
    const stored: Row[] = work.items
      // Tasks for this person, for anyone, or that they asked someone else to do.
      .filter((i) => i.type === "milestone" || !i.assignee || i.assignee === user.id || i.createdBy === user.id)
      .map((i): Row =>
        i.type === "milestone"
          ? { key: i.id, kind: "milestone", id: i.id, title: i.title, date: i.date!, end: i.endDate, milestoneKind: i.milestoneKind!, automatic: i.automatic, donorId: i.donorId, createdBy: i.createdBy, notes: i.notes }
          : { key: i.id, kind: "task", id: i.id, title: i.title, date: i.date, done: !!i.doneAt, late: false, source: "manual", assignee: i.assignee, createdBy: i.createdBy, doneBy: i.doneBy, doneAt: i.doneAt, notes: i.notes },
      );
    if (!hasWorkflows) return stored;
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
    return [...stored, ...steps].sort((a, b) => (a.date ?? "9999").localeCompare(b.date ?? "9999"));
  }, [work.items, hasWorkflows, user, field, procs, local, submissions, plan.items, project.workflows, closeouts.months]);

  return { rows, work };
}
