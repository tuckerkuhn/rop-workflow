"use client";

import { FieldHelp } from "@/components/app/field-help";

import { plainError } from "@/lib/plain-error";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { Pill, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, Figures, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
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
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

type T = ReturnType<typeof useT>["t"];
const days = (t: T, hours: number) => {
  const d = Math.round((hours / 8) * 10) / 10;
  return t(d === 1 ? "lv.day" : "lv.days", { n: d });
};
const input = "mt-1 block min-h-11 w-full border border-line bg-paper px-3 py-2.5 text-base";
const link = "inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline";
/** Everyone's balances: person, rules, then three figures. Scrolls in its own box on a phone. */
const EVERYONE = "minmax(8rem,1.4fr) minmax(8rem,1.2fr) 5rem 5rem 5rem";

/** Ruled rows with no column head, for requests: each row says what it is in its own words. */
function Rows({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="table" aria-label={label} className="mt-3 border-t border-ink font-ledger [&>*:last-child]:border-ink">
      {children}
    </div>
  );
}
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
        {/* HR roles go back to People; everyone else came from Home. */}
        <PageHead
          back={v?.seesAll ? { href: "/people", label: t("lv.people") } : { href: "/home", label: t("nav.home") }}
          title={t("lv.title")}
          actions={
            <Link href="/timesheets" className={link}>
              {t("lv.timesheets")}
            </Link>
          }
        >
          {t("lv.intro")}
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
        {!v ? (
          !error && <p className="mt-10 text-sm text-muted">{t("lv.loading")}</p>
        ) : (
          <>
            {v.waiting.length > 0 && (
              <section>
                <SectionHead>{t("lv.waitingForYou")}</SectionHead>
                <Rows label={t("lv.waitingForYou")}>
                  {v.waiting.map((r) => (
                    <RequestCard key={r.n} r={r} v={v} span={span} act={act} onError={setError} />
                  ))}
                </Rows>
              </section>
            )}

            {v.hasRecord && (
              <>
                <section>
                  <SectionHead>{t("lv.yourBalances", { group: groupName(t, v.groupLabel) })}</SectionHead>
                  {v.balances.length ? (
                    <>
                      <Figures items={v.balances.map((b) => ({ label: t(TYPE_KEY[b.kind]), value: days(t, b.available) }))} className="mt-3" />
                      <ul className="mt-2 space-y-1 text-xs text-muted">
                        {v.balances.map((b) => (
                          <li key={b.kind}>
                            <span className="font-semibold text-ink">{t(TYPE_KEY[b.kind])}: </span>
                            {b.afterPending !== b.available && t("lv.afterWaiting", { days: days(t, b.afterPending) })}
                            {b.perMonth ? t("lv.earning", { days: days(t, b.perMonth) }) : t("lv.granted")}
                            {b.atCap && b.capHours ? t("lv.atCap", { days: days(t, b.capHours) }) : ""}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <Empty>{t("lv.noBalance")}</Empty>
                  )}
                </section>
                {v.kinds.length > 0 && <RequestForm v={v} act={act} />}
              </>
            )}

            {v.mine.length > 0 && (
              <section>
                <SectionHead>{t("lv.yourRequests")}</SectionHead>
                <Rows label={t("lv.yourRequests")}>
                  {v.mine.map((r) => (
                    <RequestCard key={r.n} r={r} v={v} span={span} act={act} onError={setError} compact />
                  ))}
                </Rows>
              </section>
            )}

            {v.calendar.length > 0 && (
              <section>
                <SectionHead>{t("lv.whoIsAway")}</SectionHead>
                <Rows label={t("lv.whoIsAway")}>
                  {v.calendar.map((c) => (
                    <LedgerRow key={c.n} cols="minmax(0,1fr)" className="text-sm">
                      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Fig className="w-40 shrink-0 text-start">{span(c.start, c.end)}</Fig>
                        <span className="min-w-0 flex-1">
                          {v.names[c.person] ?? c.person} · {t(TYPE_KEY[c.kind])}
                        </span>
                        {c.status === "pending" && <Pill tone="ochre">{t("lv.notYetApproved")}</Pill>}
                      </span>
                    </LedgerRow>
                  ))}
                </Rows>
              </section>
            )}

            {v.seesAll && <Everyone v={v} act={setNotice} onError={setError} />}

            {/* No HR record yet: say so, as Timesheets and Expenses do, instead of another group's leave rules. */}
            {!v.hasRecord && v.mine.length === 0 && <Empty className="mt-8">{t("lv.noRecord")}</Empty>}

            {v.hasRecord && v.notes.length > 0 && (
              <details className="mt-8 border-y border-line px-3 text-sm">
                <summary className="flex min-h-12 cursor-pointer items-center font-ledger font-semibold">{t("lv.rulesFor", { group: groupName(t, v.groupLabel) })}</summary>
                <ul className="list-disc space-y-1 pb-3 ps-5 text-muted">
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
    <section>
      <SectionHead>{t("lv.askForLeave")}</SectionHead>
      <Sheet className="mt-3">
        <div className="grid gap-3 sm:grid-cols-2">
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
            <label className="flex min-h-11 items-center gap-2 self-end text-sm">
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
              <FieldHelp field="hr.certificate" />
              <label className={`${quietBtn} mt-1 block w-fit cursor-pointer`}>
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
              <span className="font-mono font-semibold tabular-nums">
                {t(count === 1 ? "lv.workingDay" : "lv.workingDays", { n: count })}
              </span>
              {after !== null && <span className={after < 0 ? "text-clay" : "text-muted"}> · {after < 0 ? t("lv.moreThanYouHave", { n: Math.abs(Math.round(after * 10) / 10) }) : t("lv.daysLeftAfter", { n: Math.round(after * 10) / 10 })}</span>}
            </>
          ) : (
            <span className="text-warn">{t("lv.allWeekends")}</span>
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
      </Sheet>
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
    <LedgerRow cols="minmax(0,1fr)" className="text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBlock tone={STATUS[r.status].tone}>{t(STATUS[r.status].text)}</StatusBlock>
          <span className="font-medium">
            {compact ? "" : t("lv.card.who", { name: name(r.person) })}
            {t("lv.card.what", { type: t(TYPE_KEY[r.kind]), dates: span(r.start, r.end) })}
          </span>
          <span className="text-muted">
            {r.half ? t("lv.halfADay") : t(r.days === 1 ? "lv.workingDay" : "lv.workingDays", { n: r.days })}
            {r.signatures.map((s) => t("lv.approvedBy", { name: name(s.by) })).join("")}
            {r.status === "pending" && r.next && `${t("lv.with", { people: r.next.people.map(name).join(t("lv.or")) || t("lv.nobody") })}${r.next.step === "hr" ? t("lv.hrStep") : ""}`}
          </span>
        </div>
        {r.note && <p className="mt-1 text-sm">“{r.note}”</p>}
        {r.certificate && (
          <button type="button" onClick={() => void openReceipt(r.certificate!.hash, user?.id)} className="inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline">
            📎 {r.certificate.name}
          </button>
        )}
        {r.closed?.note && <p className="mt-1 text-sm text-clay">{t("lv.sentBackBy", { name: name(r.closed.by), note: r.closed.note })}</p>}
        {r.warnings.length > 0 && (
          <ul className="mt-2 space-y-1 bg-ochre-soft px-3 py-2 text-sm text-warn">
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
            <textarea id={`lv-back-${r.n}`} value={back} onChange={(e) => setBack(e.target.value)} rows={2} className="mt-1 w-full border border-line bg-paper px-3 py-2 text-base" />
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
      </div>
    </LedgerRow>
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
    <section>
      <SectionHead className="mt-10">{t("lv.everyone")}</SectionHead>
      <div className="overflow-x-auto">
        <LedgerTable cols={EVERYONE} head={[t("lv.col.person"), t("lv.col.rules"), { label: t("lv.col.annual"), end: true }, { label: t("lv.col.sick"), end: true }, { label: t("lv.col.urgent"), end: true }]} label={t("lv.everyone")} className="mt-3 min-w-[32rem]">
          {v.everyone.map((p) => {
            const b = (k: string) => p.balances.find((x) => x.kind === k);
            const cell = (k: string) => {
              const x = b(k);
              return x ? `${Math.round((x.available / 8) * 10) / 10}${x.atCap ? t("lv.limit") : ""}` : "—";
            };
            return (
              <LedgerRow key={p.id} cols={EVERYONE} className="text-sm">
                <span>{p.name}</span>
                <span className="text-muted">{groupName(t, p.group)}</span>
                <Fig>{cell("vacation")}</Fig>
                <Fig>{cell("sick")}</Fig>
                <Fig>{cell("urgent")}</Fig>
              </LedgerRow>
            );
          })}
        </LedgerTable>
      </div>
      {v.isHr && (
        <>
          <SectionHead>{t("lv.adjust")}</SectionHead>
          <Sheet className="mt-3">
            <p className="text-sm text-muted">{t("lv.adjustHelp")}</p>
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
          </Sheet>
        </>
      )}
    </section>
  );
}
