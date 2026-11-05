"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { ROLE_LABEL } from "@/lib/hr";
import { ADJUSTMENTS, ADJUSTMENT_KEYS, GROUPS, type Adjustment, type Group, type Line, type Totals } from "@/lib/payroll";
import type { PayrollView } from "@/app/api/payroll/route";

/**
 * Monthly payroll: worked out from the HR record and approved timesheets, adjusted with reasons,
 * signed by the CFO and the CEO, then the files for ADP RUN or the bank.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
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
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl tracking-tight">Payroll</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">
              Worked out from the HR record and approved timesheets. Payroll adds adjustments with reasons; the CFO and the CEO sign; then the files for ADP RUN or the bank are released.
            </p>
          </div>
          <span className="flex gap-4 text-sm">
            <Link href="/timesheets" className="font-semibold text-forest hover:underline">
              Timesheets
            </Link>
            <Link href="/people" className="font-semibold text-forest hover:underline">
              People
            </Link>
          </span>
        </div>
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-full border border-line bg-surface">
            <button type="button" aria-label="Previous month" onClick={() => go({ month: shiftMonth(m, -1) })} className="grid h-11 w-11 place-items-center rounded-full hover:bg-sunken">
              ‹
            </button>
            <span className="min-w-36 text-center text-sm font-semibold">{monthName(m)}</span>
            <button type="button" aria-label="Next month" onClick={() => go({ month: shiftMonth(m, 1) })} className="grid h-11 w-11 place-items-center rounded-full hover:bg-sunken">
              ›
            </button>
          </div>
          <div role="radiogroup" aria-label="Pay group" className="flex rounded-full border border-line bg-surface p-1">
            {GROUPS.map((g) => (
              <button key={g} type="button" role="radio" aria-checked={group === g} onClick={() => go({ group: g })} className={`rounded-full px-4 py-2 text-sm ${group === g ? "bg-forest font-semibold text-forest-ink" : "text-muted"}`}>
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
              <Prepare key={`${v.month}-${v.group}-${v.runs.length}`} v={v} supplemental={!!paid} onDone={async (msg) => { setNotice(msg); await load(); }} />
            ) : (
              !v.runs.length && (
                <section className="mt-6">
                  <p className="text-sm text-muted">Not prepared yet. This is how it works out today:</p>
                  <Register lines={v.draft} totals={v.draftTotals} v={v} />
                </section>
              )
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* ---------------- Amounts ---------------- */

