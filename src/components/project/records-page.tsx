"use client";

import { useCurrentProject } from "@/components/app/current-project";
import { ProjectPage } from "@/components/project/project-page";

/** The project's working records: plan, review queue, budget, report sign-off and audit trail. */
export function RecordsPage() {
  const { project } = useCurrentProject();
  return <ProjectPage key={project.id} id={project.id} />;
}
