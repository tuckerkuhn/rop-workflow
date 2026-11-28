"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { Why } from "@/components/app/why";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";
import { decisionProblem, failedRules, isException, isStale, outcomeLabel, outcomeOf, type Outcome, type SelectionAction, type Shown } from "@/lib/selection";
import type { SelectionView } from "@/server/selection-store";
import { splitNames, type Rule } from "@/lib/eligibility";

/**
 * Farmer selection: the rules at the top, then the farmers in lists: To decide, Selected,
 * Waitlisted (meet every rule, no place now) and Did not qualify, each with its reason. A row opens
 * to tick the rules the farmer meets and record the decision.
 */

const input = "mt-1 block w-full rounded-sm border border-line bg-paper px-3 py-2.5 text-base";
type Farmer = SelectionView["farmers"][number];

async function call(url: string, user: string, init?: RequestInit): Promise<SelectionView> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as SelectionView;
}

type Draft = { min: string; max: string; villages: string; crops: string; rate: string; women: string };
const num0 = (x: string) => (x.trim() === "" ? undefined : Number(x.replace(",", ".")));
/** The checked rules typed for all farmers ("") or one package. */
function checksOf(x: Draft, pkg: string): Rule[] {
  const p = pkg ? { package: pkg } : {};
  const [min, max, rate, women] = [num0(x.min), num0(x.max), num0(x.rate), num0(x.women)];
  return [
    ...(min !== undefined || max !== undefined ? [{ kind: "land" as const, ...p, ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }] : []),
    ...(splitNames(x.villages).length ? [{ kind: "location" as const, ...p, villages: splitNames(x.villages) }] : []),
    ...(splitNames(x.crops).length ? [{ kind: "crop" as const, ...p, crops: splitNames(x.crops) }] : []),
    ...(rate !== undefined ? [{ kind: "contribution" as const, ...p, rate, ...(women !== undefined ? { womenRate: women } : {}) }] : []),
  ];
}

