"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { DocumentViewer } from "@/components/procurement/document";
import {
  AppShell,
  BackLink,
  NoAccess,
  CheckRow,
  ComingUp,
  EmptyQueue,
  History,
  IssueForm,
  IssueList,
  Pill,
  QueueFooter,
  QueueHeader,
  QueueItem,
  SectionLabel,
  StepCard,
  Tracker,
  primaryBtn,
  usePersistentState,
} from "@/components/workspace/ui";
import { AFN_PER_USD, holderOf, projectPath, stepHistory } from "@/lib/demo";
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
  reviewKey,
  roleLabel,
  rolePerson,
  roles,
  seedProcurements,
  stages,
  stepById,
  stepsFor,
  valueOf,
  type Issue,
  type Procurement,
  type Role,
} from "@/lib/procurement";

export const PROCUREMENT_ITEMS_KEY = "rop-procurement-v2-items";

const person = (r: string) => rolePerson(r as Role);
const fieldCls = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none disabled:bg-paper disabled:text-muted";
const lowerFirst = (s: string) => s[0].toLowerCase() + s.slice(1);

const ISSUE_FOOTNOTE =
  "Suspected fraud, bribery, collusion or a supplier protest? Do not record it here. Use the reporting channel in the Whistleblower Policy (until it is issued, the Grievance Redressal Procedures).";

/** Procurements that will reach `role` later, with the projected arrival date. */
export function procurementComingTo(items: Procurement[], role: string) {
  return items
    .filter((p) => p.step !== DONE && ownerOf(p) !== role)
    .flatMap((p) => {
      const list = stepsFor(p);
      const i = list.findIndex((s) => s.id === p.step);
      const since = p.timeline.length ? p.timeline[p.timeline.length - 1].date : TODAY;
      const path = projectPath(
        list.slice(i).map((s) => ({ step: s.id, owner: s.owner })),
        since,
        TODAY,
      );
      const hit = path.find((x, k) => k > 0 && x.owner === role);
      if (!hit) return [];
      return [
        {
          id: p.id,
          title: `${p.title} · ${p.id}`,
          step: stepById[hit.step].title,
          eta: hit.start,
          via: `${lowerFirst(stepById[path[0].step].title)} with ${holderOf("procurement", path[0].owner)?.name ?? roleLabel(path[0].owner as Role)}`,
          basis: path
            .slice(0, path.indexOf(hit))
            .map((x) => `${stepById[x.step].title}: median ${stepHistory[x.step]?.median} days (${stepHistory[x.step]?.n} cases)`)
            .join(" · "),
        },
      ];
    })
    .sort((a, b) => a.eta.localeCompare(b.eta));
}

/* ---------- requisition form ---------- */

