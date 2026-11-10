"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { MoneySourceLink } from "@/components/progress/proof-panel";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser } from "@/components/app/session";
import { Pill, TopBar, primaryBtn } from "@/components/workspace/ui";
import { LIMITS, type ActivityView, type LineView } from "@/lib/budget-view";
import type { loadBudgetView } from "@/server/budget-view-store";

/**
 * Budget against actual by activity, for the current phase: approved (Finance's workbook),
 * spent to date, forecast at completion (spent plus the revised plan for the quarters left),
 * results beside the lines that pay for them, and the lines to explain.
 */

type View = Awaited<ReturnType<typeof loadBudgetView>>;

const money = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("en-US"));
const pctText = (p: number | null) => (p === null ? "—" : `${p}%`);
const monthLabel = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

export function BudgetPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { t } = useT();

  const userId = user?.id;
  const load = useCallback(() => {
    if (!userId || !project.saved) return;
    fetch(`/api/projects/${project.id}/budget-view`, { cache: "no-store", headers: { "x-demo-user": userId } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load the budget.");
        setV(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [userId, project.id, project.saved]);
  useEffect(() => load(), [load]);
  /** Saves the reason a line is over budget into the quarterly report it belongs to. */
  const saveReason = async (line: string, text: string) => {
    if (!v?.explain || !userId) return;
    const res = await fetch(`/api/projects/${project.id}/qpr?q=${v.explain.quarter}`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": userId }, body: JSON.stringify({ action: "overspend", line, text }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Not saved (${res.status})`);
    load();
  };

  if (!user) return null;
  const flagged = v?.activities.reduce((t, a) => t + a.flags, 0) ?? 0;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">Budget vs actual</h1>
        {!project.saved ? (
          <p className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">This demo project is kept in this browser only; its budget is on the project page.</p>
        ) : error ? (
          <p role="alert" className="mt-6 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        ) : !v ? (
          <p className="mt-6 text-sm text-muted">Loading…</p>
        ) : !v.period ? (
          <p className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">
            No spending imported for this phase yet. Import Finance&rsquo;s budget against actual workbook on the{" "}
            <Link href="/progress/report" className="font-semibold text-forest hover:underline">
              quarterly report
            </Link>{" "}
            page.
          </p>
        ) : (
          <ExplainCtx.Provider value={v.explain ? { ...v.explain, save: saveReason } : null}>
            <p className="mt-1 max-w-3xl text-sm text-muted">
              {project.name}, {monthLabel(v.period.from)} to {monthLabel(v.period.to)}, in {v.currency} before overhead, from {v.imported?.file}. Approved is Finance&rsquo;s budget; forecast is spent so far plus the revised plan for the quarters left.
            </p>

            <p className="mt-1 max-w-3xl text-sm text-muted">{t("rp.totals.onBudget")}</p>

            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                ["Approved", money(v.totals.approved)],
                ["Spent", `${money(v.totals.spent)} (${pctText(v.totals.approved ? Math.round((v.totals.spent / v.totals.approved) * 1000) / 10 : null)})`],
                ["Forecast at completion", money(v.totals.forecast)],
                ["Time gone", v.timeGone === null ? "—" : `${Math.round(v.timeGone * 100)}%`],
              ].map(([k, val]) => (
                <div key={k} className="rounded-2xl border border-line bg-surface px-4 py-3">
                  <dt className="text-xs uppercase tracking-[0.12em] text-muted">{k}</dt>
                  <dd className="mt-1 font-display text-xl tabular-nums">{val}</dd>
                </div>
              ))}
            </dl>
            {user && (
              <p className="mt-2">
                <MoneySourceLink project={project.id} user={user.id} />
              </p>
            )}

            {flagged > 0 && (
              <p className="mt-4 rounded-xl bg-sunken px-4 py-3 text-sm">
                {flagged} {flagged === 1 ? "line needs" : "lines need"} a look: overspent (more than {LIMITS.overPct}% over approved), forecast more than {LIMITS.revisionPct}% over approved, or spending more than {LIMITS.behindPts} points behind or ahead of the time gone. Open an activity to see them.
              </p>
            )}

            {/* Below a wide screen: one block per activity, stacked, so nothing scrolls sideways on a phone. */}
            <div className="mt-5 divide-y divide-line rounded-2xl border border-line bg-surface lg:hidden">
              {v.activities.map((a) => (
                <ActivityCard key={a.code} a={a} open={open === a.code} onToggle={() => setOpen(open === a.code ? null : a.code)} />
              ))}
            </div>
            <div className="mt-5 hidden overflow-x-auto rounded-2xl border border-line bg-surface lg:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead className="text-xs uppercase tracking-[0.12em] text-muted">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">Activity</th>
                    <th className="px-3 py-3 text-end font-semibold">Approved</th>
                    <th className="px-3 py-3 text-end font-semibold">Spent</th>
                    <th className="px-3 py-3 text-end font-semibold">Spent %</th>
                    <th className="px-3 py-3 text-end font-semibold">Forecast</th>
                    <th className="px-3 py-3 text-end font-semibold">Forecast %</th>
                    <th className="px-4 py-3 text-end font-semibold">To check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {v.activities.map((a) => (
                    <ActivityRows key={a.code} a={a} open={open === a.code} onToggle={() => setOpen(open === a.code ? null : a.code)} />
                  ))}
                </tbody>
              </table>
            </div>

            {(v.notInBudget.length > 0 || v.notInFile.length > 0) && (
              <section className="mt-6 rounded-2xl border border-line bg-surface p-4 text-sm">
                <h2 className="font-semibold">Lines to map</h2>
                {v.notInBudget.length > 0 && (
                  <p className="mt-2">
                    In Finance&rsquo;s file but not the budget (their spending is not counted above): {v.notInBudget.map((l) => `${l.code} (${money(l.actual)})`).join(", ")}. Add them to the budget in{" "}
                    <Link href="/setup" className="font-semibold text-forest hover:underline">
                      setup
                    </Link>
                    , or ask Finance which line they belong to.
                  </p>
                )}
                {v.notInFile.length > 0 && <p className="mt-2">In the budget but not Finance&rsquo;s file (no spending shown): {v.notInFile.map((l) => l.code).join(", ")}.</p>}
              </section>
            )}
          </ExplainCtx.Provider>
        )}
      </main>
    </div>
  );
}

/** The reasons for lines over budget: where they are saved (a quarter's report) and how to save one. */
const ExplainCtx = createContext<{ quarter: string; released: boolean; lines: Record<string, string>; save: (line: string, text: string) => Promise<void> } | null>(null);

/** Under a line the quarterly report will ask about: the reason, typed here once, printed there. */
function Reason({ line }: { line: string }) {
  const x = useContext(ExplainCtx);
  const { t } = useT();
  const saved = x?.lines[line];
  const [text, setText] = useState(saved ?? "");
  const [state, setState] = useState<"" | "saving" | "saved" | string>("");
  useEffect(() => setText(saved ?? ""), [saved]);
  if (!x || saved === undefined) return null;
  const q = x.quarter.replace("-", " ");
  if (x.released) return saved ? <span className="mt-2 block text-xs">{t("rp.explain.released", { q })} {saved}</span> : null;
  const short = text.trim().length > 0 && text.trim().length < 10;
  return (
    <label className="mt-2 block text-xs">
      {t("rp.explain", { q })}
      <textarea className="mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" rows={2} value={text} onChange={(e) => (setText(e.target.value), setState(""))} />
      {text.trim() !== saved && (
        <button
          type="button"
          className={`${primaryBtn} mt-1`}
          disabled={short || state === "saving"}
          onClick={() => {
            setState("saving");
            x.save(line, text.trim()).then(
              () => setState("saved"),
              (e) => setState(e instanceof Error ? e.message : String(e)),
            );
          }}
        >
          {t("rp.explain.save")}
        </button>
      )}
      {short && <span className="mt-1 block text-muted">{t("rp.explain.short")}</span>}
      {state === "saved" && (
        <span role="status" className="mt-1 block text-forest">
          {t("rp.explain.saved", { q })}
        </span>
      )}
      {state && state !== "saving" && state !== "saved" && (
        <span role="alert" className="mt-1 block text-clay">
          {state}
        </span>
      )}
    </label>
  );
}

function ActivityRows({ a, open, onToggle }: { a: ActivityView; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr className="cursor-pointer hover:bg-sunken" onClick={onToggle}>
        <td className="px-4 py-3">
          <button type="button" aria-expanded={open} className="text-start font-semibold" onClick={(e) => (e.stopPropagation(), onToggle())}>
            <span aria-hidden className="me-1 inline-block w-3 text-muted">
              {open ? "▾" : "▸"}
            </span>
            {a.code} {a.name}
          </button>
        </td>
        <td className="px-3 py-3 text-end tabular-nums">{money(a.approved)}</td>
        <td className="px-3 py-3 text-end tabular-nums">{money(a.spent)}</td>
        <td className="px-3 py-3 text-end tabular-nums">{pctText(a.spentPct)}</td>
        <td className="px-3 py-3 text-end tabular-nums">{money(a.forecast)}</td>
        <td className={`px-3 py-3 text-end tabular-nums ${a.forecastPct !== null && a.forecastPct > 100 + LIMITS.revisionPct ? "font-semibold text-clay" : ""}`}>{pctText(a.forecastPct)}</td>
        <td className="px-4 py-3 text-end">{a.flags > 0 ? <Pill tone="ochre">{a.flags}</Pill> : <span className="text-muted">—</span>}</td>
      </tr>
      {open && a.lines.map((l) => <LineRow key={l.code} l={l} />)}
    </>
  );
}

/** What a line is, what it pays for and what to check on it: the same words in the table and the stacked view. */
function LineText({ l }: { l: LineView }) {
  return (
    <>
      <span className="font-mono text-xs text-muted">{l.code}</span> <span className="text-sm">{l.description}</span>
      {l.results.map((r) => (
        <span key={r.indicator} className="mt-1 block text-xs text-muted">
          Pays for {r.donorCode}: {r.achieved.toLocaleString("en-US")} of {r.target.toLocaleString("en-US")} {r.unit} this phase
        </span>
      ))}
      {l.flags.map((f) => (
        <span key={f.text} className={`mt-1 block text-xs ${f.level === "stop" ? "font-semibold text-clay" : "text-ochre"}`}>
          {f.text}
        </span>
      ))}
      <Reason line={l.code} />
    </>
  );
}

/** Approved, spent and forecast as three labelled figures, for the stacked view. */
function Figures({ x, warn }: { x: { approved: number | null; spent: number | null; spentPct: number | null; forecast: number | null; forecastPct: number | null }; warn?: boolean }) {
  const head = "text-[11px] uppercase tracking-wide text-muted";
  return (
    <dl className="mt-2 grid grid-cols-3 gap-2 text-sm tabular-nums">
      <div>
        <dt className={head}>Approved</dt>
        <dd>{money(x.approved)}</dd>
      </div>
      <div>
        <dt className={head}>Spent</dt>
        <dd>{money(x.spent)}</dd>
        <dd className="text-xs text-muted">{pctText(x.spentPct)}</dd>
      </div>
      <div>
        <dt className={head}>Forecast</dt>
        <dd>{money(x.forecast)}</dd>
        <dd className={`text-xs ${warn ? "font-semibold text-clay" : "text-muted"}`}>{pctText(x.forecastPct)}</dd>
      </div>
    </dl>
  );
}

function ActivityCard({ a, open, onToggle }: { a: ActivityView; open: boolean; onToggle: () => void }) {
  return (
    <div className="px-4 py-3">
      <button type="button" aria-expanded={open} className="flex w-full items-start gap-2 text-start text-sm font-semibold" onClick={onToggle}>
        <span aria-hidden className="inline-block w-3 text-muted">
          {open ? "▾" : "▸"}
        </span>
        <span className="flex-1">
          {a.code} {a.name}
        </span>
        {a.flags > 0 && <Pill tone="ochre">{a.flags}</Pill>}
      </button>
      <Figures x={a} warn={a.forecastPct !== null && a.forecastPct > 100 + LIMITS.revisionPct} />
      {open && (
        <div className="mt-3 space-y-3 border-s-2 border-line ps-3">
          {a.lines.map((l) => (
            <div key={l.code}>
              <LineText l={l} />
              <Figures x={l} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LineRow({ l }: { l: LineView }) {
  return (
    <tr className="bg-paper align-top">
      <td className="px-4 py-2 ps-10">
        <LineText l={l} />
      </td>
      <td className="px-3 py-2 text-end tabular-nums">{money(l.approved)}</td>
      <td className="px-3 py-2 text-end tabular-nums">{money(l.spent)}</td>
      <td className="px-3 py-2 text-end tabular-nums">{pctText(l.spentPct)}</td>
      <td className="px-3 py-2 text-end tabular-nums">{money(l.forecast)}</td>
      <td className="px-3 py-2 text-end tabular-nums">{pctText(l.forecastPct)}</td>
      <td className="px-4 py-2" />
    </tr>
  );
}
