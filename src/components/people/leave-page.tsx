"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { Receipt } from "@/lib/expense";
import { TYPES, workingDays, type LeaveKind, type LvAction } from "@/lib/leave";
import type { LeaveView } from "@/app/api/leave/route";

/**
 * Leave: balances, asking for leave on a phone, the supervisor's approval, who is away, and for HR
 * everyone's balances and adjustments. Approved leave fills in the timesheet.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const days = (hours: number) => {
  const d = Math.round((hours / 8) * 10) / 10;
  return `${d} ${d === 1 ? "day" : "days"}`;
};
const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
const STATUS = { pending: { tone: "ochre", text: "Waiting" }, approved: { tone: "forest", text: "Approved" }, returned: { tone: "clay", text: "Sent back" }, cancelled: { tone: "muted", text: "Cancelled" } } as const;

export function LeavePage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { date } = useT();
  const [v, setV] = useState<LeaveView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call<LeaveView>("/api/leave", user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user]);
  useEffect(() => {
    if (ready && user) void load();
  }, [ready, user, load]);

  if (!user) return null;
  const act = async (a: LvAction, msg: string) => {
    setError("");
    const r = await call<{ view: LeaveView }>("/api/leave", user.id, { method: "POST", body: JSON.stringify(a) });
    setV(r.view);
    setNotice(msg);
  };
  const fmt = (iso: string) => date(iso, { day: "numeric", month: "short" });
  const span = (a: string, b: string) => (a === b ? fmt(a) : `${fmt(a)} – ${fmt(b)}`);

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl tracking-tight">Leave</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">Ask for leave, see what you have left, and see who is away. Approved leave goes onto your timesheet.</p>
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
        {!v ? (
          !error && <p className="mt-10 text-sm text-muted">Loading…</p>
        ) : (
          <>
            {v.waiting.length > 0 && (
              <section className="mt-6">
                <SectionLabel>Waiting for your approval</SectionLabel>
                <div className="mt-2 space-y-3">
                  {v.waiting.map((r) => (
                    <RequestCard key={r.n} r={r} v={v} span={span} act={act} onError={setError} />
                  ))}
                </div>
              </section>
            )}

            {v.hasRecord && (
              <>
                <section className="mt-6">
                  <SectionLabel>Your balances · {v.groupLabel}</SectionLabel>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    {v.balances.map((b) => (
                      <div key={b.kind} className="rounded-2xl border border-line bg-surface p-4">
                        <p className="text-sm text-muted">{TYPES[b.kind]}</p>
                        <p className="mt-1 font-display text-3xl tabular-nums">{days(b.available)}</p>
                        <p className="mt-1 text-xs text-muted">
                          {b.afterPending !== b.available && `${days(b.afterPending)} after requests waiting · `}
                          {b.perMonth ? `earning ${days(b.perMonth)} a month` : "granted each January"}
                          {b.atCap && b.capHours ? ` · at the ${days(b.capHours)} limit, so nothing more builds up until you take some` : ""}
                        </p>
                      </div>
                    ))}
                    {!v.balances.length && <p className="text-sm text-muted">No paid leave balance applies to your contract.</p>}
                  </div>
                </section>
                {v.kinds.length > 0 && <RequestForm v={v} act={act} />}
              </>
            )}

            {v.mine.length > 0 && (
              <section className="mt-8">
                <SectionLabel>Your requests</SectionLabel>
                <div className="mt-2 space-y-3">
                  {v.mine.map((r) => (
                    <RequestCard key={r.n} r={r} v={v} span={span} act={act} onError={setError} compact />
                  ))}
                </div>
              </section>
            )}

            {v.calendar.length > 0 && (
              <section className="mt-8">
                <SectionLabel>Who is away</SectionLabel>
                <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
                  {v.calendar.map((c) => (
                    <li key={c.n} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                      <span className="w-40 shrink-0 tabular-nums">{span(c.start, c.end)}</span>
                      <span className="min-w-0 flex-1">
                        {v.names[c.person] ?? c.person} · {TYPES[c.kind]}
                      </span>
                      {c.status === "pending" && <Pill tone="ochre">Not yet approved</Pill>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {v.seesAll && <Everyone v={v} act={setNotice} onError={setError} />}

            {v.notes.length > 0 && (
              <details className="mt-8 rounded-2xl border border-line bg-surface p-4 text-sm">
                <summary className="cursor-pointer font-semibold">The rules for {v.groupLabel}</summary>
                <ul className="mt-2 list-disc space-y-1 ps-5 text-muted">
                  {v.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              </details>
            )}
          </>
        )}
      </main>
    </div>
  );
}

/* ---------------- Asking ---------------- */

