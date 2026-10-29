"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRequireUser } from "@/components/app/session";
import { Calendar, SampleTag, Sources, TargetPanel } from "@/components/project/market-windows";
import { Pill, SectionLabel, TODAY, TopBar, primaryBtn, quietBtn, usePersistentState } from "@/components/workspace/ui";
import { canValidate, daysFrom, projects, type AppUser } from "@/lib/demo";
import {
  CROPS,
  DATA_AS_OF,
  HARVEST,
  VALIDATION_ITEMS,
  WINDOWS,
  fitLabel,
  fitRank,
  monthsLabel,
  overlap,
  targetLabel,
  windowById,
  windowsFor,
  type Crop,
  type MarketWindow,
} from "@/lib/market-windows";
import { GATED_KEYS, isValidated, personName, type DesignState, type ProjectState } from "@/lib/project";

/**
 * Project design: the process of finding the trade window with the best validated opportunity,
 * then committing a project to it. The project page shows only the outcome.
 */

const emptyDesign: DesignState = { shortlist: [], checks: {}, dropped: [] };
const STEPS = [
  { id: "explore", label: "Explore" },
  { id: "validate", label: "Validate" },
  { id: "choose", label: "Choose" },
] as const;

type Props = { u: AppUser; state: ProjectState; setState: (fn: (s: ProjectState) => ProjectState) => void; locked: boolean };

const withDesign = (s: ProjectState, fn: (d: DesignState) => DesignState): ProjectState => ({ ...s, design: fn(s.design ?? emptyDesign) });

/* ---------- 1. Explore ---------- */