function Rules({ v, act }: { v: SelectionView; act: (a: SelectionAction) => Promise<void> }) {
  const s = v.selection;
  const [editing, setEditing] = useState(!s.criteria.length);
  const [outreach, setOutreach] = useState(s.outreach);
  const written = s.criteria.filter((c) => !c.rule);
  const [rules, setRules] = useState<string[]>(written.length ? written.map((c) => c.text) : s.criteria.length ? [""] : ["", "", ""]);
  const [reason, setReason] = useState("");
  // Rules the app checks against each farmer's record (MF-12), for all farmers ("") or one package
  // (Tucker, 28 Nov): kept as typed, made into rules on save.
  const num = (n?: number) => (n === undefined ? "" : String(n));
  const draftFor = (pkg: string): Draft => {
    const of = <K extends Rule["kind"]>(k: K) => s.criteria.find((c) => c.rule?.kind === k && (c.rule.package ?? "") === pkg)?.rule as Extract<Rule, { kind: K }> | undefined;
    return { min: num(of("land")?.min), max: num(of("land")?.max), villages: (of("location")?.villages ?? []).join(", "), crops: (of("crop")?.crops ?? []).join(", "), rate: num(of("contribution")?.rate), women: num(of("contribution")?.womenRate) };
  };
  const scopes = ["", ...v.packages.map((p) => p.key)];
  const [drafts, setDrafts] = useState<Record<string, Draft>>(() => Object.fromEntries(scopes.map((k) => [k, draftFor(k)])));
  const [scope, setScope] = useState("");
  const d = drafts[scope] ?? draftFor(scope);
  const put = (patch: Partial<Draft>) => setDrafts({ ...drafts, [scope]: { ...d, ...patch } });
  const decided = Object.keys(s.decisions).length;
  const clean = rules.map((r) => r.trim()).filter(Boolean);
  const checks: Rule[] = scopes.flatMap((k) => checksOf(drafts[k] ?? draftFor(k), k));
  const badNumber = Object.values(drafts).some((x) => [x.min, x.max, x.rate, x.women].some((y) => y.trim() !== "" && !Number.isFinite(Number(y.replace(",", ".")))));
  const anyRule = clean.length + checks.length > 0;
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
              <span className="min-w-0 flex-1">{c.text}</span>
              {c.rule && <span className="shrink-0 text-xs text-muted">checked against the record</span>}
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
        void act({ action: "criteria", outreach, criteria: clean, checks, reason }).then(() => setEditing(false), () => undefined);
      }}
    >
      <h2 className="font-ledger text-lg font-bold">Write the rules before anyone is chosen</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">Rules a stranger could check: land size, where the farmer lives, what they grow, what they agree to contribute. Avoid rules that need a judgment, such as &ldquo;motivated&rdquo;.</p>
      {rules.map((r, k) => (
        <label key={k} className="mt-3 block text-sm">
          Rule {k + 1}
          <input className={input} value={r} maxLength={300} placeholder={k === 0 ? "For example: farms between 0.2 and 2 hectares in the project villages" : ""} onChange={(e) => setRules(rules.map((x, j) => (j === k ? e.target.value : x)))} />
        </label>
      ))}
      {rules.length < 12 && (
        <button type="button" className={`${quietBtn} mt-3`} onClick={() => setRules([...rules, ""])}>
          + Another rule
        </button>
      )}
      <fieldset className="mt-5 border-t border-line pt-3">
        <legend className="text-sm font-semibold">Rules the app checks against each farmer&apos;s record</legend>
        <p className="mt-1 text-xs text-muted">Leave a box empty for no rule. Each one filled becomes a rule above, and the app shows for each farmer whether their record meets it.</p>
        {v.packages.length > 1 && (
          <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Rules for">
            {scopes.map((k) => (
              <button key={k} type="button" aria-pressed={scope === k} onClick={() => setScope(k)} className={scope === k ? primaryBtn : quietBtn}>
                {k ? `${v.packages.find((p) => p.key === k)?.name} package` : "All farmers"}
              </button>
            ))}
          </div>
        )}
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <label className="block text-sm">
            Smallest plot (hectares)
            <input className={input} inputMode="decimal" value={d.min} onChange={(e) => put({ min: e.target.value })} />
          </label>
          <label className="block text-sm">
            Largest plot (hectares)
            <input className={input} inputMode="decimal" value={d.max} onChange={(e) => put({ max: e.target.value })} />
          </label>
          <label className="block text-sm">
            Villages (separate with commas)
            <input className={input} value={d.villages} maxLength={2000} onChange={(e) => put({ villages: e.target.value })} />
          </label>
          <label className="block text-sm">
            Grows now (separate with commas)
            <input className={input} value={d.crops} maxLength={500} onChange={(e) => put({ crops: e.target.value })} />
          </label>
          <label className="block text-sm">
            Contribution (% of the package&apos;s value)
            <input className={input} inputMode="decimal" value={d.rate} onChange={(e) => put({ rate: e.target.value })} />
          </label>
          <label className="block text-sm">
            Contribution for women (%, if different)
            <input className={input} inputMode="decimal" value={d.women} disabled={!d.rate.trim()} onChange={(e) => put({ women: e.target.value })} />
          </label>
        </div>
      </fieldset>
      <label className="mt-4 block text-sm">
        How people heard they could apply
        <textarea className={input} rows={2} value={outreach} maxLength={1000} placeholder="For example: announced at the community meeting in each village and through the farmer association, with two weeks to apply" onChange={(e) => setOutreach(e.target.value)} />
        <span className="mt-1 block text-xs text-muted">An open call is the answer to &ldquo;only friends of the staff were told&rdquo;.</span>
      </label>
      {decided > 0 && (
        <label className="mt-4 block text-sm">
          Why the rules are changing ({decided} {decided === 1 ? "farmer is" : "farmers are"} already decided; their decisions stay as recorded)
          <input className={input} value={reason} maxLength={600} onChange={(e) => setReason(e.target.value)} />
        </label>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        {/* A greyed button says what it is waiting for (the examples above are only placeholders). */}
        {(!anyRule || outreach.trim().length < 10 || badNumber) && (
          <p className="w-full text-sm text-muted">{badNumber ? "A plot size or contribution is not a number" : !anyRule ? "Write at least one rule" : "Say how people heard they could apply"} to save. The grey text is only an example.</p>
        )}
        <button type="submit" className={primaryBtn} disabled={!anyRule || outreach.trim().length < 10 || badNumber}>
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
  // A first decision starts with the rules the record shows are met already ticked (MF-12).
  const [met, setMet] = useState<string[]>(d && !isStale(s, d) ? d.met : s.criteria.filter((c) => f.checks[c.id]?.ok === true).map((c) => c.id));
  const [reason, setReason] = useState("");
  const [change, setChange] = useState("");
  const all = s.criteria.every((c) => met.includes(c.id));
  const ask = (outcome: Outcome) => ({ farmer: f.id, outcome, met, reason, change });
  const send = (outcome: Outcome) => void act({ action: "decide", ...ask(outcome) }).then(onClose, () => undefined);
  return (
    <div className="border-t border-line bg-surface px-2 py-3 ps-11">
      <p className="text-sm font-semibold">Tick each rule this farmer meets</p>
      <ul className="mt-1">
        {s.criteria.map((c) => (
          <li key={c.id}>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1.5 text-sm hover:bg-ochre-soft">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0" checked={met.includes(c.id)} disabled={f.checks[c.id]?.ok === false} onChange={(e) => setMet(e.target.checked ? [...met, c.id] : met.filter((x) => x !== c.id))} />
              <span>
                {c.text}
                {f.checks[c.id] && (
                  <span className={`block text-xs ${f.checks[c.id].ok === false ? "font-semibold text-clay" : "text-muted"}`}>
                    {f.checks[c.id].ok === false ? "Not met. " : ""}
                    {f.checks[c.id].detail}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <label className="mt-2 block text-sm">
        Reason {all ? "(needed to waitlist: for example, the places are full)" : "(needed: not every rule is met. Say which, and why)"}
        <textarea className={input} rows={2} value={reason} maxLength={1000} onChange={(e) => setReason(e.target.value)} />
      </label>
      {d && (
        <label className="mt-2 block text-sm">
          Why the decision is changing (needed; the earlier decision and its reason are kept)
          <textarea className={input} rows={2} value={change} maxLength={600} onChange={(e) => setChange(e.target.value)} />
        </label>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={primaryBtn} disabled={!!decisionProblem(s, ask("selected"))} onClick={() => send("selected")}>
          {all ? "Select" : "Select as an exception"}
        </button>
        {all ? (
          <button type="button" className={quietBtn} disabled={!!decisionProblem(s, ask("waitlisted"))} onClick={() => send("waitlisted")}>
            Waitlist
          </button>
        ) : (
          <button type="button" className={quietBtn} disabled={!!decisionProblem(s, ask("not_qualified"))} onClick={() => send("not_qualified")}>
            Did not qualify
          </button>
        )}
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="mt-2 text-xs text-muted">{all ? "Meets every rule: select them, or waitlist them if there is no place now." : "Not every rule is ticked: they did not qualify, unless you select them as an exception."}</p>
    </div>
  );
}

/** The lists on the page, in order. "not_selected" holds older decisions that could not be placed (lib/selection outcomeOf). */
const GROUPS: { key: Shown | "undecided"; title: string; empty: string; tone: string }[] = [
  { key: "undecided", title: "To decide", empty: "Everyone on the list is decided.", tone: "border-ochre" },
  { key: "selected", title: "Selected", empty: "No one selected yet.", tone: "border-leaf" },
  { key: "waitlisted", title: "Waitlisted", empty: "No one waitlisted.", tone: "border-ochre" },
  { key: "not_qualified", title: "Did not qualify", empty: "No one turned down.", tone: "border-clay" },
  { key: "not_selected", title: "Not selected (decided before waitlists)", empty: "", tone: "border-line" },
];

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
  const farmers = v ? [...v.farmers].sort((a, b) => a.id.localeCompare(b.id)) : [];
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">{project.name}</p>
        <h1 className="mt-1 font-display text-4xl tracking-tight">Farmer selection</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          The written rule for who takes part, then for each farmer the decision, the reason and who made it. Selected farmers are trained and served in{" "}
          <Link href="/field" className="font-semibold text-forest underline">
            Field activities
          </Link>
          ; waitlisted farmers and those who did not qualify are not.
        </p>
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
                <dl className="mt-8 grid grid-cols-2 border-t-2 border-ink sm:grid-cols-5">
                  {(
                    [
                      ["On the list", c.total, ""],
                      ["Selected", c.selected, "text-leaf"],
                      ["Waitlisted", c.waitlisted, ""],
                      ["Did not qualify", c.notQualified, ""],
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
                  {c.notSelected ? ` · ${c.notSelected} not selected before waitlists` : ""}
                </p>

                {v.farmers.length === 0 ? (
                  <p className="mt-6 border-s-[6px] border-ochre bg-ochre-soft px-3 py-3 text-sm">
                    No farmers on this project&rsquo;s list yet. Load the farmer list in{" "}
                    <Link href="/field" className="font-semibold text-forest underline">
                      Field activities
                    </Link>
                    , then decide each one here.
                  </p>
                ) : (
                  GROUPS.map((g) => {
                    const rows = farmers.filter((f) => (s.decisions[f.id] ? outcomeOf(s, s.decisions[f.id]) : "undecided") === g.key);
                    if (!rows.length && g.key === "not_selected") return null;
                    return (
                      <section key={g.key} className="mt-8" aria-labelledby={`list-${g.key}`}>
                        <h2 id={`list-${g.key}`} className={`border-s-[6px] ${g.tone} ps-2 font-ledger text-lg font-bold leading-tight`}>
                          {g.title} <span className="font-mono text-sm font-normal text-muted">{rows.length}</span>
                        </h2>
                        {g.key === "not_selected" && <p className="mt-1 text-xs text-muted">Recorded before the app kept waitlists. Decide again to move each one to Waitlisted or Did not qualify.</p>}
                        {!rows.length ? (
                          <p className="mt-2 text-sm text-muted">{g.empty}</p>
                        ) : (
                          <ol className="mt-2 border-t-2 border-ink">
                            {rows.map((f, k) => {
                              const d = s.decisions[f.id];
                              const o = d ? outcomeOf(s, d) : null;
                              const stale = d ? isStale(s, d) : false;
                              const exception = d ? isException(s, d) : false;
                              const failed = d && o === "not_qualified" ? failedRules(s, d) : [];
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
                                    <span className={`shrink-0 px-2 py-0.5 font-mono text-xs uppercase ${!o ? "bg-ochre text-ink" : o === "selected" ? "text-leaf" : o === "waitlisted" ? "text-warn" : "text-muted"}`}>
                                      {!o ? "To decide" : o === "selected" && exception ? "Selected, exception" : outcomeLabel[o]}
                                    </span>
                                    {v.can.decide && open !== f.id && (
                                      <button type="button" className={quietBtn} onClick={() => setOpen(f.id)}>
                                        {!d ? "Decide" : o === "waitlisted" ? "Select from waitlist" : "Decide again"}
                                      </button>
                                    )}
                                  </div>
                                  {d && (
                                    <p className="px-2 pb-3 ps-11 text-xs text-muted">
                                      {d.byName}, {d.on} · {stale && d.of === undefined ? `${d.met.length} rules met` : `${d.met.length} of ${d.of ?? s.criteria.length} rules met`}
                                      {failed.length ? ` · not met: ${failed.map((c) => c.text).join("; ")}` : ""}
                                      {d.reason ? ` · ${d.reason}` : ""}
                                      {stale ? " · decided under an earlier version of the rules" : ""}
                                      {d.earlier?.length ? ` · changed ${d.earlier.length === 1 ? "once" : `${d.earlier.length} times`}, last because: ${d.earlier[d.earlier.length - 1].why}` : ""}
                                    </p>
                                  )}
                                  {open === f.id && <Decide v={v} f={f} act={act} onClose={() => setOpen(null)} />}
                                </li>
                              );
                            })}
                          </ol>
                        )}
                      </section>
                    );
                  })
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
