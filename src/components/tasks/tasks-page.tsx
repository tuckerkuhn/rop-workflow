"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { hasStarted, useProjectStage } from "@/components/app/project-stage";
import { DonorFilter, useDonorChoice } from "@/components/app/donor-filter";
import { useT } from "@/components/app/i18n";
import { LockIcon, LockedFeature } from "@/components/app/locked-feature";
import { useFeature, useRequireUser, useSession } from "@/components/app/session";
import { useDonors, useKoboServer } from "@/components/app/use-project-data";
import { FieldWorkspace } from "@/components/field/workspace";
import { ProcurementWorkspace } from "@/components/procurement/workspace";
import { AddSheet } from "@/components/tasks/add-sheet";
import { CalendarView } from "@/components/tasks/calendar-view";
import { TaskDetail } from "@/components/tasks/detail";
import { ListView } from "@/components/tasks/list-view";
import type { RowActions } from "@/components/tasks/row";
import { taskHref, taskSources, type TaskSource } from "@/components/tasks/sources";
import { TimelineView } from "@/components/tasks/timeline-view";
import { useTaskRows } from "@/components/tasks/use-rows";
import { TopBar, usePersistentState } from "@/components/workspace/ui";
import { canEditProject, type AppUser, type ProjectInfo, type Stage } from "@/lib/demo";
import type { MessageKey } from "@/lib/i18n";
import type { Row } from "@/lib/work-items";

/**
 * Work: where things get started and done. A hub up top (start new work; continue with my tasks,
 * active workflows or what needs my attention) over one list of everything to do and every date to
 * plan around, shown as a list, a month calendar or (paid plan) a timeline.
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
/** What the list below the hub shows: everything, my own open tasks, or workflow steps waiting on me. */
type Focus = "all" | "mine" | "attention";
const isMine = (r: Row) => r.kind === "task" && r.source === "manual" && !r.done;
const needsMe = (r: Row) => r.kind === "task" && r.source !== "manual" && !r.done;

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
  const [focus, setFocus] = useState<Focus>("all");
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
  const shownRows = focus === "mine" ? rows.filter(isMine) : focus === "attention" ? rows.filter(needsMe) : rows;
  const showFocus = (f: Focus) => {
    setFocus(f);
    document.getElementById("work-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="min-h-screen">
      <TopBar active="tasks" />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:max-w-5xl">
        <h1 className="font-display text-4xl tracking-tight">{t("tasks.title")}</h1>
        <p className="mt-1 text-lg text-muted">{t("work.ask")}</p>

        <WorkHub
          user={user}
          canAdd={canEdit}
          onAdd={() => setAdding(true)}
          mine={rows.filter(isMine).length}
          attention={rows.filter(needsMe).length}
          onFocus={showFocus}
        />

        <div id="work-list" className="mt-8 scroll-mt-4">
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

        {focus !== "all" && (
          <p className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-semibold">{t("work.showing", { what: t(focus === "mine" ? "work.mine" : "work.attention") })}</span>
            <button type="button" onClick={() => setFocus("all")} className="font-semibold text-forest hover:underline">
              {t("work.showAll")}
            </button>
          </p>
        )}

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
          ) : focus !== "all" && shownRows.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted">{t(focus === "mine" ? "work.mineEmpty" : "work.attentionEmpty")}</p>
          ) : shown === "calendar" ? (
            <CalendarView rows={shownRows} actions={actions} />
          ) : shown === "timeline" ? (
            <TimelineView rows={shownRows} />
          ) : (
            <ListView rows={shownRows} actions={actions} />
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

const chevron = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5 shrink-0 text-muted rtl:rotate-180">
    <path d="m9 6 6 6-6 6" />
  </svg>
);

type StartItem = { key: string; title: MessageKey; hint: MessageKey; href?: string; onClick?: () => void; external?: boolean };
type StartGroup = { key: string; title: MessageKey; items: StartItem[] };

/**
 * The kinds of work a person can start, grouped the way the work runs: plan it, do it in the field,
 * buy for it and report on it. Each one opens the screen where it starts; only what this person may
 * start on this project is listed, and empty groups are left out. Planning ends once the project is
 * in Execute. A task or milestone is offered on its own, above the groups, in every stage.
 */
