"use client";

import { plainError } from "@/lib/plain-error";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "@/components/app/i18n";
import { localeOf, type MessageKey } from "@/lib/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, Figures, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet as RuledSheet, StatusBlock } from "@/components/workspace/ledger";
import { ALLOWANCE_TYPES, HOLIDAYS, HOURS_PER_DAY, LEAVE_TYPES, USUAL_PLACE, WORK_WEEK, daysIn, splitOf, weekday, type Allowance, type Day, type LeaveType, type Sheet, type TsAction } from "@/lib/timesheet";
import type { TimesheetView } from "@/app/api/timesheets/route";

/**
 * Monthly timesheets on a phone or a desk: prefilled from last month and the holiday calendar,
 * corrected day by day, certified and sent to the supervisor. Every version stays in the HR ledger.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

const shiftMonth = (m: string, by: number) => {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return d.toISOString().slice(0, 7);
};
const draftKey = (person: string, month: string) => `rop-ts-${person}-${month}`;
const readDraft = (k: string): Sheet | null => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as Sheet) : null;
  } catch {
    return null;
  }
};
const writeDraft = (k: string, s: Sheet | null) => {
  try {
    if (s) localStorage.setItem(k, JSON.stringify(s));
    else localStorage.removeItem(k);
  } catch {}
};
const dayHours = (d?: Day) => Object.values(d?.hours ?? {}).reduce((a, b) => a + b, 0);
const fmtH = (h: number) => (Number.isInteger(h) ? String(h) : h.toFixed(1));
/** Ruled-table columns: waiting sheets, the funding split, and everyone's month. */
const WAIT_COLS = "minmax(0,1fr) minmax(0,11rem)";
const SPLIT_COLS = "minmax(10rem,1fr) 6rem 6rem 6rem 6rem 6rem";
const OVERVIEW_COLS = "minmax(0,1fr) minmax(0,9rem) minmax(0,10rem)";
type T = (key: MessageKey, vars?: Record<string, string | number>) => string;

/** The lib keeps English labels; the screen shows them through these keys. */
const LEAVE_KEY: Record<LeaveType, MessageKey> = {
  holiday: "ts.leaveType.holiday",
  floating: "ts.leaveType.floating",
  vacation: "ts.leaveType.vacation",
  travel: "ts.leaveType.travel",
  sick: "ts.leaveType.sick",
  urgent: "ts.leaveType.urgent",
  compassionate: "ts.leaveType.compassionate",
  parental: "ts.leaveType.parental",
  hajj: "ts.leaveType.hajj",
  unpaid: "ts.leaveType.unpaid",
  other: "ts.leaveType.other",
};
const ALLOWANCE_KEY: Record<Allowance, MessageKey> = { dangerPay: "ts.allowance.dangerPay", postDiff: "ts.allowance.postDiff", separateMaintenance: "ts.allowance.separateMaintenance" };
const SHORT: MessageKey[] = ["ts.wd.0", "ts.wd.1", "ts.wd.2", "ts.wd.3", "ts.wd.4", "ts.wd.5", "ts.wd.6"];

