"use client";

import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import {
  CHANGE_KINDS,
  FIELDS,
  GROUP_LABEL,
  HIRE_REQUIRED,
  HR_ROLES,
  KIND_LABEL,
  ROLE_LABEL,
  fieldsIn,
  fullRules,
  type FieldKey,
  type Fields,
  type Group,
  type HrAction,
  type HrRole,
  type ProposalInput,
  type Rules,
  type RulesInput,
  type Value,
  PAYOUT_GROUPS,
  PAYOUT_GROUP_LABEL,
  DEFAULT_PAYOUT,
} from "@/lib/hr";
import type { HrView, PersonView, ProposalView } from "@/server/hr-view";
import { readBamboo, type BambooRow } from "@/lib/bamboo-import";
import { ROLE_HELP, SIGNATURES, SIGNER_LABEL } from "@/lib/authority";

/**
 * People: the HR record. Every change is proposed, signed by the people the rules name, and
 * written as a new ledger entry; nothing is ever edited or deleted.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

function useHr() {
  const { user, ready } = useSession();
  const [view, setView] = useState<HrView | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    try {
      setView(await call<HrView>("/api/hr", user?.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user?.id]);
  useEffect(() => {
    if (ready && user) void reload();
  }, [ready, user, reload]);
  const act = useCallback(
    async (a: HrAction) => {
      const r = await call<{ view: HrView }>("/api/hr", user?.id, { method: "POST", body: JSON.stringify(a) });
      setView(r.view);
    },
    [user?.id],
  );
  const seal = useCallback(async () => {
    const r = await call<{ sealed: boolean; why?: string }>("/api/hr/seal", user?.id, { method: "POST" });
    await reload();
    return r;
  }, [user?.id, reload]);
  const reset = useCallback(async () => {
    await call("/api/hr/reset", user?.id, { method: "POST" });
    await reload();
  }, [user?.id, reload]);
  return { view, error, act, seal, reset, reload };
}

const today = () => new Date().toISOString().slice(0, 10);

function show(k: FieldKey, v: Value | undefined, names: Record<string, string>, currency?: Value) {
  if (v == null || v === "") return "—";
  const f = FIELDS[k];
  if (f.type === "person") return names[String(v)] ?? String(v);
  if (f.type === "money") return `${typeof v === "number" ? v.toLocaleString("en-US") : v}${currency ? ` ${currency}` : ""}`;
  if (k === "dangerPay" || k === "postDiff" || k === "retirementPct") return `${v}%`;
  return String(v);
}

type Tab = "waiting" | "people" | "changes" | "rules" | "ledger";

export function PeoplePage() {
  const { user } = useRequireUser();
  const hr = useHr();
  const { date } = useT();
  const [tab, setTab] = useState<Tab>("waiting");
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [declare, setDeclare] = useState(false);
  const [notice, setNotice] = useState("");
  const [importing, setImporting] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);

  const v = hr.view;
  if (!user) return null;
  const waiting = v?.proposals.filter((p) => p.canSign) ?? [];
  const mine = v?.people.find((p) => p.id === v.me);
  const isHr = !!v?.roles.includes("hr");
  const tabs: { id: Tab; label: string }[] = v?.seesAll
    ? [
        { id: "waiting", label: `Waiting for you (${waiting.length})` },
        { id: "people", label: "People" },
        { id: "changes", label: "All changes" },
        { id: "rules", label: "Authority" },
        { id: "ledger", label: "Ledger" },
      ]
    : [
        { id: "waiting", label: "My record" },
        { id: "changes", label: "My changes" },
      ];
  const person = open ? v?.people.find((p) => p.id === open) : null;
  const fmt = (iso: string) => date(iso.slice(0, 10), { day: "numeric", month: "short", year: "numeric" });

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h1 className="font-display text-3xl tracking-tight">People</h1>
          <span className="flex gap-4 text-sm">
            <a href="/timesheets" className="font-semibold text-forest hover:underline">
              Timesheets
            </a>
            <a href="/leave" className="font-semibold text-forest hover:underline">
              Leave
            </a>
            <a href="/expenses" className="font-semibold text-forest hover:underline">
              Expenses
            </a>
            <a href="/onboarding" className="font-semibold text-forest hover:underline">
              Onboarding
            </a>
            <a href="/offboarding" className="font-semibold text-forest hover:underline">
              Leaving and renewals
            </a>
            {v?.seesAll && (
              <a href="/payroll" className="font-semibold text-forest hover:underline">
                Payroll
              </a>
            )}
          </span>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          The HR record. Nothing in it can be edited or deleted: every change is a new entry, signed by the people the rules name, and sealed so any later tampering shows.
        </p>
        {v?.sample && (
          <p className="mt-3 rounded-xl bg-sunken px-4 py-2 text-xs text-muted">
            Sample records: fictional people and pay. Real records go in a separate book that can never be reset.
          </p>
        )}
        {hr.error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {hr.error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {!v ? (
          !hr.error && <p className="mt-10 text-sm text-muted">Loading…</p>
        ) : !v.started ? (
          <StartRecord view={v} admin={!!user.admin} userId={user.id} onStarted={(msg) => void hr.reload().then(() => setNotice(msg))} />
        ) : (
          <>
            <IntegrityBar view={v} fmt={fmt} />

            <div role="tablist" className="mt-6 flex gap-1 overflow-x-auto border-b border-line">
              {tabs.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  onClick={() => setTab(t.id)}
                  className={`shrink-0 border-b-2 px-3 py-2.5 text-sm ${tab === t.id ? "border-forest font-semibold text-forest" : "border-transparent text-muted hover:text-ink"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "waiting" && (
              <section className="mt-6 space-y-4">
                {v.seesAll ? (
                  waiting.length ? (
                    waiting.map((p) => <ProposalCard key={p.id} p={p} view={v} fmt={fmt} act={hr.act} onDone={setNotice} />)
                  ) : (
                    <Empty>Nothing is waiting for your signature.</Empty>
                  )
                ) : mine ? (
                  <PersonRecord p={mine} view={v} fmt={fmt} onChange={() => setForm({ type: "update", subject: mine.id, own: true })} />
                ) : (
                  <Empty>You have no HR record yet. HR adds it when your contract starts.</Empty>
                )}
                {!v.seesAll && v.people.some((p) => p.id !== v.me) && (
                  <section>
                    <SectionLabel>My team</SectionLabel>
                    <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
                      {v.people
                        .filter((p) => p.id !== v.me)
                        .map((p) => (
                          <li key={p.id} className="px-4 py-3 text-sm">
                            <span className="block font-medium">{p.name}</span>
                            <span className="block text-muted">
                              {p.title} · since {p.fields.startDate ? fmt(String(p.fields.startDate)) : "—"}
                              {p.fields.contractEnd ? ` · contract ends ${fmt(String(p.fields.contractEnd))}` : ""}
                            </span>
                          </li>
                        ))}
                    </ul>
                  </section>
                )}
                {!v.seesAll && <Relations view={v} onDeclare={() => setDeclare(true)} fmt={fmt} />}
              </section>
            )}

            {tab === "people" && v.seesAll && (
              <section className="mt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionLabel>{v.people.length} people</SectionLabel>
                  {isHr && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" className={quietBtn} onClick={() => setImporting(!importing)}>
                        Move people from BambooHR
                      </button>
                      <button type="button" className={primaryBtn} onClick={() => setForm({ type: "hire" })}>
                        Add a person
                      </button>
                    </div>
                  )}
                </div>
                {isHr && importing && (
                  <BambooImport
                    user={user!.id}
                    onDone={(msg) => {
                      setImporting(false);
                      setNotice(msg);
                      void hr.reload();
                    }}
                  />
                )}
                <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface">
                  {v.people.map((p) => (
                    <li key={p.id}>
                      <button type="button" onClick={() => setOpen(p.id)} className="flex w-full items-center gap-3 px-4 py-3 text-start hover:bg-sunken">
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{p.name}</span>
                          <span className="block truncate text-sm text-muted">
                            {p.title} · {p.office}
                          </span>
                        </span>
                        {p.separated && <Pill tone="muted">Left {fmt(p.separated.effective)}</Pill>}
                        {v.proposals.some((x) => x.subject === p.id && x.status === "pending") && <Pill tone="ochre">Change pending</Pill>}
                        {v.relations.some((r) => r.a === p.id || r.b === p.id) && <Pill tone="plum">Related party</Pill>}
                      </button>
                    </li>
                  ))}
                </ul>
                <div className="mt-6">
                  <Relations view={v} onDeclare={() => setDeclare(true)} fmt={fmt} />
                </div>
              </section>
            )}

            {tab === "changes" && (
              <section className="mt-6 space-y-4">
                {v.proposals.length ? v.proposals.map((p) => <ProposalCard key={p.id} p={p} view={v} fmt={fmt} act={hr.act} onDone={setNotice} />) : <Empty>No changes yet.</Empty>}
              </section>
            )}

            {tab === "rules" && v.seesAll && v.rules && (
              <RulesView rules={v.rules} names={v.names} onPropose={() => setRulesOpen(true)} />
            )}

            {tab === "ledger" && v.seesAll && (
              <Ledger view={v} fmt={fmt} seal={hr.seal} reset={user.admin && v.sample ? hr.reset : null} onDone={setNotice} />
            )}
          </>
        )}
      </main>

      {person && v && (
        <Modal title={person.name} onClose={() => setOpen(null)}>
          <PersonRecord
            p={person}
            view={v}
            fmt={fmt}
            onChange={isHr && person.id !== v.me ? () => setForm({ type: "update", subject: person.id }) : undefined}
            onLeave={isHr && person.id !== v.me && !person.separated ? () => setForm({ type: "separate", subject: person.id }) : undefined}
            onCorrect={isHr && person.id !== v.me ? (id) => setForm({ type: "update", subject: person.id, corrects: id }) : undefined}
          />
        </Modal>
      )}
      {form && v && (
        <ChangeForm
          state={form}
          view={v}
          onClose={() => setForm(null)}
          submit={async (proposal) => {
            await hr.act({ action: "propose", proposal });
            setForm(null);
            setOpen(null);
            setNotice("Proposed. It takes effect once every step is signed.");
          }}
        />
      )}
      {declare && v && (
        <DeclareForm
          view={v}
          onClose={() => setDeclare(false)}
          submit={async (a, b, relation) => {
            await hr.act({ action: "declare", a, b, relation });
            setDeclare(false);
            setNotice("Recorded. Neither person can now sign changes to the other's record.");
          }}
        />
      )}
      {rulesOpen && v?.rules && (
        <RulesForm
          rules={v.rules}
          view={v}
          onClose={() => setRulesOpen(false)}
          submit={async (rules, reason) => {
            await hr.act({ action: "propose", proposal: { type: "rules", subject: null, effective: today(), rules, reason } });
            setRulesOpen(false);
            setNotice("New rules proposed. They apply once the CEO and the Board sign.");
          }}
        />
      )}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">{children}</p>;
}

/* ---------------- Integrity ---------------- */

