"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Pill } from "@/components/workspace/ui";
import {
  HARVEST,
  MONTHS,
  SAMPLE_LABEL,
  VALIDATION_ITEMS,
  monthsLabel,
  overlap,
  targetLabel,
  windowById,
  windowsFor,
  type Crop,
  type MarketWindow,
  type Source,
} from "@/lib/market-windows";
import { isValidated, personName, type ProjectState } from "@/lib/project";

/** Shared pieces for market windows: used by Project design (working view) and the project page (presented view). */

export const statusPill: Record<MarketWindow["status"], { tone: "forest" | "clay" | "plum" | "muted"; label: string }> = {
  open: { tone: "forest", label: "Open" },
  closed: { tone: "clay", label: "Closed" },
  policy: { tone: "plum", label: "Policy window" },
  unknown: { tone: "muted", label: "To verify" },
};

export function SampleTag({ validated = false }: { validated?: boolean }) {
  return validated ? (
    <span className="rounded bg-mist px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-leaf">Validated</span>
  ) : (
    <span className="rounded bg-ochre-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ochre">{SAMPLE_LABEL}</span>
  );
}

export function Sources({ sources, prefix = "Sources" }: { sources: Source[]; prefix?: string }) {
  return (
    <p className="text-[11px] text-muted">
      {prefix}:{" "}
      {sources.length === 0
        ? "none yet"
        : sources.map((s, k) => (
            <span key={s.url}>
              {k > 0 && " · "}
              <a href={s.url} target="_blank" rel="noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-forest">
                {s.label}
              </a>
            </span>
          ))}
    </p>
  );
}

/** "Target: Grapes, India, Jun–Nov", clickable to the window, its validation and sources. */
export function TargetLine({ state, onOpen }: { state: ProjectState; onOpen: () => void }) {
  const win = state.marketTarget && windowById(state.marketTarget.windowId);
  if (!win) return <p className="text-sm text-clay">Target: no market window chosen yet.</p>;
  return (
    <p className="text-sm">
      <span className="font-semibold">Target:</span>{" "}
      <button type="button" onClick={onOpen} className="font-semibold text-forest underline decoration-dotted underline-offset-4" title="Show the market window, its validation and sources">
        {targetLabel(win)}
      </button>
      {!isValidated(state, win.id) && <span className="ml-2 text-xs text-clay">not yet validated</span>}
    </p>
  );
}

