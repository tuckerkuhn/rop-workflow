"use client";

import Link from "next/link";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import type { AppUser, projects } from "@/lib/demo";

/** Where Tasks gets its work from. Phase 2 merges these into one list. */

export type TaskSource = "field" | "procurement";

/** Sources this person may open on this project. */
export function taskSources(u: AppUser, project: (typeof projects)[number]): TaskSource[] {
  const has = (w: TaskSource) => (project.workflows as readonly string[]).includes(w);
  return [
    has("field") && u.fieldAccess !== "none" ? ("field" as const) : null,
    has("procurement") && u.procurementAccess !== "none" ? ("procurement" as const) : null,
  ].filter((s): s is TaskSource => s !== null);
}

export const taskHref = (source: TaskSource, query = "") => `/tasks?source=${source}${query ? `&${query}` : ""}`;

/** Switch between the work types in the top bar. Hidden when there is only one. */
export function TaskSourceSwitch({ active }: { active: TaskSource }) {
  const { user } = useSession();
  const { project } = useCurrentProject();
  const { t } = useT();
  if (!user) return null;
  const sources = taskSources(user, project);
  if (sources.length < 2) return null;
  return (
    <nav aria-label={t("tasks.source")} className="flex rounded-full bg-sunken p-0.5 text-sm">
      {sources.map((s) => (
        <Link
          key={s}
          href={taskHref(s)}
          aria-current={active === s ? "page" : undefined}
          className={`whitespace-nowrap rounded-full px-3 py-1 font-display transition ${active === s ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {t(s === "field" ? "tasks.field" : "tasks.procurement")}
        </Link>
      ))}
    </nav>
  );
}