function Explore({ u, state, setState, locked, crop, setCrop }: Props & { crop: Crop; setCrop: (c: Crop) => void }) {
  const design = state.design ?? emptyDesign;
  const editable = canValidate(u) && !locked;
  const ranked = [...WINDOWS].filter((w) => fitRank(w) <= 1).sort((a, b) => fitRank(a) - fitRank(b) || overlap(b).length - overlap(a).length);
  const age = Math.round(daysFrom(DATA_AS_OF, TODAY) / 30);
  const rows = windowsFor(crop);
  const toggle = (id: string) =>
    setState((s) => {
      const on = s.design?.shortlist.includes(id);
      const w = windowById(id)!;
      return {
        ...withDesign(s, (d) => ({ ...d, shortlist: on ? d.shortlist.filter((x) => x !== id) : [...d.shortlist, id] })),
        audit: [...s.audit, { date: TODAY, who: u.id, what: `${on ? "Removed" : "Short-listed"} ${targetLabel(w)} in Project design`, kind: "change" }],
      };
    });

  return (
    <section id="explore" className="scroll-mt-28 space-y-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <SectionLabel>1 · Explore the windows</SectionLabel>
          <p className="mt-1 max-w-2xl text-sm text-muted">Where do import markets have unmet demand, and when? Short-list the windows worth validating.</p>
        </div>
        <SampleTag />
      </div>

      <div className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-3">
        {[
          { k: "Windows tracked", v: String(WINDOWS.length), s: `${CROPS.length} crops × 5 markets · Afghanistan` },
          { k: "Best fits", v: String(ranked.filter((w) => fitRank(w) === 0).length), s: "Open and overlapping the Afghan harvest" },
          { k: "Data freshness", v: `${age} months`, s: `Latest source ${DATA_AS_OF} · entered by hand` },
        ].map((c) => (
          <div key={c.k} className="bg-surface px-5 py-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{c.k}</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{c.v}</p>
            <p className="mt-1 truncate text-xs text-muted">{c.s}</p>
          </div>
        ))}
      </div>

      <div>
        <p className="text-sm font-semibold">Open windows, best fit first</p>
        <ul className="mt-2 grid gap-2 md:grid-cols-2">
          {ranked.map((w) => {
            const on = design.shortlist.includes(w.id);
            return (
              <li key={w.id} className={`flex items-center gap-3 rounded-xl border p-3 text-sm ${on ? "border-forest bg-mist" : "border-line bg-surface"}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{targetLabel(w)}</p>
                  <p className="text-xs text-muted">
                    {fitLabel[fitRank(w)]}
                    {overlap(w).length ? ` (${monthsLabel(overlap(w))})` : ""} · {w.sources.length} sources
                  </p>
                </div>
                {editable ? (
                  <button type="button" onClick={() => toggle(w.id)} className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${on ? "border border-line" : "bg-forest text-forest-ink"}`}>
                    {on ? "Short-listed ✓" : "Short-list"}
                  </button>
                ) : (
                  on && <Pill tone="forest">Short-listed</Pill>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div role="radiogroup" aria-label="Crop" className="flex rounded-full bg-sunken p-1 text-sm">
          {CROPS.map((c) => (
            <button key={c} type="button" role="radio" aria-checked={crop === c} onClick={() => setCrop(c)} className={`rounded-full px-4 py-1.5 ${crop === c ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}>
              {c}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">
          Afghan harvest {monthsLabel(HARVEST[crop].months)} · {HARVEST[crop].note}
        </p>
      </div>
      <Calendar crop={crop} highlight={design.shortlist} onPick={editable ? toggle : undefined} />
      <Sources sources={[...new Map([...HARVEST[crop].sources, ...rows.flatMap((x) => x.sources)].map((s) => [s.url, s])).values()]} />
    </section>
  );
}

/* ---------- 2. Validate ---------- */

function CheckItem({ win, item, u, state, setState, editable }: { win: MarketWindow; item: (typeof VALIDATION_ITEMS)[number] } & Omit<Props, "locked"> & { editable: boolean }) {
  const done = state.design?.checks[win.id]?.[item.id];
  const [evidence, setEvidence] = useState("");
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${done ? "bg-leaf" : "bg-line"}`}>{done ? "✓" : ""}</span>
        <div className="min-w-0 flex-1">
          <p className="leading-snug">{item.label}</p>
          {done ? (
            <p className="mt-0.5 text-sm text-muted">
              {personName(done.by)}, {done.date}: {done.evidence}
            </p>
          ) : (
            <>
              <p className="mt-1 text-xs text-plum">AI suggestion: {item.hint(win)}</p>
              {editable && (
                <form
                  className="mt-2 flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!evidence.trim()) return;
                    setState((s) => ({
                      ...withDesign(s, (d) => ({ ...d, checks: { ...d.checks, [win.id]: { ...d.checks[win.id], [item.id]: { by: u.id, date: TODAY, evidence: evidence.trim() } } } })),
                      audit: [...s.audit, { date: TODAY, who: u.id, what: `Validated "${item.label.toLowerCase()}" for ${targetLabel(win)}`, kind: "approval" }],
                    }));
                  }}
                >
                  <input
                    id={`ev-${win.id}-${item.id}`}
                    value={evidence}
                    onChange={(e) => setEvidence(e.target.value)}
                    placeholder="Evidence: who you spoke to, a link, or a document reference"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus:border-forest focus:outline-none"
                  />
                  <button type="submit" disabled={!evidence.trim()} className="rounded-full bg-forest px-4 py-1.5 text-sm font-medium text-forest-ink disabled:opacity-35">
                    Confirm
                  </button>
                </form>
              )}
            </>
          )}
        </div>
      </div>
    </li>
  );
}

function Validate({ u, state, setState, locked }: Props) {
  const design = state.design ?? emptyDesign;
  const editable = canValidate(u) && !locked;
  const [dropping, setDropping] = useState<string | null>(null);
  const [why, setWhy] = useState("");
  return (
    <section id="validate" className="scroll-mt-28 space-y-4">
      <div>
        <SectionLabel>2 · Validate the short-list</SectionLabel>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          A window counts as validated when every item has a named person and evidence. {editable ? "You can confirm items." : "Nadia, Tucker or Daniel confirm items."} AI only suggests where to look.
        </p>
      </div>
      {design.shortlist.length === 0 && <p className="rounded-2xl border border-line bg-surface p-5 text-sm text-muted">Nothing short-listed yet. Pick windows in step 1.</p>}
      {design.shortlist.map((id) => {
        const win = windowById(id)!;
        const checks = design.checks[id] ?? {};
        const n = VALIDATION_ITEMS.filter((i) => checks[i.id]).length;
        const ok = isValidated(state, id);
        return (
          <article key={id} className={`rounded-2xl border-2 bg-surface ${ok ? "border-forest/50" : "border-line"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
              <div>
                <p className="font-display text-xl">{targetLabel(win)}</p>
                <p className="text-xs text-muted">
                  {fitLabel[fitRank(win)]} · {n} of {VALIDATION_ITEMS.length} items confirmed
                </p>
              </div>
              <div className="flex items-center gap-2">
                <SampleTag validated={ok} />
                {editable && state.marketTarget?.windowId !== id && dropping !== id && (
                  <button type="button" onClick={() => setDropping(id)} className="text-xs text-muted hover:text-clay">
                    Drop
                  </button>
                )}
              </div>
            </div>
            {dropping === id && (
              <form
                className="flex flex-wrap gap-2 border-b border-line px-5 py-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!why.trim()) return;
                  setState((s) => ({
                    ...withDesign(s, (d) => ({ ...d, shortlist: d.shortlist.filter((x) => x !== id), dropped: [...d.dropped, { windowId: id, reason: why.trim(), by: u.id, date: TODAY }] })),
                    audit: [...s.audit, { date: TODAY, who: u.id, what: `Dropped ${targetLabel(win)}: ${why.trim()}`, kind: "change" }],
                  }));
                  setDropping(null);
                  setWhy("");
                }}
              >
                <input
                  id={`drop-${id}`}
                  autoFocus
                  value={why}
                  onChange={(e) => setWhy(e.target.value)}
                  placeholder="Why drop this window?"
                  className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus:border-clay focus:outline-none"
                />
                <button type="submit" className="rounded-full bg-clay px-4 py-1.5 text-sm font-medium text-white">
                  Drop
                </button>
                <button type="button" onClick={() => setDropping(null)} className="px-2 text-sm text-muted">
                  Cancel
                </button>
              </form>
            )}
            <ul className="divide-y divide-line px-5">
              {VALIDATION_ITEMS.map((item) => (
                <CheckItem key={item.id} win={win} item={item} u={u} state={state} setState={setState} editable={editable} />
              ))}
            </ul>
            <div className="border-t border-line px-5 py-3">
              <Sources sources={win.sources} />
            </div>
          </article>
        );
      })}
      {design.dropped.length > 0 && (
        <div className="rounded-2xl border border-line bg-paper p-4 text-sm">
          <p className="font-semibold">Dropped</p>
          <ul className="mt-1 space-y-1 text-muted">
            {design.dropped.map((d) => (
              <li key={d.windowId + d.date}>
                {targetLabel(windowById(d.windowId)!)}: {d.reason} ({personName(d.by)}, {d.date})
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/* ---------- 3. Choose ---------- */

function Choose({ u, state, setState, locked, projectId, openTarget }: Props & { projectId: string; openTarget: () => void }) {
  const design = state.design ?? emptyDesign;
  const editable = canValidate(u) && !locked;
  const saved = state.marketTarget;
  const savedWin = saved && windowById(saved.windowId);
  const [editing, setEditing] = useState(!saved);
  const [pick, setPick] = useState<string | undefined>(saved?.windowId);
  const [reason, setReason] = useState(saved?.reason ?? "");
  const pickWin = pick ? windowById(pick) : undefined;
  const ready = !!pickWin && isValidated(state, pickWin.id) && !!reason.trim();

  return (
    <section id="choose" className="scroll-mt-28 space-y-4">
      <div>
        <SectionLabel>3 · Choose the project&rsquo;s target</SectionLabel>
        <p className="mt-1 max-w-2xl text-sm text-muted">Only a validated window can be chosen. The choice and reason go on the project record and into its reports.</p>
      </div>
      <div className="rounded-2xl border-2 border-line bg-surface p-5">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Decision · target market window</p>
        {!editing && savedWin ? (
          <div className="mt-2">
            <button type="button" onClick={openTarget} className="font-display text-xl text-forest underline decoration-dotted underline-offset-4">
              {targetLabel(savedWin)}
            </button>
            <p className="mt-1 text-sm leading-relaxed">{saved!.reason}</p>
            <p className="mt-2 text-xs font-semibold text-leaf">
              Chosen by {personName(saved!.by)} on {saved!.date}
              {locked && " · locked: the project has moved to Execute"}
            </p>
            {editable && (
              <button type="button" onClick={() => setEditing(true)} className={`${quietBtn} mt-3 py-1.5`}>
                Change
              </button>
            )}
          </div>
        ) : editable ? (
          <div className="mt-3 space-y-3">
            {design.shortlist.length === 0 && <p className="text-sm text-muted">Short-list and validate a window first.</p>}
            <ul className="space-y-2">
              {design.shortlist.map((id) => {
                const w = windowById(id)!;
                const ok = isValidated(state, id);
                const n = VALIDATION_ITEMS.filter((i) => design.checks[id]?.[i.id]).length;
                return (
                  <li key={id}>
                    <label className={`flex items-start gap-3 rounded-xl border p-3 text-sm ${!ok ? "cursor-not-allowed opacity-60" : "cursor-pointer"} ${pick === id ? "border-forest bg-mist" : "border-line"}`}>
                      <input type="radio" name="target-window" id={`tw-${id}`} disabled={!ok} checked={pick === id} onChange={() => setPick(id)} className="mt-0.5 h-4 w-4 accent-[var(--forest)]" />
                      <span>
                        <span className="font-medium">{targetLabel(w)}</span>
                        <span className="block text-xs text-muted">
                          {ok ? "Validated" : `Not validated yet: ${n} of ${VALIDATION_ITEMS.length} items`} ·{" "}
                          {overlap(w).length ? `overlaps the harvest in ${monthsLabel(overlap(w))}` : "needs storage"}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
            <label className="block">
              <span className="text-sm font-medium">Why can the producers hit this window?</span>
              <textarea
                id="target-reason"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none"
              />
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={!ready}
                onClick={() => {
                  setState((s) => ({
                    ...s,
                    marketTarget: { windowId: pickWin!.id, reason: reason.trim(), by: u.id, date: TODAY },
                    audit: [...s.audit, { date: TODAY, who: u.id, what: `Chose target market window ${targetLabel(pickWin!)}`, kind: "approval" }],
                  }));
                  setEditing(false);
                }}
                className={primaryBtn}
              >
                Save as the project&rsquo;s target
              </button>
              {saved && (
                <button type="button" onClick={() => setEditing(false)} className="px-3 text-sm text-muted">
                  Cancel
                </button>
              )}
              {!ready && <p className="text-xs text-muted">{!pickWin ? "Choose a validated window." : "Write a short reason."}</p>}
            </div>
          </div>
        ) : (
          <p className="mt-2 text-sm text-muted">Not chosen yet. Nadia, Tucker or Daniel choose it.</p>
        )}
      </div>
      <p className="text-sm text-muted">
        Next: Tucker or Daniel signs off Design on the{" "}
        <Link href={`/projects/${projectId}`} className="font-semibold text-forest hover:underline">
          project page
        </Link>
        , which moves the project to Execute.
      </p>
    </section>
  );
}

/* ---------- page ---------- */

export function DesignPage() {
  const { user } = useRequireUser();
  const gatedProjects = projects.filter((p) => "designGate" in p && p.designGate);
  const [projectId, setProjectId] = useState(gatedProjects[0]?.id ?? "AG-2027");
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("project");
    if (q && GATED_KEYS[q]) setProjectId(q);
  }, []);
  const store = GATED_KEYS[projectId] ?? GATED_KEYS["AG-2027"];
  const [state, setState] = usePersistentState<ProjectState>(store.key, store.seed);
  const project = projects.find((p) => p.id === projectId)!;
  const [crop, setCrop] = useState<Crop>(("crop" in project && project.crop) || "Grapes");
  const [targetOpen, setTargetOpen] = useState(false);

  if (!user) return null;
  if (user.kind === "donor")
    return (
      <div className="min-h-screen">
        <TopBar />
        <p className="px-6 py-24 text-center text-muted">Project design is for Roots of Peace staff.</p>
      </div>
    );

  const stage = state.stage ?? project.stage;
  const locked = stage !== "Design";
  const design = state.design ?? emptyDesign;
  const validatedCount = design.shortlist.filter((id) => isValidated(state, id)).length;
  const stepStatus = {
    explore: `${design.shortlist.length} short-listed`,
    validate: `${validatedCount} of ${design.shortlist.length} validated`,
    choose: state.marketTarget ? "Target chosen" : "Not chosen",
  };
  const props: Props = { u: user, state, setState, locked };

  return (
    <div className="min-h-screen">
      <TopBar active="design" />
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:py-8">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">Project design</p>
          <h1 className="mt-1 font-display text-4xl tracking-tight">Find the best validated market window</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">Start from demand: explore where buyers have unmet demand and when, validate the strongest windows with evidence, then commit the project to one.</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <span className="text-muted">Designing</span>
            <Link href={`/projects/${project.id}`} className="rounded-full border border-line bg-surface px-3 py-1 font-medium hover:border-forest">
              {project.id} · {project.name}
            </Link>
            <Pill tone={locked ? "forest" : "ochre"}>{locked ? `${stage}: design locked` : "In Design"}</Pill>
          </div>
        </header>

        <nav aria-label="Design steps" className="sticky top-[57px] z-30 -mx-4 mt-6 border-b border-line bg-paper/95 px-4 backdrop-blur sm:mx-0 sm:px-0">
          <ol className="flex flex-wrap gap-1">
            {STEPS.map((s, k) => (
              <li key={s.id}>
                <a href={`#${s.id}`} className="flex items-baseline gap-2 px-3 py-3 text-sm hover:text-forest">
                  <span className="font-display text-lg text-muted">{k + 1}</span>
                  <span className="font-semibold">{s.label}</span>
                  <span className="text-xs text-muted">{stepStatus[s.id]}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-6 space-y-12">
          <Explore {...props} crop={crop} setCrop={setCrop} />
          <Validate {...props} />
          <Choose {...props} projectId={project.id} openTarget={() => setTargetOpen(true)} />
        </div>
        <p className="mt-10 text-xs text-muted">
          Reset this project&rsquo;s demo data:{" "}
          <button type="button" onClick={() => setState(store.seed())} className="font-semibold underline-offset-2 hover:underline">
            reset
          </button>
          .
        </p>
      </div>
      {targetOpen && state.marketTarget && <TargetPanel state={state} onClose={() => setTargetOpen(false)} />}
    </div>
  );
}
