"use client";

import { Why } from "@/components/app/why";
import { PlaceTabs, REVIEW_TABS } from "@/components/progress/report-checks";
import { askConfirm } from "@/components/app/dialogs";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ProofNumber } from "@/components/progress/proof-panel";
import { quarterRange } from "@/lib/results";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { SelfConfirmSheet, useSolo } from "@/components/app/self-confirm";
import { TopBar, primaryBtn, quietBtn, Loading, StatusPill } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
import { userById } from "@/lib/demo";
import { describeChange, lastMonth, quartersLabel, type Change, type ChangeInput, type ReviewAction } from "@/lib/monthly-review";
import { targetStatus } from "@/lib/target-status";
import type { ReviewView } from "@/server/monthly-review-store";

/**
 * The monthly project review: results against targets and the workplan, money against the
 * budget, open items, a summary, and changes to the plan that apply only once another reviewer
 * approves them. Closed with a sign-off; every step is in the audit trail.
 */

const field = "mt-1 min-h-11 w-full border border-line bg-paper px-3 py-2 text-sm focus:border-forest focus:outline-none";
// A date or a figure inside a line of small text: mono, lined up.
const mono = "font-mono tabular-nums";
// Ruled rows: a change to the plan, its status first; a target, this year, its status and the workplan.
const CHANGE = "minmax(0,1fr)";
const TARGET = "minmax(0,2fr) 11rem minmax(0,1.4fr) 7rem";
const money = (n: number | null) => (n === null ? "—" : Math.round(n).toLocaleString("en-US"));
const who = (id?: string) => (id ? (userById(id)?.name ?? id) : "");
const day = (iso?: string) => (iso ? iso.slice(0, 10) : "");

