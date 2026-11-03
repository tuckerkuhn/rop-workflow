"use client";

import { useCurrentProject } from "@/components/app/current-project";
import { ProjectPage } from "@/components/project/project-page";

/** Progress for the current project. Phase 3 replaces the project tabs with indicators and the donor report. */
export function ProgressPage() {
  const { project } = useCurrentProject();
  return <ProjectPage key={project.id} id={project.id} />;
}
