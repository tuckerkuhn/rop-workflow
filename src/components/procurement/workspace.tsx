"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LogoMark } from "@/components/logo";
import { Tagged } from "@/components/status-tag";
import {
  DONE,
  TODAY,
  blockingIssues,
  budgetLines,
  checkState,
  documentsOf,
  issueHelp,
  issueTypes,
  levelFor,
  lineOf,
  nextStep,
  ownerOf,
  prevStep,
  ready,
  roleLabel,
  roles,
  seedProcurements,
  stages,
  stepById,
  stepsFor,
  valueOf,
  type Check,
  type Issue,
  type Procurement,
  type Role,
} from "@/lib/procurement";

const STORE = "rop-procurement-v1";
const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

/* ---------- small pieces ---------- */

function Pill({ tone, children }: { tone: "forest" | "ochre" | "clay" | "muted" | "sky"; children: React.ReactNode }) {
  const t = {
    forest: "bg-mist text-leaf",
    ochre: "bg-ochre-soft text-ochre",
    clay: "bg-clay-soft text-clay",
    muted: "bg-sunken text-muted",
    sky: "bg-sky-soft text-sky",
  }[tone];
  return <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${t}`}>{children}</span>;
}

function Tracker({ p }: { p: Procurement }) {
  const current = p.step === DONE ? stages.length : stepById[p.step].stage;
  const gates: Record<number, string> = {};
  stepsFor(p).forEach((s) => s.gate && (gates[s.stage] = gates[s.stage] ? `${gates[s.stage]}·${s.gate}` : s.gate));
  return (
    <ol className="flex items-start" aria-label="Progress">
      {stages.map((label, i) => {
        const done = i < current;
        const now = i === current;
        return (
          <li key={label} className="relative flex flex-1 flex-col items-center text-center">
            {i > 0 && <span aria-hidden className={`absolute right-1/2 top-[11px] h-0.5 w-full ${i <= current ? "bg-forest" : "bg-line"}`} />}
            <span
              className={`relative z-10 grid h-6 w-6 place-items-center rounded-full border-2 text-[10px] font-bold ${
                done ? "border-forest bg-forest text-forest-ink" : now ? "border-forest bg-surface text-forest ring-4 ring-forest/15" : "border-line bg-surface text-muted"
              }`}
            >
              {done ? "✓" : i + 1}
            </span>
            <span className={`mt-1.5 hidden text-[11px] leading-tight sm:block ${now ? "font-semibold text-ink" : "text-muted"}`}>{label}</span>
            {gates[i] && (
              <span className={`mt-0.5 hidden font-mono text-[9px] sm:block ${done ? "text-forest" : "text-ochre"}`}>
                {gates[i].includes("·") ? "Gates" : "Gate"} {gates[i]}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function CheckRow({
  p,
  c,
  canEdit,
  onToggle,
  onRaise,
  onResolve,
}: {
  p: Procurement;
  c: Check;
  canEdit: boolean;
  onToggle: () => void;
  onRaise: (note: string) => void;
  onResolve: () => void;
}) {
  const [open, setOpen] = useState(false);
  const s = checkState(p, c);
  const findings = c.ai ? p.ai?.[p.step] : undefined;
  return (
    <li className="py-3">
      <div className="flex items-start gap-3">
        {s.auto ? (
          <span
            title="Checked by the system"
            className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold ${s.ok ? "bg-leaf text-white" : "bg-clay text-white"}`}
          >
            {s.ok ? "✓" : "!"}
          </span>
        ) : (
          <input
            id={`${p.id}-${p.step}-${c.id}`}
            type="checkbox"
            checked={s.ok}
            disabled={!canEdit}
            onChange={onToggle}
            className="mt-0.5 h-5 w-5 shrink-0 cursor-pointer accent-[var(--forest)] disabled:cursor-not-allowed"
          />
        )}
        <div className="min-w-0 flex-1">
          <label htmlFor={`${p.id}-${p.step}-${c.id}`} className={`block leading-snug ${s.auto ? "" : canEdit ? "cursor-pointer" : ""}`}>
            {c.label}
            {s.auto && <span className="ml-2 text-[11px] font-semibold uppercase tracking-wide text-muted">auto</span>}
            {c.ai && <span className="ml-2 rounded bg-plum-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-plum">AI pre-check</span>}
          </label>
          {s.detail && <p className={`mt-0.5 text-sm ${s.ok ? "text-muted" : "font-medium text-clay"}`}>{s.detail}</p>}
          {findings && (
            <ul className="mt-2 space-y-1.5 rounded-lg border border-plum/25 bg-plum-soft/50 p-3 text-sm">
              {findings.map((f) => (
                <li key={f} className="flex gap-2">
                  <span aria-hidden className="text-plum">◆</span>
                  <span className="min-w-0 flex-1">{f}</span>
                  {canEdit && (
                    <button type="button" onClick={() => onRaise(f)} className="shrink-0 text-xs font-semibold text-plum underline-offset-2 hover:underline">
                      Raise issue
                    </button>
                  )}
                </li>
              ))}
              <li className="pt-1 text-xs text-muted">Suggested by AI. Check each against the documents, raise what needs fixing, then tick the box.</li>
            </ul>
          )}
          {!s.ok && s.auto && canEdit && (c.resolve || c.fix) && (
            <div className="mt-2 flex flex-wrap gap-2">
              {c.resolve && (
                <button type="button" onClick={onResolve} className="rounded-full bg-clay px-3 py-1 text-xs font-semibold text-white transition hover:opacity-90">
                  {c.resolve}
                </button>
              )}
              {c.fix && (
                <button type="button" onClick={() => onRaise(c.fix!)} className="rounded-full border border-clay/40 px-3 py-1 text-xs font-semibold text-clay hover:border-clay">
                  Raise as an issue
                </button>
              )}
            </div>
          )}
          {open && (
            <p className="mt-1.5 text-sm leading-relaxed text-muted">
              {c.why} <Tagged text={`[${c.tag}]`} />
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label="Why is this required?"
          className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border text-xs font-semibold transition ${
            open ? "border-forest bg-forest text-forest-ink" : "border-line text-muted hover:border-forest/50 hover:text-forest"
          }`}
        >
          ?
        </button>
      </div>
    </li>
  );
}

function IssueForm({ initial, onCancel, onSave }: { initial: string; onCancel: () => void; onSave: (i: Omit<Issue, "id" | "by" | "status">) => void }) {
  const [type, setType] = useState<Issue["type"]>("Operational issue");
  const [note, setNote] = useState(initial);
  const [blocking, setBlocking] = useState(true);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (note.trim()) onSave({ type, note: note.trim(), blocking });
      }}
      className="space-y-3 rounded-xl border border-line bg-paper p-4"
    >
      <div className="flex flex-wrap gap-1.5">
        {issueTypes.map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setType(t)}
            aria-pressed={type === t}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${type === t ? "border-forest bg-forest text-forest-ink" : "border-line bg-surface hover:border-forest/40"}`}
          >
            {t}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted">{issueHelp[type]}</p>
      <textarea
        id="issue-note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={2}
        placeholder="What happened, and what is needed?"
        className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none"
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm">
          <input id="issue-blocking" type="checkbox" checked={blocking} onChange={(e) => setBlocking(e.target.checked)} className="h-4 w-4 accent-[var(--forest)]" />
          Hold this step until resolved
        </label>
        <div className="flex gap-2">
          <button type="button" onClick={onCancel} className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-ink">
            Cancel
          </button>
          <button type="submit" className="rounded-full bg-ink px-4 py-1.5 text-sm font-medium text-paper">
            Add issue
          </button>
        </div>
      </div>
      <p className="border-t border-line pt-3 text-xs leading-relaxed text-muted">
        Suspected fraud, bribery, collusion or a supplier protest? Do not record it here. Use the reporting channel in the
        Whistleblower Policy (until it is issued, the Grievance Redressal Procedures).
      </p>
    </form>
  );
}

