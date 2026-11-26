"use client";

import Link from "next/link";
import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRowWords } from "@/components/home/waiting";
import { BUCKETS, waitingCount, type WaitingRow } from "@/lib/home-buckets";
import type { Bucket } from "@/server/home-store";

/**
 * The top of Home, in one of two views of the same rows (lib/home-buckets):
 *
 * - Bands ("Summary" on screen), for people who open the app outdoors on a phone with one to three
 *   things to do: solid blocks of color, one large number each, and the one thing to do now with a
 *   Start button. The full list is one tap away ("Show all"), not drawn a second time below.
 * - Ledger ("List" on screen), for people with long lists: ruled rows, figures in a column, a wash
 *   on the row that needs doing first.
 *
 * Field roles open in Bands and everyone else in Ledger; anyone can switch, and the choice is
 * remembered. Color means the same in both: green is the work, gold is "look here", brown is time.
 * A row that opens something answers the pointer along its whole width and always shows an arrow.
 */

export type HomeViewKind = "bands" | "ledger";
type Rows = Record<Bucket, WaitingRow[]>;
/** The one thing to do next: one of the rows (by its key), or a step that is not on the list (a field officer's weekly update). */
type Next = { key?: string; href: string; text: string } | null;

/** The rows in one list, the next step's row first; `extra` when the next step is not one of the rows. */
function ordered(rows: Rows, next: Next) {
  const all = BUCKETS.flatMap((b) => rows[b]);
  const row = next?.key ? all.find((r) => r.key === next.key) : next ? undefined : all[0];
  return { all: row ? [row, ...all.filter((r) => r !== row)] : all, row, extra: next && !row ? next : null };
}

const INK = "text-[#1c211b]";
const BAND: Record<Bucket, string> = { approve: "bg-deep text-deep-ink", fix: `bg-ochre ${INK}`, due: "bg-[#7a5230] text-white" };
const focus = "focus-visible:outline focus-visible:outline-4 focus-visible:-outline-offset-4 focus-visible:outline-forest";

