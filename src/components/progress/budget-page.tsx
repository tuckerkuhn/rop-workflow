"use client";

import { Why } from "@/components/app/why";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { MoneySourceLink } from "@/components/progress/proof-panel";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser } from "@/components/app/session";
import { Pill, TopBar } from "@/components/workspace/ui";
import { Fig, Figures, LedgerRow, LedgerTable, PageHead, SectionHead } from "@/components/workspace/ledger";
import { LIMITS, type ActivityView, type LineView } from "@/lib/budget-view";
import type { Explain, loadBudgetView } from "@/server/budget-view-store";
import { OverspendReasonPicker } from "@/components/progress/overspend-reason";
import { SpendImport } from "@/components/progress/spend-import";
import { LedgerBudget } from "@/components/ledger/ledger-budget";
import type { OverspendReason } from "@/lib/overspend";

/**
 * Budget against actual by activity, for the current phase: approved (Finance's workbook),
 * spent to date, forecast at completion (spent plus the revised plan for the quarters left),
 * results beside the lines that pay for them, and the lines to explain.
 */

type View = Awaited<ReturnType<typeof loadBudgetView>> & { mayImport?: boolean };

const money = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("en-US"));
const pctText = (p: number | null) => (p === null ? "—" : `${p}%`);
/** Activity, approved, spent, spent %, forecast, forecast %, to check. */
const COLS = "minmax(14rem,1.6fr) 7rem 7rem 5rem 7rem 6rem 5rem";
const HEAD = ["Activity", "Approved", "Spent", { label: "Spent %", end: true }, { label: "Forecast", end: true }, { label: "Forecast %", end: true }, { label: "To check", end: true }];
const monthLabel = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

