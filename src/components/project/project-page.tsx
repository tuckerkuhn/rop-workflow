"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { FIELD_ITEMS_KEY } from "@/components/field/workspace";
import { PROCUREMENT_ITEMS_KEY } from "@/components/procurement/workspace";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TODAY, TopBar, dangerBtn, primaryBtn, quietBtn, usePersistentState } from "@/components/workspace/ui";
import { STAGES, holderOf, projectRoleHolders, projects, userById, type AppUser } from "@/lib/demo";
import { maskName, seedField, type Farmer, type FieldItem } from "@/lib/field";
import { seedProcurements, type Procurement } from "@/lib/procurement";
import {
  CROSS_CUTTING,
  SAMPLE_EXPORT,
  actualFor,
  activities,
  activityStatus,
  agentJobs,
  dataFlags,
  formLabel,
  indicatorLibrary,
  indicators,
  parseExport,
  personName,
  planLines,
  results,
  seedProject,
  suggestLine,
  type Indicator,
  type ProjectState,
  type SpendRow,
  type Submission,
} from "@/lib/project";

export const PROJECT_KEY = "rop-project-v3";
const TABS = ["Overview", "Plan", "Execute", "Verify", "Budget", "Report", "Audit"] as const;
type Tab = (typeof TABS)[number];
const PERIOD = "January to March 2027 (to 4 March)";

const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
const name = (id: string) => personName(id);

function Bar({ value, target }: { value: number; target: number }) {
  const w = Math.min(100, pct(value, target));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-sunken" aria-hidden>
      <div className={`h-full rounded-full ${w >= 100 ? "bg-leaf" : "bg-forest"}`} style={{ width: `${w}%` }} />
    </div>
  );
}

/* ---------- evidence drawer ---------- */

function EvidencePanel({ ind, state, onClose }: { ind: Indicator; state: ProjectState; onClose: () => void }) {
  const a = actualFor(ind, state.submissions);
  const appr = state.actualApprovals[ind.id];
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/40" onClick={onClose} role="dialog" aria-modal="true" aria-label={`Evidence for ${ind.name}`}>
      <aside className="h-full w-full max-w-xl overflow-auto bg-surface p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-mono text-xs text-muted">
              {ind.id} · {ind.unit}
            </p>
            <h3 className="mt-1 font-display text-2xl tracking-tight">{ind.name}</h3>
          </div>
          <button type="button" onClick={onClose} className="rounded-full px-3 py-1 text-sm text-muted hover:bg-sunken">
            Close
          </button>
        </div>
        <p className="mt-4 font-display text-5xl tabular-nums">{a.value ?? "—"}</p>
        <p className="text-sm text-muted">
          Target {ind.target} · {a.evidence.length} evidence records{a.pending ? ` · ${a.pending} more waiting in the review queue` : ""}
        </p>
        <div className="mt-4 rounded-xl border border-line bg-paper p-4 text-sm">
          <p className="font-semibold">How this number was made</p>
          <ol className="mt-2 space-y-1 text-muted">
            <li>1. Kobo submissions pulled daily into the review queue.</li>
            <li>2. Data checker (AI) flagged quality problems; it sees farmer IDs only.</li>
            <li>3. {name(projectRoleHolders("mel-owner")[0]?.id ?? "omar")} accepted each record below.</li>
            <li>
              4.{" "}
              {appr ? (
                <>
                  Actual approved by {name(appr.by)} on {appr.date}
                  {appr.note && appr.note !== String(a.value) ? <span className="text-clay"> · value changed since approval ({appr.note})</span> : ""}.
                </>
              ) : (
                <span className="text-clay">Actual not yet approved by the MEL owner. It cannot be released.</span>
              )}
            </li>
          </ol>
        </div>
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {a.evidence.map((s) => (
            <li key={s.id} className="py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs">{s.id}</span>
                <span className="text-xs text-muted">{s.date}</span>
              </div>
              <p className="mt-0.5">
                {formLabel[s.form]} · Farmer {s.farmerId}
                {s.fields.result ? ` · result ${s.fields.result}` : ""}
              </p>
              <p className="text-xs text-muted">
                Collected by {name(s.enumerator)} · GPS {s.gps[0].toFixed(3)}, {s.gps[1].toFixed(3)} · {s.photo ? "photo attached" : "no photo"} · accepted by {name(s.decidedBy ?? "")} {s.decidedOn}
              </p>
            </li>
          ))}
          {a.evidence.length === 0 && <li className="py-3 text-sm text-muted">No accepted evidence yet.</li>}
        </ul>
      </aside>
    </div>
  );
}

/* ---------- sections ---------- */

