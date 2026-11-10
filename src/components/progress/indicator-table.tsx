"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProofNumber } from "@/components/progress/proof-panel";
import { useT } from "@/components/app/i18n";
import { today } from "@/lib/clock";
import { quarterOfToday, targetStatus } from "@/lib/target-status";
import type { FrameworkView, TreeNode } from "@/server/framework-store";

/**
 * Every target this year, one row each, grouped under the output it serves. In order: name, the
 * year's target, the result so far, a status word (never colour alone) and the date of the last
 * accepted result. Tapping a row opens the records and proof behind it.
 */
const STATUS: Record<string, { tone: "forest" | "sky" | "ochre" | "clay" | "muted"; text: string }> = {
  completed: { tone: "forest", text: "Target met" },
  on_track: { tone: "sky", text: "On track" },
  not_started: { tone: "muted", text: "Not due yet" },
  delayed: { tone: "clay", text: "Delayed" },
  not_implemented: { tone: "clay", text: "Not implemented" },
};
const n = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 1 });

/** One wording for an indicator's status everywhere. "Not started" splits three ways: not planned, due now, or due later. */
export function indicatorStatus(i: { status: string; planned: number[] | null; year: number; yearTarget: number }) {
  const qNow = Math.floor(new Date().getUTCMonth() / 3) + 1;
  if (i.status === "not_started" && i.planned && i.planned.length === 0 && i.yearTarget > i.year) return { tone: "clay" as const, text: "Not planned" };
  // Due this quarter: this is the last quarter of its window (the same rule as the summary's list).
  if (i.status === "not_started" && i.planned?.length && Math.max(...i.planned) === qNow) return { tone: "ochre" as const, text: "Due this quarter" };
  return STATUS[i.status] ?? { tone: "muted" as const, text: i.status };
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
  // Outputs, each with the indicators of its activities.
  const outputs: { key: string; text: string | null; rows: TreeNode["indicators"] }[] = v.outcomes.flatMap((o) =>
    o.children.map((out) => ({ key: out.key, text: out.text ?? out.suggested?.text ?? null, rows: [...out.indicators, ...out.children.flatMap((a) => a.indicators)] })).filter((x) => x.rows.length),
  );
  const qNow = quarterOfToday(today());
  const TONE = { forest: "bg-mist text-forest", clay: "bg-clay-soft text-clay", muted: "bg-sunken text-muted" } as const;
  const ICON = { on_track: "✓", behind: "!", no_data: "–" } as const;
  return (
    <section className="mt-8" aria-labelledby="ind-year">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ind-year" className="font-display text-2xl">
          {t("prog.title", { year: v.year })}
        </h2>
        <Link href="/progress/framework" className="text-sm font-semibold text-forest hover:underline">
          Results framework →
        </Link>
      </div>
      <p className="mt-1 text-xs text-muted">{t("prog.open")}</p>
      {outputs.map((o) => (
        <div key={o.key} className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Output {o.key}
            {o.text ? ` · ${o.text}` : ""}
          </p>
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
                        <span className="font-semibold">{n(i.year)}</span>
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
