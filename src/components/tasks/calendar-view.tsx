"use client";

import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { RowItem, kindFill, type RowActions } from "@/components/tasks/row";
import { TODAY } from "@/components/workspace/ui";
import { weekStartOf } from "@/lib/i18n";
import { addDays, onDay, type Row } from "@/lib/work-items";

/**
 * A month of tasks and milestones. Phones show dots per day and the picked day's items below;
 * wider screens show titles in each day. Ranges such as harvest windows mark every day they cover.
 */

const dotOf = (r: Row) => (r.kind === "milestone" ? kindFill[r.milestoneKind] : r.kind === "task" && r.done ? "bg-line" : "bg-forest");

function monthGrid(month: string, weekStart: number) {
  const first = `${month}-01`;
  const lead = (new Date(`${first}T12:00:00Z`).getUTCDay() - weekStart + 7) % 7;
  const start = addDays(first, -lead);
  // Six weeks always fit a month and keep the grid from jumping in height.
  return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

const shiftMonth = (month: string, n: number) => {
  const d = new Date(`${month}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
};

export function CalendarView({ rows, actions }: { rows: Row[]; actions: RowActions }) {
  const { t, date, lang } = useT();
  const [month, setMonth] = useState(TODAY.slice(0, 7));
  const [picked, setPicked] = useState(TODAY);
  const days = monthGrid(month, weekStartOf(lang));
  const dated = rows.filter((r) => r.date);
  const on = (day: string) => dated.filter((r) => onDay(r, day));
  const pickedRows = on(picked);

  return (
    <div>
      <div className="flex items-center gap-2">
        <h2 className="flex-1 font-display text-2xl">{date(`${month}-01`, { month: "long", year: "numeric" })}</h2>
        <button
          type="button"
          onClick={() => {
            setMonth(TODAY.slice(0, 7));
            setPicked(TODAY);
          }}
          className="rounded-full border border-line px-3 py-1.5 text-sm hover:border-forest"
        >
          {t("calendar.today")}
        </button>
        {[-1, 1].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setMonth(shiftMonth(month, n))}
            aria-label={t(n < 0 ? "calendar.prev" : "calendar.next")}
            className="grid h-10 w-10 place-items-center rounded-full border border-line hover:border-forest"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-4 w-4 rtl:-scale-x-100" aria-hidden>
              <path d={n < 0 ? "m15 6-6 6 6 6" : "m9 6 6 6-6 6"} />
            </svg>
          </button>
        ))}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-line bg-line">
        <div className="grid grid-cols-7 gap-px" aria-hidden>
          {days.slice(0, 7).map((d) => (
            <div key={d} className="bg-sunken py-1.5 text-center text-[11px] font-semibold uppercase tracking-wide text-muted">
              {date(d, { weekday: "narrow" })}
            </div>
          ))}
        </div>
        {Array.from({ length: 6 }, (_, w) => (
          <div key={w} className="mt-px grid grid-cols-7 gap-px">
            {days.slice(w * 7, w * 7 + 7).map((d) => {
              const items = on(d);
              const inMonth = d.startsWith(month);
              const isPicked = d === picked;
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={isPicked}
                  aria-label={`${date(d, { weekday: "long", day: "numeric", month: "long" })}${items.length ? `, ${items.length}` : ""}`}
                  onClick={() => setPicked(d)}
                  className={`flex min-h-14 flex-col items-stretch gap-1 p-1 text-start lg:min-h-24 ${inMonth ? "bg-surface" : "bg-paper text-muted"} ${isPicked ? "ring-2 ring-inset ring-forest" : ""}`}
                >
                  <span className={`grid h-6 w-6 place-items-center self-center rounded-full text-xs tabular-nums lg:self-start ${d === TODAY ? "bg-forest font-bold text-forest-ink" : ""}`}>
                    {date(d, { day: "numeric" })}
                  </span>
                  {/* Phones: one dot per item, up to four. */}
                  <span className="flex flex-wrap justify-center gap-0.5 lg:hidden" aria-hidden>
                    {items.slice(0, 4).map((r) => (
                      <span key={r.key} className={`h-1.5 w-1.5 rounded-full ${dotOf(r)}`} />
                    ))}
                  </span>
                  {/* Wider screens: titles. */}
                  <span className="hidden flex-col gap-0.5 lg:flex" aria-hidden>
                    {items.slice(0, 3).map((r) => (
                      <span key={r.key} className="flex items-center gap-1 truncate text-[11px] leading-tight">
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotOf(r)}`} />
                        <span className={`truncate ${r.kind === "task" && r.done ? "text-muted line-through" : ""}`}>{r.title}</span>
                      </span>
                    ))}
                    {items.length > 3 && <span className="text-[11px] text-muted">{t("calendar.more", { n: items.length - 3 })}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <section className="mt-6" aria-live="polite">
        <h3 className="font-display text-lg">{date(picked, { weekday: "long", day: "numeric", month: "long" })}</h3>
        {pickedRows.length ? (
          <ul className="mt-1 divide-y divide-line">
            {pickedRows.map((r) => (
              <RowItem key={r.key} row={r} actions={actions} />
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">{t("calendar.nothing")}</p>
        )}
      </section>
    </div>
  );
}
