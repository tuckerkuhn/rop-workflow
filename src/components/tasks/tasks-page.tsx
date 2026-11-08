"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { LockIcon, LockedFeature } from "@/components/app/locked-feature";
import { NewMenu } from "@/components/app/new-menu";
import { useFeature, useRequireUser } from "@/components/app/session";
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
import { TopBar, usePersistentState } from "@/components/workspace/ui";
import type { AppUser } from "@/lib/demo";
import type { MessageKey } from "@/lib/i18n";
import type { Row } from "@/lib/work-items";

/**
 * Work: one list of what needs me and my tasks, filtered by workflow, as a list, a month calendar
 * or (paid plan) a timeline. New work starts from "+ New" in the header.
 * ?source=field or ?source=procurement opens that workflow.
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
type Chip = "all" | "procurement" | "field" | "reporting" | "hr";
// Mine: tasks and the activities I own. Needs me: everything waiting on me from the project and its workflows.
const isMine = (r: Row) => r.kind === "task" && (r.source === "manual" || r.source === "activity") && !r.done;
const needsMe = (r: Row) => r.kind === "task" && r.source !== "manual" && r.source !== "activity" && !r.done;
/** Which workflow a row belongs to, for the chips; tasks and activities belong to none. */
function workflowOf(r: Row): Exclude<Chip, "all"> | null {
  if (r.kind !== "task") return null;
  if (r.source === "procurement" || (r.href && /\/work\/(bills|plan|closeout|suppliers)|source=procurement/.test(r.href))) return "procurement";
  if (r.source === "field") return "field";
  if (r.source === "hr") return "hr";
  if (r.source === "project" && r.href?.startsWith("/progress")) return "reporting";
  return null;
}
const CHIPS: { id: Chip; label: MessageKey }[] = [
  { id: "all", label: "work.chip.all" },
  { id: "procurement", label: "work.chip.procurement" },
  { id: "field", label: "work.chip.field" },
  { id: "reporting", label: "work.chip.reporting" },
  { id: "hr", label: "work.chip.hr" },
];
const PLACES: { href: string; label: MessageKey }[] = [
  { href: "/work/activities", label: "nav.activities" },
  { href: "/work/plan", label: "nav.procCalendar" },
  { href: "/work/opportunities", label: "nav.opportunities" },
];

const VIEWS: { id: View; label: MessageKey }[] = [
  { id: "list", label: "tasks.view.list" },
  { id: "calendar", label: "tasks.view.calendar" },
  { id: "timeline", label: "tasks.view.timeline" },
];

/**
 * One list: what needs my attention, then my tasks. Workflows are filters above it; List and
 * Calendar show the same list. New work starts from "+ New" in the header.
 */
function AllTasks({ user }: { user: AppUser }) {
  const { t } = useT();
  const { project } = useCurrentProject();
  const { rows, work } = useTaskRows(user, project);
  const timeline = useFeature("timeline");
  const [saved, setSaved] = usePersistentState<View>("rop-tasks-view", () => "list");
  // Picking the locked timeline shows the upgrade prompt without remembering it as the choice.
  const [prompt, setPrompt] = useState(false);
  const [adding, setAdding] = useState(false);
  const [chip, setChip] = useState<Chip>("all");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const closeDetail = useCallback(() => setOpenKey(null), []);
  const closeAdd = useCallback(() => setAdding(false), []);
  const view: View = saved === "timeline" && !timeline ? "list" : saved;
  const shown: View | "locked" = prompt ? "locked" : view;
  const canEdit = work.saved;
  // "+ New → Task or milestone" lands here with ?new=task.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("new") === "task") {
      setAdding(true);
      window.history.replaceState(null, "", "/work");
    }
  }, []);

  const actions: RowActions = {
    canEdit,
    onToggle: (id, done) => void work.setDone(id, done),
    onDelete: (id) => void work.remove(id).catch(() => work.reload()),
    onOpen: (r) => r.id && setOpenKey(r.key),
  };
  const opened = openKey ? rows.find((r) => r.key === openKey && r.id) : undefined;
  const inChip = (r: Row) => chip === "all" || workflowOf(r) === chip;
  const attention = rows.filter((r) => needsMe(r) && inChip(r));
  const mine = rows.filter((r) => isMine(r) && inChip(r));
  const chips = CHIPS.filter((c) => c.id === "all" || rows.some((r) => (needsMe(r) || isMine(r)) && workflowOf(r) === c.id));
  const empty = !attention.length && !mine.length;

  return (
    <div className="min-h-screen">
      <TopBar active="tasks" />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:max-w-5xl">
        <h1 className="font-display text-4xl tracking-tight">{t("tasks.title")}</h1>
        {/* The places in Work; on large screens they are in the sidebar. */}
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm lg:hidden">
          {PLACES.map((p) => (
            <Link key={p.href} href={p.href} className="font-semibold text-forest hover:underline">
              {t(p.label)}
            </Link>
          ))}
        </p>

        {chips.length > 1 && (
          <div role="group" aria-label={t("work.workflows")} className="mt-5 flex flex-wrap gap-2">
            {chips.map((c) => (
              <button key={c.id} type="button" aria-pressed={chip === c.id} onClick={() => setChip(c.id)} className={`whitespace-nowrap rounded-full px-3 py-1.5 text-sm ${chip === c.id ? "bg-forest text-paper" : "bg-mist text-forest hover:bg-sunken"}`}>
                {t(c.label)}
              </button>
            ))}
          </div>
        )}

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
          ) : empty ? (
            <div className="flex flex-wrap items-center gap-3 py-10">
              <p className="text-muted">{t("new.empty")}</p>
              <NewMenu align="start" />
            </div>
          ) : shown === "calendar" ? (
            <CalendarView rows={[...attention, ...mine]} actions={actions} />
          ) : shown === "timeline" ? (
            <TimelineView rows={[...attention, ...mine]} />
          ) : (
            <>
              {attention.length > 0 && (
                <section aria-labelledby="needs-me">
                  <h2 id="needs-me" className="font-display text-2xl">
                    {t("work.needsMe")}
                  </h2>
                  <div className="mt-2">
                    <ListView rows={attention} actions={actions} />
                  </div>
                </section>
              )}
              {mine.length > 0 && (
                <section aria-labelledby="my-tasks" className={attention.length ? "mt-8" : ""}>
                  <h2 id="my-tasks" className="font-display text-2xl">
                    {t("work.myTasks")}
                  </h2>
                  <div className="mt-2">
                    <ListView rows={mine} actions={actions} />
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>
      {adding && <AddSheet user={user} onAdd={work.add} onClose={closeAdd} />}
      {opened && (
        <TaskDetail row={opened} canEdit={canEdit} donor={null} projectCode={project.id} hasField={project.workflows.includes("field")} onToggle={actions.onToggle} onSaveNotes={work.setNotes} onClose={closeDetail} />
      )}
    </div>
  );
}
