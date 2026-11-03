"use client";

import Link from "next/link";
import { useT } from "@/components/app/i18n";
import { useProgress } from "@/components/app/use-project-data";
import { RowItem, type RowActions } from "@/components/tasks/row";
import { useTaskRows } from "@/components/tasks/use-rows";
import { SectionLabel, TODAY, quietBtn } from "@/components/workspace/ui";
import { canEditProject, daysFrom, type AppUser, type Stage, type projects } from "@/lib/demo";
import { isImpact, missingData } from "@/lib/progress";
import { bucketOf, type Row } from "@/lib/work-items";

/** Home for staff: what needs attention this week, and the current project in one card. */
export function HomePanels({ user, project, stage }: { user: AppUser; project: (typeof projects)[number]; stage: Stage }) {
  const { rows, work } = useTaskRows(user, project);
  const progress = useProgress(project.id);
  const actions: RowActions = { canEdit: work.saved, onToggle: (id, done) => void work.setDone(id, done), onDelete: (id) => void work.remove(id).catch(() => work.reload()) };
  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <ThisWeek rows={rows} progress={progress.data} actions={actions} />
      <Glance user={user} project={project} stage={stage} progress={progress.data} />
    </div>
  );
}

function ThisWeek({ rows, progress, actions }: { rows: Row[]; progress: ReturnType<typeof useProgress>["data"]; actions: RowActions }) {
  const { t, date } = useT();
  const overdue = rows.filter((r) => bucketOf(r) === "overdue");
  const soon = rows.filter((r) => r.kind === "task" && bucketOf(r) === "week");
  // The next deadline of each donor, however far off.
  const deadlines = (progress?.donors ?? []).flatMap((d) => {
    const next = d.deadlines.find((x) => x.date >= TODAY);
    return next ? [{ ...next, donor: d.name }] : [];
  });
  const noData = (progress?.indicators ?? []).filter(missingData);
  const groups = [
    { key: "overdue", label: t("home.overdue"), rows: overdue },
    { key: "soon", label: t("home.dueSoon"), rows: soon },
  ].filter((g) => g.rows.length);
  const empty = !groups.length && !deadlines.length && !noData.length;

  return (
    <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="this-week">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="this-week" className="font-display text-2xl">
          {t("home.thisWeek")}
        </h2>
        <Link href="/tasks" className="text-sm font-semibold text-forest hover:underline">
          {t("home.seeTasks")} →
        </Link>
      </div>
      {empty && <p className="mt-4 text-sm text-muted">{t("home.allClear")}</p>}
      {groups.map((g) => (
        <div key={g.key} className="mt-5">
          <span className={g.key === "overdue" ? "[&>h4]:text-clay" : ""}>
            <SectionLabel>
              {g.label} · {g.rows.length}
            </SectionLabel>
          </span>
          <ul className="mt-1 divide-y divide-line">
            {g.rows.map((r) => (
              <RowItem key={r.key} row={r} actions={actions} />
            ))}
          </ul>
        </div>
      ))}
      {deadlines.length > 0 && (
        <div className="mt-5">
          <SectionLabel>{t("home.deadlines")}</SectionLabel>
          <ul className="mt-2 space-y-2">
            {deadlines.map((d) => (
              <li key={d.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{d.title}</span>
                  <span className="block text-xs text-muted">{d.donor}</span>
                </span>
                <span className={`shrink-0 tabular-nums ${daysFrom(TODAY, d.date) <= 6 ? "font-semibold text-clay" : "text-muted"}`}>{date(d.date, { weekday: "short", day: "numeric", month: "short" })}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {noData.length > 0 && (
        <div className="mt-5">
          <SectionLabel>
            {t("home.noData")} · {noData.length}
          </SectionLabel>
          <ul className="mt-2 space-y-1 text-sm">
            {noData.map((i) => (
              <li key={i.code}>
                <Link href="/progress" className="hover:text-forest">
                  <span className="font-mono text-xs text-muted">{i.code}</span> {i.name}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function Glance({ user, project, stage, progress }: { user: AppUser; project: (typeof projects)[number]; stage: Stage; progress: ReturnType<typeof useProgress>["data"] }) {
  const { t } = useT();
  // Impact first, then outputs; three is enough for a glance.
  const key = [...(progress?.indicators ?? [])].sort((a, b) => Number(isImpact(b) && b.total !== null) - Number(isImpact(a) && a.total !== null)).slice(0, 3);
  return (
    <section className="rounded-2xl border border-line bg-surface p-5" aria-labelledby="glance">
      <h2 id="glance" className="font-display text-2xl">
        {t("home.glance")}
      </h2>
      <p className="mt-3 font-medium">{project.name}</p>
      <p className="text-sm text-muted">
        {project.id} · {project.country}
      </p>
      <p className="mt-3 text-sm">
        <span className="text-muted">{t("home.phase")}:</span> <span className="font-semibold">{t(`stage.${stage}`)}</span>
      </p>
      {key.length > 0 && (
        <div className="mt-4">
          <SectionLabel>{t("home.keyIndicators")}</SectionLabel>
          <ul className="mt-2 space-y-3">
            {key.map((i) => (
              <li key={i.code}>
                <Link href="/progress" className="block hover:text-forest">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{i.name}</span>
                    <span className="shrink-0 tabular-nums">
                      <span className="font-display text-lg">{i.total ?? "—"}</span>
                      <span className="text-muted"> / {i.target}</span>
                    </span>
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
                    <span className="block h-full rounded-full bg-forest" style={{ width: `${i.total === null || !i.target ? 0 : Math.min(100, (i.total / i.target) * 100)}%` }} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        <Link href={`/design?project=${project.id}`} className={`${quietBtn} py-2`}>
          {t("home.editDesign")}
        </Link>
        {canEditProject(user) && (
          <Link href="/settings" className={`${quietBtn} py-2`}>
            {t("home.settings")}
          </Link>
        )}
      </div>
    </section>
  );
}
