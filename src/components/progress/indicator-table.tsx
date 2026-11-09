"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ProofNumber } from "@/components/progress/proof-panel";
import { Pill } from "@/components/workspace/ui";
import type { FrameworkView, TreeNode } from "@/server/framework-store";

/**
 * Every indicator this year, one row each, grouped under the output it serves: achieved against
 * the year's target and the workplan status, the same judgment as the summary above it.
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
  return (
    <section className="mt-8" aria-labelledby="ind-year">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ind-year" className="font-display text-2xl">
          Indicators in {v.year}
        </h2>
        <Link href="/progress/framework" className="text-sm font-semibold text-forest hover:underline">
          Results framework →
        </Link>
      </div>
      {outputs.map((o) => (
        <div key={o.key} className="mt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">
            Output {o.key}
            {o.text ? ` · ${o.text}` : ""}
          </p>
          <ul className="mt-1 divide-y divide-line rounded-2xl border border-line bg-surface">
            {o.rows.map((i) => {
              const st = indicatorStatus(i);
              const pct = i.yearTarget > 0 ? Math.min(100, Math.round((i.year / i.yearTarget) * 100)) : 0;
              return (
                <li key={i.code} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 sm:grid-cols-[1fr_9rem_7rem]">
                    <Link href={`/progress/results?indicator=${i.code}`} className="line-clamp-2 min-w-0 text-sm leading-snug hover:text-forest sm:line-clamp-none" title={i.name}>
                      <span className="me-1.5 font-mono text-xs text-muted">{i.donorCode}</span>
                      {i.name}
                    </Link>
                    <span className="order-3 col-span-2 sm:order-none sm:col-span-1">
                      <span className="block text-end text-sm tabular-nums">
                        <ProofNumber project={projectId} user={userId} indicator={i.code} from={`${v.year}-01-01`} to={`${v.year}-12-31`} value={i.year} records={i.year ? 1 : 0} className="tabular-nums">
                          {n(i.year)}
                        </ProofNumber>{" "}
                        <span className="text-muted">of {n(i.yearTarget)} {i.unit}</span>
                      </span>
                      <span className="mt-1 block h-1 overflow-hidden rounded-full bg-sunken" aria-hidden>
                        <span className={`block h-full rounded-full ${pct >= 100 ? "bg-leaf" : "bg-forest"}`} style={{ width: `${pct}%` }} />
                      </span>
                    </span>
                    <span className="justify-self-end">
                      <Pill tone={st.tone}>{st.text}</Pill>
                    </span>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </section>
  );
}
