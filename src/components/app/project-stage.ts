"use client";

import { PROJECT_KEY } from "@/components/project/project-page";
import { usePersistentState } from "@/components/workspace/ui";
import { STAGES, type ProjectInfo, type Stage } from "@/lib/demo";
import { GATED_KEYS, seedProject, type ProjectState } from "@/lib/project";

/**
 * The project's stage as it stands now. The demo projects move through stages in this browser
 * (Design is signed off on the project page); every other project keeps its fixed stage.
 * Home and Work both read it from here so they agree.
 */
export function useProjectStage(project: ProjectInfo): Stage {
  const [local] = usePersistentState<ProjectState>(PROJECT_KEY, seedProject);
  const [grapes] = usePersistentState<ProjectState>(GATED_KEYS["AG-2027"].key, GATED_KEYS["AG-2027"].seed);
  const live = project.id === "A-2027" ? local.stage : project.id === "AG-2027" ? grapes.stage : undefined;
  return live ?? project.stage;
}

/** Execute or later: the plan is signed off and design is view-only. */
export const hasStarted = (stage: Stage) => STAGES.indexOf(stage) >= STAGES.indexOf("Execute");

/** Projects whose design lives on the Project design page (the browser-only demo projects in Design). */
export const hasDesignPage = (id: string) => id in GATED_KEYS;
