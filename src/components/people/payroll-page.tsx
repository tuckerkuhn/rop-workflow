"use client";

import { plainError } from "@/lib/plain-error";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Fig, Figures, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
import { ROLE_LABEL } from "@/lib/hr";
import { ADJUSTMENTS, ADJUSTMENT_KEYS, GROUPS, RUN_COLUMNS, RUN_COLUMN_LABEL, RUN_EARNINGS, RUN_EARNING_LABEL, type Adjustment, type Group, type Line, type RunColumn, type RunLayout, type Totals } from "@/lib/payroll";
import type { PayrollView } from "@/app/api/payroll/route";

/**
 * Monthly payroll: worked out from the HR record and approved timesheets, adjusted with reasons,
 * signed by the CFO and the CEO, then the files for ADP RUN or the bank.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo - 1 + by, 1)).toISOString().slice(0, 7);
};

type Run = PayrollView["runs"][number];

export function PayrollPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { date } = useT();
  const [month, setMonth] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>("Home Office");
  const [v, setV] = useState<PayrollView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The month and person in the link are read before the first load, so it never loads the wrong month first.
  const [init, setInit] = useState(false);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("month")) setMonth(q.get("month"));
    if ((GROUPS as readonly string[]).includes(q.get("group") ?? "")) setGroup(q.get("group") as Group);
    setInit(true);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const q = new URLSearchParams({ group, ...(month ? { month } : {}) });
    try {
      setV(await call<PayrollView>(`/api/payroll?${q}`, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, month, group]);
  useEffect(() => {
    if (init && ready && user) void load();
  }, [init, ready, user, load]);

  if (!user) return null;
  const m = v?.month ?? month ?? "";
  const monthName = (x: string) => (x ? date(`${x}-01`, { month: "long", year: "numeric" }) : "");
  const go = (next: { month?: string; group?: Group }) => {
    setNotice("");
    const nm = next.month ?? m;
    const ng = next.group ?? group;
    if (next.month) setMonth(nm);
    if (next.group) setGroup(ng);
    history.replaceState(null, "", `/payroll?month=${nm}&group=${encodeURIComponent(ng)}`);
  };
  const sign = async (path: string, body: object, msg: string) => {
    setError("");
    try {
      await call(path, user.id, { method: "POST", body: JSON.stringify(body) });
      setNotice(msg);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const pending = v?.runs.find((r) => r.status === "pending");
  const paid = v?.runs.some((r) => r.status === "approved");

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <PageHead
          back={{ href: "/people", label: "People" }}
          title="Payroll"
          actions={
            <Link href="/timesheets" className="inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline">
              Timesheets
            </Link>
          }
        >
          Worked out from the HR record and approved timesheets. Payroll adds adjustments with reasons; the CFO and the CEO sign; then the files for ADP RUN or the bank are released.
        </PageHead>
        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-3 font-ledger">
          <div className="flex items-center border-y border-ink">
            <button type="button" aria-label="Previous month" onClick={() => go({ month: shiftMonth(m, -1) })} className="grid h-11 w-11 place-items-center hover:bg-ochre-soft">
              ‹
            </button>
            <span className="min-w-36 text-center font-mono text-sm font-bold tabular-nums">{monthName(m)}</span>
            <button type="button" aria-label="Next month" onClick={() => go({ month: shiftMonth(m, 1) })} className="grid h-11 w-11 place-items-center hover:bg-ochre-soft">
              ›
            </button>
          </div>
          <div role="radiogroup" aria-label="Pay group" className="flex flex-wrap gap-1">
            {GROUPS.map((g) => (
              <button
                key={g}
                type="button"
                role="radio"
                aria-checked={group === g}
                onClick={() => go({ group: g })}
                className={`min-h-11 px-3 font-mono text-xs ${group === g ? "font-bold underline decoration-ochre decoration-4 underline-offset-8" : "text-muted hover:text-ink"}`}
              >
                {g} · {g === "Home Office" ? "ADP RUN" : "bank"}
              </button>
            ))}
          </div>
        </div>

        {!v ? (
          !error && <p className="mt-10 text-sm text-muted">Loading…</p>
        ) : (
          <>
            {v.runs.map((r) => (
              <RunCard
                key={r.id}
                r={r}
                v={v}
                monthName={monthName}
                approve={() => sign("/api/hr", { action: "approve", proposal: r.id }, `Signed payroll #${r.id}.`)}
                reject={(note) => sign("/api/hr", { action: "reject", proposal: r.id, note }, `Sent back payroll #${r.id}.`)}
                withdraw={() => sign("/api/hr", { action: "withdraw", proposal: r.id }, `Withdrew payroll #${r.id}.`)}
              />
            ))}
            {v.canPrepare && !pending ? (
              <Prepare
                key={`${v.month}-${v.group}-${v.runs.length}`}
                v={v}
                supplemental={!!paid}
                onDone={async (msg) => {
                  setNotice(msg);
                  await load();
                }}
              />
            ) : (
              !v.runs.length && (
                <section className="mt-8">
                  <p className="text-sm text-muted">Not prepared yet. This is how it works out today:</p>
                  <Register lines={v.draft} totals={v.draftTotals} v={v} />
                </section>
              )
            )}
          </>
        )}
        {v && group === "Home Office" && <RunLayoutPanel user={user.id} />}
      </main>
    </div>
  );
}

/* ---------------- Amounts ---------------- */

