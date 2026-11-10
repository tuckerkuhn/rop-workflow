"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProofNumber } from "@/components/progress/proof-panel";
import { quarterRange } from "@/lib/results";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { SelfConfirmSheet, useSolo } from "@/components/app/self-confirm";
import { Pill, SectionLabel, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { userById } from "@/lib/demo";
import { describeChange, lastMonth, quartersLabel, type Change, type ChangeInput, type ReviewAction } from "@/lib/monthly-review";
import { STATUS_LABEL, type Status } from "@/lib/qpr";
import type { ReviewView } from "@/server/monthly-review-store";

/**
 * The monthly project review: results against targets and the workplan, money against the
 * budget, open items, a summary, and changes to the plan that apply only once another reviewer
 * approves them. Closed with a sign-off; every step is in the audit trail.
 */

const TONE: Record<Status, "forest" | "sky" | "ochre" | "clay" | "muted"> = { completed: "forest", on_track: "sky", delayed: "ochre", not_implemented: "clay", not_started: "muted" };
const field = "mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm";
const money = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("en-US"));
const who = (id?: string) => (id ? (userById(id)?.name ?? id) : "");
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");

export function ReviewPage() {
  const { t } = useT();
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const solo = useSolo(project.saved ? project.id : null, user?.id);
  const [month, setMonth] = useState(() => lastMonth(new Date().toISOString().slice(0, 10)));
  const [v, setV] = useState<ReviewView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const url = `/api/projects/${project.id}/review?month=${month}`;

  const load = useCallback(async () => {
    if (!user || !project.saved) return;
    try {
      const r = await fetch(url, { cache: "no-store", headers: { "x-demo-user": user.id } });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Could not load the review.");
      setV(d);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, project.saved, url]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (a: ReviewAction) => {
    if (!user) return false;
    setBusy(true);
    try {
      const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", "x-demo-user": user.id }, body: JSON.stringify(a) });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Not saved.");
      setV(d);
      setError("");
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!user) return null;
  const indName = (code: string) => {
    const i = v?.indicators.find((x) => x.code === code);
    return i ? `${i.donorCode} ${i.name}` : code;
  };
  const proposed = v?.review.changes.filter((c) => c.status === "proposed").length ?? 0;

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end gap-4">
          <h1 className="flex-1 font-display text-4xl tracking-tight">Monthly review</h1>
          <label className="text-sm">
            Month
            <input type="month" className={field} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
          </label>
        </div>
        {!project.saved ? (
          <p className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">This demo project is kept in this browser only; its monthly review is on the project page.</p>
        ) : (
          <>
            {error && (
              <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
                {error}
              </p>
            )}
            {v && (
              <>
                <p className="mt-1 text-sm text-muted">
                  {v.project.name} · {v.project.stage} ·{" "}
                  {v.review.signedOff ? (
                    <span className="font-semibold text-forest">
                      Signed off by {who(v.review.signedOff.by)} on {day(v.review.signedOff.at)}
                    </span>
                  ) : (
                    "Not signed off yet"
                  )}
                </p>

                <section className="mt-6">
                  <SectionLabel>Results against targets ({v.year}, to the end of {v.quarter.replace("-", " ")})</SectionLabel>
                  <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-surface">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead className="text-xs uppercase tracking-[0.12em] text-muted">
                        <tr>
                          <th className="px-4 py-2 text-start font-semibold">{t("pw.target")}</th>
                          <th className="px-3 py-2 text-end font-semibold">This year</th>
                          <th className="px-3 py-2 text-start font-semibold">Status</th>
                          <th className="px-4 py-2 text-start font-semibold">Workplan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {v.indicators.map((i) => (
                          <tr key={i.code}>
                            <td className="px-4 py-2">
                              <span className="font-mono text-xs text-muted">{i.donorCode}</span> {i.name}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 text-end tabular-nums">
                              <ProofNumber project={project.id} user={user?.id ?? ""} indicator={i.code} from={`${v.year}-01-01`} to={quarterRange(v.quarter).to} value={i.year} records={i.year ? 1 : 0} className="tabular-nums">
                                {i.year.toLocaleString("en-US")}
                              </ProofNumber>{" "}
                              / {i.yearTarget.toLocaleString("en-US")} {i.unit}
                            </td>
                            <td className="px-3 py-2">
                              <Pill tone={TONE[i.status]}>{STATUS_LABEL[i.status]}</Pill>
                            </td>
                            <td className="px-4 py-2 text-xs text-muted">{i.planned === null ? "Not linked" : i.planned.length ? i.planned.map((q) => `Q${q}`).join(", ") : `Not in ${v.year}`}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section className="mt-6 grid gap-4 md:grid-cols-2">
                  <div className="rounded-2xl border border-line bg-surface p-4 text-sm">
                    <SectionLabel>Money</SectionLabel>
                    {v.budget.period ? (
                      <>
                        <p className="mt-2">
                          Spent {money(v.budget.totals.spent)} of {money(v.budget.totals.approved)} {v.budget.currency} approved ({v.budget.totals.approved ? Math.round((v.budget.totals.spent / v.budget.totals.approved) * 100) : 0}%) with{" "}
                          {v.budget.timeGone === null ? "—" : `${Math.round(v.budget.timeGone * 100)}%`} of the time gone, to {v.budget.period.to}. Forecast at completion {money(v.budget.totals.forecast)}.
                        </p>
                        <p className="mt-2">
                          {v.budget.flagged.length} budget {v.budget.flagged.length === 1 ? "line needs" : "lines need"} a look.{" "}
                          <Link href="/progress/budget" className="font-semibold text-forest hover:underline">
                            Budget vs actual
                          </Link>
                        </p>
                      </>
                    ) : (
                      <p className="mt-2 text-muted">No spending imported for this phase yet.</p>
                    )}
                  </div>
                  <div className="rounded-2xl border border-line bg-surface p-4 text-sm">
                    <SectionLabel>Open items</SectionLabel>
                    <p className="mt-2">
                      {v.open.pending} {v.open.pending === 1 ? "result is" : "results are"} waiting for MEL to accept, and {v.open.queried} {v.open.queried === 1 ? "has" : "have"} been queried.{" "}
                      <Link href="/progress/results" className="font-semibold text-forest hover:underline">
                        Results and proof
                      </Link>
                    </p>
                    <p className="mt-2">{proposed ? `${proposed} proposed ${proposed === 1 ? "change is" : "changes are"} waiting for a decision.` : "No changes waiting for a decision."}</p>
                  </div>
                </section>

                {v.mayEdit && (
                  <div className="mt-6 flex flex-wrap items-center gap-3">
                    <button type="button" className={quietBtn} disabled={busy} onClick={() => {
                      // A draft replaces both notes: ask first when someone has already written them.
                      if ((v.review.summary?.text.trim() || v.review.attention?.text.trim()) && !window.confirm("Replace the summary and the needs-attention note with a new draft? What is written now will be lost.")) return;
                      void act({ action: "draft" });
                    }}>
                      {busy ? "Working…" : v.review.summary ? "Redraft summary and needs attention with AI" : "Draft summary and needs attention with AI"}
                    </button>
                    <span className="text-xs text-muted">AI writes from the figures on this page only; read and correct it before signing off.</span>
                  </div>
                )}
                <section className="mt-3 grid gap-4 md:grid-cols-2">
                  <Note label="Summary" hint="Where the project stands this month, in a few sentences." value={v.review.summary} editable={v.mayEdit} busy={busy} onSave={(text) => act({ action: "summary", text })} />
                  <Note label="Needs attention" hint="Risks, late work and decisions needed, and who acts on each." value={v.review.attention} editable={v.mayEdit} busy={busy} onSave={(text) => act({ action: "attention", text })} />
                </section>

                <section className="mt-6">
                  <SectionLabel>Changes to the plan</SectionLabel>
                  <p className="mt-1 text-sm text-muted">A change applies to the plan only when a reviewer who did not propose it approves it.</p>
                  {v.review.changes.length === 0 ? (
                    <p className="mt-2 text-sm text-muted">None proposed this month.</p>
                  ) : (
                    <ul className="mt-2 space-y-2">
                      {v.review.changes.map((c) => (
                        <ChangeItem key={c.id} c={c} me={v.me} mayDecide={v.mayDecide} solo={solo} busy={busy} label={describeChange(c, { indicator: indName })} act={act} />
                      ))}
                    </ul>
                  )}
                  {v.mayEdit && <Propose v={v} busy={busy} act={act} />}
                </section>

                {v.mayDecide && !v.review.signedOff && (
                  <section className="mt-8 border-t border-line pt-4">
                    <button type="button" className={primaryBtn} disabled={busy || proposed > 0} onClick={() => void act({ action: "signoff" })}>
                      Sign off the {month} review
                    </button>
                    {proposed > 0 && <p className="mt-2 text-xs text-muted">Decide or withdraw the proposed changes first.</p>}
                  </section>
                )}
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function Note({ label, hint, value, editable, busy, onSave }: { label: string; hint: string; value?: { text: string; by: string; at: string; drafted?: boolean }; editable: boolean; busy: boolean; onSave: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState(value?.text ?? "");
  const [editing, setEditing] = useState(false);
  useEffect(() => setText(value?.text ?? ""), [value?.text]);
  return (
    <div className="rounded-2xl border border-line bg-surface p-4 text-sm">
      <SectionLabel>{label}</SectionLabel>
      {editing ? (
        <>
          <textarea className={field} rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder={hint} />
          <div className="mt-2 flex gap-2">
            <button type="button" className={primaryBtn} disabled={busy} onClick={() => void onSave(text).then((ok) => ok && setEditing(false))}>
              Save
            </button>
            <button type="button" className={quietBtn} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </>
      ) : (
        <>
          <p className={`mt-2 whitespace-pre-line ${value ? "" : "text-muted"}`}>{value?.text ?? hint}</p>
          {value && (
            <p className="mt-1 text-xs text-muted">
              {value.drafted ? `AI draft for ${who(value.by)}, ${day(value.at)}: check it` : `${who(value.by)}, ${day(value.at)}`}
            </p>
          )}
          {editable && (
            <button type="button" className={`${quietBtn} mt-2 py-1.5`} onClick={() => setEditing(true)}>
              {value ? "Edit" : "Write"}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function ChangeItem({ c, me, mayDecide, solo, busy, label, act }: { c: Change; me: string; mayDecide: boolean; solo: boolean; busy: boolean; label: string; act: (a: ReviewAction) => Promise<boolean> }) {
  const { t } = useT();
  const [note, setNote] = useState("");
  const [selfing, setSelfing] = useState(false);
  const tone = c.status === "approved" ? "forest" : c.status === "rejected" ? "clay" : "ochre";
  return (
    <li className="rounded-xl border border-line bg-paper p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={tone}>{c.status === "approved" ? "Approved and applied" : c.status === "rejected" ? "Rejected" : "Proposed"}</Pill>
        <span className="font-semibold">{label}</span>
      </div>
      <p className="mt-1">{c.reason}</p>
      <p className="mt-1 text-xs text-muted">
        Proposed by {who(c.proposedBy)} on {day(c.proposedAt)}
        {c.decidedBy && ` · ${c.status} by ${who(c.decidedBy)} on ${day(c.decidedAt)}`}
        {c.note && ` · “${c.note}”`}
      </p>
      {c.status === "proposed" && mayDecide && c.proposedBy !== me && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input className="min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 py-1.5 text-sm" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Decision note" />
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void act({ action: "decide", id: c.id, decision: "approve", note: note.trim() || undefined })}>
            Approve and apply
          </button>
          <button type="button" className={quietBtn} disabled={busy} onClick={() => void act({ action: "decide", id: c.id, decision: "reject", note: note.trim() || undefined })}>
            Reject
          </button>
        </div>
      )}
      {c.status === "proposed" && c.proposedBy === me && (
        <div className="mt-2 flex flex-wrap gap-2">
          {/* Solo mode (server/solo.ts): a small team's reviewer approves their own change, confirming it. */}
          {mayDecide && solo && (
            <button type="button" className={`${primaryBtn} min-h-12`} disabled={busy} onClick={() => setSelfing(true)}>
              Approve and apply
            </button>
          )}
          <button type="button" className={`${quietBtn} py-1`} disabled={busy} onClick={() => void act({ action: "withdraw", id: c.id })}>
            Withdraw
          </button>
        </div>
      )}
      {selfing && (
        <SelfConfirmSheet
          what={label}
          onCancel={() => setSelfing(false)}
          onConfirm={async (self) => {
            await act({ action: "decide", id: c.id, decision: "approve", self });
            setSelfing(false);
          }}
        />
      )}
      {c.status === "approved" && c.selfApproved && <p className="mt-1 text-xs font-semibold text-ochre">{t("so.self")}</p>}
    </li>
  );
}

function Propose({ v, busy, act }: { v: ReviewView; busy: boolean; act: (a: ReviewAction) => Promise<boolean> }) {
  const [kind, setKind] = useState<ChangeInput["kind"] | null>(null);
  const [indicator, setIndicator] = useState(v.indicators[0]?.code ?? "");
  const [to, setTo] = useState("");
  const [fromLine, setFromLine] = useState(v.lines[0]?.code ?? "");
  const [toLine, setToLine] = useState(v.lines[1]?.code ?? "");
  const [amount, setAmount] = useState("");
  const [activity, setActivity] = useState(v.activities[0]?.code ?? "");
  const act0 = v.activities.find((a) => a.code === activity);
  const [quarters, setQuarters] = useState<string[]>(act0?.quarters ?? []);
  const [reason, setReason] = useState("");
  useEffect(() => setQuarters(v.activities.find((a) => a.code === activity)?.quarters ?? []), [activity, v.activities]);

  const y = Number(v.year);
  const qs = [y, y + 1].flatMap((yr) => ["01", "04", "07", "10"].map((m) => `${yr}-${m}-01`));
  const ind = v.indicators.find((i) => i.code === indicator);
  const line = (c: string) => v.lines.find((l) => l.code === c);

  const submit = async () => {
    if (!kind) return;
    const change: ChangeInput =
      kind === "target" ? { kind, indicator, year: v.year, to: Number(to), reason } : kind === "budget" ? { kind, fromLine, toLine, amount: Number(amount), reason } : { kind, activity, quarters, reason };
    if (await act({ action: "propose", change })) {
      setKind(null);
      setTo("");
      setAmount("");
      setReason("");
    }
  };

  if (!kind)
    return (
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={quietBtn} onClick={() => setKind("target")}>
          + Adjust a target
        </button>
        <button type="button" className={quietBtn} onClick={() => setKind("budget")}>
          + Move budget
        </button>
        <button type="button" className={quietBtn} onClick={() => setKind("workplan")}>
          + Re-plan an activity
        </button>
      </div>
    );

  return (
    <div className="mt-3 rounded-2xl border border-line bg-surface p-4 text-sm">
      <p className="font-semibold">{kind === "target" ? "Adjust a target" : kind === "budget" ? "Move budget between lines" : "Re-plan an activity"}</p>
      {kind === "target" && (
        <div className="mt-2 grid gap-3 sm:grid-cols-[2fr_1fr]">
          <label>
            Indicator
            <select className={field} value={indicator} onChange={(e) => setIndicator(e.target.value)}>
              {v.indicators.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.donorCode} {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            {v.year} target (now {ind?.yearTarget.toLocaleString("en-US")} {ind?.unit})
            <input className={field} type="number" min={0} value={to} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
      )}
      {kind === "budget" && (
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["From line", fromLine, setFromLine],
              ["To line", toLine, setToLine],
            ] as const
          ).map(([lab, val, set]) => (
            <label key={lab}>
              {lab}
              <select className={field} value={val} onChange={(e) => set(e.target.value)}>
                {v.lines.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code} {l.description.slice(0, 50)}
                  </option>
                ))}
              </select>
              <span className="mt-1 block text-xs text-muted">
                Budget {money(line(val)?.amount ?? null)}, spent {money(line(val)?.spent ?? 0)} {line(val)?.currency}
              </span>
            </label>
          ))}
          <label>
            Amount
            <input className={field} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
          </label>
        </div>
      )}
      {kind === "workplan" && (
        <div className="mt-2">
          <label>
            Activity
            <select className={field} value={activity} onChange={(e) => setActivity(e.target.value)}>
              {v.activities.map((a) => (
                <option key={a.code} value={a.code}>
                  {a.code} {a.title.slice(0, 70)}
                </option>
              ))}
            </select>
          </label>
          <p className="mt-2 text-xs text-muted">Now: {quartersLabel(act0?.quarters ?? [])}. Choose the quarters it should run in:</p>
          <div className="mt-1 flex flex-wrap gap-2">
            {qs.map((q) => (
              <label key={q} className="flex items-center gap-1 rounded-lg border border-line px-2 py-1 text-xs">
                <input type="checkbox" checked={quarters.includes(q)} onChange={(e) => setQuarters(e.target.checked ? [...quarters, q] : quarters.filter((x) => x !== q))} />
                {quartersLabel([q])}
              </label>
            ))}
          </div>
        </div>
      )}
      <label className="mt-3 block">
        Why
        <textarea className={field} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Transport costs doubled after the Iran route closed; the saving on community sheds covers it." />
      </label>
      <div className="mt-3 flex gap-2">
        <button type="button" className={primaryBtn} disabled={busy} onClick={() => void submit()}>
          Propose
        </button>
        <button type="button" className={quietBtn} onClick={() => setKind(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
