"use client";

import { useState } from "react";
import { workflowSteps, type StepKind, type WorkflowStep } from "@/lib/workflow";

const kindStyles: Record<StepKind, { chip: string; dot: string; tag?: string }> = {
  step: { chip: "bg-mist text-forest", dot: "bg-forest" },
  gate: { chip: "bg-ochre-soft text-ochre", dot: "bg-ochre", tag: "Gate" },
  yes: { chip: "bg-mist text-leaf", dot: "bg-leaf", tag: "If Yes" },
  no: { chip: "bg-clay-soft text-clay", dot: "bg-clay", tag: "If No" },
};

// Center of the first/last column in a 7-column grid with 1.5rem gaps.
const COL_CENTER = "calc((100% - 9rem) / 14)";

const byId = Object.fromEntries(workflowSteps.map((s) => [s.id, s]));
const columns: WorkflowStep[][] = [["1"], ["2"], ["3"], ["4"], ["5a", "5b"], ["6"], ["7"]].map((col) =>
  col.map((id) => byId[id]),
);

function Node({
  step,
  active,
  compact,
  onSelect,
}: {
  step: WorkflowStep;
  active: boolean;
  compact?: boolean;
  onSelect: () => void;
}) {
  const k = kindStyles[step.kind];
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`group relative z-10 flex w-full flex-1 flex-col rounded-2xl border p-4 text-left transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
        active
          ? "border-forest bg-forest text-forest-ink shadow-[0_18px_40px_-18px_rgb(31_77_54/0.65)]"
          : "border-line bg-surface hover:-translate-y-0.5 hover:border-forest/40 hover:shadow-[0_14px_30px_-20px_rgb(19_32_26/0.45)]"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={`font-mono text-[11px] tracking-wider ${active ? "text-forest-ink/70" : "text-muted"}`}>
          {step.label}
        </span>
        {k.tag && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
              active ? "bg-forest-ink/15 text-forest-ink" : k.chip
            }`}
          >
            {k.tag}
          </span>
        )}
      </span>
      <span className={`mt-auto block font-display text-[1.05rem] leading-snug ${compact ? "pt-1" : "pt-4"}`}>
        {step.title}
      </span>
      {!compact && (
        <span className={`mt-1 block text-xs leading-relaxed ${active ? "text-forest-ink/75" : "text-muted"}`}>
          {step.short}
        </span>
      )}
      {step.kind === "gate" && (
        <span
          aria-hidden
          className={`absolute -right-[7px] top-1/2 h-3 w-3 -translate-y-1/2 rotate-45 border ${
            active ? "border-forest bg-forest" : "border-line bg-surface"
          }`}
        />
      )}
    </button>
  );
}