/** The register's columns after the row number: person, six amounts, net. */
const REG_COLS = "minmax(13rem,1.6fr) 6.5rem 6.5rem 6.5rem 7rem 7rem 9rem 7rem";

const amt = (n: number, cur: string) => (cur === "AFN" ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function Register({ lines, totals, v, adjust, onAdjust }: { lines: Line[]; totals: Totals; v: PayrollView; adjust?: Record<string, Adjustment>; onAdjust?: (person: string) => void }) {
  const cur = lines[0]?.currency ?? (v.group === "Afghanistan" ? "AFN" : "USD");
  const ho = v.group === "Home Office";
  const extra = (l: Line) => l.bonus + l.retro + l.vacationPayout + l.medicalReimb + l.expenses;
  return (
    <div className="mt-3">
      <div className="overflow-x-auto">
        <LedgerTable
          cols={`2.25rem ${REG_COLS}`}
          label="Payroll register"
          className="mt-0 min-w-[66rem]"
          head={[
            "#",
            "Person",
            { label: "Regular", end: true },
            { label: "Danger / post", end: true },
            { label: "Allowances", end: true },
            { label: "Adjustments", end: true },
            { label: "Gross", end: true },
            ho
              ? {
                  label: (
                    <>
                      403(b) EE / ROP{" "}
                      <a href="#about-403b" title={ABOUT_403B} aria-label={`What is 403(b)? ${ABOUT_403B}`} className="border border-line px-1.5 text-forest hover:border-forest">
                        ?
                      </a>
                    </>
                  ),
                  end: true,
                }
              : { label: "Tax", end: true },
            { label: "Net", end: true },
          ]}
        >
          {lines.map((l, i) => (
            <LedgerRow key={l.person} n={i + 1} cols={REG_COLS} className="text-sm">
              <span className="min-w-0">
                <span className="font-semibold">{l.name}</span>
                <span className="block text-xs text-muted">
                  {l.title} · {amt(l.rate, l.currency)} per {l.payBasis.toLowerCase()}
                </span>
                {l.problems.map((p) => (
                  <span key={p} className="mt-0.5 block text-xs text-warn">
                    ⚠ {p}
                  </span>
                ))}
                {l.note && <span className="mt-0.5 block text-xs text-muted">“{l.note}”</span>}
                {(l.expenseReports ?? []).length > 0 && (
                  <span className="mt-0.5 block text-xs text-muted">
                    Reimburses expense report{l.expenseReports.length > 1 ? "s" : ""}{" "}
                    {l.expenseReports.map((n, i) => (
                      <span key={n}>
                        {i > 0 && ", "}
                        <a href={`/expenses?open=${n}`} className="underline">
                          #{n}
                        </a>
                      </span>
                    ))}{" "}
                    ({amt(l.expenses, l.currency)})
                  </span>
                )}
                {onAdjust && (
                  <button type="button" onClick={() => onAdjust(l.person)} className="mt-1 block min-h-11 text-xs font-semibold text-forest hover:underline">
                    {adjust?.[l.person] ? "Change adjustments" : "Add an adjustment"}
                  </button>
                )}
              </span>
              <Fig>{amt(l.regular, l.currency)}</Fig>
              <span className="text-end">
                <Fig>{amt(l.dangerPay + l.postDiff, l.currency)}</Fig>
                {(l.dangerDays > 0 || l.postDiffDays > 0) && <span className="block font-mono text-xs text-muted">{l.dangerDays + l.postDiffDays} days</span>}
              </span>
              <Fig>{amt(l.comms + l.living, l.currency)}</Fig>
              <span className="text-end">
                <Fig>{amt(extra(l), l.currency)}</Fig>
                {l.advance > 0 && <span className="block font-mono text-xs text-muted">−{amt(l.advance, l.currency)} advance</span>}
              </span>
              <Fig strong>{amt(l.gross, l.currency)}</Fig>
              {ho ? (
                <Fig>
                  {amt(l.ee403b, l.currency)} / {amt(l.er403b, l.currency)}
                </Fig>
              ) : (
                <Fig>{amt(l.tax, l.currency)}</Fig>
              )}
              <Fig strong>{amt(l.net, l.currency)}</Fig>
            </LedgerRow>
          ))}
        </LedgerTable>
      </div>
      <Figures
        items={[
          { label: "People", value: lines.length },
          { label: `Gross (${cur})`, value: amt(totals.gross, cur) },
          ho ? { label: `403(b) EE / ROP (${cur})`, value: `${amt(totals.ee403b, cur)} / ${amt(totals.er403b, cur)}` } : { label: `Tax (${cur})`, value: amt(totals.tax, cur) },
          { label: `Net (${cur})`, value: amt(totals.net, cur) },
        ]}
      />
      {ho && (
        <p id="about-403b" className="mt-2 text-xs text-muted">
          {ABOUT_403B}
        </p>
      )}
      <div className="mt-6">
        <SectionLabel>Cost by funding source ({cur}, gross plus ROP&apos;s 403(b))</SectionLabel>
        <LedgerTable cols="minmax(0,1fr) 9rem" head={["Funding source", { label: cur, end: true }]} label="Cost by funding source" className="mt-2 max-w-2xl">
          {Object.entries(totals.cost)
            .sort((a, b) => b[1] - a[1])
            .map(([s, c]) => (
              <LedgerRow key={s} cols="minmax(0,1fr) 9rem" className="text-sm">
                <span className="truncate">{v.sources[s] ?? s}</span>
                <Fig>{amt(c, cur)}</Fig>
              </LedgerRow>
            ))}
        </LedgerTable>
        {ho && <p className="mt-2 text-xs text-muted">Employer FICA and SUI are calculated by ADP and are not included.</p>}
        {!ho && <p className="mt-2 text-xs text-muted">Salary tax uses the Afghan monthly schedule (0% to 5,000; 2% to 12,500; 10% to 100,000; 20% above). Finance confirms before paying it.</p>}
      </div>
    </div>
  );
}

/* ---------------- A prepared payroll ---------------- */

function RunCard({ r, v, monthName, approve, reject, withdraw }: { r: Run; v: PayrollView; monthName: (m: string) => string; approve: () => Promise<void>; reject: (note: string) => Promise<void>; withdraw: () => Promise<void> }) {
  const [open, setOpen] = useState(r.status !== "rejected" && r.status !== "withdrawn");
  const [back, setBack] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (id: string) => v.names[id] ?? id;
  const wrap = (fn: () => Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  const file = (f: string) => `/api/payroll/export?run=${r.id}&file=${f}`;
  const download = async (f: string, label: string) => {
    const res = await fetch(file(f), { headers: { "x-demo-user": v.me } });
    if (!res.ok) return;
    const blob = await res.blob();
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? `${label}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <article className="mt-10">
      <SectionHead
        className="mt-0"
        aside={
          <button type="button" onClick={() => setOpen(!open)} className="min-h-11 text-sm font-semibold text-forest hover:underline" aria-expanded={open}>
            {open ? "Hide register" : "Show register"}
          </button>
        }
      >
        {v.group}, {monthName(v.month)}: <span className="font-mono tabular-nums">{amt(r.totals.net, r.lines[0]?.currency ?? "USD")}</span> net to {r.lines.length} people
      </SectionHead>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {r.status === "approved" ? (
          <StatusBlock tone="forest">Approved</StatusBlock>
        ) : r.status === "pending" ? (
          <StatusBlock tone="ochre">Waiting for signatures</StatusBlock>
        ) : r.status === "rejected" ? (
          <StatusBlock tone="clay">Sent back</StatusBlock>
        ) : (
          <StatusBlock tone="muted">Withdrawn</StatusBlock>
        )}
        {r.supplemental && <Pill tone="plum">Supplemental</Pill>}
        <span className="font-mono text-xs text-muted">
          #{r.id} · prepared by {name(r.by)} · pay date {r.payDate}
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{r.reason}</p>
      {r.changedSince.length > 0 && (
        <div className="mt-3 border border-clay bg-clay-soft px-3 py-2 text-sm text-clay">
          <p className="font-semibold">Worked out again today, this payroll comes out differently:</p>
          <ul className="mt-1 list-disc ps-5">
            {r.changedSince.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <p className="mt-1">{r.status === "approved" ? "A timesheet or record changed after approval: pay the difference in a supplemental payroll." : "Send it back so payroll prepares it again."}</p>
        </div>
      )}
      {r.warnings.length > 0 && (
        <ul className="mt-3 space-y-1 bg-ochre-soft px-3 py-2 text-sm text-warn">
          {r.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      <ol className="mt-3 flex flex-wrap gap-2 text-xs">
        {r.roles.map((role, i) => {
          const s = r.signatures[i];
          const isNext = r.status === "pending" && i === r.signatures.length;
          return (
            <li key={i} className={`border px-3 py-1 ${s ? "border-forest text-leaf" : isNext ? "border-ochre bg-ochre-soft text-warn" : "border-line text-muted"}`}>
              <span className="font-mono">{String(i + 1).padStart(2, "0")}</span> {ROLE_LABEL[role]}
              {s ? `: ${name(s.by)}${s.as !== role ? ` for the ${ROLE_LABEL[s.as]}` : ""}` : isNext && r.next?.fellBack ? ": falls to the Board (conflict)" : isNext ? ": waiting" : ""}
            </li>
          );
        })}
      </ol>
      {r.status === "pending" && r.next && (
        <p className="mt-2 text-xs text-muted">
          Can sign now: {r.next.people.length ? r.next.people.map(name).join(", ") : "nobody"}
          {r.next.blocked.length > 0 && ` · Cannot: ${r.next.blocked.map((b) => `${name(b.id)} (${b.why})`).join(", ")}`}
        </p>
      )}
      {r.closedBy?.note && (
        <p className="mt-2 text-sm text-clay">
          Sent back by {name(r.closedBy.by)}: {r.closedBy.note}
        </p>
      )}
      {r.cannotSign && <p className="mt-2 text-sm text-muted">You cannot sign this: {r.cannotSign}.</p>}
      {back === null && (r.canSign || r.canWithdraw || r.status === "approved") && (
        <div className="mt-4 flex flex-wrap gap-2">
          {r.canSign && (
            <>
              <button type="button" disabled={busy} className={primaryBtn} onClick={wrap(approve)}>
                Approve as {ROLE_LABEL[r.next?.fellBack ? "board" : r.next!.role]}
              </button>
              <button type="button" disabled={busy} className={quietBtn} onClick={() => setBack("")}>
                Send back
              </button>
            </>
          )}
          {r.canWithdraw && (
            <button type="button" disabled={busy} className={quietBtn} onClick={wrap(withdraw)}>
              Withdraw
            </button>
          )}
          {r.status === "approved" && (
            <>
              {v.group === "Home Office" ? (
                <button type="button" className={primaryBtn} onClick={() => void download("run", "adp-run")}>
                  Download for ADP RUN
                </button>
              ) : (
                <button type="button" className={primaryBtn} onClick={() => void download("bank", "bank")}>
                  Download bank transfers
                </button>
              )}
              <button type="button" className={quietBtn} onClick={() => void download("register", "register")}>
                Download register
              </button>
            </>
          )}
        </div>
      )}
      {r.status === "approved" && v.group === "Home Office" && <p className="mt-2 text-xs text-muted">The ADP file uses a draft layout until ROP&apos;s RUN import template is matched.</p>}
      {back !== null && (
        <Sheet>
          <label className="text-sm font-medium" htmlFor={`pay-back-${r.id}`}>
            What needs to change?
          </label>
          <textarea id={`pay-back-${r.id}`} value={back} onChange={(e) => setBack(e.target.value)} rows={3} className="mt-1 w-full border border-line-strong bg-paper px-3 py-2 text-base" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || back.trim().length < 3} className={dangerBtn} onClick={wrap(() => reject(back))}>
              Send back
            </button>
            <button type="button" className={quietBtn} onClick={() => setBack(null)}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
      {open && <Register lines={r.lines} totals={r.totals} v={v} />}
    </article>
  );
}

/* ---------------- Preparing ---------------- */

function Prepare({ v, supplemental, onDone }: { v: PayrollView; supplemental: boolean; onDone: (msg: string) => Promise<void> }) {
  const { user } = useSession();
  const [adjust, setAdjust] = useState<Record<string, Adjustment>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ lines: Line[]; totals: Totals }>({ lines: supplemental ? [] : v.draft, totals: supplemental ? totals0 : v.draftTotals });
  const [payDate, setPayDate] = useState(v.payDate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [addPerson, setAddPerson] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const body = (action: "prepare" | "preview") => ({ action, month: v.month, group: v.group, payDate, supplemental, adjustments: adjust, reason });
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      call<{ lines: Line[]; totals: Totals }>("/api/payroll", user?.id, { method: "POST", body: JSON.stringify(body("preview")) })
        .then((r) => {
          setPreview(r);
          setError("");
        })
        .catch((e: Error) => setError(e.message));
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adjust]);

  const problems = preview.lines.filter((l) => l.problems.length).length;
  const people = v.draft.map((l) => [l.person, l.name] as const).filter(([id]) => !preview.lines.some((l) => l.person === id));
  return (
    <section className="mt-10">
      <SectionHead className="mt-0">{supplemental ? "Prepare a supplemental payroll" : "Prepare this payroll"}</SectionHead>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {supplemental
          ? "This month is already paid. A supplemental payroll pays only adjustments and newly accepted expense reports: a late bonus, retro pay, a correction after a revised timesheet."
          : "Every amount below is worked out from the HR record, the approved timesheets and the accepted expense reports. Add bonuses, retro pay, payouts, medical reimbursements or advance repayments with a note; nothing else can be typed in."}
      </p>
      {supplemental && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={addPerson} onChange={(e) => setAddPerson(e.target.value)} className="min-h-11 border border-line-strong bg-paper px-3 py-2.5 text-sm" aria-label="Person">
            <option value="">Choose a person…</option>
            {people.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={!addPerson}
            className={quietBtn}
            onClick={() => {
              setEditing(addPerson);
              setAddPerson("");
            }}
          >
            Add an adjustment
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-clay">
          {error}
        </p>
      )}
      {editing && (
        <AdjustForm
          name={v.names[editing] ?? editing}
          value={adjust[editing] ?? {}}
          onClose={() => setEditing(null)}
          onSave={(a) => {
            setAdjust((cur) => {
              const next = { ...cur };
              if (ADJUSTMENT_KEYS.some((k) => a[k])) next[editing] = a;
              else delete next[editing];
              return next;
            });
            setEditing(null);
          }}
        />
      )}
      {preview.lines.length > 0 && <Register lines={preview.lines} totals={preview.totals} v={v} adjust={adjust} onAdjust={setEditing} />}
      <Sheet className="mt-6 grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="text-sm">
          <span className="font-medium">Pay date</span>
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 block min-h-11 w-full border border-line-strong bg-paper px-3 py-2.5 font-mono text-base" />
        </label>
        <label className="text-sm">
          <span className="font-medium">What this covers (kept forever)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`${v.group} payroll, ${v.month}`} className="mt-1 block min-h-11 w-full border border-line-strong bg-paper px-3 py-2.5 text-base" />
        </label>
      </Sheet>
      {problems > 0 && <p className="mt-3 text-sm text-warn">{problems} lines have something to check. The signers will see them; fix what you can first (approve timesheets, complete records).</p>}
      <button
        type="button"
        disabled={busy || reason.trim().length < 3 || !preview.lines.length}
        className={`${primaryBtn} mt-4`}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await call("/api/payroll", user?.id, { method: "POST", body: JSON.stringify(body("prepare")) });
            await onDone("Sent for signatures: the CFO, then the CEO.");
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Sending…" : "Send for signatures"}
      </button>
    </section>
  );
}

const ABOUT_403B = "403(b) is the US retirement savings plan for non-profit staff. EE is what the employee puts in from their pay; ROP is what ROP adds on top.";
const totals0: Totals = { gross: 0, net: 0, ee403b: 0, er403b: 0, tax: 0, advance: 0, expenses: 0, cost: {} };

function AdjustForm({ name, value, onSave, onClose }: { name: string; value: Adjustment; onSave: (a: Adjustment) => void; onClose: () => void }) {
  const [a, setA] = useState<Adjustment>(value);
  const any = ADJUSTMENT_KEYS.some((k) => a[k]);
  return (
    <div className="mt-4" role="group" aria-label={`Adjustments for ${name}`}>
      <Sheet className="mt-0">
        <p className="font-ledger font-bold">Adjustments for {name}</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {ADJUSTMENT_KEYS.map((k) => (
            <label key={k} className="text-sm">
              <span className="text-muted">{ADJUSTMENTS[k]}</span>
              <input
                type="number"
                inputMode="decimal"
                min={k === "retro" ? undefined : 0}
                step="0.01"
                value={a[k] ?? ""}
                onChange={(e) => setA({ ...a, [k]: e.target.value === "" ? undefined : Number(e.target.value) })}
                className="mt-1 block min-h-11 w-full border border-line-strong bg-paper px-3 py-2 text-end font-mono text-base tabular-nums"
              />
            </label>
          ))}
        </div>
        <label className="mt-3 block text-sm">
          <span className="text-muted">Why (required, kept forever)</span>
          <input value={a.note ?? ""} onChange={(e) => setA({ ...a, note: e.target.value })} className="mt-1 block min-h-11 w-full border border-line-strong bg-paper px-3 py-2 text-base" />
        </label>
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={any && (a.note ?? "").trim().length < 3} className={primaryBtn} onClick={() => onSave(a)}>
            {any ? "Save" : "Remove adjustments"}
          </button>
          <button type="button" className={quietBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
      </Sheet>
    </div>
  );
}

/** The ADP RUN file layout: columns, headings and earning codes, set by payroll to match ROP's RUN template. */
function RunLayoutPanel({ user }: { user: string }) {
  const [d, setD] = useState<{ run: RunLayout; history: { at: string; byName: string; reason: string }[]; mayEdit: boolean } | null>(null);
  const [draft, setDraft] = useState<RunLayout | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    fetch("/api/payroll/settings", { cache: "no-store", headers: { "x-demo-user": user } })
      .then((r) => (r.ok ? r.json() : null))
      .then((x) => x && (setD(x), setDraft(x.run)));
  }, [user]);
  if (!d || !draft) return null;
  const sel = "min-h-11 border border-line-strong bg-paper px-2 py-1.5 text-sm";
  const save = async () => {
    setError("");
    const r = await fetch("/api/payroll/settings", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: JSON.stringify({ run: draft, reason }) });
    const x = await r.json();
    if (!r.ok) return setError(x.error ?? "Could not save.");
    setD(x);
    setDraft(x.run);
    setReason("");
    setOpen(false);
  };
  const move = (i: number, by: number) => setDraft({ ...draft, columns: draft.columns.map((c, j, all) => (j === i ? all[i + by] : j === i + by ? all[i] : c)) });
  return (
    <section className="mt-12">
      <SectionHead className="mt-0" aside={<StatusBlock tone={d.run.confirmed ? "forest" : "ochre"}>{d.run.confirmed ? "Matches the RUN template" : "Draft layout"}</StatusBlock>}>
        ADP RUN file layout
      </SectionHead>
      <p className="mt-1 text-sm text-muted">
        {d.run.source}. Columns: {d.run.columns.map((c) => c.heading).join(", ")}.{d.history.length ? ` Last changed ${d.history[d.history.length - 1].at} by ${d.history[d.history.length - 1].byName}.` : ""}
      </p>
      {d.mayEdit && !open && (
        <button type="button" className={`${quietBtn} mt-2`} onClick={() => setOpen(true)}>
          Change the layout
        </button>
      )}
      {open && (
        <Sheet className="mt-3 space-y-4">
          <div>
            <SectionLabel>Columns, in order</SectionLabel>
            <ul className="mt-2 border-t border-ink">
              {draft.columns.map((c, i) => (
                <li key={c.key} className="flex flex-wrap items-center gap-2 border-b border-line py-1.5 text-sm last:border-ink">
                  <span aria-hidden className="w-6 font-mono text-xs text-muted">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className="w-48 text-muted">{RUN_COLUMN_LABEL[c.key]}</span>
                  <input value={c.heading} onChange={(e) => setDraft({ ...draft, columns: draft.columns.map((x, j) => (j === i ? { ...x, heading: e.target.value } : x)) })} className={sel} aria-label={`Heading for ${RUN_COLUMN_LABEL[c.key]}`} />
                  <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className="grid min-h-11 min-w-11 place-items-center text-muted hover:bg-ochre-soft disabled:opacity-30" aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" disabled={i === draft.columns.length - 1} onClick={() => move(i, 1)} className="grid min-h-11 min-w-11 place-items-center text-muted hover:bg-ochre-soft disabled:opacity-30" aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" onClick={() => setDraft({ ...draft, columns: draft.columns.filter((_, j) => j !== i) })} className="min-h-11 px-2 text-xs text-muted hover:text-clay">
                    Remove
                  </button>
                </li>
              ))}
            </ul>
            <select
              value=""
              onChange={(e) => e.target.value && setDraft({ ...draft, columns: [...draft.columns, { key: e.target.value as RunColumn, heading: RUN_COLUMN_LABEL[e.target.value as RunColumn] }] })}
              className={`${sel} mt-2`}
              aria-label="Add a column"
            >
              <option value="">Add a column…</option>
              {RUN_COLUMNS.filter((k) => !draft.columns.some((c) => c.key === k)).map((k) => (
                <option key={k} value={k}>
                  {RUN_COLUMN_LABEL[k]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <SectionLabel>Earning codes</SectionLabel>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {RUN_EARNINGS.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <span className="w-44 text-muted">{RUN_EARNING_LABEL[k]}</span>
                  <input value={draft.codes[k]} onChange={(e) => setDraft({ ...draft, codes: { ...draft.codes, [k]: e.target.value } })} className={`${sel} w-28 font-mono`} />
                </label>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              Company code <input value={draft.companyCode} onChange={(e) => setDraft({ ...draft, companyCode: e.target.value })} className={`${sel} w-28 font-mono`} />
            </label>
            <label className="flex items-center gap-2">
              Pay date as
              <select value={draft.dateFormat} onChange={(e) => setDraft({ ...draft, dateFormat: e.target.value as RunLayout["dateFormat"] })} className={sel}>
                <option>MM/DD/YYYY</option>
                <option>YYYY-MM-DD</option>
              </select>
            </label>
          </div>
          <label className="block text-sm">
            Where this layout comes from
            <input value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value })} className={`${sel} mt-1 w-full`} />
          </label>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input type="checkbox" checked={draft.confirmed} onChange={(e) => setDraft({ ...draft, confirmed: e.target.checked })} />
            This matches ROP&rsquo;s ADP RUN import template
          </label>
          <label className="block text-sm">
            Reason for the change
            <input value={reason} onChange={(e) => setReason(e.target.value)} className={`${sel} mt-1 w-full`} />
          </label>
          {error && <p className="text-sm text-clay">{error}</p>}
          <div className="flex gap-2">
            <button type="button" className={primaryBtn} disabled={reason.trim().length < 5} onClick={() => void save()}>
              Save layout
            </button>
            <button type="button" className={quietBtn} onClick={() => (setOpen(false), setDraft(d.run))}>
              Cancel
            </button>
          </div>
        </Sheet>
      )}
    </section>
  );
}