export function TimesheetPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { t, tx, date } = useT();
  const [month, setMonth] = useState<string | null>(null);
  const [person, setPerson] = useState<string | null>(null);
  const [v, setV] = useState<TimesheetView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  // The month and person in the link are read before the first load, so it never loads the wrong month first.
  const [init, setInit] = useState(false);
  const [editing, setEditing] = useState<Sheet | null>(null);

  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get("month")) setMonth(q.get("month"));
    if (q.get("person")) setPerson(q.get("person"));
    setInit(true);
  }, []);

  const load = useCallback(async () => {
    if (!user) return;
    const q = new URLSearchParams();
    if (month) q.set("month", month);
    if (person) q.set("person", person);
    try {
      const r = await call<TimesheetView>(`/api/timesheets?${q}`, user.id);
      setV(r);
      setError("");
      // Unsent work is kept in this browser until it is submitted.
      const draft = r.person ? readDraft(draftKey(r.person, r.month)) : null;
      setEditing(draft ?? (r.current ? null : r.prefill));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, month, person]);
  useEffect(() => {
    if (init && ready && user) void load();
  }, [init, ready, user, load]);

  useEffect(() => {
    if (v?.person && editing && v.current === null) writeDraft(draftKey(v.person, v.month), editing);
  }, [editing, v]);

  const act = async (a: TsAction, msg: string) => {
    if (!user) return;
    setError("");
    try {
      const r = await call<{ view: TimesheetView }>("/api/timesheets", user.id, { method: "POST", body: JSON.stringify(a) });
      if (a.action === "submit") writeDraft(draftKey(a.person, a.sheet.month), null);
      setV(r.view);
      setEditing(null);
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!user) return null;
  const m = v?.month ?? month ?? "";
  const monthName = (x: string) => (x ? date(`${x}-01`, { month: "long", year: "numeric" }) : "");
  const go = (next: { month?: string; person?: string }) => {
    setNotice("");
    if (next.month) setMonth(next.month);
    if (next.person) setPerson(next.person);
    const q = new URLSearchParams({ month: next.month ?? m, ...((next.person ?? v?.person) ? { person: (next.person ?? v?.person)! } : {}) });
    history.replaceState(null, "", `/timesheets?${q}`);
  };
  const subject = v?.people.find((p) => p.id === v.person);
  // The one to look at first: the oldest month waiting, when there is more than one.
  const oldest = v && v.waiting.length > 1 ? [...v.waiting].sort((a, b) => a.month.localeCompare(b.month) || a.n - b.n)[0] : undefined;
  const own = v?.person === v?.me;
  const mayEdit = !!v && (own || v.isHr);

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        {/* HR roles go back to People; everyone else came from Home. */}
        <PageHead back={v?.seesAll ? { href: "/people", label: t("ts.people") } : { href: "/home", label: t("nav.home") }} title={t("ts.title")}>
          {t("ts.intro")}
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
          !error && <p className="mt-10 text-sm text-muted">{t("ts.loading")}</p>
        ) : !v.person ? (
          <Empty className="mt-8">{t("ts.noRecord")}</Empty>
        ) : (
          <>
            {v.waiting.length > 0 && (
              <section className="mt-6">
                <SectionHead className="mt-0">{t("ts.waitingForYou")}</SectionHead>
                <LedgerTable cols={WAIT_COLS} head={[tx("Person"), { label: tx("Month"), end: true }]} label={t("ts.waitingForYou")}>
                  {v.waiting.map((w) => (
                    <LedgerRow key={w.n} cols={WAIT_COLS} first={w.n === oldest?.n} onClick={() => go({ month: w.month, person: w.person })} className="text-sm">
                      <span className="min-w-0 font-semibold">
                        {v.names[w.person] ?? w.person}
                        {w.revised ? <span className="font-normal text-muted"> · {t("ts.revisedLower")}</span> : ""}
                      </span>
                      <Fig>{monthName(w.month)}</Fig>
                    </LedgerRow>
                  ))}
                </LedgerTable>
                {oldest && <p className="mt-2 text-xs text-muted">{tx("Shaded: the oldest month waiting.")}</p>}
              </section>
            )}

            <div className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-3 font-ledger">
              <div className="flex items-center border-y border-ink">
                <button type="button" aria-label={t("ts.prevMonth")} onClick={() => go({ month: shiftMonth(m, -1) })} className="grid h-11 w-11 place-items-center hover:bg-ochre-soft">
                  ‹
                </button>
                <span className="min-w-36 text-center font-mono text-sm font-bold tabular-nums">{monthName(m)}</span>
                <button type="button" aria-label={t("ts.nextMonth")} disabled={m >= v.today.slice(0, 7)} onClick={() => go({ month: shiftMonth(m, 1) })} className="grid h-11 w-11 place-items-center hover:bg-ochre-soft disabled:opacity-30">
                  ›
                </button>
              </div>
              {v.people.length > 1 && (
                <select value={v.person} onChange={(e) => go({ person: e.target.value })} className="min-h-11 border border-line-strong bg-paper px-3 text-sm" aria-label={t("ts.whose")}>
                  {v.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === v.me ? ` ${t("ts.you")}` : ""}
                    </option>
                  ))}
                </select>
              )}
              <span className="font-mono text-xs text-muted">
                {subject?.title} · {v.office}
              </span>
            </div>

            {v.current && !editing && (
              <CurrentSheet
                v={v}
                monthName={monthName}
                onApprove={() => act({ action: "approve", timesheet: v.current!.n }, t("ts.notice.approved"))}
                onReturn={(note) => act({ action: "return", timesheet: v.current!.n, note }, t("ts.notice.returned"))}
                onRevise={mayEdit ? () => setEditing(JSON.parse(JSON.stringify(v.current!.sheet))) : undefined}
              />
            )}

            {editing && mayEdit && (
              <Editor
                key={`${v.person}-${v.month}`}
                v={v}
                sheet={editing}
                setSheet={setEditing}
                own={own}
                revising={!!v.current}
                unsent={JSON.stringify(editing) !== JSON.stringify(v.current?.sheet ?? v.prefill)}
                onCancel={
                  v.current
                    ? () => {
                        setEditing(null);
                      }
                    : () => {
                        if (v.person) writeDraft(draftKey(v.person, v.month), null);
                        setEditing(v.prefill);
                      }
                }
                onSubmit={() => act({ action: "submit", person: v.person!, sheet: editing, certify: true }, own ? t("ts.notice.submitted") : t("ts.notice.submittedFor", { name: String(subject?.name) }))}
              />
            )}
            {editing && !mayEdit && <Empty className="mt-8">{t("ts.notSubmittedYet")}</Empty>}

            {v.seesAll && <Overview v={v} monthName={monthName} go={go} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ---------------- A submitted timesheet ---------------- */

function CurrentSheet({ v, monthName, onApprove, onReturn, onRevise }: { v: TimesheetView; monthName: (m: string) => string; onApprove: () => void; onReturn: (note: string) => void; onRevise?: () => void }) {
  const { t: tr, lang } = useT();
  const t = v.current!;
  const [back, setBack] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = (id: string) => v.names[id] ?? id;
  const wrap = (fn: () => void | Promise<void>) => async () => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-6 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {t.status === "approved" ? (
          <StatusBlock tone="forest">{tr("ts.status.approved")}</StatusBlock>
        ) : t.status === "returned" ? (
          <StatusBlock tone="clay">{tr("ts.status.returned")}</StatusBlock>
        ) : (
          <StatusBlock tone="ochre">{tr("ts.status.pending")}</StatusBlock>
        )}
        {t.revisedAfterApproval && <Pill tone="plum">{tr("ts.revisedAfterApproval")}</Pill>}
        <span className="text-sm text-muted">
          {tr(t.by === t.person ? "ts.versionSubmitted" : "ts.versionEnteredBy", { version: t.version, name: name(t.by), date: new Date(t.at).toLocaleDateString(localeOf(lang), { day: "numeric", month: "short" }) })}
          {t.decidedBy && ` · ${tr(t.status === "approved" ? "ts.approvedBy" : "ts.sentBackBy", { name: name(t.decidedBy.by) })}`}
          {t.status === "pending" && ` · ${tr("ts.goesTo", { names: t.approvers.map(name).join(` ${tr("ts.or")} `) || tr("ts.nobody") })}${t.via === "hr" ? ` ${tr("ts.viaHr")}` : ""}`}
        </span>
      </div>
      {t.decidedBy?.note && <p className="bg-clay-soft px-4 py-3 text-sm text-clay">“{t.decidedBy.note}”</p>}
      {t.leaveCheck.length > 0 && (
        <div className="bg-ochre-soft px-4 py-3 text-sm text-warn">
          <p className="font-semibold">{tr("ts.leaveMismatch")}</p>
          <ul className="mt-1 list-disc ps-5">
            {t.leaveCheck.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      <Summary sheet={t.sheet} v={v} />
      <DayList sheet={t.sheet} v={v} />
      {t.cannotApprove && <p className="text-sm text-muted">{tr("ts.cannotApprove", { reason: t.cannotApprove })}</p>}
      <div className="flex flex-wrap gap-2">
        {t.canApprove && back === null && (
          <>
            <button type="button" disabled={busy} className={primaryBtn} onClick={wrap(onApprove)}>
              {tr("ts.approveMonth", { month: monthName(t.month) })}
            </button>
            <button type="button" disabled={busy} className={quietBtn} onClick={() => setBack("")}>
              {tr("ts.sendBack")}
            </button>
          </>
        )}
        {onRevise && back === null && (
          <button type="button" className={quietBtn} onClick={onRevise}>
            {t.status === "returned" ? tr("ts.correctResubmit") : tr("ts.submitRevised")}
          </button>
        )}
      </div>
      {back !== null && (
        <RuledSheet className="">
          <label className="text-sm font-medium" htmlFor="ts-back">
            {tr("ts.whatChange")}
          </label>
          <textarea id="ts-back" value={back} onChange={(e) => setBack(e.target.value)} rows={3} className="mt-1 w-full border border-line-strong bg-paper px-3 py-2 text-base" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || back.trim().length < 3} className={dangerBtn} onClick={wrap(() => onReturn(back))}>
              {tr("ts.sendBack")}
            </button>
            <button type="button" className={quietBtn} onClick={() => setBack(null)}>
              {tr("ts.cancel")}
            </button>
          </div>
        </RuledSheet>
      )}
    </section>
  );
}

/* ---------------- Totals and the split ---------------- */

function Summary({ sheet, v }: { sheet: Sheet; v: TimesheetView }) {
  const { t } = useT();
  const s = useMemo(() => splitOf(sheet, v.office), [sheet, v.office]);
  const label = (id: string) => v.sources.find((x) => x.id === id)?.label ?? id;
  const recorded = s.directTotal + s.leaveTotal + s.unpaidHours;
  const diff = recorded - s.expected;
  return (
    <div>
      <Figures className="mt-0" items={[{ label: t("ts.hoursRecorded"), value: fmtH(recorded) }]} />
      <div className="mt-2 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span className="text-muted">
          {t("ts.expectedMonth", { hours: fmtH(s.expected) })}
          {diff !== 0 && (
            <span className={`font-mono tabular-nums ${diff < 0 ? "text-warn" : "text-clay"}`}>
              {" "}
              · {diff > 0 ? "+" : ""}
              {fmtH(diff)}
            </span>
          )}
        </span>
        {s.leaveTotal + s.unpaidHours > 0 && (
          <span className="text-muted">
            {t("ts.leaveColon")}{" "}
            {LEAVE_TYPES.filter((l) => s.leave[l])
              .map((l) => `${t(LEAVE_KEY[l])} ${t("ts.hoursShort", { hours: fmtH(s.leave[l]) })}`)
              .join(", ")}
          </span>
        )}
        {ALLOWANCE_TYPES.some((a) => s.allowanceDays[a]) && (
          <span className="text-muted">
            {ALLOWANCE_TYPES.filter((a) => s.allowanceDays[a])
              .map((a) => t(s.allowanceDays[a] === 1 ? "ts.allowanceDay" : "ts.allowanceDays", { name: t(ALLOWANCE_KEY[a]), n: s.allowanceDays[a] }))
              .join(", ")}
          </span>
        )}
      </div>
      {s.sources.length > 0 && (
        <div className="mt-3">
          <div className="overflow-x-auto">
            <LedgerTable
              cols={SPLIT_COLS}
              className="mt-0 min-w-[36rem]"
              head={[
                t("ts.col.source"),
                { label: t("ts.col.inCountry"), end: true },
                { label: t("ts.col.outside"), end: true },
                { label: t("ts.col.leaveShare"), end: true },
                { label: t("ts.col.total"), end: true },
                { label: t("ts.col.charged"), end: true },
              ]}
            >
              {s.sources.map((id) => (
                <LedgerRow key={id} cols={SPLIT_COLS} className="text-sm">
                  <span className="min-w-0">{label(id)}</span>
                  <Fig>{fmtH(s.inCountry[id] ?? 0)}</Fig>
                  <Fig>{fmtH(s.outside[id] ?? 0)}</Fig>
                  <Fig>{fmtH(s.leaveBySource[id] ?? 0)}</Fig>
                  <Fig>{fmtH(s.total[id] ?? 0)}</Fig>
                  <Fig strong>{(s.pct[id] ?? 0).toFixed(2)}%</Fig>
                </LedgerRow>
              ))}
            </LedgerTable>
          </div>
          <p className="mt-2 text-xs text-muted">{t("ts.splitNote")}</p>
        </div>
      )}
    </div>
  );
}

/* ---------------- The days ---------------- */

function describe(d: Day | undefined, v: TimesheetView, t: T) {
  const parts: string[] = [];
  const label = (id: string) => (id === "non-contract" ? t("ts.nonContract") : id);
  if (dayHours(d))
    parts.push(
      Object.entries(d!.hours!)
        .filter(([, h]) => h > 0)
        .map(([s, h]) => t("ts.dayHours", { hours: fmtH(h), source: label(s) }))
        .join(" + ") + (d?.place === "out" ? ` · ${t("ts.outside")}` : ""),
    );
  if (d?.leave?.hours) parts.push(`${t(LEAVE_KEY[d.leave.type])} ${t("ts.hoursShort", { hours: fmtH(d.leave.hours) })}`);
  if (d?.allowances?.length) parts.push(d.allowances.map((a) => t(ALLOWANCE_KEY[a])).join(", "));
  void v;
  return parts.join(" · ") || "—";
}

function DayList({ sheet, v, onEdit, open, editor }: { sheet: Sheet; v: TimesheetView; onEdit?: (d: string) => void; open?: string | null; editor?: React.ReactNode }) {
  const { t } = useT();
  const work = WORK_WEEK[v.office] ?? WORK_WEEK["Home Office"];
  return (
    <ul className="divide-y divide-line border-y border-ink font-ledger">
      {daysIn(sheet.month).map((d) => {
        const day = sheet.days[d];
        const off = !work.includes(weekday(d));
        const holiday = HOLIDAYS[v.office]?.[d];
        const total = dayHours(day) + (day?.leave?.hours ?? 0);
        const Tag = onEdit ? "button" : "div";
        return (
          <li key={d}>
            <Tag
              {...(onEdit ? { type: "button" as const, onClick: () => onEdit(d), "aria-expanded": open === d } : {})}
              className={`flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-start text-sm ${off && !total ? "text-muted" : ""} ${onEdit ? "hover:bg-ochre-soft" : ""} ${open === d ? "bg-sunken" : ""}`}
            >
              <span className="min-w-16 shrink-0">
                <span className="font-mono font-bold tabular-nums">{d.slice(8)}</span> <span className="font-mono text-xs">{t(SHORT[weekday(d)])}</span>
              </span>
              <span className="min-w-0 flex-1 truncate">
                {describe(day, v, t)}
                {holiday && <span className="text-muted"> · {holiday}</span>}
                {day?.note && !holiday && <span className="text-muted"> · {day.note}</span>}
              </span>
              <Fig tone={total > HOURS_PER_DAY ? "clay" : "muted"} className="shrink-0">
                {total ? t("ts.hoursShort", { hours: fmtH(total) }) : off ? t("ts.off") : t("ts.hoursShort", { hours: 0 })}
              </Fig>
            </Tag>
            {/* The open day's form sits right under its row, so on a phone it appears where the finger tapped. */}
            {open === d && editor && <div className="px-2 pb-2">{editor}</div>}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Filling it in ---------------- */

function Editor({
  v,
  sheet,
  setSheet,
  own,
  revising,
  unsent,
  onCancel,
  onSubmit,
}: {
  v: TimesheetView;
  sheet: Sheet;
  setSheet: (s: Sheet) => void;
  own: boolean;
  revising: boolean;
  unsent: boolean;
  onCancel: () => void;
  onSubmit: () => Promise<void>;
}) {
  const { t } = useT();
  const [open, setOpen] = useState<string | null>(null);
  const [certify, setCertify] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fill, setFill] = useState(v.sources.find((s) => sheet && Object.values(sheet.days).some((d) => d.hours?.[s.id]))?.id ?? v.sources[0]?.id ?? "");
  const [leave, setLeave] = useState<{ from: string; to: string; type: LeaveType }>({ from: `${sheet.month}-01`, to: `${sheet.month}-01`, type: "vacation" });
  const work = WORK_WEEK[v.office] ?? WORK_WEEK["Home Office"];
  const setDay = (d: string, day: Day | null) => {
    const days = { ...sheet.days };
    if (day && (dayHours(day) || day.leave?.hours || day.allowances?.length || day.note)) days[d] = day;
    else delete days[d];
    setSheet({ ...sheet, days });
  };
  const fillAll = () => {
    const days = { ...sheet.days };
    for (const d of daysIn(sheet.month)) {
      if (!work.includes(weekday(d)) || HOLIDAYS[v.office]?.[d] || days[d]?.leave) continue;
      days[d] = { ...days[d], hours: { [fill]: HOURS_PER_DAY }, place: days[d]?.place ?? USUAL_PLACE[v.office] ?? "in" };
    }
    setSheet({ ...sheet, days });
  };
  const addLeave = () => {
    const days = { ...sheet.days };
    for (const d of daysIn(sheet.month)) if (d >= leave.from && d <= leave.to && work.includes(weekday(d))) days[d] = { leave: { type: leave.type, hours: HOURS_PER_DAY }, ...(days[d]?.note ? { note: days[d].note } : {}) };
    setSheet({ ...sheet, days });
  };
  const sel = "min-h-11 border border-line-strong bg-paper px-3 py-2.5 text-base sm:text-sm";
  return (
    <section className="mt-6 space-y-4">
      {revising && <p className="bg-ochre-soft px-4 py-3 text-sm text-warn">{t("ts.newVersion")}</p>}
      {!revising && <p className="text-sm text-muted">{t("ts.prefilled")}</p>}
      {unsent && (
        <p role="status" className="border border-warn/40 bg-ochre-soft px-4 py-3 text-sm font-semibold text-warn">
          {t("ts.unsent")}
        </p>
      )}
      <Summary sheet={sheet} v={v} />
      <RuledSheet className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="block text-xs text-muted">{t("ts.fillLabel", { hours: HOURS_PER_DAY })}</span>
          <select value={fill} onChange={(e) => setFill(e.target.value)} className={`${sel} mt-1`}>
            {v.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={quietBtn} onClick={fillAll}>
          {t("ts.fill")}
        </button>
        <span className="mx-2 hidden h-10 w-px bg-line sm:block" />
        <label className="text-sm">
          <span className="block text-xs text-muted">{t("ts.leaveFrom")}</span>
          <input
            type="date"
            min={`${sheet.month}-01`}
            max={daysIn(sheet.month).at(-1)}
            value={leave.from}
            onChange={(e) => setLeave({ ...leave, from: e.target.value, to: e.target.value > leave.to ? e.target.value : leave.to })}
            className={`${sel} mt-1 font-mono`}
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted">{t("ts.to")}</span>
          <input type="date" min={leave.from} max={daysIn(sheet.month).at(-1)} value={leave.to} onChange={(e) => setLeave({ ...leave, to: e.target.value })} className={`${sel} mt-1 font-mono`} />
        </label>
        <select value={leave.type} onChange={(e) => setLeave({ ...leave, type: e.target.value as LeaveType })} className={sel} aria-label={t("ts.leaveType")}>
          {v.leaveTypes.map((l) => (
            <option key={l} value={l}>
              {t(LEAVE_KEY[l])}
            </option>
          ))}
        </select>
        <button type="button" className={quietBtn} onClick={addLeave}>
          {t("ts.addLeave")}
        </button>
        <p className="w-full text-xs text-muted">
          {t("ts.askLeave")}{" "}
          <Link href="/leave" className="font-semibold text-forest hover:underline">
            {t("ts.askLeaveLink")}
          </Link>
        </p>
      </RuledSheet>

      <div>
        <DayList sheet={sheet} v={v} onEdit={(d) => setOpen(open === d ? null : d)} open={open} editor={open && <DayEditor key={open} date={open} day={sheet.days[open]} v={v} onChange={(day) => setDay(open, day)} onClose={() => setOpen(null)} />} />
      </div>

      <RuledSheet className="">
        <label className="flex items-start gap-3 text-sm">
          <input type="checkbox" checked={certify} onChange={(e) => setCertify(e.target.checked)} className="mt-0.5 h-5 w-5" />
          <span>{own ? t("ts.certifyOwn") : t("ts.certifyHr")}</span>
        </label>
      </RuledSheet>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={!certify || busy}
          className={primaryBtn}
          onClick={async () => {
            setBusy(true);
            try {
              await onSubmit();
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? t("ts.submitting") : t("ts.submit")}
        </button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          {revising ? t("ts.cancel") : t("ts.startAgain")}
        </button>
      </div>
    </section>
  );
}

function DayEditor({ date: d, day, v, onChange, onClose }: { date: string; day: Day | undefined; v: TimesheetView; onChange: (d: Day | null) => void; onClose: () => void }) {
  const { t } = useT();
  const cur: Day = day ?? { place: USUAL_PLACE[v.office] ?? "in" };
  const set = (patch: Partial<Day>) => onChange({ ...cur, ...patch });
  const input = "min-h-11 w-24 border border-line-strong bg-paper px-3 py-2 text-end font-mono text-base tabular-nums";
  // Bring the form into view when it opens (it can start below the fold on a phone) and put the cursor in it.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    box.current?.querySelector<HTMLInputElement>("input")?.focus({ preventScroll: true });
  }, []);
  return (
    <div ref={box} className="mt-2" role="group" aria-label={t("ts.hoursFor", { date: d })}>
      <RuledSheet className="mt-0 bg-paper px-2 pb-4">
        <div className="flex items-center justify-between">
          <p className="font-ledger font-bold">
            <span className="font-mono text-xs">{t(SHORT[weekday(d)])}</span> <span className="font-mono">{d.slice(8)}</span>
            {HOLIDAYS[v.office]?.[d] && <span className="font-normal text-muted"> · {HOLIDAYS[v.office][d]}</span>}
          </p>
          <button type="button" onClick={onClose} className="min-h-11 px-2 text-sm font-semibold text-forest hover:underline">
            {t("ts.done")}
          </button>
        </div>
        <SectionLabel>{t("ts.hoursWorked")}</SectionLabel>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {v.sources.map((s) => (
            <label key={s.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 truncate">{s.label}</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={24}
                step={0.5}
                value={cur.hours?.[s.id] ?? ""}
                onChange={(e) => {
                  const hours = { ...(cur.hours ?? {}) };
                  const n = e.target.value === "" ? 0 : Math.max(0, Math.min(24, Number(e.target.value)));
                  if (n) hours[s.id] = n;
                  else delete hours[s.id];
                  set({ hours });
                }}
                className={input}
                aria-label={t("ts.sourceHours", { source: s.label })}
              />
            </label>
          ))}
        </div>
        <fieldset className="mt-3 flex flex-wrap gap-4 text-sm">
          <legend className="sr-only">{t("ts.where")}</legend>
          {(["in", "out"] as const).map((p) => (
            <label key={p} className="flex min-h-11 items-center gap-2">
              <input type="radio" name={`place-${d}`} checked={(cur.place ?? "in") === p} onChange={() => set({ place: p })} />
              {p === "in" ? t("ts.placeIn") : t("ts.placeOut")}
            </label>
          ))}
        </fieldset>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span>{t("ts.leave")}</span>
          <select
            value={cur.leave?.type ?? ""}
            onChange={(e) => set({ leave: e.target.value ? { type: e.target.value as LeaveType, hours: cur.leave?.hours || HOURS_PER_DAY } : undefined })}
            className="min-h-11 border border-line-strong bg-paper px-3 py-2 text-base sm:text-sm"
            aria-label={t("ts.leaveType")}
          >
            <option value="">{t("ts.none")}</option>
            {/* A type already on the day stays choosable even if the person's rules no longer list it. */}
            {LEAVE_TYPES.filter((l) => v.leaveTypes.includes(l) || cur.leave?.type === l).map((l) => (
              <option key={l} value={l}>
                {t(LEAVE_KEY[l])}
              </option>
            ))}
          </select>
          {cur.leave && (
            <input type="number" inputMode="decimal" min={0} max={24} step={0.5} value={cur.leave.hours} onChange={(e) => set({ leave: { ...cur.leave!, hours: Number(e.target.value) || 0 } })} className={input} aria-label={t("ts.leaveHours")} />
          )}
        </div>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          {ALLOWANCE_TYPES.map((a) => (
            <label key={a} className="flex min-h-11 items-center gap-2">
              <input type="checkbox" checked={!!cur.allowances?.includes(a)} onChange={(e) => set({ allowances: e.target.checked ? [...(cur.allowances ?? []), a] : (cur.allowances ?? []).filter((x: Allowance) => x !== a) })} />
              {t(ALLOWANCE_KEY[a])}
            </label>
          ))}
        </div>
        <label className="mt-3 block text-sm">
          <span className="text-muted">{t("ts.note")}</span>
          <input value={cur.note ?? ""} maxLength={300} onChange={(e) => set({ note: e.target.value || undefined })} className="mt-1 min-h-11 w-full border border-line-strong bg-paper px-3 py-2 text-base" />
        </label>
      </RuledSheet>
    </div>
  );
}

/* ---------------- The month, for HR ---------------- */

function Overview({ v, monthName, go }: { v: TimesheetView; monthName: (m: string) => string; go: (n: { person: string }) => void }) {
  const { t, tx } = useT();
  const tone = { approved: "forest", pending: "ochre", returned: "clay", missing: "muted" } as const;
  const text: Record<keyof typeof tone, MessageKey> = { approved: "ts.status.approved", pending: "ts.status.waiting", returned: "ts.status.returned", missing: "ts.status.missing" };
  return (
    <section className="mt-10">
      <SectionHead className="mt-0">{t("ts.everyone", { month: monthName(v.month) })}</SectionHead>
      <LedgerTable cols={OVERVIEW_COLS} head={[tx("Person"), "", tx("Status")]} label={t("ts.everyone", { month: monthName(v.month) })}>
        {v.overview.map((o) => (
          <LedgerRow key={o.person} cols={OVERVIEW_COLS} onClick={() => go({ person: o.person })} className="items-center text-sm">
            <span className="min-w-0 truncate font-semibold">{v.names[o.person] ?? o.person}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              {o.by && o.by !== o.person && <span className="text-xs text-muted">{t("ts.enteredByHr")}</span>}
              {o.revised && <Pill tone="plum">{t("ts.revised")}</Pill>}
            </span>
            <span>
              <StatusBlock tone={tone[o.status as keyof typeof tone]}>{t(text[o.status as keyof typeof text])}</StatusBlock>
            </span>
          </LedgerRow>
        ))}
      </LedgerTable>
    </section>
  );
}
