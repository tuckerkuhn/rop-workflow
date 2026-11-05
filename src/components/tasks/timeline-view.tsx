"use client";

import { useT } from "@/components/app/i18n";
import { kindFill } from "@/components/tasks/row";
import { rowEnd, type Row } from "@/lib/work-items";
import { today } from "@/lib/clock";

/**
 * Gantt-style timeline (paid plan): one line per dated item, ranges as bars, single days as
 * diamonds, from the start of the first item's month to the end of the last one's.
 */

const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86400000;
const monthStart = (iso: string) => `${iso.slice(0, 7)}-01`;
const nextMonth = (iso: string) => {
  const d = new Date(`${monthStart(iso)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
};

export function TimelineView({ rows }: { rows: Row[] }) {
  const { t, date } = useT();
  const dated = rows.filter((r): r is Row & { date: string } => !!r.date);
  if (dated.length === 0) return <p className="py-16 text-center text-sm text-muted">{t("timeline.empty")}</p>;

  const from = monthStart([today(), ...dated.map((r) => r.date)].sort()[0]);
  const to = nextMonth([today(), ...dated.map((r) => rowEnd(r) ?? r.date)].sort().at(-1)!);
  const span = day(to) - day(from);
  const at = (iso: string) => ((day(iso) - day(from)) / span) * 100;
  const months: string[] = [];
  for (let m = from; m < to; m = nextMonth(m)) months.push(m);

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <div className="min-w-[640px]">
        <div className="flex border-b border-line text-[11px] font-semibold uppercase tracking-wide text-muted">
          <div className="w-44 shrink-0 px-3 py-2 sm:w-60" />
          <div className="relative h-8 flex-1">
            {months.map((m) => (
              <span key={m} className="absolute top-0 h-full border-s border-line ps-1.5 pt-2" style={{ insetInlineStart: `${at(m)}%` }}>
                {date(m, { month: "short" })}
              </span>
            ))}
          </div>
        </div>
        <ul>
          {dated.map((r) => {
            const end = rowEnd(r) ?? r.date;
            const range = r.kind === "milestone" && r.end;
            const fill = r.kind === "milestone" ? kindFill[r.milestoneKind] : r.done ? "bg-line" : "bg-forest";
            return (
              <li key={r.key} className="flex items-center border-b border-line last:border-b-0">
                <div className="w-44 shrink-0 truncate px-3 py-2 text-sm sm:w-60" title={r.title}>
                  <span className={r.kind === "task" && r.done ? "text-muted line-through" : ""}>{r.title}</span>
                </div>
                <div className="relative h-9 flex-1">
                  {months.map((m) => (
                    <span key={m} className="absolute inset-y-0 border-s border-line/60" style={{ insetInlineStart: `${at(m)}%` }} aria-hidden />
                  ))}
                  <span className="absolute inset-y-0 border-s-2 border-ochre/70" style={{ insetInlineStart: `${at(today())}%` }} aria-hidden />
                  {range ? (
                    <span
                      className={`absolute top-1/2 h-3 -translate-y-1/2 rounded-full ${fill}`}
                      style={{ insetInlineStart: `${at(r.date)}%`, width: `${Math.max(0.8, at(end) - at(r.date) + 100 / span)}%` }}
                      title={`${date(r.date)} – ${date(end)}`}
                    />
                  ) : (
                    <span
                      className={`absolute top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 ${r.kind === "milestone" ? fill : `rounded-full ${fill}`}`}
                      style={{ insetInlineStart: `calc(${at(r.date)}% - 6px)` }}
                      title={date(r.date)}
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
