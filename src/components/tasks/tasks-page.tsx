"use client";

import { useSearchParams } from "next/navigation";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser } from "@/components/app/session";
import { FieldWorkspace } from "@/components/field/workspace";
import { ProcurementWorkspace } from "@/components/procurement/workspace";
import { TopBar } from "@/components/workspace/ui";
import { taskSources } from "@/components/tasks/sources";

/** Tasks: field activities and procurement for the current project, one work type at a time. */
export function TasksPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const { t } = useT();
  const asked = useSearchParams().get("source");

  if (!user) return null;
  const sources = taskSources(user, project);
  const source = sources.find((s) => s === asked) ?? sources[0];

  if (source === "field") return <FieldWorkspace />;
  if (source === "procurement") return <ProcurementWorkspace />;
  return (
    <div className="min-h-screen">
      <TopBar />
      <div className="mx-auto max-w-md px-6 py-24 text-center">
        <h1 className="font-display text-3xl">{t("tasks.title")}</h1>
        <p className="mt-2 text-sm text-muted">
          {user.fieldAccess === "none" && user.procurementAccess === "none" ? t("tasks.noAccess") : t("tasks.noWork", { project: project.name })}
        </p>
      </div>
    </div>
  );
}