function IntegrityBar({ view, fmt }: { view: HrView; fmt: (iso: string) => string }) {
  const i = view.integrity;
  if (!i.ok)
    return (
      <div role="alert" className="mt-5 rounded-2xl border border-clay bg-clay-soft p-4 text-sm text-clay">
        <p className="font-semibold">The HR record has been tampered with.</p>
        <p className="mt-1">{i.problem} Do not approve anything until this is explained. Compare the seal emails with the Ledger tab.</p>
      </div>
    );
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-3 text-sm">
      <span className="font-semibold text-leaf">✓ Record intact</span>
      <span className="text-muted">
        {i.entries} entries, each sealed to the one before
        {i.lastSeal ? ` · last daily seal ${fmt(i.lastSeal.at)}${i.lastSeal.sentTo ? " (emailed)" : ""}` : " · not sealed yet"}
        {i.unsealed > 0 && i.lastSeal ? ` · ${i.unsealed} since` : ""}
      </span>
    </div>
  );
}

/* ---------------- A person's record ---------------- */

function PersonRecord({
  p,
  view,
  fmt,
  onChange,
  onLeave,
  onCorrect,
}: {
  p: PersonView;
  view: HrView;
  fmt: (iso: string) => string;
  onChange?: () => void;
  onLeave?: () => void;
  onCorrect?: (proposal: number) => void;
}) {
  const own = p.id === view.me;
  const history = view.proposals.filter((x) => x.subject === p.id).sort((a, b) => b.id - a.id);
  const related = view.relations.filter((r) => r.a === p.id || r.b === p.id);
  return (
    <div className="space-y-5">
      {p.separated && (
        <p className="rounded-xl bg-sunken px-4 py-3 text-sm">
          Left ROP on {fmt(p.separated.effective)}: {p.separated.reason}
        </p>
      )}
      {(["job", "pay", "details"] as Group[])
        .filter((g) => p.groups.includes(g))
        .map((g) => (
          <section key={g}>
            <SectionLabel>{GROUP_LABEL[g]}</SectionLabel>
            <dl className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface px-4">
              {fieldsIn(g).map((k) => (
                <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 py-2 text-sm">
                  <dt className="text-muted">{FIELDS[k].label}</dt>
                  <dd className="min-w-0 tabular-nums">{show(k, p.fields[k], view.names, FIELDS[k].type === "money" ? p.fields.currency : undefined)}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      {p.upcoming.length > 0 && (
        <section>
          <SectionLabel>Approved, starting later</SectionLabel>
          <ul className="mt-2 space-y-1 text-sm">
            {p.upcoming.map((u) => (
              <li key={u.proposal}>
                From {fmt(u.effective)}: {Object.entries(u.fields).map(([k, val]) => `${FIELDS[k as FieldKey].label} ${show(k as FieldKey, val, view.names, p.fields.currency)}`).join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}
      {related.length > 0 && view.seesAll && (
        <section>
          <SectionLabel>Related parties</SectionLabel>
          <ul className="mt-2 text-sm">
            {related.map((r) => (
              <li key={r.n}>
                {view.names[r.a === p.id ? r.b : r.a] ?? (r.a === p.id ? r.b : r.a)} ({r.relation}), declared by {view.names[r.by] ?? r.by}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap gap-2">
        {onChange && (
          <button type="button" className={primaryBtn} onClick={onChange}>
            {own ? "Update my contact details" : "Propose a change"}
          </button>
        )}
        {onLeave && (
          <button type="button" className={quietBtn} onClick={onLeave}>
            Record leaving ROP
          </button>
        )}
      </div>
      {history.length > 0 && (
        <section>
          <SectionLabel>History</SectionLabel>
          <ul className="mt-2 space-y-2">
            {history.map((h) => (
              <li key={h.id} className="rounded-xl border border-line bg-surface px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">
                    #{h.id} {KIND_LABEL[h.kind]}
                  </span>
                  <StatusPill p={h} />
                  <span className="text-muted">from {fmt(h.effective)}</span>
                  {onCorrect && h.status === "approved" && (h.type === "update" || h.type === "hire") && (
                    <button type="button" onClick={() => onCorrect(h.id)} className="ms-auto text-sm font-semibold text-forest hover:underline">
                      Correct
                    </button>
                  )}
                </div>
                <Diff p={h} names={view.names} currency={p.fields.currency} />
                <p className="mt-1 text-muted">
                  {h.reason} · proposed by {view.names[h.by] ?? h.by}
                  {h.signatures.length > 0 && `, signed by ${h.signatures.map((s) => `${view.names[s.by] ?? s.by} (${ROLE_LABEL[s.as]})`).join(", ")}`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function StatusPill({ p }: { p: ProposalView }) {
  if (p.status === "approved") return <Pill tone="forest">Approved</Pill>;
  if (p.status === "rejected") return <Pill tone="clay">Sent back</Pill>;
  if (p.status === "withdrawn") return <Pill tone="muted">Withdrawn</Pill>;
  return <Pill tone="ochre">Waiting</Pill>;
}

function Diff({ p, names, currency }: { p: ProposalView; names: Record<string, string>; currency?: Value }) {
  if (!p.fields) return null;
  const keys = Object.keys(p.fields) as FieldKey[];
  if (!keys.length) return <p className="mt-1 text-xs text-muted">Details you may not see.</p>;
  const cur = p.fields.currency ?? p.before?.currency ?? currency;
  return (
    <table className="mt-2 w-full text-sm">
      <tbody>
        {keys.map((k) => (
          <tr key={k} className="align-top">
            <td className="w-44 py-0.5 pe-3 text-muted">{FIELDS[k].label}</td>
            <td className="py-0.5 tabular-nums">
              {p.type === "update" && <span className="text-muted line-through decoration-1">{show(k, p.before?.[k], names, cur)}</span>}
              {p.type === "update" && " → "}
              <span className="font-medium">{show(k, p.fields?.[k], names, cur)}</span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* ---------------- A proposed change ---------------- */

function ProposalCard({ p, view, fmt, act, onDone }: { p: ProposalView; view: HrView; fmt: (iso: string) => string; act: (a: HrAction) => Promise<void>; onDone: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [back, setBack] = useState<string | null>(null);
  const run = async (a: HrAction, msg: string) => {
    setBusy(true);
    setError("");
    try {
      await act(a);
      onDone(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const who = p.subject ? (view.names[p.subject] ?? p.subject) : "Everyone";
  // Fields that only some kinds of change carry.
  const extra = p as ProposalView & { other?: string; rules?: RulesInput; month?: string; group?: string; lines?: unknown[]; leave?: string; hours?: number };
  return (
    <article className="rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <StatusPill p={p} />
        <span className="text-xs text-muted">
          #{p.id} · proposed by {view.names[p.by] ?? p.by}, {fmt(p.at)}
        </span>
      </div>
      <h3 className="mt-2 text-lg font-semibold">
        {KIND_LABEL[p.kind]}: {who}
      </h3>
      <p className="text-sm text-muted">Takes effect {fmt(p.effective)}</p>
      {p.type === "separate" && <p className="mt-2 text-sm">Leaving ROP.</p>}
      {extra.other && <p className="mt-2 text-sm">Remove the link between {who} and {view.names[extra.other] ?? extra.other}.</p>}
      {extra.leave && typeof extra.hours === "number" && (
        <p className="mt-2 text-sm">
          {extra.hours > 0 ? "Add" : "Take away"} {Math.abs(extra.hours / 8)} days of {extra.leave === "vacation" ? "annual" : extra.leave} leave.
        </p>
      )}
      {extra.rules && <RulesView rules={fullRules(extra.rules)} names={view.names} compact />}
      {extra.month && extra.group && (
        <p className="mt-2 text-sm">
          {extra.group} payroll for {extra.month}
          {extra.lines ? `, ${extra.lines.length} people` : ""}.{" "}
          <a href={`/payroll?month=${extra.month}&group=${encodeURIComponent(extra.group)}`} className="font-semibold text-forest hover:underline">
            Open the register
          </a>
        </p>
      )}
      <Diff p={p} names={view.names} currency={view.people.find((x) => x.id === p.subject)?.fields.currency} />
      <p className="mt-3 text-sm">
        <span className="text-muted">Reason: </span>
        {p.reason}
      </p>
      {p.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 rounded-xl bg-ochre-soft px-3 py-2 text-sm text-ochre">
          {p.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <ol className="mt-3 flex flex-wrap gap-2 text-xs">
        {p.roles.map((r, i) => {
          const s = p.signatures[i];
          const isNext = p.status === "pending" && i === p.signatures.length;
          return (
            <li key={i} className={`rounded-full border px-3 py-1 ${s ? "border-forest text-leaf" : isNext ? "border-ochre text-ochre" : "border-line text-muted"}`}>
              {i + 1}. {ROLE_LABEL[r]}
              {s ? `: ${view.names[s.by] ?? s.by}${s.as !== r ? ` for the ${ROLE_LABEL[s.as]}` : ""}, ${fmt(s.at)}` : isNext && p.next?.fellBack ? ": falls to the Board (conflict)" : isNext ? ": waiting" : ""}
            </li>
          );
        })}
      </ol>
      {p.status === "pending" && p.next && view.seesAll && (
        <p className="mt-2 text-xs text-muted">
          Can sign now: {p.next.people.length ? p.next.people.map((x) => view.names[x] ?? x).join(", ") : "nobody: everyone holding this role has a conflict. Change the rules to add someone."}
          {p.next.blocked.length > 0 && ` · Cannot: ${p.next.blocked.map((b) => `${view.names[b.id] ?? b.id} (${b.why})`).join(", ")}`}
        </p>
      )}
      {p.closedBy?.note && (
        <p className="mt-2 text-sm text-clay">
          Sent back by {view.names[p.closedBy.by] ?? p.closedBy.by}: {p.closedBy.note}
        </p>
      )}
      {p.cannotSign && <p className="mt-2 text-sm text-muted">You hold this role but cannot sign: {p.cannotSign}.</p>}
      {error && (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      )}
      {(p.canSign || p.canWithdraw) && back === null && (
        <div className="mt-4 flex flex-wrap gap-2">
          {p.canSign && (
            <>
              <button type="button" disabled={busy} className={primaryBtn} onClick={() => run({ action: "approve", proposal: p.id }, `Signed #${p.id}.`)}>
                Approve as {ROLE_LABEL[p.next?.fellBack ? "board" : p.next!.role]}
              </button>
              <button type="button" disabled={busy} className={quietBtn} onClick={() => setBack("")}>
                Send back
              </button>
            </>
          )}
          {p.canWithdraw && (
            <button type="button" disabled={busy} className={quietBtn} onClick={() => run({ action: "withdraw", proposal: p.id }, `Withdrew #${p.id}.`)}>
              Withdraw
            </button>
          )}
        </div>
      )}
      {back !== null && (
        <div className="mt-4">
          <label className="text-sm font-medium" htmlFor={`back-${p.id}`}>
            Why are you sending it back?
          </label>
          <textarea id={`back-${p.id}`} value={back} onChange={(e) => setBack(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || back.trim().length < 3} className={dangerBtn} onClick={() => run({ action: "reject", proposal: p.id, note: back }, `Sent back #${p.id}.`).then(() => setBack(null))}>
              Send back
            </button>
            <button type="button" className={quietBtn} onClick={() => setBack(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

/* ---------------- Proposing a change ---------------- */

type FormState = { type: "hire" } | { type: "update"; subject: string; own?: boolean; corrects?: number } | { type: "separate"; subject: string };

function ChangeForm({ state, view, onClose, submit }: { state: FormState; view: HrView; onClose: () => void; submit: (p: ProposalInput) => Promise<void> }) {
  const person = "subject" in state ? view.people.find((p) => p.id === state.subject) : undefined;
  const corrected = state.type === "update" && state.corrects ? view.proposals.find((p) => p.id === state.corrects) : undefined;
  const [values, setValues] = useState<Fields>(() => (corrected?.fields ? { ...corrected.fields } : {}));
  const [effective, setEffective] = useState(corrected?.effective ?? today());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const own = state.type === "update" && !!state.own;
  const groups: Group[] = own ? ["details"] : ["job", "pay", "details"];
  const changed = (Object.keys(values) as FieldKey[]).filter((k) => state.type === "hire" ? values[k] !== "" && values[k] != null : values[k] !== (person?.fields[k] ?? null) || corrected);
  const title = state.type === "hire" ? "Add a person" : state.type === "separate" ? `${person?.name}: leaving ROP` : corrected ? `${person?.name}: correct change #${corrected.id}` : own ? "Update my contact details" : `${person?.name}: propose a change`;

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const fields = Object.fromEntries(changed.map((k) => [k, values[k] ?? null])) as Fields;
      if (state.type === "hire") await submit({ type: "hire", subject: "new", effective: String(fields.startDate ?? effective), fields, reason });
      else if (state.type === "separate") await submit({ type: "separate", subject: state.subject, effective, reason });
      else await submit({ type: "update", subject: state.subject, effective, fields, reason, ...(state.corrects ? { corrects: state.corrects } : {}) });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const missing = state.type === "hire" ? HIRE_REQUIRED.filter((k) => values[k] == null || values[k] === "") : [];

  return (
    <Modal title={title} onClose={onClose}>
      <div className="space-y-5">
        {corrected && <p className="rounded-xl bg-sunken px-3 py-2 text-sm">A correction is a new entry. Change #{corrected.id} stays in the history, marked as corrected.</p>}
        {state.type !== "separate" &&
          groups.map((g) => (
            <fieldset key={g}>
              <legend className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">{GROUP_LABEL[g]}</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {fieldsIn(g).map((k) => (
                  <FieldInput key={k} k={k} value={k in values ? values[k] : (person?.fields[k] ?? null)} directory={view.directory} required={state.type === "hire" && HIRE_REQUIRED.includes(k)} onChange={(val) => setValues((s) => ({ ...s, [k]: val }))} />
                ))}
              </div>
            </fieldset>
          ))}
        {state.type !== "hire" && (
          <label className="block text-sm">
            <span className="font-medium">{state.type === "separate" ? "Last day" : "Takes effect"}</span>
            <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base sm:w-56" />
            {effective < today() && <span className="mt-1 block text-ochre">Backdated: the approvers will see this.</span>}
          </label>
        )}
        <label className="block text-sm">
          <span className="font-medium">Reason (required, kept forever)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-clay">
            {error}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} disabled={busy || reason.trim().length < 3 || (state.type === "update" && !changed.length) || missing.length > 0} onClick={() => void send()}>
            {busy ? "Sending…" : "Propose"}
          </button>
          <button type="button" className={quietBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
        {missing.length > 0 && <p className="text-xs text-muted">Still needed: {missing.map((k) => FIELDS[k].label).join(", ")}.</p>}
      </div>
    </Modal>
  );
}

function FieldInput({ k, value, onChange, directory, required }: { k: FieldKey; value: Value | undefined; onChange: (v: Value) => void; directory: { id: string; name: string }[]; required?: boolean }) {
  const f = FIELDS[k];
  const cls = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
  const label = (
    <span className="font-medium">
      {f.label}
      {required && <span className="text-clay"> *</span>}
    </span>
  );
  const str = value == null ? "" : String(value);
  return (
    <label className="block text-sm">
      {label}
      {f.type === "select" ? (
        <select value={str} onChange={(e) => onChange(e.target.value || null)} className={cls}>
          <option value="">—</option>
          {f.options.map((o) => (
            <option key={o}>{o}</option>
          ))}
        </select>
      ) : f.type === "person" ? (
        <select value={str} onChange={(e) => onChange(e.target.value || null)} className={cls}>
          <option value="">—</option>
          {directory.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      ) : f.type === "money" || f.type === "number" ? (
        <input type="number" inputMode="decimal" min={0} step="any" value={str} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))} className={cls} />
      ) : (
        <input type={f.type === "date" ? "date" : "text"} value={str} onChange={(e) => onChange(e.target.value || null)} className={cls} />
      )}
    </label>
  );
}

/* ---------------- Related parties ---------------- */

function Relations({ view, onDeclare, fmt }: { view: HrView; onDeclare: () => void; fmt: (iso: string) => string }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-4">
      <SectionLabel>Related parties</SectionLabel>
      <p className="mt-1 text-sm text-muted">Family members and other close relations. Nobody can sign a change to the record of someone they are related to. Declaring takes effect at once; removing a link needs approval.</p>
      {view.relations.length > 0 && (
        <ul className="mt-3 space-y-1 text-sm">
          {view.relations.map((r) => (
            <li key={r.n}>
              {view.names[r.a] ?? r.a} and {view.names[r.b] ?? r.b}: {r.relation} <span className="text-muted">(declared by {view.names[r.by] ?? r.by}, {fmt(r.at)})</span>
            </li>
          ))}
        </ul>
      )}
      <button type="button" className={`${quietBtn} mt-3`} onClick={onDeclare}>
        Declare a related person
      </button>
    </section>
  );
}

function DeclareForm({ view, onClose, submit }: { view: HrView; onClose: () => void; submit: (a: string, b: string, relation: string) => Promise<void> }) {
  const isHr = view.roles.includes("hr");
  const [a, setA] = useState(view.me);
  const [b, setB] = useState("");
  const [relation, setRelation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const cls = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
  return (
    <Modal title="Declare a related person" onClose={onClose}>
      <div className="space-y-4">
        {isHr && (
          <label className="block text-sm">
            <span className="font-medium">Person</span>
            <select value={a} onChange={(e) => setA(e.target.value)} className={cls}>
              {view.directory.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="block text-sm">
          <span className="font-medium">{isHr ? "Is related to" : "I am related to"}</span>
          <select value={b} onChange={(e) => setB(e.target.value)} className={cls}>
            <option value="">—</option>
            {view.directory
              .filter((d) => d.id !== a)
              .map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="font-medium">How</span>
          <input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder="For example: brother, cousin, spouse" className={cls} />
        </label>
        {error && (
          <p role="alert" className="text-sm text-clay">
            {error}
          </p>
        )}
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || !b || relation.trim().length < 2}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await submit(a, b, relation);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Declare
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- Rules ---------------- */

function RulesView({ rules, names, onPropose, compact }: { rules: Rules; names: Record<string, string>; onPropose?: () => void; compact?: boolean }) {
  return (
    <section className={compact ? "mt-3" : "mt-6 space-y-6"}>
      {!compact && (
        <>
          <p className="max-w-2xl text-sm text-muted">
            Every signature in the app needs a type of role, not a title. This table says who in this organization holds each type. Whatever it says, nobody signs anything about themselves, a related person or their own supervisor, or anything they
            proposed; a step whose holders all have a conflict falls to the board. Changing this table needs the executive head and the board.
          </p>
          <div className="space-y-3">
            {HR_ROLES.map((r) => (
              <article key={r} className="rounded-2xl border border-line bg-surface p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="font-semibold">{ROLE_LABEL[r]}</h3>
                  <span className="text-sm">{rules.holders[r].map((x) => names[x] ?? x).join(", ") || <span className="text-clay">Nobody named yet</span>}</span>
                </div>
                <p className="mt-1 text-sm text-muted">{ROLE_HELP[r]}</p>
                {SIGNATURES.some((g) => g.by.includes(r)) && (
                  <ul className="mt-2 list-disc ps-5 text-sm">
                    {SIGNATURES.filter((g) => g.by.includes(r)).map((g) => (
                      <li key={g.area + g.what}>
                        <span className="text-muted">{g.area}:</span> {g.what}
                        {g.by.length > 1 && <span className="text-muted"> (with {g.by.filter((x) => x !== r).map((x) => SIGNER_LABEL[x].toLowerCase()).join(", ")})</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            ))}
          </div>
          <SectionLabel>Steps for each kind of HR change</SectionLabel>
        </>
      )}
      <table className="w-full text-sm">
        <tbody className="divide-y divide-line">
          {CHANGE_KINDS.map((k) => (
            <tr key={k}>
              <td className="py-1.5 pe-3 text-muted">{KIND_LABEL[k]}</td>
              <td className="py-1.5">HR proposes → {rules.steps[k].map((r) => ROLE_LABEL[r]).join(" → ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {compact && (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {HR_ROLES.map((r) => (
              <tr key={r}>
                <td className="w-40 py-1.5 pe-3 text-muted">{ROLE_LABEL[r]}</td>
                <td className="py-1.5">{rules.holders[r].map((x) => names[x] ?? x).join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {onPropose && (
        <button type="button" className={quietBtn} onClick={onPropose}>
          Propose changes to the authority table
        </button>
      )}
    </section>
  );
}

function RulesForm({ rules, view, onClose, submit }: { rules: Rules; view: HrView; onClose: () => void; submit: (r: Rules, reason: string) => Promise<void> }) {
  const [draft, setDraft] = useState<Rules>(() => JSON.parse(JSON.stringify(rules)));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const setStep = (k: (typeof CHANGE_KINDS)[number], i: number, r: HrRole | "") =>
    setDraft((d) => {
      const steps = [...d.steps[k]];
      if (r) steps[i] = r;
      else steps.splice(i, 1);
      return { ...d, steps: { ...d.steps, [k]: steps.length ? steps : d.steps[k] } };
    });
  const toggle = (r: HrRole, id: string) => setDraft((d) => ({ ...d, holders: { ...d.holders, [r]: d.holders[r].includes(id) ? d.holders[r].filter((x) => x !== id) : [...d.holders[r], id] } }));
  const sel = "rounded-lg border border-line bg-paper px-2 py-1.5 text-sm";
  return (
    <Modal title="Propose changes to the authority table" onClose={onClose}>
      <div className="space-y-5">
        <section>
          <SectionLabel>Steps</SectionLabel>
          <div className="mt-2 space-y-2">
            {CHANGE_KINDS.map((k) => (
              <div key={k} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-56 text-muted">{KIND_LABEL[k]}</span>
                {[...draft.steps[k], ""].slice(0, 4).map((r, i) => (
                  <select key={i} value={r} onChange={(e) => setStep(k, i, e.target.value as HrRole | "")} className={sel} aria-label={`${KIND_LABEL[k]} step ${i + 1}`}>
                    <option value="">{i < draft.steps[k].length ? "Remove" : "Add a step"}</option>
                    {HR_ROLES.map((x) => (
                      <option key={x} value={x}>
                        {ROLE_LABEL[x]}
                      </option>
                    ))}
                  </select>
                ))}
              </div>
            ))}
          </div>
        </section>
        <section>
          <SectionLabel>Role holders</SectionLabel>
          <div className="mt-2 space-y-3">
            {HR_ROLES.map((r) => (
              <fieldset key={r}>
                <legend className="text-sm font-medium">{ROLE_LABEL[r]}</legend>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {view.directory.map((d) => (
                    <label key={d.id} className="flex items-center gap-1.5 text-sm">
                      <input type="checkbox" checked={draft.holders[r].includes(d.id)} onChange={() => toggle(r, d.id)} />
                      {d.name}
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
        </section>
        <section>
          <SectionLabel>Unused annual leave when someone leaves</SectionLabel>
          <p className="mt-1 text-xs text-muted">Follow the law and policy in force for each group, and say where it comes from. While a group is &ldquo;not decided&rdquo;, a leaver&rsquo;s final pay waits for HR.</p>
          <div className="mt-2 space-y-2">
            {PAYOUT_GROUPS.map((g) => {
              const v = draft.leavePayout?.[g] ?? DEFAULT_PAYOUT[g];
              const put = (patch: Partial<typeof v>) => setDraft((d) => ({ ...d, leavePayout: { ...DEFAULT_PAYOUT, ...d.leavePayout, [g]: { ...v, ...patch } } }));
              return (
                <div key={g} className="grid gap-2 text-sm sm:grid-cols-[11rem_9rem_7rem_1fr] sm:items-center">
                  <span className="text-muted">{PAYOUT_GROUP_LABEL[g]}</span>
                  <select value={v.rule} onChange={(e) => put({ rule: e.target.value as typeof v.rule })} className={sel} aria-label={`${PAYOUT_GROUP_LABEL[g]}: payout`}>
                    <option value="pays">Paid out</option>
                    <option value="none">Not paid out</option>
                    <option value="unset">Not decided</option>
                  </select>
                  <input
                    type="number"
                    min={0}
                    disabled={v.rule !== "pays"}
                    placeholder="No cap"
                    value={v.capDays ?? ""}
                    onChange={(e) => put({ capDays: e.target.value === "" ? null : Number(e.target.value) })}
                    className={sel}
                    aria-label={`${PAYOUT_GROUP_LABEL[g]}: most days paid`}
                  />
                  <input value={v.source} onChange={(e) => put({ source: e.target.value })} className={sel} aria-label={`${PAYOUT_GROUP_LABEL[g]}: source`} placeholder="Law or policy, with the section" />
                </div>
              );
            })}
          </div>
        </section>
        <label className="block text-sm">
          <span className="font-medium">Reason (required, kept forever)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
        </label>
        {error && (
          <p role="alert" className="text-sm text-clay">
            {error}
          </p>
        )}
        <button
          type="button"
          className={primaryBtn}
          disabled={busy || reason.trim().length < 3}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await submit(draft, reason);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          Propose
        </button>
      </div>
    </Modal>
  );
}

/* ---------------- Ledger ---------------- */

const KIND_TEXT: Record<string, string> = { start: "Rules set up", propose: "Proposed", approve: "Signed", reject: "Sent back", withdraw: "Withdrawn", declare: "Related party declared", seal: "Sealed" };

function Ledger({ view, fmt, seal, reset, onDone }: { view: HrView; fmt: (iso: string) => string; seal: () => Promise<{ sealed: boolean; why?: string }>; reset: (() => Promise<void>) | null; onDone: (s: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ignored = new Map(view.ignored.map((i) => [i.n, i.why]));
  const run = async (fn: () => Promise<string>) => {
    setBusy(true);
    setError("");
    try {
      onDone(await fn());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-6 space-y-6">
      <p className="max-w-2xl text-sm text-muted">
        Every entry, newest first. Each fingerprint is worked out from the entry and the fingerprint before it, so changing any entry changes every fingerprint after it. Once a day the latest fingerprint is
        sealed and emailed outside the app; if it ever differs from the email, the record was changed.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={busy} className={quietBtn} onClick={() => run(async () => { const r = await seal(); return r.sealed ? "Sealed." : (r.why ?? "Not sealed."); })}>
          Seal now
        </button>
        {reset && (
          <button type="button" disabled={busy} className={quietBtn} onClick={() => run(async () => { await reset(); return "Sample records restored."; })}>
            Reset sample records
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-sm text-clay">
          {error}
        </p>
      )}
      {view.ignored.length > 0 && (
        <div className="rounded-2xl border border-clay bg-clay-soft p-4 text-sm text-clay">
          <p className="font-semibold">Entries that do not count</p>
          <p className="mt-1">Written to the record but not allowed by the rules, so they have no effect. Ask who wrote them and why.</p>
          <ul className="mt-2 list-disc ps-5">
            {view.ignored.map((i) => (
              <li key={i.n}>
                Entry {i.n} ({KIND_TEXT[i.kind] ?? i.kind}) by {view.names[i.actor] ?? i.actor}: {i.why}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-start text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start font-medium">#</th>
              <th className="px-3 py-2 text-start font-medium">When</th>
              <th className="px-3 py-2 text-start font-medium">Who</th>
              <th className="px-3 py-2 text-start font-medium">What</th>
              <th className="px-3 py-2 text-start font-medium">Fingerprint</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {view.entries.map((e) => (
              <tr key={e.n} className={ignored.has(e.n) ? "bg-clay-soft" : e.kind === "seal" ? "bg-mist" : ""}>
                <td className="px-3 py-1.5 tabular-nums">{e.n}</td>
                <td className="px-3 py-1.5 whitespace-nowrap">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="px-3 py-1.5">{view.names[e.actor] ?? e.actor}</td>
                <td className="px-3 py-1.5">
                  {KIND_TEXT[e.kind] ?? e.kind}
                  {e.subject ? `: ${view.names[e.subject] ?? e.subject}` : ""}
                </td>
                <td className="px-3 py-1.5 font-mono text-xs text-muted" title={e.hash}>
                  {e.hash.slice(0, 12)}…
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {view.seals.length > 0 && (
        <section>
          <SectionLabel>Seals</SectionLabel>
          <ul className="mt-2 space-y-1 text-sm">
            {view.seals.map((s) => (
              <li key={s.n}>
                {fmt(s.at)}: entries 1 to {s.upTo}, <span className="font-mono text-xs">{s.hash}</span> {s.sentTo ? `· emailed to ${s.sentTo}` : "· not emailed (HR_SEAL_TO not set)"}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

/* ---------------- Modal ---------------- */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[92vh] w-full overflow-y-auto bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-line"
      >
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 font-display text-2xl leading-snug">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl text-muted hover:bg-sunken">
            ×
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}

/**
 * The HR record's first entry: who holds each approval role. Shown until the book is started.
 * In a real book this entry can never be changed or deleted; later changes to the table need a
 * proposal signed by the executive head and the board.
 */
function StartRecord({ view, admin, userId, onStarted }: { view: HrView; admin: boolean; userId: string; onStarted: (msg: string) => void }) {
  const [holders, setHolders] = useState<Partial<Record<HrRole, string[]>>>({});
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!admin)
    return (
      <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">
        The HR record has not been started yet. An administrator starts it by naming who holds each approval role.
      </p>
    );
  const toggle = (r: HrRole, id: string) => setHolders((h) => ({ ...h, [r]: (h[r] ?? []).includes(id) ? (h[r] ?? []).filter((x) => x !== id) : [...(h[r] ?? []), id] }));
  const name = (id: string) => view.names[id] ?? id;
  const both = (holders.ceo ?? []).filter((x) => (holders.board ?? []).includes(x));
  const missing = (["ceo", "board", "hr"] as HrRole[]).filter((r) => !(holders[r] ?? []).length);
  const ready = !missing.length && !both.length && confirm.trim() === view.book;
  const start = async () => {
    setBusy(true);
    setError("");
    try {
      await call("/api/hr/start", userId, { method: "POST", body: JSON.stringify({ holders, confirm }) });
      onStarted("The HR record is started. Changes to the authority table now need the executive head and the board.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-5">
      <h2 className="font-display text-2xl">Start the HR record</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        Name who holds each approval role. This is the record&rsquo;s first entry{view.sample ? "" : ", and in this real book it can never be changed or deleted"}. After it, the table changes only through a proposal signed by the executive head and the board. Only people added under{" "}
        <a href="/settings/people" className="font-semibold text-forest hover:underline">
          People and roles
        </a>{" "}
        who have a sign-in email can be named.
      </p>
      <div className="mt-4 divide-y divide-line">
        {HR_ROLES.map((r) => (
          <div key={r} className="py-3">
            <p className="text-sm font-semibold">
              {ROLE_LABEL[r]}
              {(["ceo", "board", "hr"] as HrRole[]).includes(r) && <span className="ms-2 text-xs font-normal text-clay">required</span>}
            </p>
            <p className="text-xs text-muted">{ROLE_HELP[r]}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {view.directory.filter((d) => !view.eligible || view.eligible.includes(d.id)).map((d) => {
                const on = (holders[r] ?? []).includes(d.id);
                return (
                  <button key={d.id} type="button" aria-pressed={on} onClick={() => toggle(r, d.id)} className={`rounded-full border px-3 py-1 text-xs ${on ? "border-forest bg-mist font-semibold text-leaf" : "border-line text-muted hover:border-forest"}`}>
                    {d.name}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {both.length > 0 && <p className="mt-3 text-sm text-clay">{both.map(name).join(", ")} cannot be both executive head and board: nobody may sign two steps of one change.</p>}
      {missing.length > 0 && <p className="mt-3 text-sm text-muted">Still needed: {missing.map((r) => ROLE_LABEL[r]).join(", ")}.</p>}
      <label className="mt-4 block max-w-sm text-sm">
        To confirm, type the book&rsquo;s name: <span className="font-mono">{view.book}</span>
        <input className="mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {error && (
        <p role="alert" className="mt-3 text-sm text-clay">
          {error}
        </p>
      )}
      <button type="button" className={`${primaryBtn} mt-4`} disabled={!ready || busy} onClick={() => void start()}>
        Start the HR record
      </button>
    </section>
  );
}

/** BambooHR's employee report in; one "new person" proposal per employee out, each approved as usual. */
function BambooImport({ user, onDone }: { user: string; onDone: (msg: string) => void }) {
  const [file, setFile] = useState("");
  const [rows, setRows] = useState<BambooRow[] | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const read = async (f: File) => {
    setErr("");
    setRows(null);
    setFile(f.name);
    try {
      const { readWorkbook } = await import("@/lib/read-sheet");
      const { parseCsv } = await import("@/lib/results-import");
      const grid = /\.csv$/i.test(f.name) ? parseCsv(await f.text()) : ((await readWorkbook(await f.arrayBuffer()))[0]?.grid ?? []);
      const out = readBamboo(grid);
      if (out.missing.length) return setErr(`The report needs columns for: ${out.missing.join(", ")}.`);
      setRows(out.rows);
    } catch (e) {
      setErr(`Could not read ${f.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  const ready = rows?.filter((r) => !r.skip && !r.errors.length) ?? [];
  const bad = rows?.filter((r) => !r.skip && r.errors.length) ?? [];
  return (
    <section className="mt-3 rounded-2xl border border-line bg-surface p-4">
      <p className="text-sm font-semibold">Move people from BambooHR</p>
      <p className="mt-1 text-sm text-muted">
        In BambooHR, run a report with First Name, Last Name, Job Title, Location, Employment Status, Hire Date, Reports To, Pay Rate, Pay Per, Mobile Phone and Contract End Date, and export it. Each active person becomes a new-person proposal that the finance head and the executive head approve as usual. Bank details, ID and leave balances are added after, through the normal changes.
      </p>
      <input type="file" accept=".csv,.xlsx" className="mt-3 block text-sm" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} aria-label="BambooHR report" />
      {err && <p className="mt-2 text-sm text-clay">{err}</p>}
      {rows && (
        <>
          <p className="mt-3 text-sm">
            {ready.length} ready, {bad.length} to fix in the report, {rows.filter((r) => r.skip).length} skipped (inactive).
          </p>
          <ul className="mt-2 max-h-72 divide-y divide-line overflow-auto rounded-xl border border-line text-sm">
            {rows.map((r) => (
              <li key={r.row} className={`px-3 py-2 ${r.skip ? "text-muted" : ""}`}>
                <span className="font-semibold">{String(r.fields.name || `Row ${r.row}`)}</span> · {String(r.fields.title ?? "")} · {String(r.fields.office ?? "")}, {String(r.fields.employment ?? "")}
                {r.fields.pay != null && ` · ${r.fields.currency} ${Number(r.fields.pay).toLocaleString("en-US")} per ${String(r.fields.payBasis).toLowerCase()}`}
                {r.reportsTo && ` · reports to ${r.reportsTo}`}
                {r.skip && <span className="block text-xs">{r.skip}</span>}
                {r.errors.length > 0 && <span className="block text-xs text-clay">{r.errors.join("; ")}</span>}
                {r.warnings.length > 0 && <span className="block text-xs text-ochre">{r.warnings.join("; ")}</span>}
              </li>
            ))}
          </ul>
          <button
            type="button"
            className={`${primaryBtn} mt-3`}
            disabled={busy || !ready.length}
            onClick={async () => {
              setBusy(true);
              setErr("");
              try {
                const res = await fetch("/api/hr/import", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: JSON.stringify({ file, rows: ready.map((r) => ({ fields: r.fields, reportsTo: r.reportsTo })) }) });
                const d = await res.json();
                if (!res.ok) throw new Error(d.error ?? "Import failed.");
                onDone(`${d.made.length} people proposed from BambooHR${d.skipped.length ? `; ${d.skipped.length} skipped (${d.skipped.map((x: { name: string; why: string }) => `${x.name}: ${x.why}`).slice(0, 3).join("; ")})` : ""}. They join the record once approved.`);
              } catch (e) {
                setErr(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Propose {ready.length} people
          </button>
        </>
      )}
    </section>
  );
}
