"use client";

import Link from "next/link";
import { Pill } from "@/components/workspace/ui";
import { useEffect, useState } from "react";
import { usePersistentState } from "@/components/workspace/ui";
import type { AppUser, ProjectInfo } from "@/lib/demo";
import type { HomeView, Lens } from "@/server/home-store";

/**
 * Home for a database project, shaped by role. The eye goes, in order, to: one sentence that says
 * where things stand; four tiles (the need-to-know, each with a plain status word); what is waiting
 * for this person; what is in season. People with several roles switch between views.
 */

type Level = "good" | "warning" | "critical" | "unknown";
const LEVEL: Record<Level, { word: string; icon: string; chip: string }> = {
  good: { word: "On track", icon: "✓", chip: "bg-mist text-forest" },
  warning: { word: "Watch", icon: "!", chip: "bg-ochre-soft text-ochre" },
  critical: { word: "Act now", icon: "!", chip: "bg-clay-soft text-clay" },
  unknown: { word: "No data", icon: "–", chip: "bg-sunken text-muted" },
};
const LENS_LABEL: Record<Lens, string> = { lead: "Leadership", mel: "MEL", finance: "Finance", procurement: "Procurement", field: "Delivery" };

const pct = (n: number | null) => (n === null ? "—" : `${Math.round(n)}%`);
const compact = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(Math.round(n)));
const monthWord = (m: string | null) => (m ? new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" }) : "—");
const dayWord = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function Chip({ level, word }: { level: Level; word?: string }) {
  const l = LEVEL[level];
  return (
    <span className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${l.chip}`}>
      <span aria-hidden>{l.icon}</span>
      {word ?? l.word}
    </span>
  );
}

/** `clear`: a count tile at zero says "All clear" rather than "On track". */
function Tile({ label, value, level, children, href, clear }: { label: string; value: string; level: Level; children?: React.ReactNode; href?: string; clear?: boolean }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-sm text-muted">{label}</span>
        <Chip level={level} word={clear && level === "good" ? "All clear" : undefined} />
      </div>
      <p className="mt-2 font-display text-3xl tabular-nums leading-none tracking-tight">{value}</p>
      <div className="mt-3 text-sm text-muted">{children}</div>
    </>
  );
  const cls = "block h-full rounded-2xl border border-line bg-surface p-4 transition";
  return href ? (
    <Link href={href} className={`${cls} hover:border-forest`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

/** Spent against the time gone: the fill is spent, the tick is where spending would be if even. */
function Meter({ spent, time, over }: { spent: number | null; time: number | null; over: boolean }) {
  const s = Math.min(100, Math.max(0, spent ?? 0));
  const t = time === null ? null : Math.min(100, Math.max(0, time));
  return (
    <div className="relative mt-1 h-2 rounded-full bg-mist" role="img" aria-label={`${pct(spent)} of the budget spent with ${pct(time)} of the time gone`}>
      <div className={`h-2 rounded-full ${over ? "bg-clay" : "bg-forest"}`} style={{ width: `${s}%` }} />
      {t !== null && <div className="absolute -top-1 h-4 w-0.5 rounded-full bg-ink" style={{ left: `calc(${t}% - 1px)` }} title={`${pct(time)} of the time gone`} />}
    </div>
  );
}

/** One whole split into statuses; the counts are printed beside it. */
function StatusBar({ counts, total }: { counts: HomeView["schedule"]["counts"]; total: number }) {
  const parts = [
    { n: counts.completed, cls: "bg-forest", name: "done" },
    { n: counts.on_track, cls: "bg-progress", name: "on track" },
    { n: counts.not_started, cls: "bg-line", name: "not started" },
    { n: counts.delayed + counts.not_implemented, cls: "bg-clay", name: "late" },
  ].filter((p) => p.n > 0);
  return (
    <div className="mt-1 flex h-2 gap-0.5 overflow-hidden rounded-full" role="img" aria-label={parts.map((p) => `${p.n} ${p.name}`).join(", ")}>
      {parts.map((p) => (
        <div key={p.name} className={p.cls} style={{ width: `${(p.n / Math.max(1, total)) * 100}%` }} />
      ))}
    </div>
  );
}

export function RoleHome({ user, project }: { user: AppUser; project: ProjectInfo }) {
  const [v, setV] = useState<HomeView | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = usePersistentState<Lens | "">("rop-home-lens", () => "");

  useEffect(() => {
    let live = true;
    setV(null);
    fetch(`/api/projects/${project.id}/home`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load Home.");
        if (live) setV(d);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [project.id, user.id]);

  if (error) return <p className="rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>;
  if (!v)
    return (
      <div aria-busy className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-32 animate-pulse rounded-2xl bg-sunken" />
        ))}
      </div>
    );

  const lens: Lens = chosen && v.lenses.includes(chosen) ? chosen : v.lenses[0];
  const mine = v.actions.filter((a) => a.for === lens || (lens === "field" && a.for === "field")).sort((a, b) => Number(b.urgent) - Number(a.urgent));
  const s = v.schedule;
  const onTrack = s.counts.completed + s.counts.on_track;
  const late = s.counts.delayed + s.counts.not_implemented;
  const b = v.budget;
  const report = v.deadlines.find((d) => d.key === "qpr")!;
  const review = v.deadlines.find((d) => d.key === "review")!;
  const deadlineLevel: Level = report.days <= 14 ? "warning" : "good";

  const deadlineTile = (
    <Tile label="Next deadline" value={`${report.days} days`} level={deadlineLevel} href={report.href}>
      {report.what}, about {dayWord(report.date)}. {review.what} closes {dayWord(review.date)}.
    </Tile>
  );
  const budgetTile = (
    <Tile label="On budget" value={pct(b.spentPct)} level={b.level} href="/progress/budget">
      <Meter spent={b.spentPct} time={b.timePct} over={b.ahead} />
      <span className="mt-2 block">
        spent with {pct(b.timePct)} of the time gone
        {b.overspent.length ? `; ${b.overspent.length} ${b.overspent.length === 1 ? "line" : "lines"} overspent` : ""}
      </span>
    </Tile>
  );
  const tiles: Record<Lens, React.ReactNode[]> = {
    lead: [
      <Tile key="time" label="On time" value={`${onTrack} of ${s.total}`} level={s.level} href="/progress/review">
        <StatusBar counts={s.counts} total={s.total} />
        <span className="mt-2 block">
          {s.counts.completed} done · {s.counts.on_track} on track · {s.counts.not_started} not due yet{late ? ` · ${late} late` : ""}
        </span>
      </Tile>,
      <div key="budget">{budgetTile}</div>,
      // What is waiting for the lead is listed beside the tiles; this tile is about evidence.
      <Tile key="count" label="Waiting to count" value={String(v.mel.pending + v.mel.queried)} level={v.mel.pending + v.mel.queried ? "warning" : "good"} href="/progress/results">
        {v.mel.pending + v.mel.queried ? `${v.mel.pending} results waiting for MEL${v.mel.queried ? `, ${v.mel.queried} queried` : ""}: they count once accepted.` : "Every recorded result is checked."}
      </Tile>,
      <div key="deadline">{deadlineTile}</div>,
    ],
    mel: [
      <Tile key="check" clear label="Results to check" value={String(v.mel.toCheck)} level={v.mel.toCheck ? "critical" : "good"} href="/progress/results">
        Recorded by others, waiting for you to accept or query.
      </Tile>,
      <Tile key="ready" label={`${v.mel.quarter} report`} value={v.mel.stops ? `${v.mel.stops} to fix` : "Ready"} level={v.mel.stops ? "critical" : v.mel.checks ? "warning" : "good"} href="/progress/report">
        {v.mel.stops} stop and {v.mel.checks} check items before release.
      </Tile>,
      <Tile key="proof" clear label="Missing proof" value={String(v.mel.noProof)} level={v.mel.noProof ? "warning" : "good"} href="/progress/results">
        Results accepted this quarter with no file or link.
      </Tile>,
      <div key="deadline">{deadlineTile}</div>,
    ],
    finance: [
      <Tile key="import" label="Spending imported to" value={monthWord(b.importedTo)} level={mine.some((a) => a.key === "import") ? "warning" : "good"} href="/progress/report">
        {mine.some((a) => a.key === "import") ? "Last month's workbook is not in yet." : "Up to date with Finance's workbook."}
      </Tile>,
      <div key="budget">{budgetTile}</div>,
      <Tile key="lines" clear label="Lines to explain" value={String(b.flagged)} level={b.overspent.length ? "critical" : b.flagged ? "warning" : "good"} href="/progress/budget">
        {b.overspent.length} overspent; the rest forecast above approved or behind plan.
      </Tile>,
      <div key="deadline">{deadlineTile}</div>,
    ],
    procurement: [
      <Tile key="soon" label="Purchases starting soon" value={String(v.season.purchases.length)} level={v.season.purchases.some((p) => p.days <= 14) ? "warning" : "good"} href="/work/plan">
        On the procurement calendar in the next 60 days.
      </Tile>,
      <div key="budget">{budgetTile}</div>,
      <Tile key="you" label="Needs you" value={String(mine.length)} level={mine.length ? "warning" : "good"} href="/work?source=procurement">
        Procurement steps waiting for you are in Work.
      </Tile>,
      <div key="deadline">{deadlineTile}</div>,
    ],
    field: [
      <Tile key="queried" clear label="Queried results to fix" value={String(v.field.queried)} level={v.field.queried ? "critical" : "good"} href="/progress/results">
        MEL asked you to correct these before they count.
      </Tile>,
      <Tile key="mine" label="My results this quarter" value={String(v.field.mine)} level="good" href="/progress/results">
        Recorded by you since the quarter began.
      </Tile>,
      (() => {
        const mine = v.season.now.filter((a) => a.owner === user.name && a.status !== "done" && a.status !== "cancelled");
        const idle = mine.filter((a) => a.status === "not_started").length;
        return (
          <Tile key="season" label="My activities this quarter" value={String(mine.length)} level={idle ? "warning" : "good"} href="/work/activities">
            {mine.length ? `${idle ? `${idle} not started yet` : "All under way"}; ${v.season.weeksLeft} weeks left in ${v.season.quarter}.` : "None assigned to you this quarter."}
          </Tile>
        );
      })(),
      <div key="deadline">{deadlineTile}</div>,
    ],
  };

  const headline: Record<Lens, string> = {
    lead: `${v.project.short} is ${late ? `behind on ${late} ${late === 1 ? "indicator" : "indicators"}` : "on schedule"}: ${onTrack} of ${s.total} indicators done or on track${late ? "" : ", none late"}. It has spent ${pct(b.spentPct)} of its budget with ${pct(b.timePct)} of the time gone${b.overspent.length ? `, and ${b.overspent.length} ${b.overspent.length === 1 ? "line is" : "lines are"} overspent` : ""}.`,
    mel: v.mel.toCheck ? `${v.mel.toCheck} ${v.mel.toCheck === 1 ? "result is" : "results are"} waiting for you to check, and the ${v.mel.quarter} report has ${v.mel.stops} ${v.mel.stops === 1 ? "item" : "items"} to fix before release.` : `No results are waiting for you; the ${v.mel.quarter} report has ${v.mel.stops} ${v.mel.stops === 1 ? "item" : "items"} to fix before release.`,
    finance: `Spending is imported to ${monthWord(b.importedTo)}: ${pct(b.spentPct)} spent with ${pct(b.timePct)} of the time gone, ${b.flagged} budget ${b.flagged === 1 ? "line" : "lines"} to explain.`,
    procurement: `${v.season.purchases.length} ${v.season.purchases.length === 1 ? "purchase starts" : "purchases start"} in the next 60 days; spending is at ${pct(b.spentPct)} of the budget.`,
    field: (() => {
      if (v.field.queried) return `MEL has queried ${v.field.queried} of your results: fix them so they count.`;
      const mine = v.season.now.filter((a) => a.owner === user.name && a.status !== "done" && a.status !== "cancelled");
      const idle = mine.filter((a) => a.status === "not_started").length;
      if (!mine.length) return `No activities are assigned to you for ${v.season.quarter} yet; ${v.season.now.length} are due across the project.`;
      return `You own ${mine.length} ${mine.length === 1 ? "activity" : "activities"} due by ${dayWord(v.season.quarterEnd)}${idle ? `, ${idle} not started yet` : ", all under way"}. Record results as you finish them.`;
    })(),
  };

  return (
    <section aria-label="Where things stand" className="space-y-5">
      <div className="flex flex-wrap items-start gap-3">
        <p className="min-w-0 flex-1 text-lg leading-snug">
          {headline[lens]}
          {lens === "lead" && (
            <Link href="/portfolio" className="ms-2 whitespace-nowrap text-sm font-semibold text-forest hover:underline">
              All projects →
            </Link>
          )}
        </p>
        {v.lenses.length > 1 && (
          <div role="radiogroup" aria-label="View Home as" className="flex rounded-full bg-sunken p-1 text-sm">
            {v.lenses.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={l === lens}
                onClick={() => setChosen(l)}
                className={`rounded-full px-3 py-1 ${l === lens ? "bg-surface font-semibold shadow-sm" : "text-muted hover:text-ink"}`}
              >
                {LENS_LABEL[l]}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{tiles[lens]}</div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className={`min-w-0 rounded-2xl border border-line bg-surface p-4 ${mine.length || (lens === "lead" && (late > 0 || b.overspent.length > 0)) ? "" : "self-start"}`} aria-labelledby="needs-you">
          <h2 id="needs-you" className="font-display text-xl">
            Needs you
          </h2>
          {mine.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing is waiting for you in this view.</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {mine.map((a) => (
                <li key={a.key}>
                  <Link href={a.href} className="flex items-center gap-3 py-2.5 text-sm hover:text-forest">
                    <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${a.urgent ? "bg-clay" : "bg-ochre"}`} />
                    <span className="flex-1">{a.text}</span>
                    {a.urgent && <span className="rounded-full bg-clay-soft px-2 py-0.5 text-xs font-semibold text-clay">Now</span>}
                    <span aria-hidden className="text-muted rtl:rotate-180">
                      ›
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {lens === "lead" && (late > 0 || b.overspent.length > 0) && (
            <div className="mt-3 space-y-1 border-t border-line pt-3 text-sm">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted">Off plan</p>
              {s.late.map((i) => (
                <p key={i.code} className="flex gap-2">
                  <span className="shrink-0 font-mono text-xs text-muted">{i.code}</span>
                  <span className="min-w-0 truncate" title={i.name}>
                    {i.name}
                  </span>
                  <span className="shrink-0 tabular-nums text-clay">
                    {i.achieved} of {i.target}
                  </span>
                </p>
              ))}
              {b.overspent.map((l) => (
                <Link key={l.code} href="/progress/budget" className="flex gap-2 hover:text-forest">
                  <span className="shrink-0 font-mono text-xs text-muted">{l.code}</span>
                  <span className="min-w-0 truncate" title={l.description}>
                    {l.description}
                  </span>
                  <span className="shrink-0 tabular-nums text-clay">{pct(l.spentPct)} spent</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="min-w-0 rounded-2xl border border-line bg-surface p-4" aria-labelledby="season">
          {(() => {
            const now = v.season.now;
            const done = now.filter((a) => a.status === "done").length;
            const moving = now.filter((a) => a.status === "in_progress").length;
            const idle = now.filter((a) => a.status === "not_started").length;
            const held = now.filter((a) => a.status === "on_hold").length;
            const unowned = now.filter((a) => !a.owner && a.status !== "done" && a.status !== "cancelled").length;
            const parts = [moving && `${moving} under way`, done && `${done} done`, idle && `${idle} not started`, held && `${held} on hold`].filter(Boolean).join(", ");
            return (
              <>
                <h2 id="season" className="font-display text-xl">
                  This quarter&rsquo;s work
                </h2>
                {now.length === 0 ? (
                  <p className="mt-2 text-sm text-muted">The workplan schedules nothing for {v.season.quarter}.</p>
                ) : (
                  <>
                    <p className="mt-1 text-sm">
                      <span className="font-semibold">
                        {now.length} {now.length === 1 ? "activity" : "activities"} due by {dayWord(v.season.quarterEnd)}, {v.season.weeksLeft} {v.season.weeksLeft === 1 ? "week" : "weeks"} left.
                      </span>{" "}
                      {parts}
                      {unowned ? `; ${unowned === now.length ? "none has an owner" : `${unowned} ${unowned === 1 ? "has" : "have"} no owner`}` : ""}.
                    </p>
                    <ul className="mt-3 divide-y divide-line">
                      {now.map((a) => {
                        const st =
                          a.status === "done"
                            ? { tone: "forest" as const, text: "Done" }
                            : a.status === "in_progress"
                              ? { tone: "sky" as const, text: "Under way" }
                              : a.status === "on_hold"
                                ? { tone: "clay" as const, text: "On hold" }
                                : a.status === "cancelled"
                                  ? { tone: "muted" as const, text: "Cancelled" }
                                  : { tone: "ochre" as const, text: "Not started" };
                        return (
                          <li key={a.code} className="py-2">
                            <p className="line-clamp-2 text-sm leading-snug" title={a.title}>
                              {a.title}
                            </p>
                            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                              <Pill tone={st.tone}>{st.text}</Pill>
                              <span className={a.owner ? "" : "text-clay"}>{a.owner ?? "No owner"}</span>
                              {a.result && (
                                <span className="tabular-nums">
                                  · {compact(a.result.achieved)} of {compact(a.result.target)} {a.result.unit} this year
                                </span>
                              )}
                            </p>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
                <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <Link href="/work/activities" className="font-semibold text-forest hover:underline">
                    {unowned && v.lenses.includes("lead") ? "Assign owners" : "Open activities"} →
                  </Link>
                  {v.season.next.length > 0 && (
                    <span className="text-muted">
                      {v.season.next.length} more start in {v.season.nextQuarter}
                    </span>
                  )}
                </p>
              </>
            );
          })()}
        </section>
      </div>
    </section>
  );
}
