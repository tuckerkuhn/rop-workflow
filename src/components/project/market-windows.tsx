"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Pill } from "@/components/workspace/ui";
import {
  HARVEST,
  MONTHS,
  SAMPLE_LABEL,
  VALIDATION_ITEMS,
  monthsLabel,
  overlap,
  supplyMonths,
  targetLabel,
  windowById,
  windowsFor,
  type Area,
  type CalendarEdit,
  type Competitor,
  type Crop,
  type MarketWindow,
  type Source,
} from "@/lib/market-windows";
import { checkDone, isValidated, personName, type MarketTarget, type ProjectState } from "@/lib/project";

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

/** "Grapes, Kabul (Shomali plain) → India, Jun–Nov". */
export function targetText(t: MarketTarget) {
  const win = windowById(t.windowId);
  if (!win) return "";
  return t.area ? `${win.crop}, ${t.area.name} → ${win.market}, ${monthsLabel(win.months)}` : targetLabel(win);
}

/** "Target: …", clickable to the window, its validation and sources. */
export function TargetLine({ state, onOpen }: { state: ProjectState; onOpen: () => void }) {
  const t = state.marketTarget;
  const win = t && windowById(t.windowId);
  if (!t || !win) return <p className="text-sm text-clay">Target: no market window chosen yet.</p>;
  return (
    <p className="text-sm">
      <span className="font-semibold">Target:</span>{" "}
      <button type="button" onClick={onOpen} className="font-semibold text-forest underline decoration-dotted underline-offset-4" title="Show the market window, its validation and sources">
        {targetText(t)}
      </button>
      {!isValidated(state, win.id) && <span className="ml-2 text-xs text-clay">not yet validated</span>}
    </p>
  );
}