function IssueRow({ issue, canResolve, onResolve }: { issue: Issue; canResolve: boolean; onResolve: (note: string) => void }) {
  const [resolving, setResolving] = useState(false);
  const [note, setNote] = useState("");
  const open = issue.status === "open";
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={open ? (issue.blocking ? "clay" : "ochre") : "forest"}>{open ? (issue.blocking ? "Holding step" : "Open") : "Resolved"}</Pill>
        <span className="text-xs font-semibold text-muted">{issue.type}</span>
        <span className="text-xs text-muted">· raised by {roleLabel(issue.by)}</span>
      </div>
      <p className="mt-1.5 text-sm leading-relaxed">{issue.note}</p>
      {issue.resolution && <p className="mt-1 text-sm text-muted">Resolution: {issue.resolution}</p>}
      {open && canResolve && !resolving && (
        <button type="button" onClick={() => setResolving(true)} className="mt-2 text-sm font-semibold text-forest hover:underline">
          Resolve
        </button>
      )}
      {resolving && open && (
        <form
          className="mt-2 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) onResolve(note.trim());
          }}
        >
          <input
            id={`resolve-${issue.id}`}
            autoFocus
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="How was it resolved?"
            className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm focus:border-forest focus:outline-none"
          />
          <button type="submit" className="rounded-full bg-forest px-4 py-1.5 text-sm font-medium text-forest-ink">
            Save
          </button>
        </form>
      )}
    </li>
  );
}