export function BudgetPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const [v, setV] = useState<View | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { t } = useT();

  const userId = user?.id;
  const load = useCallback((quiet = false) => {
    if (!userId || !project.saved) return;
    fetch(`/api/projects/${project.id}/budget-view`, { cache: "no-store", headers: { "x-demo-user": userId } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load the budget.");
        setV(d);
      })
      // A refresh after a save that fails leaves the page as it is; the save itself went through.
      .catch((e) => !quiet && setError(e instanceof Error ? e.message : String(e)));
  }, [userId, project.id, project.saved]);
  useEffect(() => load(), [load]);
  /** Saves the reason a line is over budget: on the line, so each quarterly report prints it while the line is over. */
  const saveReason = async (line: string, r: { reason: OverspendReason | null; note: string }) => {
    if (!userId) return;
    const res = await fetch(`/api/projects/${project.id}/overspend`, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": userId }, body: JSON.stringify({ line, ...r }) });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Not saved (${res.status})`);
    load(true);
  };

  if (!user) return null;
  const flagged = v?.activities.reduce((t, a) => t + a.flags, 0) ?? 0;
  // Look first at the activity expected to end furthest over its approved budget.
  const furthest = v?.activities.filter((a) => a.forecastPct !== null && a.forecastPct > 100).sort((a, b) => (b.forecastPct ?? 0) - (a.forecastPct ?? 0))[0]?.code;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <PageHead kicker={project.name} title={t("nav.budget")} meta={v?.period ? `${monthLabel(v.period.from)} to ${monthLabel(v.period.to)}` : undefined} />
        <Why>The budget in the agreement is a promise, line by line. Spending well over a line without the donor&rsquo;s written agreement can be refused at audit, even when the project as a whole is under budget.</Why>
        {/* The same spending import as on the quarterly report, where a newcomer looks for it first. */}
        {project.saved && v?.mayImport && (
          <div className="mt-4">
            <SpendImport code={project.id} currency={v.currency ?? ""} onDone={() => load(true)} />
          </div>
        )}
        {!project.saved ? (
          <p className="mt-6 bg-sunken px-4 py-3 text-sm text-muted">This demo project is kept in this browser only; its budget is on the project page.</p>
        ) : error ? (
          <p role="alert" className="mt-6 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        ) : !v ? (
          <p className="mt-6 text-sm text-muted">Loading…</p>
        ) : !v.period ? (
          <p className="mt-6 bg-sunken px-4 py-3 text-sm text-muted">
            No spending imported for this phase yet.{" "}
            {v.mayImport ? (
              <>Import Finance&rsquo;s budget against actual workbook above.</>
            ) : (
              <>Finance imports the budget against actual workbook here (or on the{" "}
                <Link href="/progress/report" className="font-semibold text-forest hover:underline">
                  quarterly report
                </Link>
                ); ask them to.
              </>
            )}
          </p>
        ) : (
          <ExplainCtx.Provider value={v.explain ? { ...v.explain, save: saveReason } : null}>
            <p className="mt-4 max-w-3xl text-sm text-muted">
              {project.name}, {monthLabel(v.period.from)} to {monthLabel(v.period.to)}, in {v.currency} before overhead, from {v.imported?.file}. Approved is Finance&rsquo;s budget; the expected total at the end (&ldquo;forecast&rdquo; in the table) is spent so far plus the revised plan for the quarters left.
            </p>

            <p className="mt-1 max-w-3xl text-sm text-muted">{t("rp.totals.onBudget")}</p>

            <Figures
              className="mt-5"
              items={[
                { label: "Approved", value: money(v.totals.approved) },
                { label: "Spent", value: `${money(v.totals.spent)} (${pctText(v.totals.approved ? Math.round((v.totals.spent / v.totals.approved) * 1000) / 10 : null)})` },
                { label: "Expected total at the end", value: money(v.totals.forecast) },
                { label: "Time gone", value: v.timeGone === null ? "—" : `${Math.round(v.timeGone * 100)}%` },
              ]}
            />
            {user && (
              <p className="mt-2">
                <MoneySourceLink project={project.id} user={user.id} />
              </p>
            )}

            {flagged > 0 && (
              <p className="mt-4 bg-sunken px-4 py-3 text-sm">
                {flagged} {flagged === 1 ? "line needs" : "lines need"} a look: overspent (more than {LIMITS.overPct}% over approved), forecast more than {v.revisionPct}% over approved (needs donor approval), or spending more than {LIMITS.behindPts} points behind or ahead of the time gone. Open an activity to see them.
              </p>
            )}

            {/* Below a wide screen: one block per activity, stacked, so nothing scrolls sideways on a phone. */}
            <SectionHead>Budget lines by activity</SectionHead>
            <div className="mt-3 divide-y divide-line border-y border-ink font-ledger lg:hidden">
              {v.activities.map((a) => (
                <ActivityCard key={a.code} a={a} revisionPct={v.revisionPct} first={a.code === furthest} open={open === a.code} onToggle={() => setOpen(open === a.code ? null : a.code)} />
              ))}
            </div>
            <div className="hidden overflow-x-auto lg:block">
              <LedgerTable cols={COLS} head={HEAD} label="Budget against actual by activity" className="mt-3 min-w-[52rem]">
                {v.activities.map((a) => (
                  <ActivityRows key={a.code} a={a} revisionPct={v.revisionPct} first={a.code === furthest} open={open === a.code} onToggle={() => setOpen(open === a.code ? null : a.code)} />
                ))}
              </LedgerTable>
            </div>
            {furthest && <p className="mt-2 text-xs text-muted">The shaded activity is the one expected to end furthest over its approved budget.</p>}

            {(v.notInBudget.length > 0 || v.notInFile.length > 0) && (
              <section className="text-sm">
                <SectionHead>Lines to map</SectionHead>
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
        {/* Spending from the books (the grant ledger), beside the workbook figures above; it changes none of them. */}
        {project.saved && <LedgerBudget code={project.id} user={user.id} />}
      </main>
    </div>
  );
}

/** The reasons for lines over budget, and how to save one. */
const ExplainCtx = createContext<{ mayWrite: boolean; lines: Explain["lines"]; save: (line: string, r: { reason: OverspendReason | null; note: string }) => Promise<void> } | null>(null);

/** Under a line the quarterly report will ask about: the reason, given here once, printed there. */
function Reason({ line }: { line: string }) {
  const x = useContext(ExplainCtx);
  const saved = x?.lines[line];
  if (!x || !saved) return null;
  return <OverspendReasonPicker saved={saved} mayWrite={x.mayWrite} onSave={(r) => x.save(line, r)} />;
}

function ActivityRows({ a, revisionPct, first, open, onToggle }: { a: ActivityView; revisionPct: number; first: boolean; open: boolean; onToggle: () => void }) {
  return (
    <>
      {/* The whole row opens the activity; the button in it says whether it is open. */}
      <div className="cursor-pointer [&:last-child>*]:border-ink" onClick={onToggle}>
        <LedgerRow cols={COLS} first={first} className="items-center text-sm hover:bg-ochre-soft">
          <button type="button" aria-expanded={open} className="min-h-11 text-start font-semibold" onClick={(e) => (e.stopPropagation(), onToggle())}>
            <span aria-hidden className="me-1 inline-block w-3 text-muted">
              {open ? "▾" : "▸"}
            </span>
            <span className="font-mono text-xs">{a.code}</span> {a.name}
          </button>
          <Fig>{money(a.approved)}</Fig>
          <Fig>{money(a.spent)}</Fig>
          <Fig>{pctText(a.spentPct)}</Fig>
          <Fig>{money(a.forecast)}</Fig>
          <Fig strong={a.forecastPct !== null && a.forecastPct > 100 + revisionPct} tone={a.forecastPct !== null && a.forecastPct > 100 + revisionPct ? "clay" : undefined}>
            {pctText(a.forecastPct)}
          </Fig>
          <span className="text-end">{a.flags > 0 ? <Pill tone="ochre">{a.flags}</Pill> : <span className="text-muted">—</span>}</span>
        </LedgerRow>
      </div>
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
        <span key={f.text} className={`mt-1 block text-xs ${f.level === "stop" ? "font-semibold text-clay" : "text-warn"}`}>
          {f.text}
        </span>
      ))}
      <Reason line={l.code} />
    </>
  );
}