const amt = (n: number, cur: string) => (cur === "AFN" ? Math.round(n).toLocaleString("en-US") : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

function Register({ lines, totals, v, adjust, onAdjust }: { lines: Line[]; totals: Totals; v: PayrollView; adjust?: Record<string, Adjustment>; onAdjust?: (person: string) => void }) {
  const cur = lines[0]?.currency ?? (v.group === "Afghanistan" ? "AFN" : "USD");
  const ho = v.group === "Home Office";
  const extra = (l: Line) => l.bonus + l.retro + l.vacationPayout + l.medicalReimb + l.expenses;
  return (
    <div className="mt-3 space-y-4">
      <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[52rem] text-sm tabular-nums">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start font-medium">Person</th>
              <th className="px-3 py-2 text-end font-medium">Regular</th>
              <th className="px-3 py-2 text-end font-medium">Danger / post</th>
              <th className="px-3 py-2 text-end font-medium">Allowances</th>
              <th className="px-3 py-2 text-end font-medium">Adjustments</th>
              <th className="px-3 py-2 text-end font-medium">Gross</th>
              {ho ? <th className="px-3 py-2 text-end font-medium">403(b) EE / ROP</th> : <th className="px-3 py-2 text-end font-medium">Tax</th>}
              <th className="px-3 py-2 text-end font-medium">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {lines.map((l) => (
              <tr key={l.person} className="align-top">
                <td className="px-3 py-2">
                  <span className="font-medium">{l.name}</span>
                  <span className="block text-xs text-muted">
                    {l.title} · {amt(l.rate, l.currency)} per {l.payBasis.toLowerCase()}
                  </span>
                  {l.problems.map((p) => (
                    <span key={p} className="mt-0.5 block text-xs text-ochre">
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
                    <button type="button" onClick={() => onAdjust(l.person)} className="mt-1 text-xs font-semibold text-forest hover:underline">
                      {adjust?.[l.person] ? "Change adjustments" : "Add an adjustment"}
                    </button>
                  )}
                </td>
                <td className="px-3 py-2 text-end">{amt(l.regular, l.currency)}</td>
                <td className="px-3 py-2 text-end">
                  {amt(l.dangerPay + l.postDiff, l.currency)}
                  {(l.dangerDays > 0 || l.postDiffDays > 0) && <span className="block text-xs text-muted">{l.dangerDays + l.postDiffDays} days</span>}
                </td>
                <td className="px-3 py-2 text-end">{amt(l.comms + l.living, l.currency)}</td>
                <td className="px-3 py-2 text-end">
                  {amt(extra(l), l.currency)}
                  {l.advance > 0 && <span className="block text-xs text-muted">−{amt(l.advance, l.currency)} advance</span>}
                </td>
                <td className="px-3 py-2 text-end font-semibold">{amt(l.gross, l.currency)}</td>
                {ho ? (
                  <td className="px-3 py-2 text-end">
                    {amt(l.ee403b, l.currency)} / {amt(l.er403b, l.currency)}
                  </td>
                ) : (
                  <td className="px-3 py-2 text-end">{amt(l.tax, l.currency)}</td>
                )}
                <td className="px-3 py-2 text-end font-semibold">{amt(l.net, l.currency)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t-2 border-line font-semibold">
            <tr>
              <td className="px-3 py-2">{lines.length} people</td>
              <td colSpan={4} />
              <td className="px-3 py-2 text-end">{amt(totals.gross, cur)}</td>
              <td className="px-3 py-2 text-end">{ho ? `${amt(totals.ee403b, cur)} / ${amt(totals.er403b, cur)}` : amt(totals.tax, cur)}</td>
              <td className="px-3 py-2 text-end">{amt(totals.net, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="rounded-2xl border border-line bg-surface p-4">
        <SectionLabel>Cost by funding source ({cur}, gross plus ROP&apos;s 403(b))</SectionLabel>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {Object.entries(totals.cost)
            .sort((a, b) => b[1] - a[1])
            .map(([s, c]) => (
              <li key={s} className="flex justify-between gap-3">
                <span className="truncate">{v.sources[s] ?? s}</span>
                <span className="tabular-nums">{amt(c, cur)}</span>
              </li>
            ))}
        </ul>
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
    <article className="mt-6 rounded-2xl border border-line bg-paper p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        {r.status === "approved" ? <Pill tone="forest">Approved</Pill> : r.status === "pending" ? <Pill tone="ochre">Waiting for signatures</Pill> : r.status === "rejected" ? <Pill tone="clay">Sent back</Pill> : <Pill tone="muted">Withdrawn</Pill>}
        {r.supplemental && <Pill tone="plum">Supplemental</Pill>}
        <span className="text-xs text-muted">
          #{r.id} · prepared by {name(r.by)} · pay date {r.payDate}
        </span>
        <button type="button" onClick={() => setOpen(!open)} className="ms-auto text-sm font-semibold text-forest hover:underline" aria-expanded={open}>
          {open ? "Hide register" : "Show register"}
        </button>
      </div>
      <h2 className="mt-2 text-lg font-semibold">
        {v.group}, {monthName(v.month)}: {amt(r.totals.net, r.lines[0]?.currency ?? "USD")} net to {r.lines.length} people
      </h2>
      <p className="text-sm text-muted">{r.reason}</p>
      {r.changedSince.length > 0 && (
        <div className="mt-3 rounded-xl border border-clay bg-clay-soft px-3 py-2 text-sm text-clay">
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
        <ul className="mt-3 space-y-1 rounded-xl bg-ochre-soft px-3 py-2 text-sm text-ochre">
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
            <li key={i} className={`rounded-full border px-3 py-1 ${s ? "border-forest text-leaf" : isNext ? "border-ochre text-ochre" : "border-line text-muted"}`}>
              {i + 1}. {ROLE_LABEL[role]}
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
      {r.closedBy?.note && <p className="mt-2 text-sm text-clay">Sent back by {name(r.closedBy.by)}: {r.closedBy.note}</p>}
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
        <div className="mt-4">
          <label className="text-sm font-medium" htmlFor={`pay-back-${r.id}`}>
            What needs to change?
          </label>
          <textarea id={`pay-back-${r.id}`} value={back} onChange={(e) => setBack(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || back.trim().length < 3} className={dangerBtn} onClick={wrap(() => reject(back))}>
              Send back
            </button>
            <button type="button" className={quietBtn} onClick={() => setBack(null)}>
              Cancel
            </button>
          </div>
        </div>
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
    <section className="mt-8">
      <h2 className="text-lg font-semibold">{supplemental ? "Prepare a supplemental payroll" : "Prepare this payroll"}</h2>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        {supplemental
          ? "This month is already paid. A supplemental payroll pays only adjustments and newly accepted expense reports: a late bonus, retro pay, a correction after a revised timesheet."
          : "Every amount below is worked out from the HR record, the approved timesheets and the accepted expense reports. Add bonuses, retro pay, payouts, medical reimbursements or advance repayments with a note; nothing else can be typed in."}
      </p>
      {supplemental && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select value={addPerson} onChange={(e) => setAddPerson(e.target.value)} className="rounded-xl border border-line bg-paper px-3 py-2.5 text-sm" aria-label="Person">
            <option value="">Choose a person…</option>
            {people.map(([id, n]) => (
              <option key={id} value={id}>
                {n}
              </option>
            ))}
          </select>
          <button type="button" disabled={!addPerson} className={quietBtn} onClick={() => { setEditing(addPerson); setAddPerson(""); }}>
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
      <div className="mt-4 grid gap-3 sm:grid-cols-[12rem_1fr]">
        <label className="text-sm">
          <span className="font-medium">Pay date</span>
          <input type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base" />
        </label>
        <label className="text-sm">
          <span className="font-medium">What this covers (kept forever)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`${v.group} payroll, ${v.month}`} className="mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base" />
        </label>
      </div>
      {problems > 0 && <p className="mt-3 text-sm text-ochre">{problems} lines have something to check. The signers will see them; fix what you can first (approve timesheets, complete records).</p>}
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

const totals0: Totals = { gross: 0, net: 0, ee403b: 0, er403b: 0, tax: 0, advance: 0, expenses: 0, cost: {} };

function AdjustForm({ name, value, onSave, onClose }: { name: string; value: Adjustment; onSave: (a: Adjustment) => void; onClose: () => void }) {
  const [a, setA] = useState<Adjustment>(value);
  const any = ADJUSTMENT_KEYS.some((k) => a[k]);
  return (
    <div className="mt-4 rounded-2xl border border-forest/40 bg-paper p-4" role="group" aria-label={`Adjustments for ${name}`}>
      <p className="font-semibold">Adjustments for {name}</p>
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
              className="mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base tabular-nums"
            />
          </label>
        ))}
      </div>
      <label className="mt-3 block text-sm">
        <span className="text-muted">Why (required, kept forever)</span>
        <input value={a.note ?? ""} onChange={(e) => setA({ ...a, note: e.target.value })} className="mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
      </label>
      <div className="mt-3 flex gap-2">
        <button type="button" disabled={any && (a.note ?? "").trim().length < 3} className={primaryBtn} onClick={() => onSave(a)}>
          {any ? "Save" : "Remove adjustments"}
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}
