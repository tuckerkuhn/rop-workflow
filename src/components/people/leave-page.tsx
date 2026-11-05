"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { Receipt } from "@/lib/expense";
import type { MessageKey } from "@/lib/i18n";
import { GROUP_LABEL, workingDays, type Group, type LeaveKind, type LvAction } from "@/lib/leave";
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

type T = ReturnType<typeof useT>["t"];
const days = (t: T, hours: number) => {
  const d = Math.round((hours / 8) * 10) / 10;
  return t(d === 1 ? "lv.day" : "lv.days", { n: d });
};
const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
const STATUS = { pending: { tone: "ochre", text: "lv.status.pending" }, approved: { tone: "forest", text: "lv.status.approved" }, returned: { tone: "clay", text: "lv.status.returned" }, cancelled: { tone: "muted", text: "lv.status.cancelled" } } as const;
/** Leave kind and rule-group names from @/lib/leave, shown in the reader's language. */
const TYPE_KEY: Record<LeaveKind, MessageKey> = { vacation: "lv.type.vacation", sick: "lv.type.sick", floating: "lv.type.floating", urgent: "lv.type.urgent", compassionate: "lv.type.compassionate", parental: "lv.type.parental", hajj: "lv.type.hajj", unpaid: "lv.type.unpaid", other: "lv.type.other" };
const GROUP_KEY: Record<Group, MessageKey> = { homeOffice: "lv.group.homeOffice", expat: "lv.group.expat", afghanistan: "lv.group.afghanistan", guatemala: "lv.group.guatemala", none: "lv.group.none" };
/** The API sends group names as English labels; find the group to translate it, or show the label as sent. */
const groupName = (t: T, label: string) => {
  const g = (Object.keys(GROUP_LABEL) as Group[]).find((k) => GROUP_LABEL[k] === label);
  return g ? t(GROUP_KEY[g]) : label;
};

