"use client";

import { useState } from "react";
import { useT } from "@/components/app/i18n";

/**
 * Columns of cards, one per step (lib/boards.ts). On a phone the columns scroll sideways; a
 * folded column (rejected, finished) shows its count until opened. Cards are links or buttons
 * made by the page: nothing is dragged.
 */

export type BoardColumn = { id: string; title: string; count: number; folded?: boolean; cards: React.ReactNode[] };

export function Board({ columns, label }: { columns: BoardColumn[]; label: string }) {
  const { t } = useT();
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div role="region" aria-label={label} tabIndex={0} className="-mx-4 mt-4 overflow-x-auto px-4 pb-3 focus:outline-none sm:-mx-6 sm:px-6">
      <ol className="flex min-w-max gap-3">
        {columns.map((c) => {
          const shown = !c.folded || open[c.id];
          return (
            <li key={c.id} className={`flex shrink-0 flex-col rounded-2xl bg-sunken p-2 ${shown ? "w-72" : "w-44"}`}>
              <h2 className="flex items-baseline gap-2 px-2 pb-2 pt-1 text-sm font-semibold">
                <span className="min-w-0 flex-1">{c.title}</span>
                <span className="text-xs font-medium tabular-nums text-muted">{c.count}</span>
              </h2>
              {c.folded && c.count > 0 && (
                <button type="button" className="mx-1 mb-2 rounded-lg px-2 py-1.5 text-start text-xs font-semibold text-forest hover:bg-surface" aria-expanded={!!open[c.id]} onClick={() => setOpen({ ...open, [c.id]: !open[c.id] })}>
                  {open[c.id] ? t("bd.hide") : t("bd.show", { n: c.count })}
                </button>
              )}
              {shown && (
                <ul className="flex flex-col gap-2">
                  {c.cards.length ? c.cards.map((card, i) => <li key={i}>{card}</li>) : <li className="px-2 pb-2 text-xs text-muted">{t("bd.empty")}</li>}
                </ul>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** One card's frame: a raised surface, ochre-edged when it has waited too long. */
export function cardClass(stuck: boolean) {
  return `block rounded-xl border bg-surface p-3 text-start text-sm shadow-sm transition hover:border-forest ${stuck ? "border-ochre border-s-4" : "border-line"}`;
}

/** Board or list, remembered by the page. */
export function ViewSwitch({ value, onChange }: { value: "board" | "list"; onChange: (v: "board" | "list") => void }) {
  const { t } = useT();
  return (
    <div role="group" className="inline-flex rounded-full bg-mist p-0.5 text-sm">
      {(["board", "list"] as const).map((v) => (
        <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={`rounded-full px-3 py-1.5 ${value === v ? "bg-forest text-paper" : "text-forest"}`}>
          {t(v === "board" ? "bd.board" : "bd.list")}
        </button>
      ))}
    </div>
  );
}
