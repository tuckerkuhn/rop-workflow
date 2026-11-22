"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { Why } from "@/components/app/why";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";
import { decisionProblem, isException, isStale, type SelectionAction } from "@/lib/selection";
import type { SelectionView } from "@/server/selection-store";

/**
 * Farmer selection: the rules at the top, then one ruled row per farmer. A row opens to tick the
 * rules the farmer meets and record the decision; the undecided come first.
 */

const input = "mt-1 block w-full rounded-sm border border-line bg-paper px-3 py-2.5 text-base";
type Farmer = SelectionView["farmers"][number];

async function call(url: string, user: string, init?: RequestInit): Promise<SelectionView> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as SelectionView;
}

function Rules({ v, act }: { v: SelectionView; act: (a: SelectionAction) => Promise<void> }) {
  const s = v.selection;
  const [editing, setEditing] = useState(!s.criteria.length);
  const [outreach, setOutreach] = useState(s.outreach);
  const [rules, setRules] = useState<string[]>(s.criteria.length ? s.criteria.map((c) => c.text) : ["", "", ""]);
  const [reason, setReason] = useState("");
  const decided = Object.keys(s.decisions).length;
  const clean = rules.map((r) => r.trim()).filter(Boolean);
  if (!editing)
    return (
      <section className="mt-6" aria-labelledby="rules-heading">
        <div className="flex flex-wrap items-end gap-3">
          <h2 id="rules-heading" className="min-w-0 flex-1 border-s-[6px] border-ochre ps-2 font-ledger text-lg font-bold leading-tight">
            The rules <span className="font-mono text-sm font-normal text-muted">version {s.version}</span>
          </h2>
          {v.can.rules && (
            <button type="button" className={quietBtn} onClick={() => setEditing(true)}>
              Change the rules
            </button>
          )}
        </div>
        <ol className="mt-2 border-t-2 border-ink">
          {s.criteria.map((c, k) => (
            <li key={c.id} className="flex gap-3 border-b border-line px-2 py-2 text-sm">
              <span aria-hidden className="w-6 shrink-0 font-mono text-xs text-muted">
                {String(k + 1).padStart(2, "0")}
              </span>
              {c.text}
            </li>
          ))}
        </ol>
        <p className="mt-2 text-sm">
          <span className="font-semibold">How people heard: </span>
          {s.outreach}
        </p>
        {s.criteriaBy && (
          <p className="mt-1 font-mono text-xs text-muted">
            Set by {s.criteriaBy.byName} on {s.criteriaBy.on}
          </p>
        )}
      </section>
    );
  return (
    <form
      className="mt-6 border-s-[6px] border-forest bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: "criteria", outreach, criteria: clean, reason }).then(() => setEditing(false), () => undefined);
      }}
    >
      <h2 className="font-ledger text-lg font-bold">Write the rules before anyone is chosen</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">Rules a stranger could check: land size, where the farmer lives, what they grow, what they agree to contribute. Avoid rules that need a judgment, such as &ldquo;motivated&rdquo;.</p>
      {rules.map((r, k) => (
        <label key={k} className="mt-3 block text-sm">
          Rule {k + 1}
          <input className={input} value={r} maxLength={300} placeholder={k === 0 ? "Farms between 0.2 and 2 hectares in the project villages" : ""} onChange={(e) => setRules(rules.map((x, j) => (j === k ? e.target.value : x)))} />
        </label>
      ))}
      {rules.length < 12 && (
        <button type="button" className={`${quietBtn} mt-3`} onClick={() => setRules([...rules, ""])}>
          + Another rule
        </button>
      )}
      <label className="mt-4 block text-sm">
        How people heard they could apply
        <textarea className={input} rows={2} value={outreach} maxLength={1000} placeholder="Announced at the community meeting in each village and through the farmer association, with two weeks to apply" onChange={(e) => setOutreach(e.target.value)} />
        <span className="mt-1 block text-xs text-muted">An open call is the answer to &ldquo;only friends of the staff were told&rdquo;.</span>
      </label>
      {decided > 0 && (
        <label className="mt-4 block text-sm">
          Why the rules are changing ({decided} {decided === 1 ? "farmer is" : "farmers are"} already decided; their decisions stay as recorded)
          <input className={input} value={reason} maxLength={600} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="submit" className={primaryBtn} disabled={!clean.length || outreach.trim().length < 10}>
          Save the rules
        </button>
        {s.criteria.length > 0 && (
          <button type="button" className={quietBtn} onClick={() => setEditing(false)}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

function Decide({ v, f, act, onClose }: { v: SelectionView; f: Farmer; act: (a: SelectionAction) => Promise<void>; onClose: () => void }) {
  const s = v.selection;
  const d = s.decisions[f.id];
  const [met, setMet] = useState<string[]>(d && !isStale(s, d) ? d.met : []);
  const [reason, setReason] = useState("");
  const all = s.criteria.every((c) => met.includes(c.id));
  const send = (selected: boolean) => void act({ action: "decide", farmer: f.id, selected, met, reason }).then(onClose, () => undefined);
  return (
    <div className="border-t border-line bg-surface px-2 py-3 ps-11">
      <p className="text-sm font-semibold">Tick each rule this farmer meets</p>
      <ul className="mt-1">
        {s.criteria.map((c) => (
          <li key={c.id}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-sm hover:bg-ochre-soft">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={met.includes(c.id)} onChange={(e) => setMet(e.target.checked ? [...met, c.id] : met.filter((x) => x !== c.id))} />
              {c.text}
            </label>
          </li>
        ))}
      </ul>
      <label className="mt-2 block text-sm">
        Reason {all ? "(needed only if not selected)" : "(needed: not every rule is met)"}
        <textarea className={input} rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} disabled={!!decisionProblem(s, { selected: true, met, reason })} onClick={() => send(true)}>
          {all ? "Select" : "Select as an exception"}
        </button>
        <button type="button" className={quietBtn} disabled={!!decisionProblem(s, { selected: false, met, reason })} onClick={() => send(false)}>
          Not selected
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function SelectionPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<SelectionView | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const url = `/api/projects/${project.id}/selection`;
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call(url, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);
  if (!user) return null;
  const act = async (a: SelectionAction) => {
    setError("");
    try {
      setV(await call(url, user.id, { method: "POST", body: JSON.stringify(a) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const s = v?.selection;
  const c = v?.counts;
  // The undecided first: that is the work left.
  const farmers = v && s ? [...v.farmers].sort((a, b) => Number(!!s.decisions[a.id]) - Number(!!s.decisions[b.id]) || a.id.localeCompare(b.id)) : [];
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">{project.name}</p>
        <h1 className="mt-1 font-display text-4xl tracking-tight">Farmer selection</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">The written rule for who takes part, then for each farmer the decision, the reason and who made it.</p>
        <Why>
          &ldquo;Who was chosen, and by what rule?&rdquo; is a standard audit question. The first complaint most projects hear comes from someone who was left out. A rule written before anyone is chosen, and a reason
          kept for each person, answers both.
        </Why>
        {error && (
          <p role="alert" className="mt-3 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {!project.saved && <p className="mt-6 text-sm text-muted">Save the project first: the selection is kept with the project.</p>}
        {!v && project.saved && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && s && c && (
          <>
            {s.criteria.length || v.can.rules ? <Rules key={s.version + s.outreach} v={v} act={act} /> : <p className="mt-6 border-s-[6px] border-ochre bg-ochre-soft px-3 py-3 text-sm">No selection rules are written yet. The project manager or a plan approver writes them.</p>}

            {s.criteria.length > 0 && (
              <>
                <dl className="mt-8 grid grid-cols-2 border-t-2 border-ink sm:grid-cols-4">
                  {(
                    [
                      ["On the list", c.total, ""],
                      ["Selected", c.selected, "text-leaf"],
                      ["Not selected", c.notSelected, ""],
                      ["Still to decide", c.undecided, c.undecided ? "text-warn" : ""],
                    ] as [string, number, string][]
                  ).map(([label, n, tone]) => (
                    <div key={label} className="border-b border-line px-2 py-3">
                      <dt className="text-xs text-muted">{label}</dt>
                      <dd className={`font-mono text-3xl font-bold ${tone}`}>{n}</dd>
                    </div>
                  ))}
                </dl>
                <p className="mt-2 font-mono text-xs text-muted">
                  Women: {c.womenSelected} selected of {c.women} on the list
                  {c.exceptions ? ` · ${c.exceptions} selected as ${c.exceptions === 1 ? "an exception" : "exceptions"}` : ""}
                </p>

                {v.farmers.length === 0 ? (
                  <p className="mt-6 border-s-[6px] border-ochre bg-ochre-soft px-3 py-3 text-sm">No farmers on this project&rsquo;s list yet. Load the applicant list in Field activities, then decide each one here.</p>
                ) : (
                  <ol className="mt-6 border-t-2 border-ink">
                    {farmers.map((f, k) => {
                      const d = s.decisions[f.id];
                      const stale = d ? isStale(s, d) : false;
                      const exception = d ? isException(s, d) : false;
                      return (
                        <li key={f.id} className={`border-b border-line ${!d ? "border-s-[6px] border-s-ochre" : ""}`}>
                          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-2 py-3">
                            <span aria-hidden className="w-6 shrink-0 font-mono text-xs text-muted">
                              {String(k + 1).padStart(2, "0")}
                            </span>
                            <span className="font-mono text-sm font-bold">{f.id}</span>
                            <span className="min-w-0 flex-1 text-sm">
                              {f.name ? `${f.name} · ` : ""}
                              {f.gender}, {f.community}, {f.hectares} ha
                            </span>
                            <span className={`shrink-0 px-2 py-0.5 font-mono text-xs uppercase ${!d ? "bg-ochre text-ink" : d.selected ? "text-leaf" : "text-muted"}`}>
                              {!d ? "To decide" : d.selected ? (exception ? "Selected, exception" : "Selected") : "Not selected"}
                            </span>
                            {v.can.decide && open !== f.id && (
                              <button type="button" className={quietBtn} onClick={() => setOpen(f.id)}>
                                {d ? "Decide again" : "Decide"}
                              </button>
                            )}
                          </div>
                          {d && (
                            <p className="px-2 pb-3 ps-11 text-xs text-muted">
                              {d.byName}, {d.on} · {d.met.length} of {s.criteria.length} rules met
                              {d.reason ? ` · ${d.reason}` : ""}
                              {stale ? " · decided under an earlier version of the rules" : ""}
                            </p>
                          )}
                          {open === f.id && <Decide v={v} f={f} act={act} onClose={() => setOpen(null)} />}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