export function LeavePage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { t, date } = useT();
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
            <h1 className="font-display text-3xl tracking-tight">{t("lv.title")}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">{t("lv.intro")}</p>
          </div>
          <span className="flex gap-4 text-sm">
            <Link href="/timesheets" className="font-semibold text-forest hover:underline">
              {t("lv.timesheets")}
            </Link>
            <Link href="/people" className="font-semibold text-forest hover:underline">
              {t("lv.people")}
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
          !error && <p className="mt-10 text-sm text-muted">{t("lv.loading")}</p>
        ) : (
          <>
            {v.waiting.length > 0 && (
              <section className="mt-6">
                <SectionLabel>{t("lv.waitingForYou")}</SectionLabel>
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
                  <SectionLabel>{t("lv.yourBalances", { group: groupName(t, v.groupLabel) })}</SectionLabel>
                  <div className="mt-2 grid gap-3 sm:grid-cols-3">
                    {v.balances.map((b) => (
                      <div key={b.kind} className="rounded-2xl border border-line bg-surface p-4">
                        <p className="text-sm text-muted">{t(TYPE_KEY[b.kind])}</p>
                        <p className="mt-1 font-display text-3xl tabular-nums">{days(t, b.available)}</p>
                        <p className="mt-1 text-xs text-muted">
                          {b.afterPending !== b.available && t("lv.afterWaiting", { days: days(t, b.afterPending) })}
                          {b.perMonth ? t("lv.earning", { days: days(t, b.perMonth) }) : t("lv.granted")}
                          {b.atCap && b.capHours ? t("lv.atCap", { days: days(t, b.capHours) }) : ""}
                        </p>
                      </div>
                    ))}
                    {!v.balances.length && <p className="text-sm text-muted">{t("lv.noBalance")}</p>}
                  </div>
                </section>
                {v.kinds.length > 0 && <RequestForm v={v} act={act} />}
              </>
            )}

            {v.mine.length > 0 && (
              <section className="mt-8">
                <SectionLabel>{t("lv.yourRequests")}</SectionLabel>
                <div className="mt-2 space-y-3">
                  {v.mine.map((r) => (
                    <RequestCard key={r.n} r={r} v={v} span={span} act={act} onError={setError} compact />
                  ))}
                </div>
              </section>
            )}

            {v.calendar.length > 0 && (
              <section className="mt-8">
                <SectionLabel>{t("lv.whoIsAway")}</SectionLabel>
                <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
                  {v.calendar.map((c) => (
                    <li key={c.n} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                      <span className="w-40 shrink-0 tabular-nums">{span(c.start, c.end)}</span>
                      <span className="min-w-0 flex-1">
                        {v.names[c.person] ?? c.person} · {t(TYPE_KEY[c.kind])}
                      </span>
                      {c.status === "pending" && <Pill tone="ochre">{t("lv.notYetApproved")}</Pill>}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {v.seesAll && <Everyone v={v} act={setNotice} onError={setError} />}

            {v.notes.length > 0 && (
              <details className="mt-8 rounded-2xl border border-line bg-surface p-4 text-sm">
                <summary className="cursor-pointer font-semibold">{t("lv.rulesFor", { group: groupName(t, v.groupLabel) })}</summary>
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
  const { t } = useT();
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
      <SectionLabel>{t("lv.askForLeave")}</SectionLabel>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">{t("lv.kind")}</span>
          <select value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)} className={input}>
            {v.kinds.map((k) => (
              <option key={k.id} value={k.id}>
                {t(TYPE_KEY[k.id])}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">{t("lv.firstDay")}</span>
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
          <span className="font-medium">{t("lv.lastDay")}</span>
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
            {t("lv.halfDay")}
          </label>
        )}
        <label className="text-sm sm:col-span-2">
          <span className="font-medium">{t("lv.noteForSupervisor")}</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} className={input} />
        </label>
        {kind === "sick" && (
          <div className="text-sm sm:col-span-2">
            <span className="font-medium">{t("lv.certificate")}</span>
            <label className={`${quietBtn} mt-1 inline-block cursor-pointer`}>
              {certificate ? `📎 ${certificate.name}` : t("lv.photoOrPdf")}
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
              {t(count === 1 ? "lv.workingDay" : "lv.workingDays", { n: count })}
            </span>
            {after !== null && <span className={after < 0 ? "text-clay" : "text-muted"}> · {after < 0 ? t("lv.moreThanYouHave", { n: Math.abs(Math.round(after * 10) / 10) }) : t("lv.daysLeftAfter", { n: Math.round(after * 10) / 10 })}</span>}
          </>
        ) : (
          <span className="text-ochre">{t("lv.allWeekends")}</span>
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
            await act({ action: "request", request: { kind, start, end, ...(half ? { half: true } : {}), ...(note.trim() ? { note } : {}), ...(certificate ? { certificate } : {}) } }, t("lv.sentToSupervisor"));
            setNote("");
            setCertificate(null);
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("lv.ask")}
      </button>
    </section>
  );
}

/* ---------------- A request ---------------- */

type Req = LeaveView["mine"][number];

function RequestCard({ r, v, span, act, onError, compact }: { r: Req; v: LeaveView; span: (a: string, b: string) => string; act: (a: LvAction, msg: string) => Promise<void>; onError: (e: string) => void; compact?: boolean }) {
  const { user } = useSession();
  const { t } = useT();
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
        <Pill tone={STATUS[r.status].tone}>{t(STATUS[r.status].text)}</Pill>
        <span className="font-medium">
          {compact ? "" : t("lv.card.who", { name: name(r.person) })}
          {t("lv.card.what", { type: t(TYPE_KEY[r.kind]), dates: span(r.start, r.end) })}
        </span>
        <span className="text-sm text-muted">
          {r.half ? t("lv.halfADay") : t(r.days === 1 ? "lv.workingDay" : "lv.workingDays", { n: r.days })}
          {r.signatures.map((s) => t("lv.approvedBy", { name: name(s.by) })).join("")}
          {r.status === "pending" && r.next && `${t("lv.with", { people: r.next.people.map(name).join(t("lv.or")) || t("lv.nobody") })}${r.next.step === "hr" ? t("lv.hrStep") : ""}`}
        </span>
      </div>
      {r.note && <p className="mt-1 text-sm">“{r.note}”</p>}
      {r.certificate && (
        <button type="button" onClick={() => void openReceipt(r.certificate!.hash, user?.id)} className="mt-1 text-sm font-semibold text-forest hover:underline">
          📎 {r.certificate.name}
        </button>
      )}
      {r.closed?.note && <p className="mt-1 text-sm text-clay">{t("lv.sentBackBy", { name: name(r.closed.by), note: r.closed.note })}</p>}
      {r.warnings.length > 0 && (
        <ul className="mt-2 space-y-1 rounded-xl bg-ochre-soft px-3 py-2 text-sm text-ochre">
          {r.warnings.map((w) => (
            <li key={w}>⚠ {w}</li>
          ))}
        </ul>
      )}
      {r.cannotSign && <p className="mt-2 text-sm text-muted">{t("lv.cannotApprove", { why: r.cannotSign })}</p>}
      {back === null ? (
        (r.canSign || r.canCancel) && (
          <div className="mt-3 flex flex-wrap gap-2">
            {r.canSign && (
              <>
                <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run({ action: "approve", request: r.n }, r.steps.length > r.signatures.length + 1 ? t("lv.approvedToHr") : t("lv.approvedDone"))}>
                  {t("lv.approve")}
                </button>
                <button type="button" disabled={busy} className={quietBtn} onClick={() => setBack("")}>
                  {t("lv.sendBack")}
                </button>
              </>
            )}
            {r.canCancel && (
              <button type="button" disabled={busy} className={quietBtn} onClick={() => void run({ action: "cancel", request: r.n }, t("lv.cancelledDone"))}>
                {t("lv.cancelLeave")}
              </button>
            )}
          </div>
        )
      ) : (
        <div className="mt-3">
          <label className="text-sm font-medium" htmlFor={`lv-back-${r.n}`}>
            {t("lv.why")}
          </label>
          <textarea id={`lv-back-${r.n}`} value={back} onChange={(e) => setBack(e.target.value)} rows={2} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || back.trim().length < 3} className={dangerBtn} onClick={() => void run({ action: "return", request: r.n, note: back }, t("lv.sentBackDone")).then(() => setBack(null))}>
              {t("lv.sendBack")}
            </button>
            <button type="button" className={quietBtn} onClick={() => setBack(null)}>
              {t("lv.cancel")}
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
  const { t } = useT();
  const [person, setPerson] = useState("");
  const [kind, setKind] = useState<"vacation" | "sick" | "floating" | "urgent">("vacation");
  const [daysN, setDaysN] = useState("");
  const [effective, setEffective] = useState(v.today);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <section className="mt-10">
      <SectionLabel>{t("lv.everyone")}</SectionLabel>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[32rem] text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-3 py-2 text-start font-medium">{t("lv.col.person")}</th>
              <th className="px-3 py-2 text-start font-medium">{t("lv.col.rules")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("lv.col.annual")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("lv.col.sick")}</th>
              <th className="px-3 py-2 text-end font-medium">{t("lv.col.urgent")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line tabular-nums">
            {v.everyone.map((p) => {
              const b = (k: string) => p.balances.find((x) => x.kind === k);
              const cell = (k: string) => {
                const x = b(k);
                return x ? `${Math.round((x.available / 8) * 10) / 10}${x.atCap ? t("lv.limit") : ""}` : "—";
              };
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2">{p.name}</td>
                  <td className="px-3 py-2 text-muted">{groupName(t, p.group)}</td>
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
          <SectionLabel>{t("lv.adjust")}</SectionLabel>
          <p className="mt-1 text-sm text-muted">{t("lv.adjustHelp")}</p>
          <div className="mt-2 grid gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="font-medium">{t("lv.person")}</span>
              <select value={person} onChange={(e) => setPerson(e.target.value)} className={input}>
                <option value="">{t("lv.choose")}</option>
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
              <span className="font-medium">{t("lv.leave")}</span>
              <select value={kind} onChange={(e) => setKind(e.target.value as typeof kind)} className={input}>
                <option value="vacation">{t(TYPE_KEY.vacation)}</option>
                <option value="sick">{t(TYPE_KEY.sick)}</option>
                <option value="urgent">{t(TYPE_KEY.urgent)}</option>
                <option value="floating">{t(TYPE_KEY.floating)}</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="font-medium">{t("lv.daysToAdd")}</span>
              <input type="number" inputMode="decimal" step="0.5" value={daysN} onChange={(e) => setDaysN(e.target.value)} className={input} />
            </label>
            <label className="text-sm">
              <span className="font-medium">{t("lv.asOf")}</span>
              <input type="date" value={effective} onChange={(e) => setEffective(e.target.value)} className={input} />
            </label>
            <label className="text-sm sm:col-span-2">
              <span className="font-medium">{t("lv.reason")}</span>
              <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("lv.reasonPlaceholder")} className={input} />
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
                act(t("lv.proposed"));
                setDaysN("");
                setReason("");
              } catch (e) {
                onError(e instanceof Error ? e.message : String(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("lv.propose")}
          </button>
        </div>
      )}
    </section>
  );
}
