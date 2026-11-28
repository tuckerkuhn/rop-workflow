"use client";

import { plainError } from "@/lib/plain-error";
import { askConfirm } from "@/components/app/dialogs";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, dangerBtn, primaryBtn, quietBtn, StatusPill as Status } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
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
import { ROLE_HELP, SIGNATURES, SIGNER_LABEL, namedGrants } from "@/lib/authority";
import { users } from "@/lib/demo";
import { DEFAULT_LISTS, screeningProblem } from "@/lib/staff-screening";

/**
 * People: the HR record. Every change is proposed, signed by the people the rules name, and
 * written as a new ledger entry; nothing is ever edited or deleted.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
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

/** Column templates for the ruled tables on this page. */
const TEAM_COLS = "minmax(0,1fr) 7rem";
const PEOPLE_COLS = "minmax(0,1fr) auto";
const REL_COLS = "minmax(0,1fr) 7rem";
const HISTORY_COLS = "3rem minmax(0,1fr)";
const ROLE_COLS = "12rem minmax(0,1fr)";
const STEP_COLS = "minmax(0,1fr) minmax(0,1.6fr)";
const ENTRY_COLS = "3.5rem 11rem minmax(0,1fr) minmax(0,1.4fr) 8rem";
const SEAL_COLS = "8rem minmax(0,1fr)";
/** Field types shown as figures (mono, lined up). */
const isFigure = (k: FieldKey) => ["money", "number", "date"].includes(FIELDS[k].type);