function Detail({ step }: { step: WorkflowStep }) {
  const k = kindStyles[step.kind];
  return (
    <div key={step.id} className="fade-swap grid gap-8 lg:grid-cols-[1.1fr_2fr]">
      <div>
        <div className="flex items-center gap-3">
          <span className={`h-2 w-2 rounded-full ${k.dot}`} />
          <span className="font-mono text-xs tracking-wider text-muted">STEP {step.label}</span>
        </div>
        <h3 className="mt-3 font-display text-3xl leading-tight tracking-tight sm:text-4xl">{step.title}</h3>
        <div className="mt-5 flex flex-wrap gap-1.5">
          {step.links.map((l) => (
            <span key={l} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[11px] text-muted">
              {l}
            </span>
          ))}
        </div>
        {step.kind === "gate" && (
          <div className="mt-6 grid grid-cols-2 gap-2 text-sm">
            <div className="rounded-xl bg-mist px-3 py-2.5 text-leaf">
              <span className="font-semibold">Yes</span> → distribute inputs
            </div>
            <div className="rounded-xl bg-clay-soft px-3 py-2.5 text-clay">
              <span className="font-semibold">No</span> → correct &amp; recheck
            </div>
          </div>
        )}
      </div>
      <dl className="grid gap-6 sm:grid-cols-3">
        {[
          ["What happens", step.what],
          ["Owner / decision", step.owner],
          ["Record or result", step.record],
        ].map(([term, desc]) => (
          <div key={term} className="border-t border-line pt-4">
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{term}</dt>
            <dd className="mt-2 text-[0.95rem] leading-relaxed">{desc}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function WorkflowExplorer() {
  const [activeId, setActiveId] = useState("4");
  const active = byId[activeId];

  return (
    <div>
      {/* Desktop: branching rail */}
      <div className="relative hidden pb-24 lg:block">
        <div aria-hidden className="absolute top-22 h-px bg-line" style={{ left: COL_CENTER, right: COL_CENTER }} />
        <div className="relative grid grid-cols-7 gap-6">
          {columns.map((col, i) =>
            col.length === 1 ? (
              <div key={i} className="flex h-44">
                <Node step={col[0]} active={activeId === col[0].id} onSelect={() => setActiveId(col[0].id)} />
              </div>
            ) : (
              <div key={i} className="relative flex h-44 flex-col gap-3">
                {/* fork in, merge out */}
                <span aria-hidden className="absolute -left-3 top-[23%] bottom-[23%] w-px bg-line" />
                <span aria-hidden className="absolute -left-3 top-[23%] h-px w-3 bg-line" />
                <span aria-hidden className="absolute -left-3 bottom-[23%] h-px w-3 bg-line" />
                <span aria-hidden className="absolute -right-3 top-[23%] h-px w-3 bg-line" />
                <span aria-hidden className="absolute -right-3 top-[23%] h-[27%] w-px bg-line" />
                <span aria-hidden className="absolute inset-x-0 top-1/2 z-[5] h-4 -translate-y-1/2 bg-paper" />
                {col.map((s) => (
                  <Node key={s.id} step={s} compact active={activeId === s.id} onSelect={() => setActiveId(s.id)} />
                ))}
              </div>
            ),
          )}
        </div>
        {/* season loop: 7 back to 1 */}
        <div
          aria-hidden
          className="absolute top-44 h-[4.5rem] rounded-b-2xl border-x border-b border-dashed border-forest/40"
          style={{ left: COL_CENTER, right: COL_CENTER }}
        >
          <span className="absolute -top-1 -left-[4.5px] h-2 w-2 rotate-45 border-l border-t border-forest/60" />
          <span className="absolute -bottom-3 left-1/2 -translate-x-1/2 whitespace-nowrap bg-paper px-3 text-xs text-muted">
            Management actions and MEL learning feed the next seasonal plan
          </span>
        </div>
      </div>

      {/* Mobile / tablet: vertical rail */}
      <ol className="relative space-y-2 lg:hidden">
        <span aria-hidden className="absolute bottom-4 left-[19px] top-4 w-px bg-line" />
        {workflowSteps.map((s) => {
          const k = kindStyles[s.kind];
          const on = s.id === activeId;
          return (
            <li key={s.id} className={s.kind === "yes" || s.kind === "no" ? "pl-6" : ""}>
              <button
                type="button"
                onClick={() => setActiveId(s.id)}
                aria-pressed={on}
                className={`relative flex w-full items-center gap-4 rounded-xl border px-3 py-3 text-left transition ${
                  on ? "border-forest bg-forest text-forest-ink" : "border-line bg-surface"
                }`}
              >
                <span className={`relative z-10 h-3 w-3 shrink-0 rounded-full ring-4 ${on ? "bg-ochre ring-forest" : `${k.dot} ring-surface`}`} />
                <span className="font-mono text-[11px] opacity-70">{s.label}</span>
                <span className="font-display">{s.title}</span>
                {k.tag && <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider opacity-80">{k.tag}</span>}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-8 rounded-3xl border border-line bg-surface p-6 shadow-[0_30px_60px_-40px_rgb(19_32_26/0.35)] sm:p-10 lg:mt-4">
        <Detail step={active} />
      </div>
    </div>
  );
}
