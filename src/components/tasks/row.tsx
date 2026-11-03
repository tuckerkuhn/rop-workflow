"use client";

import Link from "next/link";
import { useT } from "@/components/app/i18n";
import { Pill, type Tone } from "@/components/workspace/ui";
import { userById } from "@/lib/demo";
import { isOverdue, type MilestoneKind, type Row } from "@/lib/work-items";

/** One task or milestone, the same in the list and under the calendar. */

export const kindTone: Record<MilestoneKind, Tone> = { report_deadline: "clay", harvest_window: "ochre", field_activity: "sky", other: "plum" };
/** Solid colour per kind for calendar dots and timeline bars. */
export const kindFill: Record<MilestoneKind, string> = { report_deadline: "bg-clay", harvest_window: "bg-ochre", field_activity: "bg-sky", other: "bg-plum" };
const kindText: Record<MilestoneKind, string> = { report_deadline: "text-clay", harvest_window: "text-ochre", field_activity: "text-sky", other: "text-plum" };

export type RowActions = {
  canEdit: boolean;
  onToggle: (id: string, done: boolean) => void;
  onDelete: (id: string) => void;
};

const iconBtn = "grid h-11 w-11 shrink-0 place-items-center rounded-full transition disabled:cursor-not-allowed disabled:opacity-40";

function Flag({ kind }: { kind: MilestoneKind }) {
  return (
    <span className={`${iconBtn} cursor-default`} aria-hidden>
      <svg viewBox="0 0 24 24" className={`h-5 w-5 ${kindText[kind]}`} fill="currentColor">
        <path d="M12 2.5 21.5 12 12 21.5 2.5 12Z" />
      </svg>
    </span>
  );
}

export function RowItem({ row, actions }: { row: Row; actions: RowActions }) {
  const { t, date } = useT();

  if (row.kind === "milestone") {
    const when = row.end ? `${date(row.date)} – ${date(row.end)}` : date(row.date, { weekday: "short", day: "numeric", month: "short" });
    return (
      <li className="flex items-center gap-2 py-2">
        <Flag kind={row.milestoneKind} />
        <div className="min-w-0 flex-1">
          <p className="font-medium">{row.title}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            <Pill tone={kindTone[row.milestoneKind]}>{t(`milestone.kind.${row.milestoneKind}`)}</Pill>
            <span>{when}</span>
            {row.automatic && <span>· {row.donorName ?? t("tasks.fromSettings")}</span>}
          </p>
        </div>
        {actions.canEdit && !row.automatic && <DeleteButton title={row.title} onClick={() => actions.onDelete(row.id)} />}
      </li>
    );
  }

  const overdue = isOverdue(row);
  const meta = [
    row.step,
    row.date && t(row.source === "manual" ? "tasks.due" : "tasks.expected", { date: date(row.date) }),
    row.source === "manual" && (row.assignee ? userById(row.assignee)?.name : t("tasks.anyone")),
  ].filter(Boolean);

  // Workflow steps are done in their workflow, so the row opens it.
  if (row.href) {
    return (
      <li>
        <Link href={row.href} className="-mx-2 flex items-center gap-2 rounded-xl px-2 py-2 hover:bg-sunken">
          <span className={`${iconBtn} border border-dashed border-line text-muted`} aria-hidden>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4 rtl:-scale-x-100">
              <path d="m9 6 6 6-6 6" />
            </svg>
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-medium">{row.title}</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
              <Pill tone="forest">{t(`tasks.source.${row.source}`)}</Pill>
              <span>{meta.join(" · ")}</span>
              {row.late && <span className="font-semibold text-clay">{t("tasks.late")}</span>}
            </p>
          </div>
          <span className="shrink-0 text-sm font-semibold text-forest">{t("tasks.open")}</span>
        </Link>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2 py-2">
      <button
        type="button"
        disabled={!actions.canEdit}
        onClick={() => actions.onToggle(row.id!, !row.done)}
        aria-pressed={row.done}
        aria-label={t(row.done ? "tasks.markUndone" : "tasks.markDone", { title: row.title })}
        className={`${iconBtn} enabled:hover:bg-mist`}
      >
        <span className={`grid h-6 w-6 place-items-center rounded-full border-2 text-xs font-bold ${row.done ? "border-forest bg-forest text-forest-ink" : overdue ? "border-clay" : "border-line"}`}>
          {row.done && "✓"}
        </span>
      </button>
      <div className="min-w-0 flex-1">
        <p className={`font-medium ${row.done ? "text-muted line-through" : ""}`}>{row.title}</p>
        {meta.length > 0 && <p className={`mt-0.5 text-xs ${overdue ? "font-semibold text-clay" : "text-muted"}`}>{meta.join(" · ")}</p>}
      </div>
      {actions.canEdit && <DeleteButton title={row.title} onClick={() => actions.onDelete(row.id!)} />}
    </li>
  );
}

function DeleteButton({ title, onClick }: { title: string; onClick: () => void }) {
  const { t } = useT();
  return (
    <button type="button" onClick={onClick} aria-label={t("tasks.delete", { title })} title={t("tasks.delete", { title })} className={`${iconBtn} text-muted hover:bg-clay-soft hover:text-clay`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-4 w-4" aria-hidden>
        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
      </svg>
    </button>
  );
}
