"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser } from "@/components/app/session";
import { Pill, TopBar } from "@/components/workspace/ui";
import type { PortfolioView } from "@/server/portfolio-store";

/** All projects side by side: results against this year's targets first, then money against time. */
export function PortfolioPage() {
  const { user } = useRequireUser();
  const { setProject } = useCurrentProject();
  const [v, setV] = useState<PortfolioView | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!user) return;
    fetch("/api/portfolio", { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load.");
        setV(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [user]);
  if (!user) return null;
  const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">All projects</h1>
        <p className="mt-1 text-sm text-muted">Where each project stands on this year&rsquo;s results, then on money against time.</p>
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {!v && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && v.rows.length === 0 && <p className="mt-6 text-sm text-muted">No projects yet.</p>}
        <ul className="mt-6 space-y-3">
          {v?.rows.map((p) => (
            <li key={p.code} className="rounded-2xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="min-w-0 flex-1 font-display text-xl">{p.name}</h2>
                <Pill tone="muted">{p.stage}</Pill>
                {p.ready && <Pill tone={p.level === "good" ? "forest" : p.level === "warning" ? "ochre" : "clay"}>{p.late ? `${p.late} late` : "On schedule"}</Pill>}
              </div>
              {p.ready ? (
                <>
                  <p className="mt-2 text-sm">
                    <span className="font-semibold">
                      {p.met} of {p.indicators}
                    </span>{" "}
                    indicators have met this year&rsquo;s target, {p.onTrack} more on track{p.late ? `, ${p.late} late` : ""}.
                  </p>
                  {p.lateNames.length > 0 && <p className="text-xs text-muted">Late: {p.lateNames.join("; ")}</p>}
                  <p className="mt-1 text-sm text-muted">
                    {pct(p.budget.spentPct)} of {p.budget.currency} {p.budget.approved.toLocaleString("en-US", { maximumFractionDigits: 0 })} spent with {pct(p.budget.timePct)} of the time gone
                    {p.budget.ahead ? " (spending ahead of time)" : ""}
                    {p.budget.overspent ? ` · ${p.budget.overspent} overspent ${p.budget.overspent === 1 ? "line" : "lines"}` : ""}.
                  </p>
                  {p.topConcern && (
                    <p className="mt-2 text-sm">
                      <span className="font-semibold text-clay">Needs attention: </span>
                      {p.topConcern}
                    </p>
                  )}
                  {p.topWin && (
                    <p className="mt-1 text-sm">
                      <span className="font-semibold text-forest">Worth celebrating: </span>
                      {p.topWin}
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-muted">No plan signed off yet.</p>
              )}
              <Link href="/progress" onClick={() => setProject(p.code)} className="mt-2 inline-block text-sm font-semibold text-forest hover:underline">
                Open {p.short} →
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
