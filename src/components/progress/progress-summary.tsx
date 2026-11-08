"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ProgressSummary } from "@/server/progress-summary-store";

/**
 * The top of Progress for a database project: what deserves celebrating beside what needs
 * attention, each item specific and linked to where to act. Wins come only from accepted results;
 * concerns are ranked, most serious first, each with why it matters.
 */
export function ProgressSummaryPanel({ projectId, userId }: { projectId: string; userId: string }) {
  const [v, setV] = useState<ProgressSummary | null>(null);
  const [error, setError] = useState("");
  const [allWins, setAllWins] = useState(false);

  useEffect(() => {
    let live = true;
    setV(null);
    fetch(`/api/projects/${projectId}/progress-summary`, { cache: "no-store", headers: { "x-demo-user": userId } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load the summary.");
        if (live) setV(d);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [projectId, userId]);

  if (error) return <p className="mt-6 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>;
  if (!v)
    return (
      <div aria-busy className="mt-6 grid gap-4 lg:grid-cols-2">
        <div className="h-56 animate-pulse rounded-2xl bg-sunken" />
        <div className="h-56 animate-pulse rounded-2xl bg-sunken" />
      </div>
    );

  const met = v.wins.filter((w) => w.key.startsWith("done-")).length;
  const critical = v.concerns.filter((c) => c.level === "critical").length;
  const shownWins = allWins ? v.wins : v.wins.slice(0, 5);
  const headline = `${met ? `${met} ${met === 1 ? "indicator has" : "indicators have"} met ${v.year} targets` : `No ${v.year} targets met yet`}; ${
    v.concerns.length ? `${v.concerns.length} ${v.concerns.length === 1 ? "thing needs" : "things need"} attention${critical ? `, ${critical} of them now` : ""}.` : "nothing needs your attention."
  }`;

  return (
    <section aria-label="Progress summary" className="mt-6">
      <p className="text-lg leading-snug">{headline}</p>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4" aria-labelledby="celebrate">
          <h2 id="celebrate" className="flex items-center gap-2 font-display text-xl">
            <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-mist text-sm text-forest">
              ✓
            </span>
            Worth celebrating
          </h2>
          {v.wins.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing yet this year: wins appear here as accepted results reach their targets.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {shownWins.map((w) => (
                <li key={w.key} className="border-s-2 border-forest ps-3">
                  <Link href={w.href} className="block hover:text-forest">
                    <span className="line-clamp-2 text-sm font-semibold">{w.text}</span>
                    <span className="mt-0.5 block text-xs text-muted">{w.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {v.wins.length > 5 && (
            <button type="button" className="mt-3 text-sm font-semibold text-forest hover:underline" onClick={() => setAllWins(!allWins)}>
              {allWins ? "Show fewer" : `Show all ${v.wins.length}`}
            </button>
          )}
        </section>

        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4" aria-labelledby="attention">
          <h2 id="attention" className="flex items-center gap-2 font-display text-xl">
            <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-clay-soft text-sm font-semibold text-clay">
              !
            </span>
            Needs your attention
          </h2>
          {v.concerns.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing is off plan.</p>
          ) : (
            <ol className="mt-3 divide-y divide-line">
              {v.concerns.map((c) => (
                <li key={c.key}>
                  <Link href={c.href} className="flex gap-3 py-2.5 hover:text-forest">
                    <span className={`mt-0.5 shrink-0 self-start rounded-full px-2 py-0.5 text-[11px] font-semibold ${c.level === "critical" ? "bg-clay-soft text-clay" : "bg-ochre-soft text-ochre"}`}>
                      {c.level === "critical" ? "Now" : "Soon"}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-sm font-semibold">{c.text}</span>
                      <span className="mt-0.5 block text-xs text-muted">{c.why}</span>
                    </span>
                    <span aria-hidden className="mt-0.5 text-muted rtl:rotate-180">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </section>
  );
}