export function ReviewPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const solo = useSolo(project.saved ? project.id : null, user?.id);
  const [month, setMonth] = useState(() => lastMonth(new Date().toISOString().slice(0, 10)));
  const [v, setV] = useState<ReviewView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { tx } = useT();
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
  // The one change to settle first: the first still waiting for a decision.
  const nextChange = v?.review.changes.find((c) => c.status === "proposed");

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <PlaceTabs label="Monthly review" here="/progress/review" tabs={REVIEW_TABS} />
        <div className="mt-5">
          <PageHead
            kicker={project.name}
            title="Monthly review"
            actions={
              <label className="text-sm">
                <span className="font-mono text-xs text-muted">Month</span>
                <input type="month" className={`${field} font-mono`} value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} />
              </label>
            }
          >
            {project.saved && v && (
              <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{v.project.stage} ·</span>
                {v.review.signedOff ? (
                  <StatusBlock tone="forest">
                    Signed off by {who(v.review.signedOff.by)} on <span className={mono}>{day(v.review.signedOff.at)}</span>
                  </StatusBlock>
                ) : (
                  <StatusBlock tone="ochre">Not signed off yet</StatusBlock>
                )}
              </span>
            )}
          </PageHead>
        </div>
        <Why>A monthly look at results and money, with decisions written down, shows a donor the project is managed and not only reported. It is also where a problem is still cheap to fix.</Why>
        {!project.saved ? (
          <p className="mt-6 bg-sunken px-4 py-3 text-sm text-muted">This demo project is kept in this browser only; its monthly review is on the project page.</p>
        ) : (
          <>
            {error && (
              <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
                {error}
              </p>
            )}
            {!v && !error && <Loading className="mt-6" />}
            {v && (
              <>
                <section>
                  <SectionHead>
                    Results against targets (<span className={mono}>{v.year}</span>, to the end of <span className={mono}>{v.quarter.replace("-", " ")}</span>)
                  </SectionHead>
                  <TargetRows v={v} project={project.id} user={user?.id ?? ""} />
                </section>

                <section className="mt-8 grid gap-x-8 gap-y-8 md:grid-cols-2">
                  <div className="text-sm">
                    <SectionHead className="">Money</SectionHead>
                    <Sheet className="mt-3">
                      {v.budget.period ? (
                        <>
                          <p>
                            Spent <Fig>{money(v.budget.totals.spent)}</Fig> of <Fig>{money(v.budget.totals.approved)}</Fig> {v.budget.currency} approved (
                            <Fig>{v.budget.totals.approved ? Math.round((v.budget.totals.spent / v.budget.totals.approved) * 100) : 0}%</Fig>) with{" "}
                            <Fig>{v.budget.timeGone === null ? "—" : `${Math.round(v.budget.timeGone * 100)}%`}</Fig> of the time gone, to <Fig>{v.budget.period.to}</Fig>. Expected total at the end{" "}
                            <Fig>{money(v.budget.totals.forecast)}</Fig>.
                          </p>
                          <p className="mt-2">
                            <Fig>{v.budget.flagged.length}</Fig> budget {v.budget.flagged.length === 1 ? "line needs" : "lines need"} a look.{" "}
                            <Link href="/progress/budget" className="inline-flex min-h-11 items-center font-semibold text-forest hover:underline">
                              Budget vs actual
                            </Link>
                          </p>
                        </>
                      ) : (
                        <p className="text-muted">
                          No spending imported for this phase yet. Finance imports it on{" "}
                          <Link href="/progress/budget" className="font-semibold text-forest hover:underline">
                            Budget
                          </Link>
                          .
                        </p>
                      )}
                    </Sheet>
                  </div>
                  <div className="text-sm">
                    <SectionHead className="">Open items</SectionHead>
                    <Sheet className="mt-3">
                      <p>
                        <Fig>{v.open.pending}</Fig> {v.open.pending === 1 ? "result is" : "results are"} waiting for monitoring, evaluation and learning (MEL) to accept, and <Fig>{v.open.queried}</Fig> {v.open.queried === 1 ? "has" : "have"} been sent back with a question.{" "}
                        <Link href="/progress/results" className="inline-flex min-h-11 items-center font-semibold text-forest hover:underline">
                          Results and proof
                        </Link>
                      </p>
                      <p className="mt-2">{proposed ? `${proposed} proposed ${proposed === 1 ? "change is" : "changes are"} waiting for a decision.` : "No changes waiting for a decision."}</p>
                    </Sheet>
                  </div>
                </section>

                {v.mayEdit && (
                  <div className="mt-8 flex flex-wrap items-center gap-3">
                    <button type="button" className={quietBtn} disabled={busy} onClick={async () => {
                      // A draft replaces both notes: ask first when someone has already written them.
                      if ((v.review.summary?.text.trim() || v.review.attention?.text.trim()) && !(await askConfirm({ message: "Replace the summary and the needs-attention note with a new draft? What is written now will be lost.", confirm: "Replace with a draft" }))) return;
                      void act({ action: "draft" });
                    }}>
                      {busy ? "Working…" : v.review.summary ? "Redraft summary and needs attention with AI" : "Draft summary and needs attention with AI"}
                    </button>
                    <span className="text-xs text-muted">AI writes from the figures on this page only; read and correct it before signing off.</span>
                  </div>
                )}
                <section className={`${v.mayEdit ? "mt-2" : "mt-8"} grid gap-x-8 gap-y-8 md:grid-cols-2`}>
                  <Note label="Summary" hint="Where the project stands this month, in a few sentences." value={v.review.summary} editable={v.mayEdit} busy={busy} onSave={(text) => act({ action: "summary", text })} />
                  <Note label="Needs attention" hint="Risks, late work and decisions needed, and who acts on each." value={v.review.attention} editable={v.mayEdit} busy={busy} onSave={(text) => act({ action: "attention", text })} />
                </section>

                <section className="mt-10">
                  <SectionHead className="">Changes to the plan</SectionHead>
                  <p className="mt-1 text-sm text-muted">A change applies to the plan only when a reviewer who did not propose it approves it.</p>
                  {v.review.changes.length === 0 ? (
                    <Empty>None proposed this month.</Empty>
                  ) : (
                    <>
                      <LedgerTable cols={`2.25rem ${CHANGE}`} head={["#", tx("Change")]} label="Changes to the plan">
                        {v.review.changes.map((c, i) => (
                          <ChangeItem key={c.id} n={i + 1} first={nextChange?.id === c.id} c={c} me={v.me} mayDecide={v.mayDecide} solo={solo} busy={busy} label={describeChange(c, { indicator: indName })} act={act} />
                        ))}
                      </LedgerTable>
                      {nextChange && <p className="mt-2 text-xs text-muted">{tx("The shaded change is the first one waiting for a decision.")}</p>}
                    </>
                  )}
                  {v.mayEdit && <Propose v={v} busy={busy} act={act} />}
                </section>

                {v.mayDecide && !v.review.signedOff && (
                  <Sheet className="mt-10">
                    <button type="button" className={primaryBtn} disabled={busy || proposed > 0} onClick={() => void act({ action: "signoff" })}>
                      Sign off the <span className={mono}>{month}</span> review
                    </button>
                    {proposed > 0 && <p className="mt-2 text-xs text-muted">Decide or withdraw the proposed changes first.</p>}
                  </Sheet>
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
    <div className="text-sm">
      <SectionHead className="">{label}</SectionHead>
      <Sheet className="mt-3">
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
          <p className={`whitespace-pre-line ${value ? "" : "text-muted"}`}>{value?.text ?? hint}</p>
          {value && (
            <p className="mt-1 text-xs text-muted">
              {value.drafted ? (
                <>
                  AI draft for {who(value.by)}, <span className={mono}>{day(value.at)}</span>: check it
                </>
              ) : (
                <>
                  {who(value.by)}, <span className={mono}>{day(value.at)}</span>
                </>
              )}
            </p>
          )}
          {editable && (
            <button type="button" className={`${quietBtn} mt-3`} onClick={() => setEditing(true)}>
              {value ? "Edit" : "Write"}
            </button>
          )}
        </>
      )}
      </Sheet>
    </div>
  );
}

function ChangeItem({ n, first, c, me, mayDecide, solo, busy, label, act }: { n: number; first: boolean; c: Change; me: string; mayDecide: boolean; solo: boolean; busy: boolean; label: string; act: (a: ReviewAction) => Promise<boolean> }) {
  const { t } = useT();
  const [note, setNote] = useState("");
  const [selfing, setSelfing] = useState(false);
  const tone = c.status === "approved" ? "forest" : c.status === "rejected" ? "clay" : "ochre";
  return (
    <LedgerRow cols={CHANGE} n={n} first={first} className="text-sm">
      <span className="min-w-0">
        <span className="flex flex-wrap items-center gap-2">
          <StatusBlock tone={tone}>{c.status === "approved" ? "Approved and applied" : c.status === "rejected" ? "Rejected" : "Proposed"}</StatusBlock>
          <span className="font-semibold">{label}</span>
        </span>
        <span className="mt-1 block">{c.reason}</span>
        <span className="mt-1 block text-xs text-muted">
          Proposed by {who(c.proposedBy)} on <span className={mono}>{day(c.proposedAt)}</span>
          {c.decidedBy && (
            <>
              {` · ${c.status} by ${who(c.decidedBy)} on `}
              <span className={mono}>{day(c.decidedAt)}</span>
            </>
          )}
          {c.note && ` · “${c.note}”`}
        </span>
      </span>
      {c.status === "proposed" && mayDecide && c.proposedBy !== me && (
        <div className="col-start-2 flex flex-wrap items-center gap-2">
          <input className="min-h-11 min-w-0 flex-1 border border-line bg-paper px-3 py-1.5 text-sm focus:border-forest focus:outline-none" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" aria-label="Decision note" />
          <button type="button" className={primaryBtn} disabled={busy} onClick={() => void act({ action: "decide", id: c.id, decision: "approve", note: note.trim() || undefined })}>
            Approve and apply
          </button>
          <button type="button" className={quietBtn} disabled={busy} onClick={() => void act({ action: "decide", id: c.id, decision: "reject", note: note.trim() || undefined })}>
            Reject
          </button>
        </div>
      )}
      {c.status === "proposed" && c.proposedBy === me && (
        <div className="col-start-2 flex flex-wrap gap-2">
          {/* Solo mode (server/solo.ts): a small team's reviewer approves their own change, confirming it. */}
          {mayDecide && solo && (
            <button type="button" className={`${primaryBtn} min-h-12`} disabled={busy} onClick={() => setSelfing(true)}>
              Approve and apply
            </button>
          )}
          <button type="button" className={quietBtn} disabled={busy} onClick={() => void act({ action: "withdraw", id: c.id })}>
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
      {c.status === "approved" && c.selfApproved && <p className="col-start-2 text-xs font-semibold text-warn">{t("so.self")}</p>}
    </LedgerRow>
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
      <div className="mt-4 flex flex-wrap gap-2">
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
    <Sheet className="mt-4 text-sm">
      <p className="font-ledger text-lg font-bold">{kind === "target" ? "Adjust a target" : kind === "budget" ? "Move budget between lines" : "Re-plan an activity"}</p>
      {kind === "target" && (
        <div className="mt-2 grid gap-3 sm:grid-cols-[2fr_1fr]">
          <label>
            Target
            <select className={field} value={indicator} onChange={(e) => setIndicator(e.target.value)}>
              {v.indicators.map((i) => (
                <option key={i.code} value={i.code}>
                  {i.donorCode} {i.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className={mono}>{v.year}</span> target (now <span className={mono}>{ind?.yearTarget.toLocaleString("en-US")}</span> {ind?.unit})
            <input className={`${field} font-mono`} type="number" min={0} value={to} onChange={(e) => setTo(e.target.value)} />
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
                Budget <span className={mono}>{money(line(val)?.amount ?? null)}</span>, spent <span className={mono}>{money(line(val)?.spent ?? 0)}</span> {line(val)?.currency}
              </span>
            </label>
          ))}
          <label>
            Amount
            <input className={`${field} font-mono`} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
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
          <p className="mt-2 text-xs text-muted">
            Now: <span className={mono}>{quartersLabel(act0?.quarters ?? [])}</span>. Choose the quarters it should run in:
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {qs.map((q) => (
              <label key={q} className={`flex min-h-11 items-center gap-2 border px-3 font-mono text-xs ${quarters.includes(q) ? "border-forest bg-ochre-soft" : "border-line"}`}>
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
    </Sheet>
  );
}

type Translate = ReturnType<typeof useT>["t"];
type TargetCells = { code: string; name: React.ReactNode; year: React.ReactNode; status: React.ReactNode; plan: string };

/** One target's cells, worked out once and shown either as a table row or as a stacked block on a phone. */
function targetCells(i: ReviewView["indicators"][number], v: ReviewView, project: string, user: string, t: Translate): TargetCells {
  // The one wording for a target's status (lib/target-status), as of the review's quarter.
  const st = targetStatus(i, Number(v.quarter.slice(-1)));
  return {
    code: i.code,
    name: (
      <>
        <span className="font-mono text-xs text-muted">{i.donorCode}</span> {i.name}
      </>
    ),
    year: (
      <>
        <ProofNumber project={project} user={user} indicator={i.code} from={`${v.year}-01-01`} to={quarterRange(v.quarter).to} value={i.year} records={i.year ? 1 : 0} className="tabular-nums">
          {i.year.toLocaleString("en-US")}
        </ProofNumber>{" "}
        / {i.yearTarget.toLocaleString("en-US")} {i.unit}
      </>
    ),
    status: (
      <>
        <StatusPill tone={st.tone}>{t(`prog.w.${st.word}`)}</StatusPill>
        {st.detail && <span className="ms-1 text-xs text-muted">{t(`prog.d.${st.detail}`)}</span>}
      </>
    ),
    plan: i.planned === null ? "Not linked" : i.planned.length ? i.planned.map((q) => `Q${q}`).join(", ") : `Not in ${v.year}`,
  };
}

function TargetCard({ r }: { r: TargetCells }) {
  return (
    <li className="px-3 py-3">
      <h3 className="text-sm">{r.name}</h3>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
        <div className="col-span-2">
          <dt className="font-mono text-xs text-muted">This year</dt>
          <dd className="font-mono tabular-nums">{r.year}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-muted">Status</dt>
          <dd>{r.status}</dd>
        </div>
        <div>
          <dt className="font-mono text-xs text-muted">Workplan</dt>
          <dd className="font-mono text-xs text-muted">{r.plan}</dd>
        </div>
      </dl>
    </li>
  );
}

function TargetTableRow({ r, n }: { r: TargetCells; n: number }) {
  return (
    <LedgerRow cols={TARGET} n={n} className="text-sm">
      <span className="min-w-0">{r.name}</span>
      <Fig className="whitespace-nowrap">{r.year}</Fig>
      <span className="min-w-0">{r.status}</span>
      <span className="font-mono text-xs text-muted">{r.plan}</span>
    </LedgerRow>
  );
}

/**
 * Results against targets: a table on wide screens, stacked blocks on a phone (CSS decides, so
 * printing and the first server render are unaffected). A figure's proof dialog mounts only once
 * it is opened, so the hidden copy never holds one.
 */
function TargetRows({ v, project, user }: { v: ReviewView; project: string; user: string }) {
  const { t } = useT();
  const rows = v.indicators.map((i) => targetCells(i, v, project, user, t));
  return (
    <>
      {/* Below a medium screen: one block per target, stacked, so nothing scrolls sideways on a phone. */}
      <ul aria-label={t("pw.target")} className="mt-3 divide-y divide-line border-y border-ink font-ledger md:hidden">
        {rows.map((r) => (
          <TargetCard key={r.code} r={r} />
        ))}
      </ul>
      <div className="mt-3 hidden overflow-x-auto md:block">
        <LedgerTable cols={`2.25rem ${TARGET}`} head={["#", t("pw.target"), { label: "This year", end: true }, "Status", "Workplan"]} label={t("pw.target")} className="mt-0 min-w-[40rem]">
          {rows.map((r, i) => (
            <TargetTableRow key={r.code} r={r} n={i + 1} />
          ))}
        </LedgerTable>
      </div>
    </>
  );
}