/** Side panel with the chosen window, its validation evidence and sources. Same pattern as the evidence drawer. */
export function TargetPanel({ state, onClose }: { state: ProjectState; onClose: () => void }) {
  const target = state.marketTarget!;
  const win = windowById(target.windowId)!;
  const harvest = target.area?.months ?? HARVEST[win.crop].months;
  const validated = isValidated(state, win.id);
  const ov = overlap(win, harvest);
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
              {win.id} · {target.area?.name ?? win.origin} → {win.market}
            </p>
            <h3 className="mt-1 font-display text-2xl tracking-tight">{targetText(target)}</h3>
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
            [`Harvest, ${target.area?.name ?? "all Afghanistan"}`, monthsLabel(harvest)],
            ["Overlap", ov.length ? monthsLabel(ov) : "None: produce would need storage to reach this window"],
            [
              "Competing supply in those months",
              target.competition?.length ? target.competition.map((c) => `${c.origin} (${monthsLabel(c.months)})`).join(", ") : "None recorded",
            ],
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
              const c = checkDone(state, win.id, i.id);
              return (
                <li key={i.id} className="flex gap-2">
                  <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full text-[10px] font-bold text-white ${c ? "bg-leaf" : "bg-line"}`}>{c ? "✓" : ""}</span>
                  <span>
                    {i.label(target.area?.name ?? "the production area")}
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
          <p className="mt-3 text-xs text-muted">Window data from the Market Windows feature brief. Area and competitor months are ROP&rsquo;s calendar, kept in Project design.</p>
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
  const done = win ? VALIDATION_ITEMS.filter((i) => checkDone(state, win.id, i.id)) : [];
  const validators = win ? [...new Set(done.map((i) => personName(checkDone(state, win.id, i.id)!.by)))] : [];
  const ov = win ? overlap(win, t?.area?.months) : [];
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
              {" · "}harvest overlap {ov.length ? monthsLabel(ov) : "none"}
              {" · "}
              {t?.competition?.length ? `competition from ${t.competition.map((c) => c.origin).join(", ")}` : "no competing supply recorded"}
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

/* ---------- calendar ---------- */

const HATCH_COMP = "bg-[repeating-linear-gradient(135deg,var(--clay-soft)_0_4px,transparent_4px_8px)]";
const HATCH_POLICY = "bg-[repeating-linear-gradient(135deg,var(--plum-soft)_0_4px,transparent_4px_8px)]";
const cols = "grid grid-cols-[11rem_repeat(12,minmax(0,1fr))]";
const cell = (i: number) => `${i === 0 ? "rounded-l" : ""} ${i === 11 ? "rounded-r" : ""}`;

export type CalendarEditInput = { rowId: string; months: number[]; source: string; note?: string };

function RowEditor({
  months,
  note,
  noteLabel,
  onSave,
  onCancel,
}: {
  months: number[];
  /** Present for competitor rows: how this origin competes in the market. */
  note?: string;
  noteLabel?: string;
  onSave: (months: number[], source: string, note?: string) => void;
  onCancel: () => void;
}) {
  const [sel, setSel] = useState<number[]>(months);
  const [how, setHow] = useState(note ?? "");
  const [source, setSource] = useState("");
  const field = "min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus:border-forest focus:outline-none";
  return (
    <form
      className="col-span-full mt-2 space-y-2 rounded-lg border border-line bg-paper p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (source.trim() && sel.length) onSave([...sel].sort((a, b) => a - b), source.trim(), note !== undefined ? how.trim() : undefined);
      }}
    >
      <div className="flex flex-wrap gap-1">
        {MONTHS.map((m, i) => {
          const on = sel.includes(i + 1);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={on}
              onClick={() => setSel(on ? sel.filter((x) => x !== i + 1) : [...sel, i + 1])}
              className={`w-11 rounded-md border py-1 text-xs ${on ? "border-forest bg-forest text-forest-ink" : "border-line bg-surface"}`}
            >
              {m}
            </button>
          );
        })}
      </div>
      {note !== undefined && (
        <label className="block">
          <span className="text-xs font-medium text-muted">{noteLabel}</span>
          <textarea rows={2} value={how} onChange={(e) => setHow(e.target.value)} className={`mt-1 w-full ${field}`} />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          autoFocus
          value={source}
          onChange={(e) => setSource(e.target.value)}
          placeholder="Where does this come from? (trader interview, partner record, link)"
          className={field}
        />
        <button type="submit" disabled={!source.trim() || !sel.length} className="rounded-full bg-forest px-4 py-1.5 text-sm font-medium text-forest-ink disabled:opacity-35">
          Save
        </button>
        <button type="button" onClick={onCancel} className="px-2 text-sm text-muted">
          Cancel
        </button>
      </div>
    </form>
  );
}

function RowLabel({ title, sub, edit, onEdit, indent = false }: { title: string; sub?: React.ReactNode; edit?: CalendarEdit; onEdit?: () => void; indent?: boolean }) {
  return (
    <span className={`flex flex-col pr-2 ${indent ? "ml-2 border-l-2 border-clay/30 pl-2" : ""}`}>
      <span className={`leading-tight ${indent ? "text-xs" : "text-sm font-medium"}`}>{title}</span>
      {sub}
      {edit && <span className="text-[10px] leading-tight text-muted">edited by {personName(edit.by).split(" ")[0]} {edit.date}</span>}
      {onEdit && (
        <button type="button" onClick={onEdit} className="w-fit text-[11px] font-semibold text-forest hover:underline">
          Edit
        </button>
      )}
    </span>
  );
}

export function Calendar({
  crop,
  area,
  provinces,
  competitors,
  edits = [],
  highlight,
  onPick,
  onEdit,
}: {
  crop: Crop;
  /** The production area in use; "All Afghanistan" combines every province. */
  area: Area;
  provinces: Area[];
  /** Competing origins for this crop, each tied to one market. */
  competitors: Competitor[];
  edits?: CalendarEdit[];
  highlight?: string[];
  onPick?: (id: string) => void;
  /** Present for people who may correct the calendar. */
  onEdit?: (e: CalendarEditInput) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const harvest = area.months;
  const lastEdit = (id: string) => [...edits].reverse().find((e) => e.rowId === id);
  const edit = (id: string) => (onEdit ? () => setEditing(editing === id ? null : id) : undefined);
  const harvestRows = area.id === "all" ? [...provinces, area] : [area];

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <div className="min-w-[760px] p-4">
        <div className={`${cols} gap-px text-center text-[11px] text-muted`}>
          <span />
          {MONTHS.map((m, i) => (
            <span key={m} className={`py-1 ${harvest.includes(i + 1) ? "font-semibold text-ochre" : ""}`}>
              {m}
            </span>
          ))}
        </div>

        {/* Our production: each province when looking at all Afghanistan, otherwise the chosen area */}
        <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Afghan harvest</p>
        <div className="mt-1 space-y-1">
          {harvestRows.map((a) => {
            const combined = a.id === "all";
            return (
              <div key={a.id} className={`${cols} items-center gap-px`}>
                <RowLabel title={combined && area.id === "all" ? "All Afghanistan (combined)" : a.name} edit={!combined ? lastEdit(a.id) : undefined} onEdit={!combined ? edit(a.id) : undefined} />
                {MONTHS.map((m, i) => (
                  <span key={m} className={`${combined ? "h-6" : "h-4"} ${a.months.includes(i + 1) ? (combined ? "bg-ochre" : "bg-ochre/70") : "bg-sunken"} ${cell(i)}`} />
                ))}
                {editing === a.id && onEdit && (
                  <RowEditor
                    months={a.months}
                    onCancel={() => setEditing(null)}
                    onSave={(months, source) => {
                      onEdit({ rowId: a.id, months, source });
                      setEditing(null);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-1 pl-[11rem] text-[11px] text-muted">{area.note}</p>

        {/* Markets, each with the origins competing there */}
        <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-muted">Import markets and competing supply</p>
        <div className="mt-1 space-y-3">
          {windowsFor(crop).map((win) => {
            const pill = statusPill[win.status];
            const ov = overlap(win, harvest);
            const comp = competitors.filter((c) => c.market === win.market);
            const selling = supplyMonths(win, harvest);
            const contested = new Set(comp.flatMap((c) => c.months.filter((m) => selling.includes(m))));
            const on = highlight?.includes(win.id);
            return (
              <div key={win.id} className={`rounded-lg ${on ? "bg-mist/60 ring-2 ring-forest" : ""}`}>
                <button
                  type="button"
                  disabled={!onPick || win.status !== "open"}
                  onClick={() => onPick?.(win.id)}
                  className={`${cols} w-full items-center gap-px rounded-lg py-1 text-left transition enabled:hover:bg-paper`}
                  aria-pressed={on}
                  title={win.status === "open" ? "Short-list this window" : pill.label}
                >
                  <RowLabel
                    title={win.market}
                    sub={
                      <span>
                        <Pill tone={pill.tone}>{pill.label}</Pill>
                      </span>
                    }
                  />
                  {MONTHS.map((m, i) => {
                    const month = i + 1;
                    const open = win.months.includes(month);
                    const inHarvest = harvest.includes(month);
                    const bg = win.status === "policy" ? HATCH_POLICY : open && inHarvest ? "bg-forest" : open ? "bg-forest/35" : inHarvest ? "bg-ochre-soft" : "bg-sunken/60";
                    return (
                      <span
                        key={m}
                        className={`relative h-8 ${bg} ${inHarvest ? "shadow-[inset_0_-3px_0_var(--ochre)]" : ""} ${cell(i)}`}
                        aria-label={`${m}: ${open ? "open" : "not open"}${inHarvest ? ", our harvest" : ""}${contested.has(month) ? ", competing supply" : ""}`}
                      >
                        {contested.has(month) && <span className="absolute inset-x-1 top-1 h-1.5 rounded-full bg-clay" />}
                      </span>
                    );
                  })}
                  <span className="col-span-12 col-start-2 pt-0.5 text-[11px] text-muted">
                    {win.status === "open"
                      ? ov.length
                        ? `Open ${monthsLabel(win.months)} · overlaps our harvest in ${monthsLabel(ov)}${contested.size ? ` · competition in ${monthsLabel([...contested])}` : " · no competing supply in those months"}`
                        : `Open ${monthsLabel(win.months)} · no overlap with our harvest; needs storage${contested.size ? ` · competition in ${monthsLabel([...contested])}` : ""}`
                      : win.status === "closed"
                        ? "Closed: border closures"
                        : win.status === "policy"
                          ? "Opens when a big exporter restricts supply; no fixed months"
                          : "Not assessed yet"}
                  </span>
                </button>
                {comp.length > 0 && (
                  <div className="mb-1 space-y-1 pb-1">
                    {comp.map((c) => {
                      const hits = c.months.filter((m) => selling.includes(m));
                      return (
                        <div key={c.id} className={`${cols} items-start gap-px`}>
                          <RowLabel
                            indent
                            title={c.origin}
                            sub={
                              <span className={`text-[10px] leading-tight ${hits.length ? "font-semibold text-clay" : "text-muted"}`}>
                                {win.status !== "open" ? `supplies ${monthsLabel(c.months)}` : hits.length ? `competes ${monthsLabel(hits)}` : "no overlap with us"}
                              </span>
                            }
                            edit={lastEdit(c.id)}
                            onEdit={edit(c.id)}
                          />
                          {MONTHS.map((m, i) => (
                            <span key={m} className={`mt-0.5 h-4 ${c.months.includes(i + 1) ? `${HATCH_COMP} border border-clay/40` : "bg-sunken/40"} ${cell(i)}`} />
                          ))}
                          <span className="col-span-12 col-start-2 pl-2 text-[11px] leading-snug text-muted">
                            {c.note}
                            {c.sources.map((s) => (
                              <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="ml-1 underline decoration-dotted underline-offset-2 hover:text-forest">
                                {s.label}
                              </a>
                            ))}
                          </span>
                          {editing === c.id && onEdit && (
                            <RowEditor
                              months={c.months}
                              note={c.note}
                              noteLabel={`How ${c.origin} competes with Afghan ${crop.toLowerCase()} in ${win.market}`}
                              onCancel={() => setEditing(null)}
                              onSave={(months, source, note) => {
                                onEdit({ rowId: c.id, months, source, note });
                                setEditing(null);
                              }}
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-3 flex flex-wrap gap-4 border-t border-line pt-3 text-[11px] text-muted">
          {[
            ["bg-forest", "Open and in our harvest"],
            ["bg-forest/35", "Open, outside our harvest"],
            ["bg-ochre", "Our harvest"],
            [`${HATCH_COMP} border border-clay/40`, "Competing origin supplying that market"],
            ["bg-clay", "Competition during our window"],
            [`${HATCH_POLICY} border border-plum/30`, "Policy window"],
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