function Overview({ u, state, setState, field, procs, go }: SectionProps & { go: (t: Tab) => void }) {
  const { money } = useSession();
  const canReview = u.project.includes("monthly-review");
  const pending = state.submissions.filter((s) => s.status === "pending");
  const flagged = pending.filter((s) => dataFlags(s, state.submissions).length);
  const late = activities.filter((a) => activityStatus(a, field, procs).status === "Late");
  const unapproved = indicators.filter((i) => i.source !== "survey" && !state.actualApprovals[i.id]);
  const spend = state.spend.reduce((s, r) => s + r.amount, 0);
  const plannedToDate = planLines.reduce((s, l) => s + l.plannedToDate, 0);
  const openFindings = field.filter((i) => i.kind === "finding" && i.step !== "closed");

  return (
    <div className="space-y-8">
      <section className="grid gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {[
          { k: "Review queue", v: `${pending.length}`, s: `${flagged.length} flagged by the data checker`, t: "Verify" as Tab },
          { k: "Late activities", v: `${late.length}`, s: late.map((a) => a.name).join(", ") || "None", t: "Execute" as Tab },
          { k: "Actuals not approved", v: `${unapproved.length}`, s: "Block report release", t: "Verify" as Tab },
          { k: "Spend to date", v: state.spend.length ? money(spend) : "Not imported", s: state.spend.length ? `${pct(spend, plannedToDate)}% of plan to date` : "NetSuite export due", t: "Budget" as Tab },
        ].map((c) => (
          <button key={c.k} type="button" onClick={() => go(c.t)} className="bg-surface px-5 py-4 text-left transition hover:bg-paper">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{c.k}</p>
            <p className="mt-1 font-display text-3xl tabular-nums">{c.v}</p>
            <p className="mt-1 truncate text-xs text-muted">{c.s}</p>
          </button>
        ))}
      </section>

      <section className="rounded-2xl border border-line bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-plum">AI draft · Monthly reviewer</p>
            <h3 className="mt-1 font-display text-2xl tracking-tight">March monthly review</h3>
          </div>
          <p className="text-xs text-muted">For Tucker and Daniel. Sources listed below each part.</p>
        </div>
        <div className="grid gap-6 px-5 py-5 md:grid-cols-3">
          <div>
            <p className="text-sm font-semibold">Targets vs actuals</p>
            <ul className="mt-2 space-y-2 text-sm">
              {indicators
                .filter((i) => i.source !== "survey")
                .map((i) => {
                  const a = actualFor(i, state.submissions);
                  return (
                    <li key={i.id}>
                      <div className="flex justify-between gap-2">
                        <span className="truncate">{i.name}</span>
                        <span className="shrink-0 tabular-nums text-muted">
                          {a.value}/{i.target}
                        </span>
                      </div>
                      <Bar value={a.value ?? 0} target={i.target} />
                    </li>
                  );
                })}
            </ul>
            <p className="mt-2 text-[11px] text-muted">Source: accepted Kobo submissions</p>
          </div>
          <div>
            <p className="text-sm font-semibold">Budget vs actuals</p>
            {state.spend.length ? (
              <p className="mt-2 text-sm text-muted">
                {money(spend)} spent against {money(plannedToDate)} planned to date. {varianceLines(state).length} lines vary by more than {state.varianceThreshold}%.
              </p>
            ) : (
              <p className="mt-2 text-sm text-muted">No NetSuite export this month yet, so the budget part is empty.</p>
            )}
            <p className="mt-4 text-sm font-semibold">Risks</p>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-muted">
              {late.map((a) => (
                <li key={a.n}>Activity {a.n} ({a.name.toLowerCase()}) is late.</li>
              ))}
              {openFindings.length > 0 && <li>{openFindings.length} MEL findings still open.</li>}
              {flagged.length > 0 && <li>{flagged.length} new submissions have quality flags.</li>}
            </ul>
            <p className="mt-2 text-[11px] text-muted">Sources: activity plan, Field activities, Procurement, review queue</p>
          </div>
          <div>
            <p className="text-sm font-semibold">Proposed changes</p>
            <ul className="mt-2 space-y-3">
              {state.changes.map((c) => (
                <li key={c.id} className="rounded-xl border border-line bg-paper p-3 text-sm">
                  <p className="leading-relaxed">{c.text}</p>
                  {c.status === "proposed" ? (
                    canReview ? (
                      <div className="mt-2 flex gap-2">
                        {(["approved", "declined"] as const).map((d) => (
                          <button
                            key={d}
                            type="button"
                            onClick={() =>
                              setState((s) => ({
                                ...s,
                                changes: s.changes.map((x) => (x.id === c.id ? { ...x, status: d, by: u.id } : x)),
                                audit: [...s.audit, { date: TODAY, who: u.id, what: `${d === "approved" ? "Approved" : "Declined"} proposed change ${c.id}`, kind: "approval" }],
                              }))
                            }
                            className={`rounded-full px-3 py-1 text-xs font-semibold ${d === "approved" ? "bg-forest text-forest-ink" : "border border-line"}`}
                          >
                            {d === "approved" ? "Approve" : "Decline"}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted">Waiting for Tucker or Daniel</p>
                    )
                  ) : (
                    <p className={`mt-2 text-xs font-semibold ${c.status === "approved" ? "text-leaf" : "text-muted"}`}>
                      {c.status === "approved" ? "Approved" : "Declined"} by {name(c.by ?? "")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">
          Confidence: medium. Activity and procurement status are live; impact (net income) has no data until the end-of-season survey. Approved changes go back into Execute.
        </p>
      </section>

      <section>
        <SectionLabel>Pilot success measures (build spec)</SectionLabel>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ["Donor-ready output", state.reportRelease ? `Released ${state.reportRelease.date}` : "Report not released yet", "Report goes out with light edits only"],
            ["Traceable", `${traceable(state)}% of report numbers link to evidence`, "Click any number, see its source"],
            ["Daniel runs it unaided", "Not tested yet", "Week 6: log every point he gets stuck"],
            ["Report time", "Not timed yet", "Under 2 hours instead of days"],
          ].map(([t, v, s]) => (
            <div key={t} className="rounded-2xl border border-line bg-surface p-4">
              <p className="font-semibold">{t}</p>
              <p className="mt-1 text-sm">{v}</p>
              <p className="mt-1 text-xs text-muted">{s}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function traceable(state: ProjectState) {
  const nums = indicators.filter((i) => i.source !== "survey").map((i) => actualFor(i, state.submissions));
  return pct(nums.filter((a) => (a.value ?? 0) === 0 || a.evidence.length > 0).length, nums.length);
}

function Plan({ state, field, procs, openEvidence }: SectionProps & { openEvidence: (i: Indicator) => void }) {
  return (
    <div className="space-y-8">
      <section className="flex flex-wrap items-center gap-4 rounded-2xl border border-forest/30 bg-mist p-5">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-forest text-forest-ink">✓</span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">Project plan and budget approved</p>
          <p className="text-sm text-muted">
            Signed by {name(state.planApproval.by)} on {state.planApproval.date}. {state.planApproval.note} This sign-off opened Execute.
          </p>
        </div>
      </section>

      <section>
        <SectionLabel>Results framework</SectionLabel>
        <div className="mt-3 space-y-3">
          {results.map((r) => {
            const inds = indicators.filter((i) => i.result === r.id);
            const acts = activities.filter((a) => a.output === r.id);
            return (
              <div key={r.id} className={`rounded-2xl border border-line bg-surface p-5 ${r.level === "Output" ? "ml-6 sm:ml-12" : r.level === "Outcome" ? "ml-3 sm:ml-6" : ""}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={r.level === "Goal" ? "forest" : r.level === "Outcome" ? "sky" : "muted"}>{r.level}</Pill>
                  <span className="font-mono text-xs text-muted">{r.id}</span>
                  <span className="text-xs text-muted">· donor: {r.donorRef}</span>
                </div>
                <p className="mt-2 font-display text-xl leading-snug">{r.statement}</p>
                {inds.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {inds.map((i) => {
                      const a = actualFor(i, state.submissions);
                      return (
                        <li key={i.id} className="grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1 text-sm">
                          <span>
                            <span className="font-mono text-xs text-muted">{i.id}</span> {i.name}
                            {i.library && <span className="ml-2 rounded bg-plum-soft px-1.5 py-0.5 text-[10px] font-semibold text-plum">Library: {i.library}</span>}
                          </span>
                          <button type="button" onClick={() => openEvidence(i)} className="text-right tabular-nums hover:text-forest hover:underline" disabled={i.source === "survey"}>
                            {a.value ?? "—"} / {i.target}
                            {i.unit.startsWith("%") ? "%" : ""}
                          </button>
                          <div className="col-span-2">{i.source !== "survey" && <Bar value={a.value ?? 0} target={i.target} />}</div>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {acts.length > 0 && (
                  <p className="mt-3 text-xs text-muted">
                    Activities: {acts.map((a) => `${a.n}. ${a.name} (${activityStatus(a, field, procs).status.toLowerCase()})`).join(" · ")}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionLabel>Impact indicator library</SectionLabel>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {indicatorLibrary.map((l) => (
              <li key={l.theme} className={`rounded-xl border p-3 text-sm ${l.picked ? "border-forest/40 bg-mist" : "border-line bg-surface"}`}>
                <p className="font-semibold">
                  {l.theme} {l.picked && <span className="text-xs font-normal text-leaf">· picked for this project</span>}
                </p>
                <p className="text-xs text-muted">{l.example}</p>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <SectionLabel>Donor mapping</SectionLabel>
          <table className="mt-3 w-full text-sm">
            <tbody className="divide-y divide-line">
              {indicators.map((i) => (
                <tr key={i.id}>
                  <td className="py-2 pr-3 font-mono text-xs">{i.id}</td>
                  <td className="py-2 pr-3">{i.name}</td>
                  <td className="py-2 text-muted">↔ {i.donorRef}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Placeholder donor framework. Which donor template the pilot maps to is an open question in the build spec.</p>
        </div>
      </section>
    </div>
  );
}

function Execute({ field, procs }: SectionProps) {
  return (
    <div className="space-y-6">
      <div>
        <SectionLabel>ROP field sequence</SectionLabel>
        <p className="mt-1 text-sm text-muted">The standard template, editable per project. Status comes from the live workflows where they exist.</p>
      </div>
      <ol className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
        {activities.map((a) => {
          const st = activityStatus(a, field, procs);
          const link = [4, 6, 7].includes(a.n) ? "/field" : a.n === 5 ? "/procurement" : null;
          return (
            <li key={a.n} className="grid grid-cols-[2rem_1fr] gap-3 px-4 py-3 sm:grid-cols-[2rem_1fr_10rem_7rem]">
              <span className="font-display text-xl text-muted">{a.n}</span>
              <div className="min-w-0">
                <p className="font-medium">{a.name}</p>
                <p className="truncate text-xs text-muted">{st.detail}</p>
              </div>
              <div className="col-start-2 text-xs text-muted sm:col-start-auto">
                {name(a.owner)}
                <br />
                {a.start} → {a.end}
              </div>
              <div className="col-start-2 flex items-center gap-2 sm:col-start-auto sm:justify-end">
                <Pill tone={st.status === "Done" ? "forest" : st.status === "Late" ? "clay" : st.status === "In progress" ? "ochre" : "muted"}>{st.status}</Pill>
                {link && (
                  <Link href={link} className="text-xs font-semibold text-forest hover:underline">
                    Open
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-1.5">
        <span className="text-xs text-muted">Cross-cutting:</span>
        {CROSS_CUTTING.map((c) => (
          <span key={c} className="rounded-md border border-line bg-surface px-2 py-0.5 text-xs text-muted">
            {c}
          </span>
        ))}
      </div>
      <p className="text-xs text-muted">HR stays in BambooHR and finance in NetSuite. The harness reads their exports and never replaces them.</p>
    </div>
  );
}

function Verify({ u, state, setState, openEvidence }: SectionProps & { openEvidence: (i: Indicator) => void }) {
  const isMel = u.project.includes("mel-owner");
  const [querying, setQuerying] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const pending = state.submissions.filter((s) => s.status === "pending");
  const queried = state.submissions.filter((s) => s.status === "queried");
  const decide = (ids: string[], status: Submission["status"], why?: string) =>
    setState((s) => ({
      ...s,
      submissions: s.submissions.map((x) => (ids.includes(x.id) ? { ...x, status, decidedBy: u.id, decidedOn: TODAY, note: why } : x)),
      audit: [...s.audit, ...ids.map((id) => ({ date: TODAY, who: u.id, what: `${status === "accepted" ? "Accepted" : "Queried"} ${id}${why ? `: ${why}` : ""}`, kind: "approval" as const }))],
    }));
  const clean = pending.filter((s) => dataFlags(s, state.submissions).length === 0);

  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <SectionLabel>Review queue · {pending.length} from the daily Kobo pull</SectionLabel>
            <p className="mt-1 text-sm text-muted">The data checker flags problems. {isMel ? "You" : name(projectRoleHolders("mel-owner")[0]?.id ?? "")} accept or query each record; accepted data becomes part of an Actual.</p>
          </div>
          {isMel && clean.length > 0 && (
            <button type="button" onClick={() => decide(clean.map((s) => s.id), "accepted")} className={quietBtn}>
              Accept {clean.length} without flags
            </button>
          )}
        </div>
        <ul className="mt-3 space-y-2">
          {pending.map((s) => {
            const flags = dataFlags(s, state.submissions);
            return (
              <li key={s.id} className={`rounded-2xl border bg-surface p-4 ${flags.length ? "border-clay/40" : "border-line"}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">
                      <span className="font-mono text-xs text-muted">{s.id}</span> · <span className="font-medium">{formLabel[s.form]}</span> · Farmer {s.farmerId}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {s.date} · {name(s.enumerator)} · {Object.entries(s.fields).map(([k, v]) => `${k}: ${v || "—"}`).join(" · ")}
                    </p>
                    {flags.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {flags.map((f) => (
                          <li key={f} className="flex gap-2 text-sm text-clay">
                            <span aria-hidden>◆</span>
                            {f}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  {isMel && querying !== s.id && (
                    <div className="flex gap-2">
                      <button type="button" onClick={() => decide([s.id], "accepted")} className="rounded-full bg-forest px-4 py-1.5 text-sm font-medium text-forest-ink">
                        Accept
                      </button>
                      <button type="button" onClick={() => setQuerying(s.id)} className="rounded-full border border-line px-4 py-1.5 text-sm">
                        Query
                      </button>
                    </div>
                  )}
                </div>
                {querying === s.id && (
                  <form
                    className="mt-3 flex flex-wrap gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!note.trim()) return;
                      decide([s.id], "queried", note.trim());
                      setQuerying(null);
                      setNote("");
                    }}
                  >
                    <input
                      id={`q-${s.id}`}
                      autoFocus
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder={`Question for ${name(s.enumerator)}`}
                      className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none"
                    />
                    <button type="submit" className={dangerBtn}>
                      Send query
                    </button>
                  </form>
                )}
              </li>
            );
          })}
          {pending.length === 0 && <li className="rounded-2xl border border-line bg-surface p-4 text-sm text-muted">Queue is clear.</li>}
        </ul>
        {queried.length > 0 && <p className="mt-2 text-xs text-muted">{queried.length} queried and back with the enumerator: {queried.map((s) => s.id).join(", ")}</p>}
      </section>

      <section>
        <SectionLabel>Actuals for {PERIOD}</SectionLabel>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Indicator</th>
                <th className="px-4 py-2 font-semibold">Target</th>
                <th className="px-4 py-2 font-semibold">Actual</th>
                <th className="px-4 py-2 font-semibold">Women / men</th>
                <th className="px-4 py-2 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {indicators.map((i) => {
                const a = actualFor(i, state.submissions);
                const appr = state.actualApprovals[i.id];
                const stale = appr && appr.note !== String(a.value);
                return (
                  <tr key={i.id}>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-muted">{i.id}</span> {i.name}
                    </td>
                    <td className="px-4 py-3 tabular-nums">{i.target}</td>
                    <td className="px-4 py-3">
                      {i.source === "survey" ? (
                        <span className="text-muted">End-of-season survey</span>
                      ) : (
                        <button type="button" onClick={() => openEvidence(i)} className="font-semibold tabular-nums text-forest hover:underline">
                          {a.value}
                        </button>
                      )}
                      {a.pending > 0 && <span className="ml-1 text-xs text-ochre">+{a.pending} in queue</span>}
                    </td>
                    <td className="px-4 py-3 tabular-nums text-muted">{i.unit === "farmers" ? `${a.byGender.Female} / ${a.byGender.Male}` : "—"}</td>
                    <td className="px-4 py-3">
                      {i.source === "survey" ? (
                        <Pill tone="muted">No data yet</Pill>
                      ) : appr && !stale ? (
                        <Pill tone="forest">Approved · {name(appr.by).split(" ")[0]}</Pill>
                      ) : isMel ? (
                        <button
                          type="button"
                          onClick={() =>
                            setState((s) => ({
                              ...s,
                              actualApprovals: { ...s.actualApprovals, [i.id]: { what: `${i.id} actual`, by: u.id, date: TODAY, note: String(a.value) } },
                              audit: [...s.audit, { date: TODAY, who: u.id, what: `Approved actual ${i.id} = ${a.value}`, kind: "approval" }],
                            }))
                          }
                          className="rounded-full bg-forest px-3 py-1 text-xs font-semibold text-forest-ink"
                        >
                          {stale ? "Re-approve" : "Approve actual"}
                        </button>
                      ) : (
                        <Pill tone={stale ? "clay" : "ochre"}>{stale ? "Changed since approval" : "Draft"}</Pill>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">Disaggregations collected: gender, age band, household size, community. Ethnicity is not collected for this project.</p>
      </section>
    </div>
  );
}

function varianceLines(state: ProjectState) {
  return planLines
    .map((l) => {
      const spent = state.spend.filter((r) => r.line === l.code).reduce((s, r) => s + r.amount, 0);
      const v = l.plannedToDate ? ((spent - l.plannedToDate) / l.plannedToDate) * 100 : spent ? 100 : 0;
      return { ...l, spent, v };
    })
    .filter((l) => Math.abs(l.v) > state.varianceThreshold);
}

function Budget({ u, state, setState }: SectionProps) {
  const { money } = useSession();
  const canImport = u.project.includes("finance-import");
  const [rows, setRows] = useState<SpendRow[] | null>(null);
  const [error, setError] = useState("");
  const unmapped = rows?.filter((r) => !r.line) ?? [];
  const lines = planLines.map((l) => {
    const spent = state.spend.filter((r) => r.line === l.code).reduce((s, r) => s + r.amount, 0);
    const v = l.plannedToDate ? ((spent - l.plannedToDate) / l.plannedToDate) * 100 : spent ? 100 : 0;
    return { ...l, spent, v };
  });
  const load = (csv: string) => {
    const parsed = parseExport(csv);
    if (!parsed.length) return setError("No rows found. The file needs a header row and comma-separated columns.");
    setError("");
    setRows(parsed.map((r) => (r.line || !suggestLine(r) ? r : { ...r, line: "" })));
  };

  return (
    <div className="space-y-8">
      {canImport && (
        <section className="rounded-2xl border border-line bg-surface p-5">
          <SectionLabel>Monthly NetSuite import</SectionLabel>
          {!rows ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="min-w-0 flex-1 text-sm text-muted">
                Step 1 of 3. Export the saved search for this project from NetSuite as CSV, then load it here. NetSuite stays the ledger.
                {state.importedOn && ` Last import: ${state.importedOn}.`}
              </p>
              <label className={`${primaryBtn} cursor-pointer`}>
                Choose CSV
                <input
                  id="ns-file"
                  type="file"
                  accept=".csv,text/csv"
                  className="sr-only"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) f.text().then(load);
                  }}
                />
              </label>
              <button type="button" onClick={() => load(SAMPLE_EXPORT)} className={quietBtn}>
                Use sample export
              </button>
              {error && <p className="w-full text-sm text-clay">{error}</p>}
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              <p className="text-sm text-muted">
                Step 2 of 3. {rows.length} rows read. {unmapped.length ? `${unmapped.length} have no budget line; the Finance mapper suggests one for each. Check them.` : "Every row has a budget line."}
              </p>
              <ul className="divide-y divide-line border-y border-line">
                {rows.map((r, k) => {
                  const sug = suggestLine(r);
                  return (
                    <li key={r.ref} className="flex flex-wrap items-center gap-3 py-2 text-sm">
                      <span className="w-28 shrink-0 font-mono text-xs text-muted">{r.ref}</span>
                      <span className="min-w-0 flex-1 truncate">{r.memo}</span>
                      <span className="w-28 shrink-0 text-right tabular-nums">{money(r.amount)}</span>
                      <select
                        id={`map-${r.ref}`}
                        value={r.line}
                        onChange={(e) => setRows(rows.map((x, j) => (j === k ? { ...x, line: e.target.value } : x)))}
                        className={`w-52 rounded-lg border px-2 py-1 text-sm ${r.line ? "border-line bg-surface" : "border-clay bg-clay-soft"}`}
                        aria-label={`Budget line for ${r.ref}`}
                      >
                        <option value="">Choose a line…</option>
                        {planLines.map((l) => (
                          <option key={l.code} value={l.code}>
                            {l.code} {l.name}
                          </option>
                        ))}
                      </select>
                      {!r.line && sug && (
                        <button
                          type="button"
                          onClick={() => setRows(rows.map((x, j) => (j === k ? { ...x, line: sug.line } : x)))}
                          title={sug.why}
                          className="rounded-full bg-plum-soft px-3 py-1 text-xs font-semibold text-plum"
                        >
                          AI: use {sug.line} ({sug.confidence.toLowerCase()} confidence)
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={unmapped.length > 0}
                  onClick={() => {
                    setState((s) => ({
                      ...s,
                      spend: rows,
                      importedOn: TODAY,
                      audit: [
                        ...s.audit,
                        { date: TODAY, who: "agent:Finance mapper", what: `Suggested lines for ${rows.filter((r) => suggestLine(r)).length} rows`, kind: "agent" },
                        { date: TODAY, who: u.id, what: `Imported NetSuite export: ${rows.length} rows, ${money(rows.reduce((a, r) => a + r.amount, 0))}`, kind: "import" },
                      ],
                    }));
                    setRows(null);
                  }}
                  className={primaryBtn}
                >
                  Step 3: confirm import
                </button>
                <button type="button" onClick={() => setRows(null)} className="px-3 text-sm text-muted">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </section>
      )}

      <section>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <SectionLabel>Budget vs actuals · {state.importedOn ? `NetSuite export of ${state.importedOn}` : "no export imported yet"}</SectionLabel>
          <label className="flex items-center gap-2 text-sm text-muted">
            Flag variances over
            <input
              id="variance"
              type="number"
              min={1}
              max={100}
              value={state.varianceThreshold}
              onChange={(e) => setState((s) => ({ ...s, varianceThreshold: Number(e.target.value) || 10 }))}
              className="w-16 rounded-lg border border-line bg-surface px-2 py-1 text-right"
            />
            %
          </label>
        </div>
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="px-4 py-2 font-semibold">Budget line</th>
                <th className="px-4 py-2 text-right font-semibold">Planned</th>
                <th className="px-4 py-2 text-right font-semibold">Planned to date</th>
                <th className="px-4 py-2 text-right font-semibold">Spent</th>
                <th className="px-4 py-2 text-right font-semibold">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {lines.map((l) => {
                const flag = state.spend.length > 0 && Math.abs(l.v) > state.varianceThreshold;
                return (
                  <tr key={l.code} className={flag ? "bg-clay-soft/40" : ""}>
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-muted">{l.code}</span> {l.name}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(l.planned)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{money(l.plannedToDate)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{state.spend.length ? money(l.spent) : "—"}</td>
                    <td className={`px-4 py-2.5 text-right tabular-nums ${flag ? "font-semibold text-clay" : "text-muted"}`}>{state.spend.length ? `${l.v > 0 ? "+" : ""}${Math.round(l.v)}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!canImport && !state.spend.length && (
          <p className="mt-2 text-xs text-muted">Waiting for {projectRoleHolders("finance-import").map((x) => x.name).join(" or ")} to import this month&rsquo;s export.</p>
        )}
      </section>
    </div>
  );
}

function Report({ u, state, setState, field, openEvidence }: SectionProps & { openEvidence: (i: Indicator) => void }) {
  const { money } = useSession();
  const [view, setView] = useState<"rop" | "donor">("rop");
  const canRelease = u.project.includes("report-release");
  const nums = indicators.map((i) => ({ i, a: actualFor(i, state.submissions), appr: state.actualApprovals[i.id] }));
  const notApproved = nums.filter((n) => n.i.source !== "survey" && (!n.appr || n.appr.note !== String(n.a.value)));
  const farmers = field.filter((i): i is Farmer => i.kind === "farmer");
  const stories = farmers.flatMap((f) => f.stories.filter((s) => s.status === "completed").map((s) => ({ s, f })));
  const spend = state.spend.reduce((s, r) => s + r.amount, 0);
  const approvedChanges = state.changes.filter((c) => c.status === "approved");
  const checklist = [
    { ok: notApproved.length === 0, text: notApproved.length ? `${notApproved.length} actuals not approved by the MEL owner` : "Every actual approved by the MEL owner" },
    { ok: state.spend.length > 0, text: state.spend.length ? "Spend imported from NetSuite" : "This month's NetSuite export not imported" },
    { ok: traceable(state) === 100, text: `${traceable(state)}% of numbers link to evidence` },
  ];
  const ready = checklist.every((c) => c.ok);
  const label = (i: Indicator) => (view === "donor" ? i.donorRef : i.name);
  const summary = `In ${PERIOD}, ${nums[0].a.value} of ${nums[0].i.target} target farmers completed land-preparation training and ${nums[1].a.value} received the input package. ${nums[2].a.value} farmers met the land-preparation standard. Procurement of fertilizer is behind plan; the contract is held for corrections.`;

  const downloadDoc = () => {
    const html = document.getElementById("report-doc")?.outerHTML ?? "";
    const blob = new Blob([`<html><head><meta charset="utf-8"></head><body>${html}</body></html>`], { type: "application/msword" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${state.projectId}-progress-report-2027-03.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (u.kind === "donor" && !state.reportRelease) return <p className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">The March report has not been released yet.</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="radiogroup" aria-label="Report format" className="flex rounded-full bg-sunken p-1 text-sm">
          {(
            [
              ["rop", "ROP standard report"],
              ["donor", "Donor template"],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={view === k} onClick={() => setView(k)} className={`rounded-full px-4 py-1.5 ${view === k ? "bg-surface font-semibold shadow-sm" : "text-muted"}`}>
              {l}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <button type="button" onClick={downloadDoc} className={quietBtn}>
            Download Word
          </button>
          <button type="button" onClick={() => window.print()} className={quietBtn}>
            Print or save PDF
          </button>
        </div>
      </div>

      <article id="report-doc" className="rounded-2xl border border-line bg-surface px-6 py-8 sm:px-10">
        <header className="border-b-2 border-ink pb-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">Roots of Peace · {view === "rop" ? "Progress report" : "Donor progress report (mapped)"}</p>
          <h2 className="mt-1 font-display text-3xl tracking-tight">Village B Smallholder Maize</h2>
          <p className="text-sm text-muted">
            {PERIOD} · {state.reportRelease ? `Released by ${name(state.reportRelease.by)} on ${state.reportRelease.date}` : "Draft, not released"}
          </p>
        </header>

        <section className="mt-6">
          <h3 className="font-display text-xl">Summary</h3>
          <p className="mt-2 leading-relaxed">{summary}</p>
          <p className="mt-1 text-xs text-plum">Drafted by the Report writer (AI) from approved records. Edit before release.</p>
        </section>

        <section className="mt-6">
          <h3 className="font-display text-xl">Results</h3>
          <table className="mt-2 w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
              <tr>
                <th className="py-2 pr-3 font-semibold">{view === "donor" ? "Donor indicator" : "Indicator"}</th>
                <th className="py-2 pr-3 text-right font-semibold">Target</th>
                <th className="py-2 pr-3 text-right font-semibold">Actual</th>
                <th className="py-2 text-right font-semibold">%</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {nums.map(({ i, a, appr }) => (
                <tr key={i.id}>
                  <td className="py-2 pr-3">{label(i)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{i.target}</td>
                  <td className="py-2 pr-3 text-right">
                    {a.value === null ? (
                      <span className="text-muted">Not due</span>
                    ) : (
                      <button type="button" onClick={() => openEvidence(i)} className="font-semibold tabular-nums text-forest underline decoration-dotted underline-offset-4" title="Show the evidence behind this number">
                        {a.value}
                      </button>
                    )}
                    {a.value !== null && (!appr || appr.note !== String(a.value)) && <span className="ml-1 text-xs text-clay">draft</span>}
                  </td>
                  <td className="py-2 text-right tabular-nums text-muted">{a.value === null ? "—" : `${pct(a.value, i.target)}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            Women / men reached: training {nums[0].a.byGender.Female} / {nums[0].a.byGender.Male} · inputs {nums[1].a.byGender.Female} / {nums[1].a.byGender.Male}
          </p>
        </section>

        <section className="mt-6">
          <h3 className="font-display text-xl">Budget</h3>
          <p className="mt-2 text-sm">
            {state.spend.length ? `${money(spend)} spent to date against ${money(planLines.reduce((s, l) => s + l.plannedToDate, 0))} planned (NetSuite export of ${state.importedOn}).` : "Awaiting this month's NetSuite export."}
          </p>
        </section>

        {stories.length > 0 && (
          <section className="mt-6">
            <h3 className="font-display text-xl">Success stories</h3>
            {stories.map(({ s, f }) => (
              <p key={s.id} className="mt-2 text-sm leading-relaxed">
                <span className="font-semibold">{s.title}.</span> {maskName(s.text, f, null)}
              </p>
            ))}
            <p className="mt-1 text-xs text-muted">Participants appear by farmer ID only in reports.</p>
          </section>
        )}

        <section className="mt-6">
          <h3 className="font-display text-xl">Challenges and changes</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm">
            {approvedChanges.map((c) => (
              <li key={c.id}>{c.text}</li>
            ))}
            {approvedChanges.length === 0 && <li className="text-muted">No changes approved in the monthly review yet.</li>}
          </ul>
        </section>
      </article>

      {!state.reportRelease && u.kind === "employee" && (
        <section className="rounded-2xl border-2 border-line bg-surface p-5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Report release · signed by {projectRoleHolders("report-release").map((x) => x.name).join(", ")}</p>
          <ul className="mt-3 space-y-1.5">
            {checklist.map((c) => (
              <li key={c.text} className="flex items-center gap-2 text-sm">
                <span className={`grid h-5 w-5 place-items-center rounded-full text-[11px] font-bold text-white ${c.ok ? "bg-leaf" : "bg-clay"}`}>{c.ok ? "✓" : "!"}</span>
                {c.text}
              </li>
            ))}
          </ul>
          {canRelease ? (
            <button
              type="button"
              disabled={!ready}
              onClick={() =>
                setState((s) => ({
                  ...s,
                  reportRelease: { what: "March progress report", by: u.id, date: TODAY },
                  audit: [...s.audit, { date: TODAY, who: u.id, what: "Signed and released the March progress report", kind: "approval" }],
                }))
              }
              className={`${primaryBtn} mt-4`}
            >
              Sign and release report →
            </button>
          ) : (
            <p className="mt-3 text-sm text-muted">Only the report approver can release it. Nothing goes to a donor without that sign-off.</p>
          )}
        </section>
      )}
    </div>
  );
}

function Audit({ state, field, procs }: SectionProps) {
  const [kind, setKind] = useState<string>("all");
  const events = useMemo(() => {
    const own = state.audit.map((e) => ({ ...e, where: "Project" }));
    const fe = field.flatMap((i) => i.timeline.map((e) => ({ date: e.date, who: holderOf("field", e.who)?.id ?? e.who, what: `${i.id}: ${e.what}`, kind: "change" as const, where: "Field activities" })));
    const pe = procs.flatMap((p) => p.timeline.map((e) => ({ date: e.date, who: holderOf("procurement", e.who)?.id ?? e.who, what: `${p.id}: ${e.what}`, kind: "change" as const, where: "Procurement" })));
    const ag = [
      { date: TODAY, who: "agent:Data checker", what: `Checked ${state.submissions.filter((s) => s.status === "pending").length} new submissions; ${state.submissions.filter((s) => s.status === "pending" && dataFlags(s, state.submissions).length).length} flagged`, kind: "agent" as const, where: "Project" },
      { date: TODAY, who: "agent:Monthly reviewer", what: "Drafted the March monthly review with 3 proposed changes", kind: "agent" as const, where: "Project" },
    ];
    return [...own, ...fe, ...pe, ...ag].sort((a, b) => b.date.localeCompare(a.date));
  }, [state, field, procs]);
  const shown = kind === "all" ? events : events.filter((e) => e.kind === kind);
  const exportCsv = () => {
    const rows = [["date", "who", "kind", "where", "what"], ...shown.map((e) => [e.date, name(e.who), e.kind, e.where, e.what])];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${state.projectId}-audit-trail.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="space-y-8">
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionLabel>Audit trail · append-only · {events.length} events</SectionLabel>
          <div className="flex flex-wrap items-center gap-2">
            {["all", "approval", "change", "import", "agent"].map((k) => (
              <button key={k} type="button" onClick={() => setKind(k)} className={`rounded-full px-3 py-1 text-xs ${kind === k ? "bg-ink text-paper" : "border border-line"}`}>
                {k}
              </button>
            ))}
            <button type="button" onClick={exportCsv} className={quietBtn}>
              Export CSV
            </button>
          </div>
        </div>
        <ol className="mt-3 max-h-[28rem] space-y-2 overflow-auto rounded-2xl border border-line bg-surface p-4">
          {shown.map((e, k) => (
            <li key={k} className="grid grid-cols-[6rem_1fr] gap-3 text-sm">
              <span className="font-mono text-xs text-muted">{e.date}</span>
              <span>
                {e.what}
                <span className="block text-xs text-muted">
                  {name(e.who)} · {e.where}
                </span>
              </span>
            </li>
          ))}
        </ol>
      </section>
      <section>
        <SectionLabel>AI agents</SectionLabel>
        <p className="mt-1 text-sm text-muted">Agents draft, check and flag. They never write a final value, send anything outside ROP, or see participant names.</p>
        <ul className="mt-3 grid gap-2 md:grid-cols-2">
          {agentJobs.map((a) => (
            <li key={a.name} className="rounded-xl border border-line bg-surface p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{a.name}</p>
                <Pill tone={a.inDemo ? "plum" : "muted"}>{a.inDemo ? `${a.stage} · in this demo` : `${a.stage} · after pilot`}</Pill>
              </div>
              <p className="mt-1 text-muted">{a.does}</p>
              <p className="mt-1 text-xs text-muted">Hands to {a.handsTo}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

type SectionProps = {
  u: AppUser;
  state: ProjectState;
  setState: (fn: (s: ProjectState) => ProjectState) => void;
  field: FieldItem[];
  procs: Procurement[];
};

/* ---------- page ---------- */

export function ProjectPage({ id }: { id: string }) {
  const { user } = useRequireUser();
  const [state, setStateRaw] = usePersistentState<ProjectState>(PROJECT_KEY, seedProject);
  const [field] = usePersistentState<FieldItem[]>(FIELD_ITEMS_KEY, seedField);
  const [procs] = usePersistentState<Procurement[]>(PROCUREMENT_ITEMS_KEY, seedProcurements);
  const [tab, setTab] = useState<Tab>("Overview");
  const [evidence, setEvidence] = useState<Indicator | null>(null);
  const project = projects.find((p) => p.id === id);

  useEffect(() => {
    const h = window.location.hash.slice(1);
    const t = TABS.find((x) => x.toLowerCase() === h);
    if (t) setTab(t);
  }, []);
  const go = (t: Tab) => {
    setTab(t);
    history.replaceState(null, "", `#${t.toLowerCase()}`);
  };

  if (!user) return null;
  if (!project)
    return (
      <div className="min-h-screen">
        <TopBar />
        <p className="px-6 py-24 text-center text-muted">No project {id}.</p>
      </div>
    );

  const setState = (fn: (s: ProjectState) => ProjectState) => setStateRaw(fn);
  const donor = user.kind === "donor";
  const tabs: Tab[] = donor ? ["Report"] : [...TABS];
  const shownTab: Tab = donor ? "Report" : tab;
  const pendingCount = state.submissions.filter((s) => s.status === "pending").length;
  const props: SectionProps = { u: user, state, setState, field, procs };

  return (
    <div className="min-h-screen">
      <TopBar active="project" />
      <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6 lg:py-8">
        <header>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted">
              {project.id} · org {project.orgId}
            </span>
            <Pill tone={project.status === "Active" ? "forest" : "muted"}>{project.status}</Pill>
            <span className="text-xs text-muted">
              {project.country} · {project.award}
            </span>
          </div>
          <h1 className="mt-1 font-display text-4xl tracking-tight">{project.name}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{project.note}</p>
          <ol className="mt-5 flex flex-wrap gap-1 text-sm" aria-label="Stage">
            {STAGES.map((s) => {
              const idx = STAGES.indexOf(project.stage);
              const k = STAGES.indexOf(s);
              return (
                <li
                  key={s}
                  className={`rounded-full px-3 py-1 ${k === idx ? "bg-forest text-forest-ink" : k < idx ? "bg-mist text-leaf" : "bg-sunken text-muted"}`}
                  aria-current={k === idx ? "step" : undefined}
                >
                  {k < idx ? "✓ " : ""}
                  {s}
                  {s === "Develop" && " (after pilot)"}
                </li>
              );
            })}
          </ol>
        </header>

        {id !== "A-2027" ? (
          <section className="mt-8 rounded-2xl border border-line bg-surface p-6">
            <p className="font-display text-2xl">Plan not loaded yet</p>
            <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">
              Week 1 of the pilot loads the Western Highlands results, activities, indicators and targets. Until then this record stays empty rather than guessed. Two open questions in the build spec block it:
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm">
              <li>Where does the Western Highlands data live today, and is there field data or only the plan?</li>
              <li>Which donor template is the mapping target for the pilot?</li>
            </ul>
            <Link href="/projects/A-2027" className={`${quietBtn} mt-5 inline-block`}>
              See the thin path on the demo project
            </Link>
          </section>
        ) : (
          <>
            <nav aria-label="Project sections" className="sticky top-[57px] z-30 -mx-4 mt-6 overflow-x-auto border-b border-line bg-paper/95 px-4 backdrop-blur sm:mx-0 sm:px-0">
              <div className="flex w-max gap-1">
                {tabs.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => go(t)}
                    aria-current={shownTab === t ? "page" : undefined}
                    className={`relative px-3 py-3 text-sm transition ${shownTab === t ? "font-semibold text-ink" : "text-muted hover:text-ink"}`}
                  >
                    {t}
                    {t === "Verify" && pendingCount > 0 && <span className="ml-1.5 rounded-full bg-ochre-soft px-1.5 text-[11px] font-bold text-ochre">{pendingCount}</span>}
                    {shownTab === t && <span className="absolute inset-x-2 bottom-0 h-0.5 rounded bg-forest" />}
                  </button>
                ))}
              </div>
            </nav>
            <div className="mt-6">
              {shownTab === "Overview" && <Overview {...props} go={go} />}
              {shownTab === "Plan" && <Plan {...props} openEvidence={setEvidence} />}
              {shownTab === "Execute" && <Execute {...props} />}
              {shownTab === "Verify" && <Verify {...props} openEvidence={setEvidence} />}
              {shownTab === "Budget" && <Budget {...props} />}
              {shownTab === "Report" && <Report {...props} openEvidence={setEvidence} />}
              {shownTab === "Audit" && <Audit {...props} />}
            </div>
            <p className="mt-10 text-xs text-muted">
              Reset this project&rsquo;s demo data:{" "}
              <button type="button" onClick={() => setStateRaw(seedProject())} className="font-semibold underline-offset-2 hover:underline">
                reset
              </button>
              . Signed in as {userById(user.id)?.name}.
            </p>
          </>
        )}
      </div>
      {evidence && <EvidencePanel ind={evidence} state={state} onClose={() => setEvidence(null)} />}
    </div>
  );
}
