"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useFeature, useRequireUser } from "@/components/app/session";
import { FieldWorkspace } from "@/components/field/workspace";
import { ProcurementWorkspace } from "@/components/procurement/workspace";
import { AddSheet } from "@/components/tasks/add-sheet";
import { CalendarView } from "@/components/tasks/calendar-view";
import { ListView } from "@/components/tasks/list-view";
import type { RowActions } from "@/components/tasks/row";
import { taskSources } from "@/components/tasks/sources";
import { TimelineView } from "@/components/tasks/timeline-view";
import { useTaskRows } from "@/components/tasks/use-rows";
import { Pill, TopBar, primaryBtn, quietBtn, usePersistentState } from "@/components/workspace/ui";
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

function Lock() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function AllTasks({ user }: { user: AppUser }) {
  const { t } = useT();
  const { project } = useCurrentProject();
  const { rows, work } = useTaskRows(user, project);
  const timeline = useFeature("timeline");
  const [saved, setSaved] = usePersistentState<View>("rop-tasks-view", () => "list");
  // Picking the locked timeline shows the upgrade prompt without remembering it as the choice.
  const [prompt, setPrompt] = useState(false);
  const [adding, setAdding] = useState(false);
  const closeAdd = useCallback(() => setAdding(false), []);
  const view: View = saved === "timeline" && !timeline ? "list" : saved;
  const shown: View | "locked" = prompt ? "locked" : view;
  const canEdit = work.saved;

  const actions: RowActions = {
    canEdit,
    onToggle: (id, done) => void work.setDone(id, done),
    onDelete: (id) => void work.remove(id).catch(() => work.reload()),
  };

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
                {locked && <Lock />}
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
            <section className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
              <Pill tone="ochre">
                <Lock /> {t("plan.paid")}
              </Pill>
              <h2 className="mt-3 font-display text-2xl">{t("plan.locked", { feature: t("tasks.view.timeline") })}</h2>
              <p className="mt-2 text-sm text-muted">{t("plan.timelineWhy")}</p>
              <p className="mt-2 text-sm text-muted">{t("plan.ask")}</p>
              <button type="button" onClick={() => setPrompt(false)} className={`${quietBtn} mt-5`}>
                {t("plan.back")}
              </button>
            </section>
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
    </div>
  );
}