function RequisitionForm({ p, editable, update }: { p: Procurement; editable: boolean; update: (fn: (p: Procurement) => Procurement) => void }) {
  const { money, currency } = useSession();
  const toUsd = (v: number) => (currency === "AFN" ? v / AFN_PER_USD : v);
  const fromUsd = (v: number) => (currency === "AFN" ? Math.round(v * AFN_PER_USD) : v);
  // Any edit after review means the document must be reviewed again before signing.
  const set = (patch: Partial<Procurement>) =>
    update((q) => {
      const checks = { ...q.checks };
      delete checks[reviewKey(q)];
      return { ...q, ...patch, checks };
    });
  const line = lineOf(p);
  return (
    <div className="border-b border-line bg-paper/60 px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">Requisition details</p>
        <p className="text-xs text-muted">{editable ? "Fill in here. The requisition document is generated from these fields." : "Filled in by the budget holder."}</p>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted">Item</span>
          <input id="rq-title" disabled={!editable} value={p.title} onChange={(e) => set({ title: e.target.value })} className={`mt-1 ${fieldCls}`} />
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted">Specification</span>
          <textarea id="rq-spec" disabled={!editable} rows={2} value={p.specification} onChange={(e) => set({ specification: e.target.value })} className={`mt-1 ${fieldCls}`} />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Quantity</span>
          <div className="mt-1 flex gap-2">
            <input id="rq-qty" disabled={!editable} inputMode="decimal" value={p.qty} onChange={(e) => set({ qty: Number(e.target.value) || 0 })} className={fieldCls} />
            <input id="rq-unit" disabled={!editable} aria-label="Unit" value={p.unit} onChange={(e) => set({ unit: e.target.value })} className={`${fieldCls} w-24`} />
          </div>
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Estimated unit price ({currency === "AFN" ? "Afs" : "USD"})</span>
          <input
            id="rq-price"
            disabled={!editable}
            inputMode="decimal"
            value={fromUsd(p.unitPrice)}
            onChange={(e) => set({ unitPrice: toUsd(Number(e.target.value) || 0) })}
            className={`mt-1 ${fieldCls}`}
          />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Budget line</span>
          <select id="rq-line" disabled={!editable} value={p.budgetLine} onChange={(e) => set({ budgetLine: e.target.value })} className={`mt-1 ${fieldCls}`}>
            {budgetLines.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Needed by</span>
          <input id="rq-date" type="date" disabled={!editable} value={p.neededBy} onChange={(e) => set({ neededBy: e.target.value })} className={`mt-1 ${fieldCls}`} />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Delivery place</span>
          <input id="rq-place" disabled={!editable} value={p.place} onChange={(e) => set({ place: e.target.value })} className={`mt-1 ${fieldCls}`} />
        </label>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input id="rq-urgent" type="checkbox" disabled={!editable} checked={p.urgent} onChange={(e) => set({ urgent: e.target.checked })} className="h-4 w-4 accent-[var(--forest)]" />
          Urgent (not in the procurement plan)
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted">Environmental or social risk</span>
          <input
            id="rq-es"
            disabled={!editable}
            value={p.esRisk}
            placeholder="e.g. None identified, or: pesticide, storage and disposal plan attached"
            onChange={(e) => set({ esRisk: e.target.value })}
            className={`mt-1 ${fieldCls}`}
          />
        </label>
        <label className="sm:col-span-2">
          <span className="text-xs font-medium text-muted">Price basis (source of the estimate)</span>
          <input
            id="rq-basis"
            disabled={!editable}
            value={p.priceBasis}
            placeholder="e.g. Last purchase PR-2026-031 and a survey of three suppliers"
            onChange={(e) => set({ priceBasis: e.target.value })}
            className={`mt-1 ${fieldCls}`}
          />
        </label>
      </div>
      <p className="mt-3 text-sm text-muted">
        Estimated total <span className="font-semibold text-ink tabular-nums">{money(valueOf(p))}</span> · {levelFor(valueOf(p))} level
        {line && (
          <>
            {" "}
            · {money(line.remainingValue)} left on {line.code}
          </>
        )}
      </p>
    </div>
  );
}

/* ---------- new request ---------- */

function NewRequest({ onCancel, onCreate }: { onCancel: () => void; onCreate: (p: Procurement) => void }) {
  const { money, currency } = useSession();
  const [title, setTitle] = useState("");
  const [spec, setSpec] = useState("");
  const [qty, setQty] = useState("");
  const [unit, setUnit] = useState("units");
  const [price, setPrice] = useState("");
  const [line, setLine] = useState(budgetLines[0].code);
  const [neededBy, setNeededBy] = useState("2027-04-30");
  const [urgent, setUrgent] = useState(false);
  const unitUsd = (Number(price) || 0) / (currency === "AFN" ? AFN_PER_USD : 1);
  const value = (Number(qty) || 0) * unitUsd;
  const bl = budgetLines.find((b) => b.code === line)!;
  const valid = title.trim() && Number(qty) > 0 && Number(price) > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        onCreate({
          id: `PR-2027-${String(Math.floor(Math.random() * 900) + 100)}`,
          title: title.trim(),
          specification: spec.trim(),
          priceBasis: "",
          esRisk: "",
          signatures: {},
          qty: Number(qty),
          unit,
          unitPrice: unitUsd,
          budgetLine: line,
          activity: "1.2 Maize demonstration plots, 2027 Spring",
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
        <p className="mt-1 text-sm text-muted">This starts the purchase requisition. You will finish it, review the generated document and sign it in the next steps.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="sm:col-span-2">
          <span className="text-sm font-medium">Item</span>
          <input id="nr-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Hybrid maize seed" className={`mt-1 ${fieldCls}`} />
        </label>
        <label className="sm:col-span-2">
          <span className="text-sm font-medium">Specification</span>
          <textarea id="nr-spec" rows={2} value={spec} onChange={(e) => setSpec(e.target.value)} className={`mt-1 ${fieldCls}`} />
        </label>
        <label>
          <span className="text-sm font-medium">Quantity</span>
          <div className="mt-1 flex gap-2">
            <input id="nr-qty" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" className={fieldCls} />
            <input id="nr-unit" value={unit} onChange={(e) => setUnit(e.target.value)} className={`${fieldCls} w-24`} aria-label="Unit" />
          </div>
        </label>
        <label>
          <span className="text-sm font-medium">Estimated unit price ({currency === "AFN" ? "Afs" : "USD"})</span>
          <input id="nr-price" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="0" className={`mt-1 ${fieldCls}`} />
        </label>
        <label>
          <span className="text-sm font-medium">Budget line</span>
          <select id="nr-line" value={line} onChange={(e) => setLine(e.target.value)} className={`mt-1 ${fieldCls}`}>
            {budgetLines.map((b) => (
              <option key={b.code} value={b.code}>
                {b.code} {b.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="text-sm font-medium">Needed by</span>
          <input id="nr-date" type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} className={`mt-1 ${fieldCls}`} />
        </label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input id="nr-urgent" type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-4 w-4 accent-[var(--forest)]" />
          Urgent (not in the procurement plan)
        </label>
      </div>
      <div className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
        {[
          ["Estimated value", money(value)],
          ["Level", value > 0 ? levelFor(value) : "—"],
          ["Left on line", money(bl.remainingValue)],
        ].map(([k, v]) => (
          <div key={k} className="bg-surface px-4 py-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">{k}</p>
            <p className={`mt-1 font-display text-xl tabular-nums ${k === "Left on line" && value > bl.remainingValue ? "text-clay" : ""}`}>{v}</p>
          </div>
        ))}
      </div>
      <div className="flex gap-3">
        <button type="submit" disabled={!valid} className={primaryBtn}>
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
  update,
  onBack,
}: {
  p: Procurement;
  role: Role | null;
  update: (fn: (p: Procurement) => Procurement) => void;
  onBack: () => void;
}) {
  const { user, money, signIn } = useSession();
  const [raising, setRaising] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [returnNote, setReturnNote] = useState("");
  const [viewing, setViewing] = useState<{ doc: string; confirm: boolean } | null>(null);
  const step = stepById[p.step];
  const owner = ownerOf(p);
  const ownerUser = owner ? holderOf("procurement", owner) : undefined;
  const mine = !!role && owner === role;
  const value = valueOf(p);
  const line = lineOf(p);
  const isReady = ready(p);
  const blocks = blockingIssues(p);
  const docs = documentsOf(p);
  const reviewed = !!p.checks[reviewKey(p)];
  const letters: Record<number, string[]> = {};
  stepsFor(p).forEach((s) => s.gate && (letters[s.stage] = [...(letters[s.stage] ?? []), s.gate]));
  const gates = Object.fromEntries(Object.entries(letters).map(([k, g]) => [k, `${g.length > 1 ? "Gates" : "Gate"} ${g.join("·")}`]));

  const log = (q: Procurement, what: string): Procurement => ({ ...q, timeline: [...q.timeline, { date: TODAY, who: role ?? "procurement", what }] });

  const complete = () =>
    update((q) => {
      const s = stepById[q.step];
      const signatures = s.signs
        ? { ...q.signatures, [s.signs.doc]: [...(q.signatures[s.signs.doc] ?? []), { as: s.signs.as, name: user?.name ?? roleLabel(s.owner), role: s.owner, date: TODAY }] }
        : q.signatures;
      return log({ ...q, signatures, step: nextStep(q) }, s.signs ? `${s.done} · signed ${s.signs.doc.toLowerCase()}` : s.done);
    });

  return (
    <div className="space-y-6">
      <BackLink onClick={onBack} />

      <div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted">{p.id}</span>
          <Pill tone="muted">{levelFor(value)}</Pill>
          {p.urgent && <Pill tone="clay">Urgent</Pill>}
          {p.feeds && <Pill tone="sky">Feeds field inputs</Pill>}
        </div>
        <h2 className="mt-2 font-display text-3xl leading-tight tracking-tight">{p.title}</h2>
        <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
          {[
            ["Quantity", `${p.qty.toLocaleString("en-US")} ${p.unit}`],
            ["Value", money(value)],
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
        <Tracker labels={stages} current={p.step === DONE ? stages.length : step.stage} marks={gates} />
      </div>

      {p.step === DONE ? (
        <div className="rounded-2xl border border-forest/30 bg-mist p-6">
          <p className="font-display text-2xl text-forest">Closed</p>
          <p className="mt-1 text-sm text-muted">The file is complete and every document carries {p.id}.</p>
        </div>
      ) : (
        <StepCard
          mine={mine}
          ownerLabel={person(owner!)}
          eyebrow={step.gate && `Gate ${step.gate}`}
          title={step.title}
          note={step.note}
          onViewAs={ownerUser ? () => signIn(ownerUser.id) : undefined}
          switchLabel={ownerUser ? `Sign in as ${ownerUser.name.split(" ")[0]} (demo)` : undefined}
          footer={
            <>
              {mine && (
                <div className="space-y-3 border-t border-line px-5 py-4">
                  {blocks.length > 0 && (
                    <p className="text-sm font-medium text-clay">{blocks.length === 1 ? "An open issue is" : `${blocks.length} open issues are`} holding this step.</p>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={!isReady} onClick={complete} className={primaryBtn}>
                      {step.signs ? `Sign and ${lowerFirst(step.action)}` : step.action} →
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
                  {!isReady && blocks.length === 0 && (
                    <p className="text-xs text-muted">{step.signs && !reviewed ? "Review the generated document and complete every item to continue." : "Complete every item above to continue."}</p>
                  )}
                  {returning && (
                    <form
                      className="flex flex-wrap gap-2"
                      onSubmit={(e) => {
                        e.preventDefault();
                        if (!returnNote.trim()) return;
                        update((q) => log({ ...q, step: prevStep(q) }, `Returned: ${returnNote.trim()}`));
                        setReturning(false);
                        setReturnNote("");
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
              {raising !== null && role && (
                <div className="border-t border-line px-5 py-4">
                  <IssueForm
                    types={issueTypes}
                    help={issueHelp}
                    footnote={ISSUE_FOOTNOTE}
                    initial={raising}
                    onCancel={() => setRaising(null)}
                    onSave={(i) => {
                      update((q) =>
                        log(
                          { ...q, issues: [...q.issues, { ...i, type: i.type as Issue["type"], id: `I-${q.issues.length + 1}`, by: role, status: "open" }] },
                          `Issue raised: ${i.type}`,
                        ),
                      );
                      setRaising(null);
                    }}
                  />
                </div>
              )}
            </>
          }
        >
          {p.step === "requisition" && <RequisitionForm p={p} editable={mine} update={update} />}
          <ul className="divide-y divide-line px-5">
            {step.checks.map((c) => {
              const s = checkState(p, c, money);
              return (
                <CheckRow
                  key={c.id}
                  c={{
                    key: `${p.id}-${p.step}-${c.id}`,
                    label: c.label,
                    why: c.why,
                    tag: c.tag,
                    ...s,
                    findings: c.ai ? p.ai?.[p.step] : undefined,
                    fix: c.fix,
                    resolve: c.resolve,
                  }}
                  canEdit={mine}
                  onToggle={() => update((q) => ({ ...q, checks: { ...q.checks, [`${q.step}.${c.id}`]: !q.checks[`${q.step}.${c.id}`] } }))}
                  onRaise={(note) => setRaising(note)}
                  onResolve={() => update((q) => log({ ...q, checks: { ...q.checks, [`fix.${q.step}.${c.id}`]: true } }, c.resolve!))}
                />
              );
            })}
            {step.signs && (
              <li className="flex items-start gap-3 py-3">
                <span className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-[11px] font-bold text-white ${reviewed ? "bg-leaf" : "bg-line"}`}>{reviewed ? "✓" : ""}</span>
                <div className="min-w-0 flex-1">
                  <p className="leading-snug">Review the generated {step.signs.doc.toLowerCase()}</p>
                  <p className="mt-0.5 text-sm text-muted">
                    {reviewed ? `Reviewed. You sign as “${step.signs.as}” when you continue.` : `You sign it as “${step.signs.as}” when you continue.`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setViewing({ doc: step.signs!.doc, confirm: mine })}
                  className={`shrink-0 rounded-full px-4 py-1.5 text-sm font-semibold transition ${reviewed || !mine ? "border border-line hover:border-forest hover:text-forest" : "bg-forest text-forest-ink"}`}
                >
                  {reviewed || !mine ? "Open" : "Review document"}
                </button>
              </li>
            )}
          </ul>
        </StepCard>
      )}

      <IssueList
        issues={p.issues}
        roleLabel={person}
        canResolve={(i) => mine || i.by === role}
        onResolve={(id, note) =>
          update((q) => log({ ...q, issues: q.issues.map((x) => (x.id === id ? { ...x, status: "resolved", resolution: note } : x)) }, "Issue resolved"))
        }
      />

      <div className="grid gap-6 sm:grid-cols-2">
        <section>
          <SectionLabel>File · {docs.length} documents</SectionLabel>
          {docs.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Documents appear here as each step completes.</p>
          ) : (
            <ul className="mt-2 space-y-1">
              {docs.map((d) => {
                const signed = p.signatures[d]?.length ?? 0;
                return (
                  <li key={d}>
                    <button type="button" onClick={() => setViewing({ doc: d, confirm: false })} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-surface">
                      <span aria-hidden className="grid h-6 w-5 shrink-0 place-items-center rounded-sm border border-line bg-paper text-[8px] text-muted">
                        ▤
                      </span>
                      <span className="min-w-0 flex-1 truncate">{d}</span>
                      {signed > 0 && <span className="shrink-0 text-[11px] text-leaf">✍ {signed}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Every document is generated from this record and filed under {p.id}.</p>
        </section>
        <History events={p.timeline} roleLabel={person} />
      </div>

      {viewing && (
        <DocumentViewer
          p={p}
          doc={viewing.doc}
          onClose={() => setViewing(null)}
          pendingAs={mine && step?.signs?.doc === viewing.doc ? step.signs.as : undefined}
          onConfirm={viewing.confirm && !reviewed ? () => update((q) => ({ ...q, checks: { ...q.checks, [reviewKey(q)]: true } })) : undefined}
        />
      )}
    </div>
  );
}

/* ---------- workspace ---------- */

export function ProcurementWorkspace() {
  const { user } = useRequireUser();
  const myRoles = (user?.procurement ?? []) as Role[];
  const [items, setItems] = usePersistentState<Procurement[]>(PROCUREMENT_ITEMS_KEY, seedProcurements);
  const [pickedRole, setPickedRole] = useState<Role | null>(null);
  const role = pickedRole && myRoles.includes(pickedRole) ? pickedRole : (myRoles[0] ?? null);
  const [selected, setSelected] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [creating, setCreating] = useState(false);
  const [mobileDetail, setMobileDetail] = useState(false);
  const { money } = useSession();

  const counts = useMemo(() => Object.fromEntries(roles.map((r) => [r.id, items.filter((p) => ownerOf(p) === r.id).length])), [items]);
  const readOnly = !role;
  const mineList = role ? items.filter((p) => ownerOf(p) === role) : items;
  const list = showAll || readOnly ? items : mineList;
  const current = items.find((p) => p.id === selected) ?? list[0] ?? null;
  const upcoming = role ? procurementComingTo(items, role).slice(0, 5) : [];

  const update = (id: string) => (fn: (p: Procurement) => Procurement) => {
    setSelected(id);
    setItems((all) => all.map((p) => (p.id === id ? fn(p) : p)));
  };

  // Links such as /procurement?open=PR-2027-014 or ?new=1 open that record or the request form.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const open = q.get("open");
    if (open) {
      setSelected(open);
      setShowAll(true);
      setMobileDetail(true);
    }
    if (q.get("new")) {
      setCreating(true);
      setMobileDetail(true);
    }
  }, []);

  if (!user) return null;
  if (user.procurementAccess === "none") return <NoAccess what="Procurement" />;

  return (
    <AppShell
      active="procurement"
      roles={roles.filter((r) => myRoles.includes(r.id))}
      role={role}
      counts={counts}
      onRole={(r) => {
        setPickedRole(r as Role);
        setSelected(null);
        setShowAll(false);
        setMobileDetail(false);
      }}
      primary={
        myRoles.includes("holder")
          ? {
              label: "+ New request",
              onClick: () => {
                setPickedRole("holder");
                setCreating(true);
                setMobileDetail(true);
              },
            }
          : undefined
      }
      mobileDetail={mobileDetail}
      queue={
        <>
          <QueueHeader
            title={readOnly || showAll ? "All procurements" : mineList.length ? `${mineList.length} waiting on you` : "Nothing waiting on you"}
            toggleLabel={readOnly ? "" : showAll ? "Mine" : "Show all"}
            onToggle={() => setShowAll(!showAll)}
          />
          {list.length === 0 ? (
            <EmptyQueue onShowAll={() => setShowAll(true)} />
          ) : (
            <ul className="space-y-1.5 px-2 pb-6 sm:px-3">
              {list.map((p) => {
                const s = stepById[p.step];
                const late = p.step !== DONE && p.neededBy < TODAY && (s?.stage ?? 0) < 5;
                const o = ownerOf(p);
                return (
                  <QueueItem
                    key={p.id}
                    active={!creating && current?.id === p.id}
                    onClick={() => {
                      setSelected(p.id);
                      setCreating(false);
                      setMobileDetail(true);
                    }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[11px] text-muted">{p.id}</span>
                      <span className="text-xs tabular-nums text-muted">{money(valueOf(p))}</span>
                    </div>
                    <p className="mt-1 font-medium leading-snug">{p.title}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      {p.step === DONE ? (
                        <Pill tone="forest">Closed</Pill>
                      ) : (
                        <Pill tone={o === role ? "forest" : "muted"}>
                          {s.title}
                          {s.gate && ` · ${s.gate}`}
                        </Pill>
                      )}
                      {blockingIssues(p).length > 0 && <Pill tone="clay">Issue</Pill>}
                      {late && <Pill tone="ochre">Past needed-by</Pill>}
                      {(showAll || readOnly) && o && o !== role && <span className="text-[11px] text-muted">{holderOf("procurement", o)?.name}</span>}
                    </div>
                  </QueueItem>
                );
              })}
            </ul>
          )}
          <ComingUp
            items={upcoming}
            onOpen={(id) => {
              setSelected(id);
              setShowAll(true);
              setMobileDetail(true);
            }}
          />
          <QueueFooter
            onReset={() => {
              setItems(seedProcurements());
              setSelected(null);
            }}
          />
        </>
      }
      detail={
        creating ? (
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
            <Detail key={current.id} p={current} role={role} update={update(current.id)} onBack={() => setMobileDetail(false)} />
          </div>
        ) : (
          <div className="grid h-full place-items-center py-24 text-center">
            <div>
              <p className="font-display text-2xl">Nothing selected</p>
              <p className="mt-1 text-sm text-muted">Pick a procurement from the list, or start a new request.</p>
            </div>
          </div>
        )
      }
    />
  );
}