function startGroups(user: AppUser, project: ProjectInfo, stage: Stage, sources: TaskSource[], kobo: string): StartGroup[] {
  const field = sources.includes("field");
  const proc = sources.includes("procurement");
  const groups: StartGroup[] = [
    {
      key: "plan",
      title: "work.group.plan",
      items: hasStarted(stage)
        ? []
        : [
            ...(canEditProject(user) ? [{ key: "project", title: "work.new.project", hint: "work.new.projectHint", href: "/setup?new=1" } as StartItem] : []),
            ...(project.saved ? [{ key: "lens", title: "work.new.lens", hint: "work.new.lensHint", href: "/setup/lens" } as StartItem] : []),
          ],
    },
    {
      key: "field",
      title: "work.group.field",
      items: field
        ? [
            { key: "finding", title: "work.new.field", hint: "work.new.fieldHint", href: taskHref("field", "new=1") },
            { key: "step", title: "work.new.farmerStep", hint: "work.new.farmerStepHint", href: taskHref("field") },
            // Farmers are registered and visits recorded in the Kobo forms, not here.
            { key: "kobo", title: "work.new.kobo", hint: "work.new.koboHint", href: kobo, external: true },
          ]
        : [],
    },
    {
      key: "procurement",
      title: "work.group.procurement",
      items: proc
        ? [
            { key: "request", title: "work.new.procurement", hint: "work.new.procurementHint", href: taskHref("procurement", "new=1") },
            ...(project.saved
              ? ([
                  { key: "plan", title: "work.new.planPurchase", hint: "work.new.planPurchaseHint", href: "/work/plan" },
                  { key: "bill", title: "work.new.bill", hint: "work.new.billHint", href: "/work/bills" },
                ] as StartItem[])
              : []),
          ]
        : [],
    },
    { key: "execute", title: "work.group.execute", items: project.saved && user.kind === "employee" ? [{ key: "activities", title: "work.new.activities", hint: "work.new.activitiesHint", href: "/work/activities" } as StartItem] : [] },
    { key: "report", title: "work.group.report", items: [{ key: "qpr", title: "work.new.report", hint: "work.new.reportHint", href: "/progress/report" }] },
  ];
  return groups.filter((g) => g.items.length > 0);
}

const ADMIN: StartItem[] = [
  { key: "timesheet", title: "work.new.timesheet", hint: "work.new.timesheetHint", href: "/timesheets" },
  { key: "leave", title: "work.new.leave", hint: "work.new.leaveHint", href: "/leave" },
  { key: "expense", title: "work.new.expense", hint: "work.new.expenseHint", href: "/expenses" },
];

/** Whether this person has an HR record, the same check the People card on Home makes. */
function useHasHrRecord() {
  const { user } = useSession();
  const [has, setHas] = useState(false);
  useEffect(() => {
    if (!user || user.kind !== "employee") return;
    fetch("/api/hr?summary=1", { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { hasRecord?: boolean } | null) => setHas(!!s?.hasRecord))
      .catch(() => setHas(false));
  }, [user]);
  return has;
}

/** One choice in Start new work: a link, a link out to another site, or a button that opens a form here. */
function StartChoice({ o, onPick }: { o: StartItem; onPick: () => void }) {
  const { t } = useT();
  const body = (
    <>
      <span className="block font-semibold">
        {t(o.title)}
        {o.external && <span aria-hidden> ↗</span>}
      </span>
      <span className="block text-sm text-forest-ink/75">{t(o.hint)}</span>
    </>
  );
  const cls = "block w-full rounded-xl bg-forest-ink/10 px-4 py-3 text-start hover:bg-forest-ink/20";
  if (o.external)
    return (
      <a href={o.href} target="_blank" rel="noopener noreferrer" className={cls}>
        {body}
        <span className="sr-only"> ({t("work.newTab")})</span>
      </a>
    );
  if (o.href)
    return (
      <Link href={o.href} className={cls}>
        {body}
      </Link>
    );
  return (
    <button
      type="button"
      onClick={() => {
        onPick();
        o.onClick?.();
      }}
      className={cls}
    >
      {body}
    </button>
  );
}

