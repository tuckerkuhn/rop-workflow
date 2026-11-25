"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProofNumber } from "@/components/progress/proof-panel";
import { useT } from "@/components/app/i18n";
import { today } from "@/lib/clock";
import { quarterOfToday, targetStatus, targetStatusText } from "@/lib/target-status";
import { targetGroups } from "@/lib/framework";
import type { FrameworkView, TreeNode } from "@/server/framework-store";

/**
 * Every target this year, one row each, grouped under the output it serves. In order: name, the
 * year's target, the result so far, a status word (never colour alone) and the date of the last
 * accepted result. Tapping a row opens the records and proof behind it.
 */
const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** A target's status in the one shared wording (lib/target-status), as English text: "Not started · due this quarter". */
export function indicatorStatus(i: { status: string; planned: number[] | null; year: number; yearTarget: number }) {
  const st = targetStatus(i, quarterOfToday(today()));
  return { tone: st.tone, text: targetStatusText(st) };
}

export function IndicatorTable({ projectId, userId }: { projectId: string; userId: string }) {
  const { t, date } = useT();
  const [v, setV] = useState<FrameworkView | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/projects/${projectId}/framework`, { cache: "no-store", headers: { "x-demo-user": userId } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => live && setV(d));
    return () => {
      live = false;
    };
  }, [projectId, userId]);
  if (!v) return null;
  // Every target once: by outcome and output, then the ones with no place in the framework yet.
  const outputs = targetGroups<TreeNode["indicators"][number]>(v);
  const qNow = quarterOfToday(today());
  const TONE = { forest: "bg-mist text-forest", sky: "bg-mist text-forest", ochre: "bg-ochre-soft text-warn", clay: "bg-clay-soft text-clay", muted: "bg-sunken text-muted" } as const;
  const ICON = { done: "✓", on_track: "✓", behind: "!", not_started: "–", no_data: "?" } as const;
  return (
    <section className="mt-8" aria-labelledby="ind-year">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ind-year" className="border-s-[6px] border-ochre ps-2 font-ledger text-lg font-bold leading-tight">
          {t("prog.title", { year: v.year })}
        </h2>
        <Link href="/progress/framework" className="btn-link">
          Results framework →
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted">{t("prog.open")}</p>
      {outputs.map((o) => (
        <div key={o.key} className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            {o.kind === "other" ? "Other targets" : `${o.kind === "outcome" ? "Outcome" : "Output"} ${o.key}`}
            {o.text ? ` · ${o.text}` : ""}
          </p>
          {o.kind === "other" && <p className="mt-0.5 text-xs text-muted">Not placed under an output yet. Give each one its code from the donor&rsquo;s results framework in the project design to place it.</p>}
          <ul className="mt-1 divide-y divide-line rounded-2xl border border-line bg-surface">
            {o.rows.map((i) => {
              const st = targetStatus(i, qNow);
              return (
                <li key={i.code}>
                  {/* The whole row is the thing to tap: it opens the accepted results behind the figure and their proof. On a phone the parts stack; nothing scrolls sideways. */}
                  <ProofNumber plain project={projectId} user={userId} indicator={i.code} from={`${v.year}-01-01`} to={`${v.year}-12-31`} value={i.year} records={1} className="block min-h-12 w-full px-4 py-3 text-start hover:bg-sunken">
                    <span className="grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,1fr)_7rem_8rem_9rem] sm:items-center">
                      <span className="min-w-0 text-sm leading-snug">
                        <span className="me-1.5 font-mono text-xs text-muted">{i.donorCode}</span>
                        {i.name}
                      </span>
                      <span className="text-sm tabular-nums">
                        <span className="text-xs text-muted">{t("pw.howMany")} </span>
                        {n(i.yearTarget)} <span className="text-xs text-muted">{i.unit}</span>
                      </span>
                      <span className="text-sm tabular-nums">
                        <span className="text-xs text-muted">{t("prog.result")} </span>
                        {i.note ? <span className="font-semibold text-clay">{i.note}</span> : <span className="font-semibold">{n(i.year)}</span>}
                      </span>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 sm:justify-end">
                        <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[st.tone]}`}>
                          <span aria-hidden>{ICON[st.word]}</span>
                          {t(`prog.w.${st.word}`)}
                        </span>
                        {st.detail && <span className="text-xs text-muted">{t(`prog.d.${st.detail}`)}</span>}
                      </span>
                      <span className="text-xs text-muted sm:col-span-4">{i.lastAccepted ? t("prog.last", { date: date(i.lastAccepted, { day: "numeric", month: "short", year: "numeric" }) }) : t("prog.noLast")}</span>
                    </span>
                  </ProofNumber>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