/* ---------- new request ---------- */

function NewRequest({ onCancel, onCreate }: { onCancel: () => void; onCreate: (p: Procurement) => void }) {
  const [title, setTitle] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("units");
  const [price, setPrice] = useState("");
  const [line, setLine] = useState(budgetLines[0].code);
  const [neededBy, setNeededBy] = useState("2027-04-30");
  const [urgent, setUrgent] = useState(false);
  const value = (Number(qty) || 0) * (Number(price) || 0);
  const bl = budgetLines.find((b) => b.code === line)!;
  const valid = title.trim() && Number(qty) > 0 && Number(price) > 0;
  const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none";

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        const id = `PR-2027-${String(Math.floor(Math.random() * 900) + 100)}`;
        onCreate({
          id,
          title: title.trim(),
          qty: Number(qty),
          unit,
          unitPrice: Number(price),
          budgetLine: line,
          activity: "1.2 Maize demonstration plots, 2027 Long Rains",
          funding: "Award A-2027 (fictional) · body rules apply",
          neededBy,
          place: "Village B collection point",
          urgent,
          step: "need",
          checks: {},
          issues: [],
          timeline: [{ date: TODAY, who: "holder", what: "Request created" }],
        });
      }}
      className="mx-auto max-w-2xl space-y-6"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">New request</p>
        <h2 className="mt-2 font-display text-3xl tracking-tight">What do you need?</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-sm font-medium">Item</span>
          <input id="nr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hybrid maize seed" className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className="text-sm font-medium">Quantity</span>
          <div className="mt-1 flex gap-2">
            <input id="nr-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" className={field} />
            <input id="nr-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={`${field} w-24`} aria-label="Unit" />
          </div>
        </label>
        <label>
          <span className="text-sm font-medium">Estimated unit price (USD)</span>
          <input id="nr-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0.00" className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className="text-sm font-medium">Budget line</span>
          <select id="nr-line" value={line} onChange={(e) => setLine(e.target.value)} className={`mt-1 ${field}`}>
            {budgetLines.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-sm font-medium">Needed by</span>
          <input id="nr-date" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className={`mt-1 ${field}`} />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input id="nr-urgent" type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-4 w-4 accent-[var(--forest)]" />
          Urgent (not in the procurement plan)
        </label>
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {[
          ["Estimated value", usd(value)],
          ["Level", value > 0 ? levelFor(value) : "—"],
          ["Left on line", usd(bl.remainingValue)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</p>
            <p className={`mt-1 font-display text-xl tabular-nums ${k === "Left on line" && value > bl.remainingValue ? "text-clay" : ""}`}>{v}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button type="submit" disabled={!valid} className="rounded-full bg-forest px-6 py-3 text-sm font-medium text-forest-ink transition enabled:hover:-translate-y-0.5 disabled:opacity-40">
          Create request
        </button>
        <button type="button" onClick={onCancel} className="rounded-full px-4 py-3 text-sm text-muted hover:text-ink">
          Cancel
        </button>
      </div>
    </form>
  );
}

/* ---------- detail ---------- */

function Detail({
  p,
  role,
  setRole,
  update,
  onBack,
}: {
  p: Procurement;
  role: Role;
  setRole: (r: Role) => void;
  update: (fn: (p: Procurement) => Procurement) => void;
  onBack: () => void;
}) {
  const [raising, setRaising] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState("");
  const step = stepById[p.step];
  const owner = ownerOf(p);
  const mine = owner === role;
  const value = valueOf(p);
  const level = levelFor(value);
  const line = lineOf(p);
  const isReady = ready(p);
  const blocks = blockingIssues(p);
  const docs = documentsOf(p);

  const log = (q: Procurement, what: string): Procurement => ({ ...q, timeline: [...q.timeline, { date: TODAY, who: role, what }] });

  const advance = () =>
    update((q) => {
      const n = nextStep(q);
      return log({ ...q, step: n }, step.done);
    });

  const sendBack = () =>
    update((q) => log({ ...q, step: prevStep(q) }, `Returned: ${returnNote.trim()}`));

  return (
    <div className="space-y-6">
      <button type="button" onClick={onBack} className="text-sm text-muted hover:text-ink lg:hidden">
        ← Back to queue
      </button>

      {/* Header */}
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted">{p.id}</span>
          <Pill tone="muted">{level}</Pill>
          {p.urgent && <Pill tone="clay">Urgent</Pill>}
          {p.feeds && <Pill tone="sky">Feeds season inputs</Pill>}
        </div>
        <h2 className="mt-2 font-display text-3xl leading-tight tracking-tight">{p.title}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          {[
            ["Quantity", `${p.qty.toLocaleString("en-US")} ${p.unit}`],
            ["Value", usd(value)],
            ["Budget line", line ? `${line.code} ${line.name}` : p.budgetLine],
            ["Needed by", p.neededBy],
          ].map(([k, v]) => (
            <div key={k} className="min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</dt>
              <dd className="mt-0.5 truncate tabular-nums">{v}</dd>
            </div>
          ))}
        </dl>
        {p.supplier && <p className="mt-3 text-sm text-muted">Supplier: {p.supplier.name}</p>}
      </div>

      <div className="rounded-2xl border border-line bg-surface px-4 py-4">
        <Tracker p={p} />
      </div>

      {/* Next step */}
      {p.step === DONE ? (
        <div className="rounded-2xl border border-forest/30 bg-mist p-6">
          <p className="font-display text-2xl text-forest">Closed</p>
          <p className="mt-1 text-sm text-muted">The file is complete and every document carries {p.id}.</p>
        </div>
      ) : (
        <section className={`rounded-2xl border-2 bg-surface ${mine ? "border-forest" : "border-line"}`}>
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div>
              <p className={`text-[11px] font-semibold uppercase tracking-[0.14em] ${mine ? "text-forest" : "text-muted"}`}>
                {mine ? "Your turn" : `Waiting on ${roleLabel(owner!)}`}
                {step.gate && <span className="ml-2 text-ochre">· Gate {step.gate}</span>}
              </p>
              <h3 className="mt-1 font-display text-2xl tracking-tight">{step.title}</h3>
              {step.note && <p className="mt-1 text-sm text-muted">{step.note}</p>}
            </div>
            {!mine && (
              <button
                type="button"
                onClick={() => setRole(owner!)}
                className="rounded-full border border-line px-3 py-1.5 text-sm font-medium transition hover:border-forest hover:text-forest"
              >
                View as {roleLabel(owner!)}
              </button>
            )}
          </div>

          <ul className="divide-y divide-line px-5">
            {step.checks.map((c) => (
              <CheckRow
                key={c.id}
                p={p}
                c={c}
                canEdit={mine}
                onToggle={() => update((q) => ({ ...q, checks: { ...q.checks, [`${q.step}.${c.id}`]: !q.checks[`${q.step}.${c.id}`] } }))}
                onRaise={(note) => setRaising(note)}
                onResolve={() => update((q) => log({ ...q, checks: { ...q.checks, [`fix.${q.step}.${c.id}`]: true } }, c.resolve!))}
              />
            ))}
          </ul>

          {mine && (
            <div className="space-y-3 border-t border-line px-5 py-4">
              {blocks.length > 0 && (
                <p className="text-sm font-medium text-clay">
                  {blocks.length === 1 ? "An open issue is" : `${blocks.length} open issues are`} holding this step.
                </p>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={!isReady}
                  onClick={advance}
                  className="rounded-full bg-forest px-6 py-3 text-sm font-semibold text-forest-ink shadow-[0_12px_24px_-14px_rgb(31_77_54/0.8)] transition enabled:hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-35 disabled:shadow-none"
                >
                  {step.action} →
                </button>
                {step.canReturn && !returning && (
                  <button type="button" onClick={() => setReturning(true)} className="rounded-full border border-line px-4 py-3 text-sm font-medium hover:border-clay hover:text-clay">
                    Return with comments
                  </button>
                )}
                {raising === null && (
                  <button type="button" onClick={() => setRaising("")} className="rounded-full px-4 py-3 text-sm font-medium text-muted hover:text-ink">
                    + Raise issue
                  </button>
                )}
              </div>
              {!isReady && blocks.length === 0 && <p className="text-xs text-muted">Complete every item above to continue.</p>}
              {returning && (
                <form
                  className="flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (returnNote.trim()) {
                      sendBack();
                      setReturning(false);
                      setReturnNote("");
                    }
                  }}
                >
                  <input
                    id="return-note"
                    autoFocus
                    value={returnNote}
                    onChange={(e) => setReturnNote(e.target.value)}
                    placeholder="What needs to change?"
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-clay focus:outline-none"
                  />
                  <button type="submit" className="rounded-full bg-clay px-4 py-2 text-sm font-medium text-white">
                    Return
                  </button>
                  <button type="button" onClick={() => setReturning(false)} className="px-2 text-sm text-muted">
                    Cancel
                  </button>
                </form>
              )}
            </div>
          )}
          {raising !== null && (
            <div className="border-t border-line px-5 py-4">
              <IssueForm
                initial={raising}
                onCancel={() => setRaising(null)}
                onSave={(i) => {
                  update((q) =>
                    log({ ...q, issues: [...q.issues, { ...i, id: `I-${q.issues.length + 1}`, by: role, status: "open" }] }, `Issue raised: ${i.type}`),
                  );
                  setRaising(null);
                }}
              />
            </div>
          )}
        </section>
      )}

      {/* Issues */}
      {p.issues.length > 0 && (
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Issues</h4>
          <ul className="mt-1 divide-y divide-line">
            {p.issues.map((i) => (
              <IssueRow
                key={i.id}
                issue={i}
                canResolve={mine || i.by === role}
                onResolve={(note) =>
                  update((q) =>
                    log({ ...q, issues: q.issues.map((x) => (x.id === i.id ? { ...x, status: "resolved", resolution: note } : x)) }, `Issue resolved: ${i.type}`),
                  )
                }
              />
            ))}
          </ul>
        </section>
      )}

      {/* File + history */}
      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">File · {docs.length} documents</h4>
          {docs.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Documents appear here as each step completes.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {docs.map((d) => (
                <li key={d} className="flex items-center gap-2 text-sm">
                  <span aria-hidden className="grid h-6 w-5 shrink-0 place-items-center rounded-sm border border-line bg-paper text-[8px] text-muted">
                    ▤
                  </span>
                  <span className="min-w-0 truncate">{d}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Every document is filed under {p.id}.</p>
        </section>
        <section>
          <h4 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">History</h4>
          <ol className="mt-2 space-y-2 border-l border-line pl-4">
            {[...p.timeline].reverse().map((e, k) => (
              <li key={k} className="relative text-sm">
                <span aria-hidden className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-forest" />
                <p className="leading-snug">{e.what}</p>
                <p className="text-xs text-muted">
                  {e.date} · {roleLabel(e.who)}
                </p>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}

/* ---------- workspace ---------- */

export function ProcurementWorkspace() {
  const [items, setItems] = useState<Procurement[]>(seedProcurements);
  const [role, setRole] = useState<Role>("procurement");
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);

  // Restore this browser's copy of the sample data.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORE);
      if (saved) {
        const s = JSON.parse(saved);
        setItems(s.items);
        setRole(s.role);
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(STORE, JSON.stringify({ items, role }));
    } catch {}
  }, [items, role]);

  const counts = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, items.filter((p) => ownerOf(p) === r.id).length])), [items]);
  const mineList = items.filter((p) => ownerOf(p) === role);
  const list = showAll ? items : mineList;
  const current = items.find((p) => p.id === selected) ?? list[0] ?? null;

  const update = (id: string) => (fn: (p: Procurement) => Procurement) => {
    setSelected(id);
    setItems((all) => all.map((p) => (p.id === id ? fn(p) : p)));
  };

  const pick = (id: string) => {
    setSelected(id);
    setCreating(false);
    setMobileDetail(true);
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-line bg-paper/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <LogoMark className="h-7 w-7" />
            <span className="font-display text-lg tracking-tight">Procurement</span>
          </Link>
          <div className="order-last -mx-4 w-[calc(100%+2rem)] overflow-x-auto px-4 sm:mx-0 sm:w-auto sm:px-0 lg:order-none">
            <div role="tablist" aria-label="View as" className="flex w-max gap-1 rounded-full border border-line bg-surface p-1">
              {roles.map((r) => (
                <button
                  key={r.id}
                  role="tab"
                  type="button"
                  aria-selected={role === r.id}
                  onClick={() => {
                    setRole(r.id);
                    setSelected(null);
                    setShowAll(false);
                    setMobileDetail(false);
                  }}
                  className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm transition ${role === r.id ? "bg-forest text-forest-ink" : "text-muted hover:text-ink"}`}
                >
                  {r.short}
                  {counts[r.id] > 0 && (
                    <span className={`grid h-5 min-w-5 place-items-center rounded-full px-1 text-[11px] font-bold tabular-nums ${role === r.id ? "bg-forest-ink/20" : "bg-ochre-soft text-ochre"}`}>
                      {counts[r.id]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <span
              title="Rules follow Procurement Policy Draft 1.0, which is not approved. All records are fictional."
              className="hidden rounded-full border border-line px-2.5 py-1 text-[11px] text-muted md:inline"
            >
              Sample data · draft rules
            </span>
            <button
              type="button"
              onClick={() => {
                setRole("holder");
                setCreating(true);
                setMobileDetail(true);
              }}
              className="rounded-full bg-ink px-4 py-2 text-sm font-medium text-paper transition hover:opacity-85"
            >
              + New request
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1400px] flex-1 lg:grid-cols-[360px_minmax(0,1fr)]">
        {/* Queue */}
        <aside className={`border-line lg:border-r ${mobileDetail ? "hidden lg:block" : ""}`}>
          <div className="flex items-center justify-between px-4 pb-2 pt-5 sm:px-6">
            <h1 className="font-display text-xl tracking-tight">
              {showAll ? "All procurements" : mineList.length ? `${mineList.length} waiting on you` : "Nothing waiting on you"}
            </h1>
            <button type="button" onClick={() => setShowAll(!showAll)} className="text-sm text-muted hover:text-ink">
              {showAll ? "Mine" : "Show all"}
            </button>
          </div>
          {list.length === 0 ? (
            <div className="px-4 py-10 text-center sm:px-6">
              <p className="text-sm text-muted">You are all caught up.</p>
              <button type="button" onClick={() => setShowAll(true)} className="mt-2 text-sm font-semibold text-forest hover:underline">
                See everything in progress
              </button>
            </div>
          ) : (
            <ul className="space-y-1.5 px-2 pb-6 sm:px-3">
              {list.map((p) => {
                const s = stepById[p.step];
                const active = !creating && current?.id === p.id;
                const blocked = blockingIssues(p).length > 0;
                const late = p.step !== DONE && p.neededBy < TODAY && (s?.stage ?? 0) < 5;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => pick(p.id)}
                      className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                        active ? "border-forest bg-surface shadow-[0_10px_24px_-18px_rgb(19_32_26/0.6)]" : "border-transparent hover:border-line hover:bg-surface"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[11px] text-muted">{p.id}</span>
                        <span className="text-xs tabular-nums text-muted">{usd(valueOf(p))}</span>
                      </div>
                      <p className="mt-1 font-medium leading-snug">{p.title}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        {p.step === DONE ? (
                          <Pill tone="forest">Closed</Pill>
                        ) : (
                          <Pill tone={ownerOf(p) === role ? "forest" : "muted"}>
                            {s.title}
                            {s.gate && ` · ${s.gate}`}
                          </Pill>
                        )}
                        {blocked && <Pill tone="clay">Issue</Pill>}
                        {late && <Pill tone="ochre">Past needed-by</Pill>}
                        {showAll && ownerOf(p) && ownerOf(p) !== role && <span className="text-[11px] text-muted">{roleLabel(ownerOf(p)!)}</span>}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <div className="border-t border-line px-4 py-4 text-xs text-muted sm:px-6">
            Fictional records, saved in this browser only.{" "}
            <button
              type="button"
              onClick={() => {
                setItems(seedProcurements());
                setSelected(null);
              }}
              className="font-semibold underline-offset-2 hover:underline"
            >
              Reset sample data
            </button>
          </div>
        </aside>

        {/* Detail */}
        <main className={`px-4 py-6 sm:px-8 lg:py-8 ${mobileDetail ? "" : "hidden lg:block"}`}>
          {creating ? (
            <NewRequest
              onCancel={() => {
                setCreating(false);
                setMobileDetail(false);
              }}
              onCreate={(p) => {
                setItems((all) => [p, ...all]);
                setSelected(p.id);
                setCreating(false);
              }}
            />
          ) : current ? (
            <div className="mx-auto max-w-3xl">
              <Detail
                key={current.id}
                p={current}
                role={role}
                setRole={(r) => {
                  setSelected(current.id);
                  setRole(r);
                }}
                update={update(current.id)}
                onBack={() => setMobileDetail(false)}
              />
            </div>
          ) : (
            <div className="grid h-full place-items-center py-24 text-center">
              <div>
                <p className="font-display text-2xl">Nothing selected</p>
                <p className="mt-1 text-sm text-muted">Pick a procurement from the list, or start a new request.</p>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