/** Start new work and the person's own admin, then the three ways back into work already under way. */
function WorkHub({
  user,
  canAdd,
  onAdd,
  mine,
  attention,
  onFocus,
}: {
  user: AppUser;
  canAdd: boolean;
  onAdd: () => void;
  mine: number;
  attention: number;
  onFocus: (f: Focus) => void;
}) {
  const { t } = useT();
  const { project } = useCurrentProject();
  const stage = useProjectStage(project);
  const hasRecord = useHasHrRecord();
  const [starting, setStarting] = useState(false);
  const sources = taskSources(user, project);
  const label = (s: TaskSource) => t(s === "field" ? "tasks.field" : "tasks.procurement");
  const kobo = useKoboServer(sources.includes("field") && project.saved ? project.id : null);
  const groups = startGroups(user, project, stage, sources, kobo);
  const task: StartItem | null = canAdd ? { key: "task", title: "work.new.task", hint: "work.new.taskHint", onClick: onAdd } : null;
  const canStart = !!task || groups.length > 0;
  const row = "flex w-full items-center gap-3 px-4 py-3.5 text-start hover:bg-sunken";

  return (
    <div className="mt-5 grid gap-4 lg:grid-cols-2">
      {(canStart || hasRecord) && (
        <div className={`grid content-start gap-4 ${starting ? "lg:col-span-2" : ""}`}>
          {canStart && (
            <section className="rounded-2xl bg-forest p-5 text-forest-ink">
              <button type="button" aria-expanded={starting} onClick={() => setStarting((v) => !v)} className="flex w-full items-start gap-3 text-start">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden className="mt-0.5 h-7 w-7 shrink-0">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 8v8M8 12h8" />
                </svg>
                <span className="flex-1">
                  <span className="block font-display text-xl">{t("work.start")}</span>
                  <span className="mt-1 block text-sm text-forest-ink/80">{t("work.startHint")}</span>
                </span>
              </button>
              {starting && (
                <>
                  {task && (
                    <div className="mt-4 sm:max-w-sm">
                      <StartChoice o={task} onPick={() => setStarting(false)} />
                    </div>
                  )}
                  {groups.length > 0 && (
                    <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {groups.map((g) => (
                        <div key={g.key}>
                          <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-forest-ink/70">{t(g.title)}</h3>
                          <ul className="mt-2 grid gap-2">
                            {g.items.map((o) => (
                              <li key={o.key}>
                                <StartChoice o={o} onPick={() => setStarting(false)} />
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </section>
          )}

          {hasRecord && (
            <section className="rounded-2xl border border-line bg-surface">
              <h2 className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted">{t("work.group.admin")}</h2>
              <ul className="divide-y divide-line">
                {ADMIN.map((o) => (
                  <li key={o.key}>
                    <Link href={o.href!} className={row}>
                      <span className="flex-1">
                        <span className="block font-semibold">{t(o.title)}</span>
                        <span className="block text-sm text-muted">{t(o.hint)}</span>
                      </span>
                      {chevron}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}

      <section className="rounded-2xl border border-line bg-surface">
        <h2 className="px-4 pt-4 pb-1 text-xs font-semibold uppercase tracking-[0.16em] text-muted">{t("work.continue")}</h2>
        <ul className="divide-y divide-line">
          <li>
            <button type="button" onClick={() => onFocus("mine")} className={row}>
              <span className="flex-1">
                <span className="block font-semibold">{t("work.mine")}</span>
                <span className="block text-sm text-muted">{t("work.mineHint")}</span>
              </span>
              <span className="rounded-full bg-sunken px-2.5 py-0.5 text-sm font-semibold tabular-nums">{mine}</span>
              {chevron}
            </button>
          </li>
          {sources.length > 0 && (
            <li className="px-4 py-3.5">
              <span className="block font-semibold">{t("work.workflows")}</span>
              <span className="block text-sm text-muted">{t("work.workflowsHint")}</span>
              <span className="mt-2 flex flex-wrap gap-2">
                {sources.map((s) => (
                  <Link key={s} href={taskHref(s)} className="rounded-full bg-mist px-3 py-1 text-sm font-semibold text-forest hover:bg-sunken">
                    {label(s)}
                  </Link>
                ))}
              </span>
            </li>
          )}
          <li>
            <button type="button" onClick={() => onFocus("attention")} className={row}>
              <span className="flex-1">
                <span className="block font-semibold">{t("work.attention")}</span>
                <span className="block text-sm text-muted">{t("work.attentionHint")}</span>
              </span>
              <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${attention ? "bg-clay-soft text-clay" : "bg-sunken"}`}>{attention}</span>
              {chevron}
            </button>
          </li>
        </ul>
      </section>
    </div>
  );
}
