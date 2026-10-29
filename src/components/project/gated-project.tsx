"use client";

import Link from "next/link";
import { useState } from "react";
import { MarketTargetCard, TargetLine } from "@/components/project/market-windows";
import { SectionLabel, TODAY, primaryBtn } from "@/components/workspace/ui";
import { type AppUser, type Stage } from "@/lib/demo";
import { windowById } from "@/lib/market-windows";
import { designGateMissing, isValidated, personName, type ProjectState } from "@/lib/project";

/**
 * Sections for a project that starts in Design behind the market-window gate (e.g. AG-2027).
 * It has no plan, results or field data yet, so the tabs show only what exists.
 */

type Props = {
  u: AppUser;
  state: ProjectState;
  setState: (fn: (s: ProjectState) => ProjectState) => void;
};

/** Share of report numbers that link to evidence. Here the only number is the target window. */
export function gatedTraceable(state: ProjectState) {
  const win = state.marketTarget && windowById(state.marketTarget.windowId);
  if (!win) return null;
  return win.sources.length && isValidated(state, win.id) ? 100 : 0;
}

/** Header control: moves the project to Execute, or lists what is missing. */
export function MoveToExecute({ u, state, setState }: Pick<Props, "u" | "state" | "setState">) {
  // Only shown after a blocked attempt, and always recomputed so it clears once the gate is met.
  const [tried, setTried] = useState(false);
  const missing = tried ? designGateMissing(state) : [];
  const canSign = u.project.includes("plan-approver");
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!canSign}
          onClick={() => {
            if (designGateMissing(state).length) return setTried(true);
            setTried(false);
            setState((s) => ({
              ...s,
              stage: "Execute",
              audit: [...s.audit, { date: TODAY, who: u.id, what: "Signed off Design and moved the project to Execute", kind: "approval" }],
            }));
          }}
          className={primaryBtn}
        >
          Sign off Design and move to Execute →
        </button>
        {!canSign && <p className="text-xs text-muted">Only a plan approver (Tucker or Daniel) can sign off Design.</p>}
      </div>
      {missing.length > 0 && (
        <div role="alert" className="rounded-xl border border-clay/40 bg-clay-soft px-4 py-3 text-sm text-clay">
          <p className="font-semibold">Design can&rsquo;t be signed off yet. Missing:</p>
          <ul className="mt-1 list-disc pl-5">
            {missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Empty({ what, stage }: { what: string; stage: Stage }) {
  return (
    <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">
      {what} starts once the project is in Execute{stage !== "Design" ? " and its plan is drafted" : ""}. Nothing is recorded here yet.
    </p>
  );
}

export function GatedSections({ tab, state, stage, openTarget }: { tab: string; state: ProjectState; stage: Stage; openTarget: () => void }) {
  const missing = designGateMissing(state);
  const trace = gatedTraceable(state);

  if (tab === "Overview")
    return (
      <div className="space-y-6">
        <section className={`rounded-2xl border p-5 ${missing.length ? "border-clay/40 bg-clay-soft/40" : "border-forest/30 bg-mist"}`}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Design gate · market window</p>
          {missing.length ? (
            <>
              <p className="mt-1 font-semibold text-clay">Blocking: this project cannot move to Execute yet.</p>
              <ul className="mt-1 list-disc pl-5 text-sm text-clay">
                {missing.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
              <Link href={`/design?project=${state.projectId}`} className="mt-3 inline-block text-sm font-semibold text-forest hover:underline">
                Go to Project design →
              </Link>
            </>
          ) : (
            <p className="mt-1 font-semibold text-leaf">{stage === "Design" ? "Met. Ready for Design sign-off." : "Met. Design signed off."}</p>
          )}
          <div className="mt-3">
            <TargetLine state={state} onOpen={openTarget} />
          </div>
        </section>
        <section className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="font-semibold">Traceable</p>
            <p className="mt-1 text-sm">{trace === null ? "No report numbers yet" : `${trace}% of report numbers link to evidence`}</p>
            <p className="mt-1 text-xs text-muted">The target window counts as a report number; its evidence is its validation record and cited sources.</p>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-4">
            <p className="font-semibold">Stage</p>
            <p className="mt-1 text-sm">{stage}</p>
            <p className="mt-1 text-xs text-muted">Results, indicators and budget are drafted after the target is set.</p>
          </div>
        </section>
      </div>
    );

  if (tab === "Plan")
    return (
      <div className="space-y-8">
        <MarketTargetCard state={state} onOpen={openTarget} />
        <section>
          <SectionLabel>Rest of the plan</SectionLabel>
          <p className="mt-2 rounded-2xl border border-dashed border-line bg-surface p-5 text-sm text-muted">
            Results framework, activities, indicators and budget are not drafted yet. They are planned from the market target above.
          </p>
        </section>
      </div>
    );

  if (tab === "Report")
    return (
      <article className="rounded-2xl border border-line bg-surface px-6 py-8 sm:px-10">
        <header className="border-b-2 border-ink pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Roots of Peace · Progress report</p>
          <h2 className="mt-1 font-display text-3xl tracking-tight">Afghan Table Grapes</h2>
          <p className="text-sm text-muted">Draft, not released · stage {stage}</p>
        </header>
        <section className="mt-6">
          <h3 className="font-display text-xl">Market target</h3>
          <div className="mt-2">
            <TargetLine state={state} onOpen={openTarget} />
          </div>
          {state.marketTarget && <p className="mt-1 text-sm text-muted">{state.marketTarget.reason}</p>}
        </section>
        <section className="mt-6">
          <h3 className="font-display text-xl">Results</h3>
          <p className="mt-2 text-sm text-muted">No results yet.</p>
        </section>
      </article>
    );

  if (tab === "Audit")
    return (
      <section>
        <SectionLabel>Audit trail · append-only · {state.audit.length} events</SectionLabel>
        <ol className="mt-3 space-y-2 rounded-2xl border border-line bg-surface p-4">
          {[...state.audit].reverse().map((e, k) => (
            <li key={k} className="grid grid-cols-[6rem_1fr] gap-3 text-sm">
              <span className="font-mono text-xs text-muted">{e.date}</span>
              <span>
                {e.what}
                <span className="block text-xs text-muted">{personName(e.who)}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>
    );

  return <Empty what={tab} stage={stage} />;
}
