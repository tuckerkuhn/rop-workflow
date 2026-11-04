"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { DonorFilter, useDonorChoice } from "@/components/app/donor-filter";
import { useT } from "@/components/app/i18n";
import { LockIcon, LockedFeature } from "@/components/app/locked-feature";
import { useFeature, useRequireUser } from "@/components/app/session";
import { useDonors } from "@/components/app/use-project-data";
import { FieldWorkspace } from "@/components/field/workspace";
import { ProcurementWorkspace } from "@/components/procurement/workspace";
import { AddSheet } from "@/components/tasks/add-sheet";
import { CalendarView } from "@/components/tasks/calendar-view";
import { TaskDetail } from "@/components/tasks/detail";
import { ListView } from "@/components/tasks/list-view";
import type { RowActions } from "@/components/tasks/row";
import { taskSources } from "@/components/tasks/sources";
import { TimelineView } from "@/components/tasks/timeline-view";
import { useTaskRows } from "@/components/tasks/use-rows";
import { TopBar, primaryBtn, usePersistentState } from "@/components/workspace/ui";
import type { AppUser } from "@/lib/demo";
import type { MessageKey } from "@/lib/i18n";

/**
 * Tasks: one list of everything to do and every date to plan around, shown as a list, a month
 * calendar or (paid plan) a timeline. ?source=field or ?source=procurement opens that workflow.
 */
export function TasksPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const asked = useSearchParams().get("source");

  if (!user) return null;
  const source = taskSources(user, project).find((s) => s === asked);
  if (source === "field") return <FieldWorkspace />;
  if (source === "procurement") return <ProcurementWorkspace />;
  if (user.kind !== "employee") return <StaffOnly />;
  return <AllTasks user={user} />;
}

function StaffOnly() {
  const { t } = useT();
  return (
    <div className="min-h-screen">
      <TopBar />
      <p className="mx-auto max-w-md px-6 py-24 text-center text-muted">{t("tasks.noAccess")}</p>
    </div>
  );
}

type View = "list" | "calendar" | "timeline";
const VIEWS: { id: View; label: MessageKey }[] = [
  { id: "list", label: "tasks.view.list" },
  { id: "calendar", label: "tasks.view.calendar" },
  { id: "timeline", label: "tasks.view.timeline" },
];

function AllTasks({ user }: { user: AppUser }) {
  const { t } = useT();
  const { project } = useCurrentProject();
  const { rows: allRows, work } = useTaskRows(user, project);
  const donors = useDonors(project.id);
  const { donor, setDonor } = useDonorChoice(project.id, donors);
  // Picking a donor hides other donors' report deadlines; everything else stays.
  const rows = (donor ? allRows.filter((r) => r.kind !== "milestone" || !r.donorId || r.donorId === donor.id) : allRows).map((r) =>
    r.kind === "milestone" && r.donorId ? { ...r, donorName: donors.find((d) => d.id === r.donorId)?.name } : r,
  );
  const timeline = useFeature("timeline");
  const [saved, setSaved] = usePersistentState<View>("rop-tasks-view", () => "list");
  // Picking the locked timeline shows the upgrade prompt without remembering it as the choice.
  const [prompt, setPrompt] = useState(false);
  const [adding, setAdding] = useState(false);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const closeDetail = useCallback(() => setOpenKey(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const view: View = saved === "timeline" && !timeline ? "list" : saved;
  const shown: View | "locked" = prompt ? "locked" : view;
  const canEdit = work.saved;

  const actions: RowActions = {
    canEdit,
    onToggle: (id, done) => void work.setDone(id, done),
    onDelete: (id) => void work.remove(id).catch(() => work.reload()),
    onOpen: (r) => r.id && setOpenKey(r.key),
  };
  const opened = openKey ? rows.find((r) => r.key === openKey && r.id) : undefined;

  return (
    <div className="min-h-screen">
      <TopBar active="tasks" />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:max-w-5xl">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="flex-1 font-display text-4xl tracking-tight">{t("tasks.title")}</h1>
          {canEdit && (
            <button type="button" onClick={() => setAdding(true)} className={`${primaryBtn} px-5 py-2.5`}>
              + {t("tasks.add")}
            </button>
          )}
        </div>

        <div className="mt-3">
          <DonorFilter donors={donors} donor={donor} onChange={setDonor} />
        </div>

        <div role="radiogroup" aria-label={t("tasks.views")} className="mt-4 grid grid-cols-3 rounded-full bg-sunken p-1 text-sm sm:inline-grid">
          {VIEWS.map((v) => {
            const locked = v.id === "timeline" && !timeline;
            const on = shown === v.id || (locked && shown === "locked");
            return (
              <button
                key={v.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => {
                  setPrompt(locked);
                  if (!locked) setSaved(v.id);
                }}
                className={`flex items-center justify-center gap-1.5 rounded-full px-4 py-2 ${on ? "bg-surface font-semibold shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {t(v.label)}
                {locked && <LockIcon />}
              </button>
            );
          })}
        </div>

        {!work.saved && <p className="mt-4 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">{t("tasks.notSaved")}</p>}
        {work.error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {t("tasks.loadError", { error: work.error })}
          </p>
        )}

        <div className="mt-6">
          {work.status === "loading" ? (
            <p className="py-16 text-center text-sm text-muted">{t("tasks.loading")}</p>
          ) : shown === "locked" ? (
            <LockedFeature feature={t("tasks.view.timeline")} why={t("plan.timelineWhy")} onBack={() => setPrompt(false)} />
          ) : shown === "calendar" ? (
            <CalendarView rows={rows} actions={actions} />
          ) : shown === "timeline" ? (
            <TimelineView rows={rows} />
          ) : (
            <ListView rows={rows} actions={actions} />
          )}
        </div>
      </main>
      {adding && <AddSheet user={user} onAdd={work.add} onClose={closeAdd} />}
      {opened && (
        <TaskDetail
          row={opened}
          canEdit={canEdit}
          donor={opened.kind === "milestone" && opened.donorId ? (donors.find((d) => d.id === opened.donorId) ?? null) : null}
          projectCode={project.id}
          hasField={project.workflows.includes("field")}
          onToggle={actions.onToggle}
          onSaveNotes={work.setNotes}
          onClose={closeDetail}
        />
      )}
    </div>
  );
}