const Arrow = ({ className = "" }: { className?: string }) => (
  <svg aria-hidden viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="square" className={`shrink-0 rtl:rotate-180 ${className}`}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

export function ViewSwitch({ view, onView }: { view: HomeViewKind; onView: (v: HomeViewKind) => void }) {
  const { tx } = useT();
  const option = (v: HomeViewKind, label: string) => (
    <button type="button" aria-pressed={view === v} onClick={() => onView(v)} className={`min-h-11 px-3 font-mono text-xs ${view === v ? "font-bold underline decoration-ochre decoration-4 underline-offset-8" : "text-muted hover:text-ink"} ${focus}`}>
      {label}
    </button>
  );
  return (
    <div role="group" aria-label={tx("How Home looks")} className="flex justify-end">
      {option("bands", tx("Summary"))}
      {option("ledger", tx("List"))}
    </div>
  );
}

/** A row's words as a short line and the rest: cut at the first colon or bracket once the line is long. */
export function short(text: string): [string, string] {
  if (text.length <= 60) return [text, ""];
  const at = text.search(/: | \(/);
  if (at < 12) return [text, ""];
  return [text.slice(0, at), text.slice(at).replace(/^: /, "").trim()];
}

function Ledger({ rows, next, heading }: { rows: Rows; next: Next; heading: boolean }) {
  const { t, tx } = useT();
  const { words, waited, when } = useRowWords();
  const { all, extra } = ordered(rows, next);
  const total = all.length;
  return (
    <section id="waiting-list" aria-labelledby="waiting" className="scroll-mt-24 bg-surface font-ledger text-ink">
      {heading && (
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 pt-4">
          <h2 id="waiting" className="text-5xl font-bold leading-none tracking-tight text-forest">
            {tx("{n} open", { n: total })}
          </h2>
          <p className="font-mono text-xs">{total ? BUCKETS.filter((b) => rows[b].length).map((b) => `${rows[b].length} ${t(`home.b.${b}`).toLowerCase()}`).join(" / ") : ""}</p>
        </div>
      )}
      {/* Under Bands the top block already says it. */}
      {extra && heading && (
        <Link href={extra.href} className={`group mt-4 flex min-h-16 items-center justify-between gap-3 border-y border-ink bg-ochre-soft px-4 py-3 text-xl font-bold hover:bg-ochre/30 ${focus}`}>
          <span>
            <span className="text-forest">{tx("Next")}: </span>
            {extra.text}
          </span>
          <Arrow className="h-4 w-4 text-muted group-hover:text-forest" />
        </Link>
      )}
      {total === 0 ? (
        <p className="flex items-center gap-3 px-4 py-4 text-lg">
          <span aria-hidden className="h-3.5 w-3.5 bg-leaf" />
          {t("home.b.none")}
        </p>
      ) : (
        <>
          <div aria-hidden className="mt-4 h-1 bg-forest" />
          <div aria-hidden className="mt-[3px] h-px bg-forest" />
          <div aria-hidden className="grid grid-cols-[1fr_5.5rem] border-b border-ink px-4 py-1.5 font-mono text-xs">
            <span>{tx("Item")}</span>
            <span className="text-end">{tx("Days")}</span>
          </div>
          <ol>
            {all.map((r, k) => {
              const w = r.due ? null : waited(r);
              const [head, tail] = short(words(r));
              // The first row is the one to do now, unless the next step is not on the list (shown above it).
              const first = k === 0 && !extra;
              return (
                <li key={r.key}>
                  <Link
                    href={r.href}
                    className={`group grid min-h-16 grid-cols-[1fr_5.5rem] items-start border-b px-4 py-3 hover:bg-ochre-soft active:bg-ochre/30 ${first ? "border-ink bg-ochre-soft" : "border-line"} ${focus}`}
                  >
                    <span className={`min-w-0 leading-snug ${first ? "text-xl font-bold" : "text-lg font-semibold"}`}>
                      <span className={r.bucket === "approve" ? "text-forest" : r.bucket === "fix" ? "text-warn" : "text-ink"}>{t(`home.b.${r.bucket}`)}: </span>
                      {r.item?.blocks && <span className="text-clay">{t("home.b.blocks")} </span>}
                      {head}
                      {tail && (
                        <span className="mt-0.5 block truncate text-sm font-normal text-muted" title={tail}>
                          {tail}
                        </span>
                      )}
                    </span>
                    <span className="flex items-center justify-end gap-2 font-mono text-sm leading-7">
                      <span className={`whitespace-nowrap ${(w ?? 0) >= 7 || (r.due && r.due.days <= 7) ? "font-bold text-clay" : r.due ? "font-bold text-warn" : ""}`}>
                        {r.due ? when(r.due.days) : w !== null ? w : r.urgent && !r.item ? t("home.b.now") : ""}
                      </span>
                      <Arrow className="h-4 w-4 text-muted group-hover:text-forest" />
                    </span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

function Bands({ rows, next }: { rows: Rows; next: Next }) {
  const { t, tx } = useT();
  const { words, when } = useRowWords();
  // The full list is drawn only when asked for: the bands already say what is waiting.
  const [all, setAll] = useState(false);
  const showList = (e?: React.MouseEvent) => {
    e?.preventDefault();
    setAll(true);
    setTimeout(() => document.getElementById("waiting-list")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  };
  const total = waitingCount(rows);
  // The thing to do now in the reader's language when it is one of the rows; the count includes it once.
  const { row, extra } = ordered(rows, next);
  const todo = row ? { href: row.href, text: words(row) } : extra;
  const n = total + (extra ? 1 : 0);
  return (
    <section aria-labelledby="waiting" className="overflow-hidden font-bands">
      <h2 id="waiting" className="sr-only">
        {t("home.b.title")}
      </h2>
      {todo ? (
        <Link href={todo.href} className={`group flex flex-col gap-3 bg-deep px-5 pb-6 pt-5 text-deep-ink ${focus} focus-visible:outline-ochre`}>
          <span className="flex items-end gap-3">
            <span className="text-[7.5rem] font-extrabold leading-[0.8] tracking-tighter tabular-nums">{n}</span>
            <span className="pb-1 text-3xl font-extrabold leading-none">{tx("to do now")}</span>
          </span>
          <span className="mt-2 text-xl font-bold leading-snug">{todo.text}</span>
          <span className="mt-2 flex min-h-14 items-center justify-between bg-white px-4 text-lg font-extrabold text-[#314d2f] group-hover:bg-ochre group-hover:text-[#1c211b] group-active:bg-ochre">
            {tx("Start")}
            <Arrow className="h-6 w-6" />
          </span>
        </Link>
      ) : (
        <div className="bg-deep px-5 pb-6 pt-5 text-deep-ink">
          <p className="flex items-end gap-3">
            <span className="text-[7.5rem] font-extrabold leading-[0.8] tracking-tighter">0</span>
            <span className="pb-1 text-3xl font-extrabold leading-none">{tx("to do now")}</span>
          </p>
          <p className="mt-4 text-lg font-medium">{t("home.b.none")}</p>
        </div>
      )}
      {BUCKETS.filter((b) => rows[b].length).map((b) => {
        // The top band already says the first thing to do: its group shows what comes after it, or is left out.
        const rest = rows[b].filter((r) => r !== row);
        const top = rest[0];
        if (!top) return null;
        const many = rest.length > 1;
        return (
          <Link key={b} href={many ? "#waiting-list" : top.href} onClick={many ? showList : undefined} className={`group flex min-h-24 items-center gap-4 py-3 ps-5 pe-20 lg:pe-5 ${BAND[b]} hover:brightness-110 active:brightness-90 ${focus} focus-visible:outline-white`}>
            <span className="w-16 shrink-0 text-6xl font-extrabold leading-none tracking-tighter tabular-nums">{rest.length}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-2xl font-extrabold leading-tight">{rest.length < rows[b].length ? (b === "due" ? tx("more due") : tx("more to {what}", { what: t(`home.b.${b}`).toLowerCase() })) : t(`home.b.${b}`)}</span>
              <span className="mt-0.5 block text-[0.95rem] font-medium leading-snug">
                {short(words(top))[0]}
                {top.due ? ` (${when(top.due.days)})` : ""}
              </span>
            </span>
            <Arrow className="h-6 w-6 opacity-70 group-hover:opacity-100" />
          </Link>
        );
      })}
      {total > 1 && (
        <button
          type="button"
          aria-expanded={all}
          aria-controls="waiting-list"
          onClick={() => (all ? setAll(false) : showList())}
          className={`flex min-h-12 w-full items-center justify-between gap-3 border-t border-line bg-surface px-5 text-start font-ledger text-base font-semibold text-forest hover:bg-ochre-soft ${focus}`}
        >
          {all ? tx("Hide the list") : tx("Show all {n}", { n: total })}
          <span aria-hidden>{all ? "▴" : "▾"}</span>
        </button>
      )}
      {total > 1 && all && <Ledger rows={rows} next={next} heading={false} />}
    </section>
  );
}

/** The top of Home in the view the person has chosen, or the one their role opens in. */
export function HomeLead({ rows, next, view, onView }: { rows: Rows; next: Next; view: HomeViewKind; onView: (v: HomeViewKind) => void }) {
  return (
    <div className="space-y-2">
      <ViewSwitch view={view} onView={onView} />
      {view === "bands" ? <Bands rows={rows} next={next} /> : <Ledger rows={rows} next={next} heading />}
    </div>
  );
}