type Tab = "waiting" | "people" | "changes" | "rules" | "ledger";
/** The tabs HR (everyone who sees all records) has, and the tabs everyone else has. */
const HR_TABS: Tab[] = ["waiting", "people", "changes", "rules", "ledger"];
const OWN_TABS: Tab[] = ["waiting", "changes"];

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
  // Open on the queue only when something is waiting; otherwise HR lands on the list of people.
  // A link like ?person=<id>&change=contractEnd (from Leaving and renewals) opens that person's change form.
  const landed = useRef(false);
  useEffect(() => {
    if (!v || !v.started || landed.current) return;
    landed.current = true;
    if (v.seesAll && !v.proposals.some((p) => p.canSign)) setTab("people");
    const q = new URLSearchParams(window.location.search);
    // ?tab=<id> (for example ?tab=rules from People and roles) opens that tab when this viewer has it.
    const want = q.get("tab") as Tab | null;
    if (want && (v.seesAll ? HR_TABS : OWN_TABS).includes(want)) setTab(want);
    const who = q.get("person");
    const change = q.get("change");
    if (who && v.roles.includes("hr") && who !== v.me && v.people.some((p) => p.id === who)) {
      setTab("people");
      const leaving = change === "leave" && !v.people.find((p) => p.id === who)?.separated;
      setForm(leaving ? { type: "separate", subject: who } : { type: "update", subject: who, ...(change && change in FIELDS ? { first: change as FieldKey } : {}) });
    }
  }, [v]);
  if (!user) return null;
  const waiting = v?.proposals.filter((p) => p.canSign) ?? [];
  const mine = v?.people.find((p) => p.id === v.me);
  const isHr = !!v?.roles.includes("hr");
  const tabs: { id: Tab; label: string }[] = v?.seesAll
    ? [
        { id: "waiting", label: `Waiting for you (${waiting.length})` },
        { id: "people", label: "People" },
        { id: "changes", label: "All changes" },
        { id: "rules", label: "Who approves what" },
        { id: "ledger", label: "Full history (tamper check)" },
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
        <PageHead title="People" meta={v?.seesAll && v.started ? `${v.people.length} ${v.people.length === 1 ? "person" : "people"}` : undefined}>
          <p>The HR record: every change is proposed, signed by the people the rules name, and kept forever.</p>
          {/* Seven links: on a phone they wrap onto a second line instead of squeezing the last ones off the edge. */}
          <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <a href="/timesheets" className="font-semibold text-forest hover:underline">
              Timesheets
            </a>
            <a href="/leave" className="font-semibold text-forest hover:underline">
              Leave
            </a>
            <a href="/expenses" className="font-semibold text-forest hover:underline">
              Expense reports
            </a>
            <a href="/onboarding" className="font-semibold text-forest hover:underline">
              Starting at ROP
            </a>
            <a href="/offboarding" className="font-semibold text-forest hover:underline">
              Leaving and renewals
            </a>
            <a href="/training" className="font-semibold text-forest hover:underline">
              Training log
            </a>
            {v?.seesAll && (
              <a href="/payroll" className="font-semibold text-forest hover:underline">
                Payroll
              </a>
            )}
          </span>
        </PageHead>
        {v?.sample && (
          <p className="mt-4 bg-sunken px-4 py-2 text-xs text-muted">
            Sample records: fictional people and pay. Real records go in a separate book that can never be reset.
          </p>
        )}
        {hr.error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {hr.error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
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
                  className={`min-h-11 shrink-0 px-3 font-mono text-xs ${tab === t.id ? "font-bold text-ink underline decoration-ochre decoration-4 underline-offset-8" : "text-muted hover:text-ink"}`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "waiting" && (
              <section className="mt-6 space-y-4">
                {v.seesAll ? (
                  waiting.length ? (
                    <>
                      {waiting.map((p) => (
                        <ProposalCard key={p.id} p={p} view={v} fmt={fmt} act={hr.act} onDone={setNotice} first={waiting.length > 1 && p.id === Math.min(...waiting.map((x) => x.id))} />
                      ))}
                      {waiting.length > 1 && <p className="text-xs text-muted">Shaded: the change that has waited longest.</p>}
                    </>
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
                    <SectionHead>My team</SectionHead>
                    <LedgerTable cols={TEAM_COLS} head={["Person", "Since"]} label="My team">
                      {v.people
                        .filter((p) => p.id !== v.me)
                        .map((p) => (
                          <LedgerRow key={p.id} cols={TEAM_COLS} className="text-sm">
                            <span className="min-w-0">
                              <span className="block font-bold">{p.name}</span>
                              <span className="block text-muted">
                                {p.title}
                                {p.fields.contractEnd ? (
                                  <>
                                    {" · contract ends "}
                                    <Fig className="text-xs">{fmt(String(p.fields.contractEnd))}</Fig>
                                  </>
                                ) : (
                                  ""
                                )}
                              </span>
                            </span>
                            <Fig className="text-start">{p.fields.startDate ? fmt(String(p.fields.startDate)) : "—"}</Fig>
                          </LedgerRow>
                        ))}
                    </LedgerTable>
                  </section>
                )}
                {!v.seesAll && <Relations view={v} onDeclare={() => setDeclare(true)} fmt={fmt} />}
              </section>
            )}

            {tab === "people" && v.seesAll && (
              <section className="mt-6">
                <SectionHead
                  className=""
                  aside={
                    isHr && (
                      <>
                        <button type="button" className={quietBtn} onClick={() => setImporting(!importing)}>
                          Move people from BambooHR
                        </button>
                        <button type="button" className={primaryBtn} onClick={() => setForm({ type: "hire" })}>
                          Add a person
                        </button>
                      </>
                    )
                  }
                >
                  {v.people.length} people
                </SectionHead>
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
                <LedgerTable cols={PEOPLE_COLS} head={["Person", "Notes"]} label="People">
                  {v.people.map((p) => (
                    <LedgerRow key={p.id} cols={PEOPLE_COLS} onClick={() => setOpen(p.id)}>
                      <span className="min-w-0">
                        <span className="block font-bold">{p.name}</span>
                        <span className="block truncate text-sm text-muted">
                          {p.title} · {p.office}
                        </span>
                      </span>
                      <span className="flex flex-wrap justify-end gap-1">
                        {p.separated && <Pill tone="muted">Left {fmt(p.separated.effective)}</Pill>}
                        {v.proposals.some((x) => x.subject === p.id && x.status === "pending") && <Status tone="ochre">Change pending</Status>}
                        {v.relations.some((r) => r.a === p.id || r.b === p.id) && <Pill tone="plum">Related party</Pill>}
                      </span>
                    </LedgerRow>
                  ))}
                </LedgerTable>
                <Relations view={v} onDeclare={() => setDeclare(true)} fmt={fmt} />
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
            screening={isHr && !person.separated ? <ScreeningPanel person={person.id} view={v} act={hr.act} onDone={setNotice} /> : undefined}
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

/* ---------------- Integrity ---------------- */

function IntegrityBar({ view, fmt }: { view: HrView; fmt: (iso: string) => string }) {
  const i = view.integrity;
  if (!i.ok)
    return (
      <div role="alert" className="mt-5 border-y border-clay bg-clay-soft px-4 py-3 text-sm text-clay">
        <p className="font-semibold">The HR record has been tampered with.</p>
        <p className="mt-1">{i.problem} Do not approve anything until this is explained. Compare the seal emails with the Ledger tab.</p>
      </div>
    );
  return (
    <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-y border-ink py-3 font-ledger text-sm">
      <span className="font-bold text-leaf">✓ Record intact</span>
      <span className="text-muted">
        <Fig className="text-ink">{i.entries}</Fig> entries, each sealed to the one before
        {i.lastSeal ? (
          <>
            {" · last daily seal "}
            <Fig className="text-ink">{fmt(i.lastSeal.at)}</Fig>
            {i.lastSeal.sentTo ? " (emailed)" : ""}
          </>
        ) : (
          " · not sealed yet"
        )}
        {i.unsealed > 0 && i.lastSeal ? (
          <>
            {" · "}
            <Fig className="text-ink">{i.unsealed}</Fig>
            {" since"}
          </>
        ) : (
          ""
        )}
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
  screening,
}: {
  p: PersonView;
  view: HrView;
  fmt: (iso: string) => string;
  onChange?: () => void;
  onLeave?: () => void;
  onCorrect?: (proposal: number) => void;
  /** MF-03: the sanctions screening panel, for HR. */
  screening?: React.ReactNode;
}) {
  const own = p.id === view.me;
  const history = view.proposals.filter((x) => x.subject === p.id).sort((a, b) => b.id - a.id);
  const related = view.relations.filter((r) => r.a === p.id || r.b === p.id);
  return (
    <div className="space-y-5">
      {screening}
      {p.separated && (
        <p className="bg-sunken px-4 py-3 text-sm">
          Left ROP on {fmt(p.separated.effective)}: {p.separated.reason}
        </p>
      )}
      {(["job", "pay", "details"] as Group[])
        .filter((g) => p.groups.includes(g))
        .map((g) => (
          <section key={g}>
            <SectionHead className="">{GROUP_LABEL[g]}</SectionHead>
            {/* A detail under a rule: label and value on ruled lines, figures in mono. */}
            <dl className="mt-3 divide-y divide-line border-y border-ink font-ledger">
              {fieldsIn(g).map((k) => (
                <div key={k} className="grid grid-cols-[10rem_1fr] gap-3 px-3 py-2 text-sm">
                  <dt className="text-muted">{FIELDS[k].label}</dt>
                  <dd className="min-w-0 tabular-nums">
                    {isFigure(k) ? (
                      <Fig className="text-start">{show(k, p.fields[k], view.names, FIELDS[k].type === "money" ? p.fields.currency : undefined)}</Fig>
                    ) : (
                      show(k, p.fields[k], view.names, FIELDS[k].type === "money" ? p.fields.currency : undefined)
                    )}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      {p.upcoming.length > 0 && (
        <section>
          <SectionHead className="">Approved, starting later</SectionHead>
          <ul className="mt-3 divide-y divide-line border-y border-ink text-sm">
            {p.upcoming.map((u) => (
              <li key={u.proposal} className="px-3 py-2">
                From <Fig>{fmt(u.effective)}</Fig>: {Object.entries(u.fields).map(([k, val]) => `${FIELDS[k as FieldKey].label} ${show(k as FieldKey, val, view.names, p.fields.currency)}`).join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}
      {related.length > 0 && view.seesAll && (
        <section>
          <SectionHead className="">Related parties</SectionHead>
          <ul className="mt-3 divide-y divide-line border-y border-ink text-sm">
            {related.map((r) => (
              <li key={r.n} className="px-3 py-2">
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
          <SectionHead className="">History</SectionHead>
          <LedgerTable cols={HISTORY_COLS} head={["#", "Change"]} label="History">
            {history.map((h) => (
              <LedgerRow key={h.id} cols={HISTORY_COLS} className="text-sm">
                <Fig className="text-start" tone="muted">
                  #{h.id}
                </Fig>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold">{KIND_LABEL[h.kind]}</span>
                    <StatusPill p={h} />
                    <span className="text-muted">
                      from <Fig>{fmt(h.effective)}</Fig>
                    </span>
                    {onCorrect && h.status === "approved" && (h.type === "update" || h.type === "hire") && (
                      <button type="button" onClick={() => onCorrect(h.id)} className="ms-auto min-h-11 px-2 text-sm font-semibold text-forest hover:underline">
                        Correct
                      </button>
                    )}
                  </div>
                  <Diff p={h} names={view.names} currency={p.fields.currency} />
                  <p className="mt-1 text-muted">
                    {h.reason} · proposed by {view.names[h.by] ?? h.by}
                    {h.signatures.length > 0 && `, signed by ${h.signatures.map((s) => `${view.names[s.by] ?? s.by} (${ROLE_LABEL[s.as]})`).join(", ")}`}
                  </p>
                </div>
              </LedgerRow>
            ))}
          </LedgerTable>
        </section>
      )}
    </div>
  );
}

function statusOf(p: ProposalView): { tone: "forest" | "clay" | "muted" | "ochre"; label: string } {
  if (p.status === "approved") return { tone: "forest", label: "Approved" };
  if (p.status === "rejected") return { tone: "clay", label: "Sent back" };
  if (p.status === "withdrawn") return { tone: "muted", label: "Withdrawn" };
  return { tone: "ochre", label: "Waiting" };
}

/** In a dense list (a person's history), a pill. */
function StatusPill({ p }: { p: ProposalView }) {
  const s = statusOf(p);
  return <Status tone={s.tone}>{s.label}</Status>;
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

function ProposalCard({ p, view, fmt, act, onDone, first }: { p: ProposalView; view: HrView; fmt: (iso: string) => string; act: (a: HrAction) => Promise<void>; onDone: (s: string) => void; first?: boolean }) {
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
    <Sheet className="" tone={first ? "gold" : undefined}>
      <article className="font-ledger">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBlock tone={statusOf(p).tone}>{statusOf(p).label}</StatusBlock>
          <span className="text-xs text-muted">
            <Fig className="text-xs">#{p.id}</Fig> · proposed by {view.names[p.by] ?? p.by}, <Fig className="text-xs">{fmt(p.at)}</Fig>
          </span>
        </div>
        <h3 className="mt-2 text-xl font-bold leading-tight">
          {KIND_LABEL[p.kind]}: {who}
        </h3>
        <p className="text-sm text-muted">
          Takes effect <Fig>{fmt(p.effective)}</Fig>
        </p>
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
        {/* MF-03: the finalist is screened before the offer. */}
        {p.type === "hire" && p.status === "pending" && view.seesAll && <ScreeningPanel person={p.subject as string} view={view} act={act} onDone={onDone} hire />}
        {p.warnings.length > 0 && (
          <ul className="mt-3 space-y-1 bg-ochre-soft px-3 py-2 text-sm text-warn">
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
              <li key={i} className={`border px-3 py-1 ${s ? "border-forest text-leaf" : isNext ? "border-2 border-ochre font-bold text-warn" : "border-line text-muted"}`}>
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
              <button type="button" disabled={busy} className={quietBtn} onClick={() => void askConfirm({ message: "Withdraw this proposal? It stays on the record as withdrawn and nothing in it takes effect.", confirm: "Withdraw proposal" }).then((ok) => (ok ? run({ action: "withdraw", proposal: p.id }, `Withdrew #${p.id}.`) : undefined))}>
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
            <textarea id={`back-${p.id}`} value={back} onChange={(e) => setBack(e.target.value)} rows={3} className="mt-1 w-full border border-line bg-paper px-3 py-2 text-base" />
            <div className="mt-2 flex gap-2">
              <button type="button" disabled={busy || back.trim().length < 3} className={dangerBtn} onClick={() => run({ action: "reject", proposal: p.id, note: back }, `Sent back #${p.id}.`).then(() => setBack(null))}>
                Send back
              </button>
              <button type="button" className={quietBtn} onClick={() => setBack(null)}>
                Cancel
              </button>
            </div>
            {back.trim().length < 3 && <p className="mt-1 text-xs text-muted">Write a few words on what needs fixing to send it back.</p>}
          </div>
        )}
      </article>
    </Sheet>
  );
}

/* ---------------- Proposing a change ---------------- */

type FormState = { type: "hire" } | { type: "update"; subject: string; own?: boolean; corrects?: number; first?: FieldKey } | { type: "separate"; subject: string };

function ChangeForm({ state, view, onClose, submit }: { state: FormState; view: HrView; onClose: () => void; submit: (p: ProposalInput) => Promise<void> }) {
  const person = "subject" in state ? view.people.find((p) => p.id === state.subject) : undefined;
  const corrected = state.type === "update" && state.corrects ? view.proposals.find((p) => p.id === state.corrects) : undefined;
  const [values, setValues] = useState<Fields>(() => (corrected?.fields ? { ...corrected.fields } : {}));
  const [effective, setEffective] = useState(corrected?.effective ?? today());
  const [reason, setReason] = useState("");
  const [noRecruitment, setNoRecruitment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const own = state.type === "update" && !!state.own;
  const groups: Group[] = own ? ["details"] : ["job", "pay", "details"];
  // A link may ask for one field first (e.g. contract end, to renew); it leads the form and is left out of its group.
  const first = state.type === "update" && state.first && !own ? state.first : undefined;
  const changed = (Object.keys(values) as FieldKey[]).filter((k) => state.type === "hire" ? values[k] !== "" && values[k] != null : values[k] !== (person?.fields[k] ?? null) || corrected);
  const title = state.type === "hire" ? "Add a person" : state.type === "separate" ? `${person?.name}: leaving ROP` : corrected ? `${person?.name}: correct change #${corrected.id}` : own ? "Update my contact details" : `${person?.name}: propose a change`;

  const send = async () => {
    setBusy(true);
    setError("");
    try {
      const fields = Object.fromEntries(changed.map((k) => [k, values[k] ?? null])) as Fields;
      if (state.type === "hire") await submit({ type: "hire", subject: "new", effective: String(fields.startDate ?? effective), fields, reason, ...(noRecruitment.trim() ? { noRecruitment: noRecruitment.trim() } : {}) });
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
        {corrected && <p className="bg-sunken px-3 py-2 text-sm">A correction is a new entry. Change #{corrected.id} stays in the history, marked as corrected.</p>}
        {first && (
          <Sheet tone="gold" className="grid gap-3 sm:grid-cols-2">
            <FieldInput k={first} value={first in values ? values[first] : (person?.fields[first] ?? null)} directory={view.directory} onChange={(val) => setValues((s) => ({ ...s, [first]: val }))} />
          </Sheet>
        )}
        {state.type !== "separate" &&
          groups.map((g) => (
            <fieldset key={g}>
              <legend className="font-mono text-xs uppercase tracking-[0.12em] text-muted">{GROUP_LABEL[g]}</legend>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {fieldsIn(g).filter((k) => k !== first).map((k) => (
                  <FieldInput key={k} k={k} value={k in values ? values[k] : (person?.fields[k] ?? null)} directory={view.directory} required={state.type === "hire" && HIRE_REQUIRED.includes(k)} onChange={(val) => setValues((s) => ({ ...s, [k]: val }))} />
                ))}
              </div>
            </fieldset>
          ))}
        {state.type === "hire" && (
          <label className="block text-sm">
            <span className="font-medium">Not chosen through Recruitment? Say why</span>
            <span className="block text-muted">A person chosen for a vacancy in Recruitment is matched by name. Anyone else needs a reason the signers can read.</span>
            <input value={noRecruitment} onChange={(e) => setNoRecruitment(e.target.value)} className="mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2.5 text-base" />
          </label>
        )}
        {state.type !== "hire" && (
          <label className="block text-sm">
            <span className="font-medium">{state.type === "separate" ? "Last day" : "Takes effect"}</span>
            <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className="mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2.5 text-base sm:w-56" />
            {effective < today() && <span className="mt-1 block text-warn">Backdated: the approvers will see this.</span>}
          </label>
        )}
        <label className="block text-sm">
          <span className="font-medium">Reason (required, kept forever)</span>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} className="mt-1 w-full border border-line bg-paper px-3 py-2 text-base" />
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
        {state.type === "update" && !changed.length && <p className="text-xs text-muted">Change at least one detail above to propose it.</p>}
        {reason.trim().length < 3 && <p className="text-xs text-muted">Write the reason for this change to propose it.</p>}
      </div>
    </Modal>
  );
}

function FieldInput({ k, value, onChange, directory, required }: { k: FieldKey; value: Value | undefined; onChange: (v: Value) => void; directory: { id: string; name: string }[]; required?: boolean }) {
  const f = FIELDS[k];
  const cls = "mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2.5 text-base";
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
    <section>
      <SectionHead
        aside={
          <button type="button" className={quietBtn} onClick={onDeclare}>
            Declare a related person
          </button>
        }
      >
        Related parties
      </SectionHead>
      <p className="mt-1 max-w-3xl text-sm text-muted">Family members and other close relations. Nobody can sign a change to the record of someone they are related to. Declaring takes effect at once; removing a link needs approval.</p>
      {view.relations.length > 0 && (
        <LedgerTable cols={REL_COLS} head={["Related", "Declared"]} label="Related parties">
          {view.relations.map((r) => (
            <LedgerRow key={r.n} cols={REL_COLS} className="text-sm">
              <span className="min-w-0">
                {view.names[r.a] ?? r.a} and {view.names[r.b] ?? r.b}: {r.relation} <span className="text-muted">(declared by {view.names[r.by] ?? r.by})</span>
              </span>
              <Fig className="text-start" tone="muted">
                {fmt(r.at)}
              </Fig>
            </LedgerRow>
          ))}
        </LedgerTable>
      )}
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
  const cls = "mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2.5 text-base";
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
    <section className={compact ? "mt-3" : "mt-6"}>
      {!compact && (
        <>
          <p className="max-w-3xl text-sm text-muted">
            Every signature in the app needs a type of role, not a title. This table says who in this organization holds each type. Whatever it says, nobody signs anything about themselves, a related person or their own supervisor, or anything they
            proposed; a step whose holders all have a conflict falls to the board. Changing this table needs the executive head and the board.
          </p>
          <SectionHead
            aside={
              onPropose && (
                <button type="button" className={quietBtn} onClick={onPropose}>
                  Propose changes to the authority table
                </button>
              )
            }
          >
            Who holds each role
          </SectionHead>
          <div className="overflow-x-auto">
            <LedgerTable cols={ROLE_COLS} head={["Role", "Holders and what they sign"]} label="Who holds each role" className="mt-3 min-w-[36rem]">
              {HR_ROLES.map((r) => (
                <LedgerRow key={r} cols={ROLE_COLS} className="text-sm">
                  <span className="font-bold">{ROLE_LABEL[r]}</span>
                  <div className="min-w-0">
                    <p>{rules.holders[r].map((x) => names[x] ?? x).join(", ") || <span className="text-clay">Nobody named yet</span>}</p>
                    {/* A right given on someone's own record, outside the table: shown here so the table is the whole delegation. */}
                    {namedGrants(r, rules.holders, users).length > 0 && (
                      <p className="mt-1 text-warn">
                        Not in this table, but with the right on their own record:{" "}
                        {namedGrants(r, rules.holders, users)
                          .map((g) => `${g.name} (${g.does.join(", ")})`)
                          .join("; ")}
                        . Add them to this role to make it part of the written delegation.
                      </p>
                    )}
                    <p className="mt-1 text-muted">{ROLE_HELP[r]}</p>
                    {SIGNATURES.some((g) => g.by.includes(r)) && (
                      <ul className="mt-2 list-disc ps-5">
                        {SIGNATURES.filter((g) => g.by.includes(r)).map((g) => (
                          <li key={g.area + g.what}>
                            <span className="text-muted">{g.area}:</span> {g.what}
                            {g.by.length > 1 && <span className="text-muted"> (with {g.by.filter((x) => x !== r).map((x) => SIGNER_LABEL[x].toLowerCase()).join(", ")})</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </LedgerRow>
              ))}
            </LedgerTable>
          </div>
          <SectionHead>Steps for each kind of HR change</SectionHead>
        </>
      )}
      <LedgerTable cols={STEP_COLS} head={["Change", "Steps"]} label="Steps for each kind of HR change">
        {CHANGE_KINDS.map((k) => (
          <LedgerRow key={k} cols={STEP_COLS} className="text-sm">
            <span className="text-muted">{KIND_LABEL[k]}</span>
            <span>HR proposes → {rules.steps[k].map((r) => ROLE_LABEL[r]).join(" → ")}</span>
          </LedgerRow>
        ))}
      </LedgerTable>
      {compact && (
        <LedgerTable cols={STEP_COLS} head={["Role", "Held by"]} label="Role holders">
          {HR_ROLES.map((r) => (
            <LedgerRow key={r} cols={STEP_COLS} className="text-sm">
              <span className="text-muted">{ROLE_LABEL[r]}</span>
              <span>{rules.holders[r].map((x) => names[x] ?? x).join(", ") || "—"}</span>
            </LedgerRow>
          ))}
        </LedgerTable>
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
  const sel = "min-h-11 border border-line bg-paper px-2 py-1.5 text-sm";
  return (
    <Modal title="Propose changes to the authority table" onClose={onClose}>
      <div className="space-y-5">
        <section>
          <SectionHead className="">Steps</SectionHead>
          <div className="mt-3 divide-y divide-line border-y border-ink">
            {CHANGE_KINDS.map((k) => (
              <div key={k} className="flex flex-wrap items-center gap-2 py-2 text-sm">
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
          <SectionHead className="">Role holders</SectionHead>
          <div className="mt-3 divide-y divide-line border-y border-ink">
            {HR_ROLES.map((r) => (
              <fieldset key={r} className="py-2">
                <legend className="float-left w-full text-sm font-bold">{ROLE_LABEL[r]}</legend>
                <div className="clear-left flex flex-wrap gap-x-4">
                  {view.directory.map((d) => (
                    <label key={d.id} className="flex min-h-11 items-center gap-1.5 text-sm">
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
          <SectionHead className="">Unused annual leave when someone leaves</SectionHead>
          <p className="mt-1 text-xs text-muted">Follow the law and policy in force for each group, and say where it comes from. While a group is &ldquo;not decided&rdquo;, a leaver&rsquo;s final pay waits for HR.</p>
          <div className="mt-3 divide-y divide-line border-y border-ink">
            {PAYOUT_GROUPS.map((g) => {
              const v = draft.leavePayout?.[g] ?? DEFAULT_PAYOUT[g];
              const put = (patch: Partial<typeof v>) => setDraft((d) => ({ ...d, leavePayout: { ...DEFAULT_PAYOUT, ...d.leavePayout, [g]: { ...v, ...patch } } }));
              return (
                <div key={g} className="grid gap-2 py-2 text-sm sm:grid-cols-[11rem_9rem_7rem_1fr] sm:items-center">
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
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1 w-full border border-line bg-paper px-3 py-2 text-base" />
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
    <section className="mt-6">
      <p className="max-w-3xl text-sm text-muted">
        Every entry, newest first. Each fingerprint is worked out from the entry and the fingerprint before it, so changing any entry changes every fingerprint after it. Once a day the latest fingerprint is
        sealed and emailed outside the app; if it ever differs from the email, the record was changed.
      </p>
      <SectionHead
        aside={
          <>
            <button type="button" disabled={busy} className={quietBtn} onClick={() => run(async () => { const r = await seal(); return r.sealed ? "Sealed." : (r.why ?? "Not sealed."); })}>
              Seal now (lock today&rsquo;s fingerprint)
            </button>
            {reset && (
              <button type="button" disabled={busy} className={quietBtn} onClick={() => void askConfirm({ message: "Restore the sample records? Every change made to the fictional people and pay since they were loaded is undone.", confirm: "Restore sample records", danger: true }).then((ok) => (ok ? run(async () => { await reset(); return "Sample records restored."; }) : undefined))}>
                Reset sample records
              </button>
            )}
          </>
        }
      >
        Entries
      </SectionHead>
      {error && (
        <p role="alert" className="mt-3 text-sm text-clay">
          {error}
        </p>
      )}
      {view.ignored.length > 0 && (
        <div className="mt-4 border-y border-clay bg-clay-soft px-4 py-3 text-sm text-clay">
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
      <div className="overflow-x-auto">
        <LedgerTable cols={ENTRY_COLS} head={[{ label: "#", end: true }, "When", "Who", "What", "Tamper check (fingerprint)"]} label="Full history" className="mt-3 min-w-[44rem]">
          {view.entries.map((e) => (
            <LedgerRow key={e.n} cols={ENTRY_COLS} className={`text-sm ${ignored.has(e.n) ? "bg-clay-soft" : e.kind === "seal" ? "bg-mist" : ""}`}>
              <Fig>{e.n}</Fig>
              <Fig className="whitespace-nowrap text-start">{new Date(e.at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</Fig>
              <span>{view.names[e.actor] ?? e.actor}</span>
              <span>
                {KIND_TEXT[e.kind] ?? e.kind}
                {e.subject ? `: ${view.names[e.subject] ?? e.subject}` : ""}
              </span>
              <span title={e.hash}>
                <Fig className="text-start text-xs" tone="muted">
                  {e.hash.slice(0, 12)}…
                </Fig>
              </span>
            </LedgerRow>
          ))}
        </LedgerTable>
      </div>
      {view.seals.length > 0 && (
        <section>
          <SectionHead>Seals</SectionHead>
          <LedgerTable cols={SEAL_COLS} head={["Sealed", "Entries and fingerprint"]} label="Seals">
            {view.seals.map((s) => (
              <LedgerRow key={s.n} cols={SEAL_COLS} className="text-sm">
                <Fig className="text-start">{fmt(s.at)}</Fig>
                <span className="min-w-0">
                  entries 1 to <Fig>{s.upTo}</Fig>, <span className="break-all font-mono text-xs">{s.hash}</span> {s.sentTo ? `· emailed to ${s.sentTo}` : "· not emailed: no seal address is set; ask your administrator"}
                </span>
              </LedgerRow>
            ))}
          </LedgerTable>
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
        className="max-h-[92vh] w-full overflow-y-auto border-t-4 border-forest bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] font-ledger sm:max-w-2xl"
      >
        <div className="flex items-start gap-3">
          <h2 className="min-w-0 flex-1 text-2xl font-bold leading-snug tracking-tight">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="grid h-11 w-11 shrink-0 place-items-center text-xl text-muted hover:bg-sunken">
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
      <Empty className="mt-6">The HR record has not been started yet. An administrator starts it by naming who holds each approval role.</Empty>
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
    <section>
      <SectionHead>Start the HR record</SectionHead>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Name who holds each approval role. This is the record&rsquo;s first entry{view.sample ? "" : ", and in this real book it can never be changed or deleted"}. After it, the table changes only through a proposal signed by the executive head and the board. Only people added under{" "}
        <a href="/settings/people" className="font-semibold text-forest hover:underline">
          People and roles
        </a>{" "}
        who have a sign-in email can be named.
      </p>
      <div className="mt-4 divide-y divide-line border-y border-ink">
        {HR_ROLES.map((r) => (
          <div key={r} className="px-3 py-3">
            <p className="text-sm font-bold">
              {ROLE_LABEL[r]}
              {(["ceo", "board", "hr"] as HrRole[]).includes(r) && <span className="ms-2 text-xs font-normal text-clay">required</span>}
            </p>
            <p className="text-xs text-muted">{ROLE_HELP[r]}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {view.directory.filter((d) => !view.eligible || view.eligible.includes(d.id)).map((d) => {
                const on = (holders[r] ?? []).includes(d.id);
                return (
                  <button key={d.id} type="button" aria-pressed={on} onClick={() => toggle(r, d.id)} className={`min-h-11 border px-3 text-sm ${on ? "border-2 border-forest bg-mist font-bold text-leaf" : "border-line text-muted hover:border-forest"}`}>
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
        <input className="mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2 text-base" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
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
    <Sheet>
      <section>
        <p className="font-ledger text-lg font-bold">Move people from BambooHR</p>
        <p className="mt-1 text-sm text-muted">
          In BambooHR, run a report with First Name, Last Name, Job Title, Location, Employment Status, Hire Date, Reports To, Pay Rate, Pay Per, Mobile Phone and Contract End Date, and export it. Each active person becomes a new-person proposal that the finance head and the executive head approve as usual. Bank details, ID and leave balances are added after, through the normal changes.
        </p>
        <input type="file" accept=".csv,.xlsx" className="mt-3 block min-h-11 text-sm" onChange={(e) => e.target.files?.[0] && void read(e.target.files[0])} aria-label="BambooHR report" />
        {err && <p className="mt-2 text-sm text-clay">{err}</p>}
        {rows && (
          <>
            <p className="mt-3 text-sm">
              <Fig>{ready.length}</Fig> ready, <Fig>{bad.length}</Fig> to fix in the report, <Fig>{rows.filter((r) => r.skip).length}</Fig> skipped (inactive).
            </p>
            <ul className="mt-2 max-h-72 divide-y divide-line overflow-auto border-y border-ink text-sm">
              {rows.map((r) => (
                <li key={r.row} className={`px-3 py-2 ${r.skip ? "text-muted" : ""}`}>
                  <span className="font-semibold">{String(r.fields.name || `Row ${r.row}`)}</span> · {String(r.fields.title ?? "")} · {String(r.fields.office ?? "")}, {String(r.fields.employment ?? "")}
                  {r.fields.pay != null && (
                    <>
                      {" · "}
                      <Fig>
                        {String(r.fields.currency)} {Number(r.fields.pay).toLocaleString("en-US")}
                      </Fig>
                      {` per ${String(r.fields.payBasis).toLowerCase()}`}
                    </>
                  )}
                  {r.reportsTo && ` · reports to ${r.reportsTo}`}
                  {r.skip && <span className="block text-xs">{r.skip}</span>}
                  {r.errors.length > 0 && <span className="block text-xs text-clay">{r.errors.join("; ")}</span>}
                  {r.warnings.length > 0 && <span className="block text-xs text-warn">{r.warnings.join("; ")}</span>}
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
    </Sheet>
  );
}

/** My details: the signed-in person's own HR record. They may propose new contact details (HR approves); anything else goes through HR. */
export function MyDetailsPage() {
  const { user } = useRequireUser();
  const { date } = useT();
  const hr = useHr();
  const [form, setForm] = useState<FormState | null>(null);
  const [notice, setNotice] = useState("");
  if (!user) return null;
  const v = hr.view;
  const mine = v?.people.find((p) => p.id === v.me);
  const fmt = (iso: string) => date(iso.slice(0, 10), { day: "numeric", month: "short", year: "numeric" });
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <PageHead back={{ href: "/home", label: "Home" }} title="My details">
          <p>Update your phone and emergency contact here; HR approves. For anything else, ask HR.</p>
          <p className="mt-2">
            <a href="/training" className="font-semibold text-forest hover:underline">
              My training log
            </a>
          </p>
        </PageHead>
        {hr.error && <p className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">{hr.error}</p>}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {!v && !hr.error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && !mine && <Empty className="mt-6">You have no HR record yet. HR adds it when your contract starts.</Empty>}
        {v && mine && (
          <div className="mt-6">
            <PersonRecord p={mine} view={v} fmt={fmt} onChange={() => setForm({ type: "update", subject: mine.id, own: true })} />
          </div>
        )}
      </main>
      {form && v && (
        <ChangeForm
          state={form}
          view={v}
          onClose={() => setForm(null)}
          submit={async (proposal) => {
            await hr.act({ action: "propose", proposal });
            setForm(null);
            setNotice("Sent to HR. Your record changes once HR approves.");
          }}
        />
      )}
    </div>
  );
}

/**
 * MF-03: the sanctions screening of a finalist or a member of staff. HR records each check (date,
 * lists, result, the printout's link); a possible match is reviewed by a person and never decides
 * by itself. A hire waits for a clear, current result.
 */
function ScreeningPanel({ person, view, act, onDone, hire }: { person: string; view: HrView; act: (a: HrAction) => Promise<void>; onDone: (s: string) => void; hire?: boolean }) {
  const list = view.screenings[person] ?? [];
  const today = new Date().toISOString().slice(0, 10);
  const problem = screeningProblem(list, today);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: today, lists: DEFAULT_LISTS, result: "clear" as "clear" | "possible_match", link: "", note: "" });
  const [error, setError] = useState("");
  const isHr = view.roles.includes("hr");
  const last = list.at(-1);
  return (
    <div className={`mt-3 px-3 py-2 text-sm ${problem ? "bg-ochre-soft" : "bg-mist"}`}>
      <p className="font-semibold">Sanctions screening</p>
      <p className="mt-0.5">{problem ? (hire ? `Before the offer: ${problem}` : problem) : `Clear on ${last!.date} (${last!.lists}).`}</p>
      {last?.link && (
        <a href={last.link} target="_blank" rel="noreferrer" className="text-xs font-semibold text-forest hover:underline">
          Open the printout
        </a>
      )}
      {isHr && !open && (
        <button type="button" className={`${quietBtn} mt-2`} onClick={() => setOpen(true)}>
          Record a screening
        </button>
      )}
      {isHr && open && (
        <form
          className="mt-2 grid gap-2 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError("");
            void act({ action: "screen", screening: { person, date: f.date, lists: f.lists, result: f.result, ...(f.link.trim() ? { link: f.link.trim() } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}) } })
              .then(() => {
                setOpen(false);
                onDone(f.result === "clear" ? "Screening recorded: clear." : "Screening recorded: a possible match, for a person to review.");
              })
              .catch((x: unknown) => setError(x instanceof Error ? x.message : String(x)));
          }}
        >
          <label className="block">
            Date checked
            <input type="date" value={f.date} max={today} onChange={(e) => setF({ ...f, date: e.target.value })} className="mt-1 w-full border border-line bg-surface px-2 py-1.5" />
          </label>
          <label className="block">
            Result
            <select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value as typeof f.result })} className="mt-1 w-full border border-line bg-surface px-2 py-1.5">
              <option value="clear">Clear: not on the lists</option>
              <option value="possible_match">Possible match: a person reviews it</option>
            </select>
          </label>
          <label className="block sm:col-span-2">
            Lists checked
            <input value={f.lists} maxLength={400} onChange={(e) => setF({ ...f, lists: e.target.value })} className="mt-1 w-full border border-line bg-surface px-2 py-1.5" />
          </label>
          <label className="block sm:col-span-2">
            Link to the printout
            <input type="url" value={f.link} placeholder="https://" onChange={(e) => setF({ ...f, link: e.target.value })} className="mt-1 w-full border border-line bg-surface px-2 py-1.5" />
          </label>
          {error && (
            <p role="alert" className="text-clay sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" className={primaryBtn}>
              Save the screening
            </button>
            <button type="button" className={quietBtn} onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