function RequestForm({ v, act }: { v: LeaveView; act: (a: LvAction, msg: string) => Promise<void> }) {
  const { user } = useSession();
  const [kind, setKind] = useState<LeaveKind>(v.kinds[0].id);
  const [start, setStart] = useState(v.today);
  const [end, setEnd] = useState(v.today);
  const [half, setHalf] = useState(false);
  const [note, setNote] = useState("");
  const [certificate, setCertificate] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const count = half ? 0.5 : workingDays(start, end < start ? start : end, v.office).length;
  const bal = v.balances.find((b) => b.kind === kind);
  const after = bal ? bal.afterPending / 8 - count : null;
  return (
    <section className="mt-6 rounded-2xl border border-line bg-surface p-4">
      <SectionLabel>Ask for leave</SectionLabel>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Kind</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)} className={input}>
            {v.kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">First day</span>
          <input
            type="date"
            value={start}
            onChange={(e) => {
              setStart(e.target.value);
              if (end < e.target.value) setEnd(e.target.value);
            }}
            className={input}
          />
        </label>
        <label className="text-sm">
          <span className="font-medium">Last day</span>
          <input
            type="date"
            min={start}
            value={end}
            onChange={(e) => {
              setEnd(e.target.value);
              if (e.target.value !== start) setHalf(false);
            }}
            className={input}
          />
        </label>
        {start === end && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={half} onChange={(e) => setHalf(e.target.checked)} className="h-5 w-5" />
            Half a day
          </label>
        )}
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">Note for your supervisor (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
        </label>
        {kind === "sick" && (
          <div className="text-sm sm:col-span-2">
            <span className="font-medium">Doctor&apos;s certificate (needed for longer sick leave)</span>
            <label className={`${quietBtn} mt-1 inline-block cursor-pointer`}>
              {certificate ? `📎 ${certificate.name}` : "Photo or PDF"}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="sr-only"
                onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  setError("");
                  try {
                    const body = new FormData();
                    body.append("file", await shrink(f));
                    setCertificate(await call<Receipt>("/api/files", user?.id, { method: "POST", body }));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            </label>
          </div>
        )}
      </div>
      <p className="mt-3 text-sm">
        {count ? (
          <>
            <span className="font-semibold">
              {count} working {count === 1 ? "day" : "days"}
            </span>
            {after !== null && <span className={after < 0 ? "text-clay" : "text-muted"}> · {after < 0 ? `${Math.abs(Math.round(after * 10) / 10)} more than you have` : `${Math.round(after * 10) / 10} days left after this`}</span>}
          </>
        ) : (
          <span className="text-ochre">Those dates are all weekends or public holidays.</span>
        )}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      )}
      <button
        type="button"
        disabled={busy || !count}
        className={`${primaryBtn} mt-3`}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await act({ action: "request", request: { kind, start, end, ...(half ? { half: true } : {}), ...(note.trim() ? { note } : {}), ...(certificate ? { certificate } : {}) } }, "Sent to your supervisor.");
            setNote("");
            setCertificate(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        Ask
      </button>
    </section>
  );
}

/* ---------------- A request ---------------- */

type Req = LeaveView["mine"][number];

