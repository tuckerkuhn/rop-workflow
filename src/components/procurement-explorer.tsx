"use client";

import { useState } from "react";
import { procurementStages, type ProcurementStage } from "@/lib/procurement";
import { Tagged } from "@/components/status-tag";

const byId = Object.fromEntries(procurementStages.map((s) => [s.id, s]));

function Node({ stage, active, onSelect }: { stage: ProcurementStage; active: boolean; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`group relative z-10 flex h-full w-full flex-col rounded-2xl border p-4 text-left transition-all duration-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${
        active
          ? "border-forest bg-forest text-forest-ink shadow-[0_18px_40px_-18px_rgb(31_77_54/0.65)]"
          : `${stage.upstream ? "border-dashed" : ""} border-line bg-surface hover:-translate-y-0.5 hover:border-forest/40 hover:shadow-[0_14px_30px_-20px_rgb(19_32_26/0.45)]`
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className={`font-mono text-[11px] tracking-wider ${active ? "text-forest-ink/70" : "text-muted"}`}>{stage.label}</span>
        {stage.upstream && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${active ? "bg-forest-ink/15" : "bg-sunken text-muted"}`}>
            Upstream
          </span>
        )}
      </span>
      <span className="mt-auto block pt-4 font-display text-[1rem] leading-snug">{stage.title}</span>
      <span className={`mt-1 block text-xs leading-relaxed ${active ? "text-forest-ink/75" : "text-muted"}`}>{stage.short}</span>
      {stage.gate && (
        <span
          className={`absolute -right-3 top-1/2 z-20 -translate-y-1/2 rounded-md border px-1.5 py-0.5 font-mono text-[10px] font-semibold ${
            active ? "border-ochre bg-ochre text-[#1b140a]" : "border-ochre/50 bg-ochre-soft text-ochre"
          }`}
        >
          {stage.gate}
        </span>
      )}
    </button>
  );
}

function Detail({ stage }: { stage: ProcurementStage }) {
  return (
    <div key={stage.id} className="fade-swap grid gap-8 lg:grid-cols-[1fr_2fr]">
      <div>
        <span className="font-mono text-xs tracking-wider text-muted">
          {stage.upstream ? "UPSTREAM · ONCE PER AWARD" : `STAGE ${stage.label}`}
        </span>
        <h3 className="mt-3 font-display text-3xl leading-tight tracking-tight sm:text-4xl">{stage.title}</h3>
        <p className="mt-4 text-[0.95rem] leading-relaxed text-muted">
          <span className="font-semibold text-ink">Trigger. </span>
          <Tagged text={stage.trigger} />
        </p>
        {stage.gate && (
          <p className="mt-4 rounded-xl bg-ochre-soft px-3 py-2.5 text-sm text-ochre">
            <span className="font-semibold">Gate {stage.gate}</span> closes this stage. Nothing moves on until its conditions are recorded.
          </p>
        )}
        <div className="mt-5 flex flex-wrap gap-1.5">
          {stage.records.map((r) => (
            <span key={r} className="rounded-md border border-line bg-paper px-2 py-1 font-mono text-[11px] text-muted">
              {r}
            </span>
          ))}
        </div>
      </div>
      <dl className="grid gap-x-8 gap-y-6 sm:grid-cols-2">
        {stage.fields.map((f) => (
          <div key={f.term} className={`border-t border-line pt-4 ${f.term === "People and actions" ? "sm:col-span-2" : ""}`}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{f.term}</dt>
            <dd className="mt-2">
              <ul className="space-y-2 text-[0.93rem] leading-relaxed">
                {f.items.map((it) => (
                  <li key={it}>
                    <Tagged text={it} />
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function ProcurementExplorer() {
  const [activeId, setActiveId] = useState("2");
  const active = byId[activeId];

  return (
    <div>
      {/* Desktop: stage rail */}
      <div className="relative hidden lg:block">
        <div aria-hidden className="absolute left-[5%] right-[5%] top-1/2 h-px bg-line" />
        <ol className="relative grid grid-cols-9 gap-4">
          {procurementStages.map((s) => (
            <li key={s.id} className="h-44">
              <Node stage={s} active={activeId === s.id} onSelect={() => setActiveId(s.id)} />
            </li>
          ))}
        </ol>
      </div>

      {/* Mobile / tablet: vertical rail */}
      <ol className="relative space-y-2 lg:hidden">
        <span aria-hidden className="absolute bottom-4 left-[19px] top-4 w-px bg-line" />
        {procurementStages.map((s) => {
          const on = s.id === activeId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setActiveId(s.id)}
                aria-pressed={on}
                className={`relative flex w-full items-center gap-4 rounded-xl border px-3 py-3 text-left transition ${
                  on ? "border-forest bg-forest text-forest-ink" : "border-line bg-surface"
                }`}
              >
                <span className={`relative z-10 h-3 w-3 shrink-0 rounded-full ring-4 ${on ? "bg-ochre ring-forest" : "bg-forest ring-surface"}`} />
                <span className="font-mono text-[11px] opacity-70">{s.label}</span>
                <span className="font-display">{s.title}</span>
                {s.gate && <span className="ml-auto font-mono text-[10px] font-semibold opacity-80">Gate {s.gate}</span>}
              </button>
            </li>
          );
        })}
      </ol>

      <div className="mt-8 rounded-3xl border border-line bg-surface p-6 shadow-[0_30px_60px_-40px_rgb(19_32_26/0.35)] sm:p-10">
        <Detail stage={active} />
      </div>
    </div>
  );
}
