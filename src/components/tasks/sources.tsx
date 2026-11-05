"use client";

import Link from "next/link";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import type { AppUser, ProjectInfo } from "@/lib/demo";

/** The workflows Tasks can open in full, next to the list of all tasks. */

export type TaskSource = "field" | "procurement";

/** Sources this person may open on this project. */
export function taskSources(u: AppUser, project: ProjectInfo): TaskSource[] {
  const has = (w: TaskSource) => (project.workflows as readonly string[]).includes(w);
  return [
    has("field") && u.fieldAccess !== "none" ? ("field" as const) : null,
    has("procurement") && u.procurementAccess !== "none" ? ("procurement" as const) : null,
  ].filter((s): s is TaskSource => s !== null);
}

export const taskHref = (source: TaskSource, query = "") => `/work?source=${source}${query ? `&${query}` : ""}`;

/** Switch in the top bar between all tasks and the full workflows. Hidden when there is no workflow to open. */
export function TaskSourceSwitch({ active }: { active: TaskSource | "all" }) {
  const { user } = useSession();
  const { project } = useCurrentProject();
  const { t } = useT();
  if (!user) return null;
  const sources = taskSources(user, project);
  if (sources.length === 0) return null;
  const tabs = [{ id: "all" as const, href: "/work", label: t("tasks.all") }, ...sources.map((s) => ({ id: s, href: taskHref(s), label: t(s === "field" ? "tasks.field" : "tasks.procurement") }))];
  return (
    <nav aria-label={t("tasks.source")} className="flex rounded-full bg-sunken p-0.5 text-sm">
      {tabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.href}
          aria-current={active === tab.id ? "page" : undefined}
          className={`whitespace-nowrap rounded-full px-3 py-1 font-display transition ${active === tab.id ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