/** Side panel with the chosen window, its validation evidence and sources. Same pattern as the evidence drawer. */
export function TargetPanel({ state, onClose }: { state: ProjectState; onClose: () => void }) {
  const target = state.marketTarget!;
  const win = windowById(target.windowId)!;
  const checks = state.design?.checks[win.id] ?? {};
  const validated = isValidated(state, win.id);
  const ov = overlap(win);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose} role="dialog" aria-modal="true" aria-label="Target market window">
      <aside className="h-full w-full max-w-xl overflow-auto bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-muted">
              {win.id} · {win.origin} → {win.market}
            </p>
            <h3 className="mt-1 font-display text-2xl tracking-tight">{targetLabel(win)}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-muted hover:bg-sunken">
            Close
          </button>
        </div>
        <div className="mt-3">
          <SampleTag validated={validated} />
        </div>
        <dl className="mt-5 space-y-4 text-sm">
          {[
            ["Window open", monthsLabel(win.months)],
            ["Afghan harvest", monthsLabel(HARVEST[win.crop].months)],
            ["Overlap", ov.length ? monthsLabel(ov) : "None: fruit would need storage to reach this window"],
            ["Why the producers can hit it", target.reason],
            ["Chosen", `${personName(target.by)} on ${target.date}`],
          ].map(([k, v]) => (
            <div key={k}>
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
              <dd className="mt-0.5 leading-relaxed">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="mt-5 rounded-xl border border-line bg-paper p-4">
          <p className="text-sm font-semibold">Validation</p>
          <ul className="mt-2 space-y-2 text-sm">
            {VALIDATION_ITEMS.map((i) => {
              const c = checks[i.id];
              return (
                <li key={i.id} className="flex gap-2">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${c ? "bg-leaf" : "bg-line"}`}>{c ? "✓" : ""}</span>
                  <span>
                    {i.label}
                    {c && (
                      <span className="block text-xs text-muted">
                        {personName(c.by)}, {c.date}: {c.evidence}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="mt-4 rounded-xl border border-line bg-paper p-4">
          <p className="text-sm font-semibold">Sources</p>
          <ul className="mt-2 space-y-1.5 text-sm">
            {win.sources.map((s) => (
              <li key={s.url}>
                <a href={s.url} target="_blank" rel="noreferrer" className="text-forest underline underline-offset-2">
                  {s.label} ↗
                </a>
              </li>
            ))}
            {win.sources.length === 0 && <li className="text-muted">No source yet. This window is an assumption to verify.</li>}
          </ul>
          <p className="mt-3 text-xs text-muted">Seed data from the Market Windows feature brief, entered by hand.</p>
        </div>
        <Link href={`/design?project=${state.projectId}`} className="mt-5 inline-block text-sm font-semibold text-forest hover:underline">
          Open in Project design →
        </Link>
      </aside>
    </div>
  );
}

/** Compact card for the project's Plan tab. The working detail lives in Project design. */
export function MarketTargetCard({ state, onOpen }: { state: ProjectState; onOpen: () => void }) {
  const t = state.marketTarget;
  const win = t && windowById(t.windowId);
  const checks = win ? (state.design?.checks[win.id] ?? {}) : {};
  const done = VALIDATION_ITEMS.filter((i) => checks[i.id]);
  const validators = [...new Set(done.map((i) => personName(checks[i.id].by)))];
  return (
    <section className={`rounded-2xl border p-5 ${win ? "border-line bg-surface" : "border-clay/40 bg-clay-soft/40"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Market target</p>
          <div className="mt-1">
            <TargetLine state={state} onOpen={onOpen} />
          </div>
          {t && <p className="mt-1 text-sm text-muted">{t.reason}</p>}
          {win && (
            <p className="mt-2 text-xs text-muted">
              {done.length === VALIDATION_ITEMS.length ? `Validated by ${validators.join(", ")}` : `${done.length} of ${VALIDATION_ITEMS.length} validation items done`}
              {" · "}harvest overlap {overlap(win).length ? monthsLabel(overlap(win)) : "none"}
            </p>
          )}
        </div>
        <Link href={`/design?project=${state.projectId}`} className="shrink-0 text-sm font-semibold text-forest hover:underline">
          {win ? "Open in Project design →" : "Choose it in Project design →"}
        </Link>
      </div>
    </section>
  );
}

export function Calendar({ crop, highlight, onPick }: { crop: Crop; highlight?: string[]; onPick?: (id: string) => void }) {
  const harvest = HARVEST[crop].months;
  const cols = "grid grid-cols-[9.5rem_repeat(12,minmax(0,1fr))]";
  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <div className="min-w-[720px] p-4">
        <div className={`${cols} gap-px text-center text-[11px] text-muted`}>
          <span />
          {MONTHS.map((m, i) => (
            <span key={m} className={`py-1 ${harvest.includes(i + 1) ? "font-semibold text-ochre" : ""}`}>
              {m}
            </span>
          ))}
        </div>
        <div className={`${cols} mt-1 items-center gap-px`}>
          <span className="pr-2 text-xs font-semibold">Afghan harvest</span>
          {MONTHS.map((m, i) => (
            <span key={m} className={`h-6 ${harvest.includes(i + 1) ? "bg-ochre" : "bg-sunken"} ${i === 0 ? "rounded-l" : ""} ${i === 11 ? "rounded-r" : ""}`} />
          ))}
        </div>
        <div className="mt-2 space-y-1">
          {windowsFor(crop).map((win) => {
            const pill = statusPill[win.status];
            const ov = overlap(win);
            const on = highlight?.includes(win.id);
            return (
              <button
                key={win.id}
                type="button"
                disabled={!onPick || win.status !== "open"}
                onClick={() => onPick?.(win.id)}
                className={`${cols} w-full items-center gap-px rounded-lg py-1 text-left transition enabled:hover:bg-paper ${on ? "bg-mist ring-2 ring-forest" : ""}`}
                aria-pressed={on}
                title={win.status === "open" ? "Short-list this window" : pill.label}
              >
                <span className="flex flex-col pr-2">
                  <span className="text-sm font-medium">{win.market}</span>
                  <span>
                    <Pill tone={pill.tone}>{pill.label}</Pill>
                  </span>
                </span>
                {MONTHS.map((m, i) => {
                  const month = i + 1;
                  const open = win.months.includes(month);
                  const inHarvest = harvest.includes(month);
                  const cell =
                    win.status === "policy"
                      ? "bg-[repeating-linear-gradient(135deg,var(--plum-soft)_0_4px,transparent_4px_8px)]"
                      : open && inHarvest
                        ? "bg-forest"
                        : open
                          ? "bg-forest/35"
                          : inHarvest
                            ? "bg-ochre-soft"
                            : "bg-sunken/60";
                  return (
                    <span
                      key={m}
                      className={`h-8 ${cell} ${inHarvest ? "shadow-[inset_0_-3px_0_var(--ochre)]" : ""} ${i === 0 ? "rounded-l" : ""} ${i === 11 ? "rounded-r" : ""}`}
                      aria-label={`${m}: ${open ? "open" : "not open"}${inHarvest ? ", Afghan harvest" : ""}`}
                    />
                  );
                })}
                <span className="col-span-12 col-start-2 pt-0.5 text-[11px] text-muted">
                  {win.status === "open"
                    ? ov.length
                      ? `Open ${monthsLabel(win.months)} · overlaps the harvest in ${monthsLabel(ov)}`
                      : `Open ${monthsLabel(win.months)} · no overlap with the harvest; needs storage`
                    : win.status === "closed"
                      ? "Closed: border closures"
                      : win.status === "policy"
                        ? "Opens when a big exporter restricts supply; no fixed months"
                        : "Not assessed yet"}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 border-t border-line pt-3 text-[11px] text-muted">
          {[
            ["bg-forest", "Open and in harvest"],
            ["bg-forest/35", "Open, outside harvest"],
            ["bg-ochre", "Afghan harvest"],
            ["bg-[repeating-linear-gradient(135deg,var(--plum-soft)_0_4px,transparent_4px_8px)] border border-plum/30", "Policy window"],
          ].map(([c, l]) => (
            <span key={l} className="flex items-center gap-1.5">
              <span className={`inline-block h-3 w-5 rounded-sm ${c}`} />
              {l}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