function RequestCard({ r, v, span, act, onError, compact }: { r: Req; v: LeaveView; span: (a: string, b: string) => string; act: (a: LvAction, msg: string) => Promise<void>; onError: (e: string) => void; compact?: boolean }) {
  const { user } = useSession();
  const [busy, setBusy] = useState(false);
  const [back, setBack] = useState<string | null>(null);
  const name = (id: string) => v.names[id] ?? id;
  const run = async (a: LvAction, msg: string) => {
    setBusy(true);
    onError("");
    try {
      await act(a, msg);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={STATUS[r.status].tone}>{STATUS[r.status].text}</Pill>
        <span className="font-medium">
          {compact ? "" : `${name(r.person)}: `}
          {TYPES[r.kind]}, {span(r.start, r.end)}
        </span>
        <span className="text-sm text-muted">
          {r.half ? "half a day" : `${r.days} working ${r.days === 1 ? "day" : "days"}`}
          {r.signatures.map((s) => ` · approved by ${name(s.by)}`).join("")}
          {r.status === "pending" && r.next && ` · with ${r.next.people.map(name).join(" or ") || "nobody (check the HR rules)"}${r.next.step === "hr" ? " (HR)" : ""}`}
        </span>
      </div>
      {r.note && <p className="mt-1 text-sm">“{r.note}”</p>}
      {r.certificate && (
        <button type="button" onClick={() => void openReceipt(r.certificate!.hash, user?.id)} className="mt-1 text-sm font-semibold text-forest hover:underline">
          📎 {r.certificate.name}
        </button>
      )}
      {r.closed?.note && <p className="mt-1 text-sm text-clay">Sent back by {name(r.closed.by)}: “{r.closed.note}”</p>}
      {r.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-xl bg-ochre-soft px-3 py-2 text-sm text-ochre">
          {r.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {r.cannotSign && <p className="mt-2 text-sm text-muted">You cannot approve this: {r.cannotSign}.</p>}
      {back === null ? (
        (r.canSign || r.canCancel) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {r.canSign && (
              <>
                <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run({ action: "approve", request: r.n }, r.steps.length > r.signatures.length + 1 ? "Approved. It goes to HR." : "Approved.")}>
                  Approve
                </button>
                <button type="button" disabled={busy} className={quietBtn} onClick={() => setBack("")}>
                  Send back
                </button>
              </>
            )}
            {r.canCancel && (
              <button type="button" disabled={busy} className={quietBtn} onClick={() => void run({ action: "cancel", request: r.n }, "Cancelled.")}>
                Cancel this leave
              </button>
            )}
          </div>
        )
      ) : (
        <div className="mt-3">
          <label className="text-sm font-medium" htmlFor={`lv-back-${r.n}`}>
            Why? (for example, other dates that work)
          </label>
          <textarea id={`lv-back-${r.n}`} value={back} onChange={(e) => setBack(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || back.trim().length < 3} className={dangerBtn} onClick={() => void run({ action: "return", request: r.n, note: back }, "Sent back.").then(() => setBack(null))}>
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

/* ---------------- HR: everyone ---------------- */

function Everyone({ v, act, onError }: { v: LeaveView; act: (msg: string) => void; onError: (e: string) => void }) {
  const { user } = useSession();
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState<"vacation" | "sick" | "floating" | "urgent">("vacation");
  const [daysN, setDaysN] = useState("");
  const [effective, setEffective] = useState(v.today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="mt-10">
      <SectionLabel>Everyone&apos;s balances (days available)</SectionLabel>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start font-medium">Person</th>
              <th className="px-3 py-2 text-start font-medium">Rules</th>
              <th className="px-3 py-2 text-end font-medium">Annual</th>
              <th className="px-3 py-2 text-end font-medium">Sick</th>
              <th className="px-3 py-2 text-end font-medium">Urgent</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {v.everyone.map((p) => {
              const b = (k: string) => p.balances.find((x) => x.kind === k);
              const cell = (k: string) => {
                const x = b(k);
                return x ? `${Math.round((x.available / 8) * 10) / 10}${x.atCap ? " (limit)" : ""}` : "—";
              };
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 text-muted">{p.group}</td>
                  <td className="px-3 py-2 text-end">{cell("vacation")}</td>
                  <td className="px-3 py-2 text-end">{cell("sick")}</td>
                  <td className="px-3 py-2 text-end">{cell("urgent")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {v.isHr && (
        <div className="mt-4 rounded-2xl border border-line bg-surface p-4">
          <SectionLabel>Adjust a balance</SectionLabel>
          <p className="mt-1 text-sm text-muted">For opening balances brought over from BambooHR, or a correction. Another HR officer approves it in People before it counts.</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium">Person</span>
              <select value={person} onChange={(e) => setPerson(e.target.value)} className={input}>
                <option value="">Choose…</option>
                {v.everyone
                  .filter((p) => p.id !== v.me)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium">Leave</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={input}>
                <option value="vacation">{TYPES.vacation}</option>
                <option value="sick">{TYPES.sick}</option>
                <option value="urgent">{TYPES.urgent}</option>
                <option value="floating">{TYPES.floating}</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium">Days to add (negative to take away)</span>
              <input type="number" inputMode="decimal" step="0.5" value={daysN} onChange={(e) => setDaysN(e.target.value)} className={input} />
            </label>
            <label className="text-sm">
              <span className="font-medium">As of</span>
              <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className={input} />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="font-medium">Reason (kept forever)</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opening balance from BambooHR, 31 Oct 2026" className={input} />
            </label>
          </div>
          <button
            type="button"
            disabled={busy || !person || !Number(daysN) || reason.trim().length < 3}
            className={`${primaryBtn} mt-3`}
            onClick={async () => {
              setBusy(true);
              onError("");
              try {
                await call("/api/hr", user?.id, { method: "POST", body: JSON.stringify({ action: "propose", proposal: { type: "leave-adjust", subject: person, effective, leave: kind, hours: Number(daysN) * 8, reason } }) });
                act("Proposed. It counts once another HR officer approves it in People.");
                setDaysN("");
                setReason("");
              } catch (e) {
                onError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Propose the adjustment
          </button>
        </div>
      )}
    </section>
  );
}