/** Approved, spent and forecast as three labelled figures, for the stacked view. */
function LineFigures({ x, warn }: { x: { approved: number | null; spent: number | null; spentPct: number | null; forecast: number | null; forecastPct: number | null }; warn?: boolean }) {
  const head = "font-mono text-xs text-muted";
  return (
    <dl className="mt-2 grid grid-cols-3 gap-2 font-mono text-sm tabular-nums">
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

function ActivityCard({ a, revisionPct, first, open, onToggle }: { a: ActivityView; revisionPct: number; first: boolean; open: boolean; onToggle: () => void }) {
  return (
    <div className={`px-3 py-3 ${first ? "bg-ochre-soft" : ""}`}>
      <button type="button" aria-expanded={open} className="flex min-h-11 w-full items-start gap-2 text-start text-sm font-semibold" onClick={onToggle}>
        <span aria-hidden className="inline-block w-3 text-muted">
          {open ? "▾" : "▸"}
        </span>
        <span className="flex-1">
          {a.code} {a.name}
        </span>
        {a.flags > 0 && <Pill tone="ochre">{a.flags}</Pill>}
      </button>
      <LineFigures x={a} warn={a.forecastPct !== null && a.forecastPct > 100 + revisionPct} />
      {open && (
        <div className="mt-3 space-y-3 border-t border-line pt-3 ps-5">
          {a.lines.map((l) => (
            <div key={l.code}>
              <LineText l={l} />
              <LineFigures x={l} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function LineRow({ l }: { l: LineView }) {
  return (
    <LedgerRow cols={COLS} className="bg-paper text-sm">
      <span className="ps-5">
        <LineText l={l} />
      </span>
      <Fig>{money(l.approved)}</Fig>
      <Fig>{money(l.spent)}</Fig>
      <Fig>{pctText(l.spentPct)}</Fig>
      <Fig>{money(l.forecast)}</Fig>
      <Fig>{pctText(l.forecastPct)}</Fig>
      <span />
    </LedgerRow>
  );
}
