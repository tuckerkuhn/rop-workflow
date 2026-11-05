"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import {
  ALLOWANCES,
  ALLOWANCE_TYPES,
  HOLIDAYS,
  HOURS_PER_DAY,
  LEAVE,
  LEAVE_TYPES,
  USUAL_PLACE,
  WORK_WEEK,
  daysIn,
  splitOf,
  weekday,
  type Allowance,
  type Day,
  type LeaveType,
  type Sheet,
  type TsAction,
} from "@/lib/timesheet";
import type { TimesheetView } from "@/app/api/timesheets/route";

/**
 * Monthly timesheets on a phone or a desk: prefilled from last month and the holiday calendar,
 * corrected day by day, certified and sent to the supervisor. Every version stays in the HR ledger.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
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

export function TimesheetPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { date } = useT();
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
    const q = new URLSearchParams({ month: next.month ?? m, ...(next.person ?? v?.person ? { person: (next.person ?? v?.person)! } : {}) });
    history.replaceState(null, "", `/timesheets?${q}`);
  };
  const subject = v?.people.find((p) => p.id === v.person);
  const own = v?.person === v?.me;
  const mayEdit = !!v && (own || v.isHr);

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl tracking-tight">Timesheets</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted">Hours per day per funding source, leave and allowance days. The supervisor approves; every version is kept in the HR record.</p>
          </div>
          <Link href="/people" className="text-sm font-semibold text-forest hover:underline">
            People
          </Link>
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
        ) : !v.person ? (
          <p className="mt-8 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">You have no HR record yet, so there is no timesheet to fill in. HR adds your record when your contract starts.</p>
        ) : (
          <>
            {v.waiting.length > 0 && (
              <section className="mt-5 rounded-2xl border border-forest/40 bg-mist/60 p-4">
                <p className="text-sm font-semibold">Waiting for your approval</p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {v.waiting.map((w) => (
                    <li key={w.n}>
                      <button type="button" onClick={() => go({ month: w.month, person: w.person })} className="rounded-full border border-line bg-paper px-3 py-1.5 text-sm hover:border-forest">
                        {v.names[w.person] ?? w.person} · {monthName(w.month)}
                        {w.revised ? " · revised" : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3">
              <div className="flex items-center rounded-full border border-line bg-surface">
                <button type="button" aria-label="Previous month" onClick={() => go({ month: shiftMonth(m, -1) })} className="grid h-11 w-11 place-items-center rounded-full hover:bg-sunken">
                  ‹
                </button>
                <span className="min-w-36 text-center text-sm font-semibold">{monthName(m)}</span>
                <button type="button" aria-label="Next month" disabled={m >= v.today.slice(0, 7)} onClick={() => go({ month: shiftMonth(m, 1) })} className="grid h-11 w-11 place-items-center rounded-full hover:bg-sunken disabled:opacity-30">
                  ›
                </button>
              </div>
              {v.people.length > 1 && (
                <select value={v.person} onChange={(e) => go({ person: e.target.value })} className="rounded-full border border-line bg-surface px-4 py-2.5 text-sm" aria-label="Whose timesheet">
                  {v.people.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {p.id === v.me ? " (you)" : ""}
                    </option>
                  ))}
                </select>
              )}
              <span className="text-sm text-muted">
                {subject?.title} · {v.office}
              </span>
            </div>

            {v.current && !editing && (
              <CurrentSheet
                v={v}
                monthName={monthName}
                onApprove={() => act({ action: "approve", timesheet: v.current!.n }, "Approved.")}
                onReturn={(note) => act({ action: "return", timesheet: v.current!.n, note }, "Sent back with your note.")}
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
                onSubmit={() => act({ action: "submit", person: v.person!, sheet: editing, certify: true }, own ? "Submitted to your supervisor." : `Submitted for ${subject?.name}.`)}
              />
            )}
            {editing && !mayEdit && <p className="mt-8 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">Not submitted yet.</p>}

            {v.seesAll && <Overview v={v} monthName={monthName} go={go} />}
          </>
        )}
      </main>
    </div>
  );
}

/* ---------------- A submitted timesheet ---------------- */

function CurrentSheet({ v, monthName, onApprove, onReturn, onRevise }: { v: TimesheetView; monthName: (m: string) => string; onApprove: () => void; onReturn: (note: string) => void; onRevise?: () => void }) {
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
        {t.status === "approved" ? <Pill tone="forest">Approved</Pill> : t.status === "returned" ? <Pill tone="clay">Sent back</Pill> : <Pill tone="ochre">Waiting for approval</Pill>}
        {t.revisedAfterApproval && <Pill tone="plum">Revised after approval</Pill>}
        <span className="text-sm text-muted">
          Version {t.version}, {t.by === t.person ? "submitted" : `entered by ${name(t.by)}`} {new Date(t.at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          {t.decidedBy && ` · ${t.status === "approved" ? "approved" : "sent back"} by ${name(t.decidedBy.by)}`}
          {t.status === "pending" && ` · goes to ${t.approvers.map(name).join(" or ") || "nobody (check the HR rules)"}${t.via === "hr" ? " (HR, because the supervisor has a conflict)" : ""}`}
        </span>
      </div>
      {t.decidedBy?.note && <p className="rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">“{t.decidedBy.note}”</p>}
      {t.leaveCheck.length > 0 && (
        <div className="rounded-xl bg-ochre-soft px-4 py-3 text-sm text-ochre">
          <p className="font-semibold">Leave on this timesheet does not match approved leave:</p>
          <ul className="mt-1 list-disc ps-5">
            {t.leaveCheck.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      )}
      <Summary sheet={t.sheet} v={v} />
      <DayList sheet={t.sheet} v={v} />
      {t.cannotApprove && <p className="text-sm text-muted">You cannot approve this: {t.cannotApprove}.</p>}
      <div className="flex flex-wrap gap-2">
        {t.canApprove && back === null && (
          <>
            <button type="button" disabled={busy} className={primaryBtn} onClick={wrap(onApprove)}>
              Approve {monthName(t.month)}
            </button>
            <button type="button" disabled={busy} className={quietBtn} onClick={() => setBack("")}>
              Send back
            </button>
          </>
        )}
        {onRevise && back === null && (
          <button type="button" className={quietBtn} onClick={onRevise}>
            {t.status === "returned" ? "Correct and resubmit" : "Submit a revised version"}
          </button>
        )}
      </div>
      {back !== null && (
        <div>
          <label className="text-sm font-medium" htmlFor="ts-back">
            What needs to change?
          </label>
          <textarea id="ts-back" value={back} onChange={(e) => setBack(e.target.value)} rows={3} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
          <div className="mt-2 flex gap-2">
            <button type="button" disabled={busy || back.trim().length < 3} className={dangerBtn} onClick={wrap(() => onReturn(back))}>
              Send back
            </button>
            <button type="button" className={quietBtn} onClick={() => setBack(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

/* ---------------- Totals and the split ---------------- */

function Summary({ sheet, v }: { sheet: Sheet; v: TimesheetView }) {
  const s = useMemo(() => splitOf(sheet, v.office), [sheet, v.office]);
  const label = (id: string) => v.sources.find((x) => x.id === id)?.label ?? id;
  const recorded = s.directTotal + s.leaveTotal;
  const diff = recorded - s.expected;
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1 text-sm">
        <span>
          <span className="font-display text-2xl tabular-nums">{fmtH(recorded)}</span> <span className="text-muted">hours recorded</span>
        </span>
        <span className="text-muted">
          {fmtH(s.expected)} expected for a full month{diff !== 0 && <span className={diff < 0 ? "text-ochre" : "text-clay"}> · {diff > 0 ? "+" : ""}{fmtH(diff)}</span>}
        </span>
        {s.leaveTotal > 0 && (
          <span className="text-muted">
            Leave:{" "}
            {LEAVE_TYPES.filter((l) => s.leave[l])
              .map((l) => `${LEAVE[l]} ${fmtH(s.leave[l])} h`)
              .join(", ")}
          </span>
        )}
        {ALLOWANCE_TYPES.some((a) => s.allowanceDays[a]) && (
          <span className="text-muted">
            {ALLOWANCE_TYPES.filter((a) => s.allowanceDays[a])
              .map((a) => `${ALLOWANCES[a]} ${s.allowanceDays[a]} day${s.allowanceDays[a] === 1 ? "" : "s"}`)
              .join(", ")}
          </span>
        )}
      </div>
      {s.sources.length > 0 && (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[32rem] text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1 pe-3 text-start font-medium">Funding source</th>
                <th className="py-1 pe-3 text-end font-medium">In country</th>
                <th className="py-1 pe-3 text-end font-medium">Outside</th>
                <th className="py-1 pe-3 text-end font-medium">Leave share</th>
                <th className="py-1 pe-3 text-end font-medium">Total</th>
                <th className="py-1 text-end font-medium">Charged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line tabular-nums">
              {s.sources.map((id) => (
                <tr key={id}>
                  <td className="py-1.5 pe-3">{label(id)}</td>
                  <td className="py-1.5 pe-3 text-end">{fmtH(s.inCountry[id] ?? 0)}</td>
                  <td className="py-1.5 pe-3 text-end">{fmtH(s.outside[id] ?? 0)}</td>
                  <td className="py-1.5 pe-3 text-end">{fmtH(s.leaveBySource[id] ?? 0)}</td>
                  <td className="py-1.5 pe-3 text-end">{fmtH(s.total[id] ?? 0)}</td>
                  <td className="py-1.5 text-end font-semibold">{(s.pct[id] ?? 0).toFixed(2)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">Leave is shared across funding sources in proportion to hours worked, to the hour. Percentages add to exactly 100.</p>
        </div>
      )}
    </div>
  );
}

/* ---------------- The days ---------------- */

const SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function describe(d: Day | undefined, v: TimesheetView) {
  const parts: string[] = [];
  const label = (id: string) => (id === "non-contract" ? "Non-contract" : id);
  if (dayHours(d)) parts.push(Object.entries(d!.hours!).filter(([, h]) => h > 0).map(([s, h]) => `${fmtH(h)} h ${label(s)}`).join(" + ") + (d?.place === "out" ? " · outside" : ""));
  if (d?.leave?.hours) parts.push(`${LEAVE[d.leave.type]} ${fmtH(d.leave.hours)} h`);
  if (d?.allowances?.length) parts.push(d.allowances.map((a) => ALLOWANCES[a]).join(", "));
  void v;
  return parts.join(" · ") || "—";
}

function DayList({ sheet, v, onEdit, open }: { sheet: Sheet; v: TimesheetView; onEdit?: (d: string) => void; open?: string | null }) {
  const work = WORK_WEEK[v.office] ?? WORK_WEEK["Home Office"];
  return (
    <ul className="divide-y divide-line rounded-2xl border border-line bg-surface">
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
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm ${off && !total ? "text-muted" : ""} ${onEdit ? "hover:bg-sunken" : ""} ${open === d ? "bg-sunken" : ""}`}
            >
              <span className="w-16 shrink-0 tabular-nums">
                <span className="font-semibold">{d.slice(8)}</span> {SHORT[weekday(d)]}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {describe(day, v)}
                {holiday && <span className="text-muted"> · {holiday}</span>}
                {day?.note && !holiday && <span className="text-muted"> · {day.note}</span>}
              </span>
              <span className={`shrink-0 tabular-nums ${total > HOURS_PER_DAY ? "text-clay" : "text-muted"}`}>{total ? `${fmtH(total)} h` : off ? "off" : "0 h"}</span>
            </Tag>
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------- Filling it in ---------------- */

function Editor({ v, sheet, setSheet, own, revising, onCancel, onSubmit }: { v: TimesheetView; sheet: Sheet; setSheet: (s: Sheet) => void; own: boolean; revising: boolean; onCancel: () => void; onSubmit: () => Promise<void> }) {
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
  const sel = "rounded-xl border border-line bg-paper px-3 py-2.5 text-base sm:text-sm";
  return (
    <section className="mt-6 space-y-4">
      {revising && <p className="rounded-xl bg-ochre-soft px-4 py-3 text-sm text-ochre">A new version. The one already submitted stays in the record; this one needs approving again.</p>}
      {!revising && <p className="text-sm text-muted">Prefilled from last month and the holiday calendar. Change what was different, then submit. Unsent changes stay in this browser.</p>}
      <Summary sheet={sheet} v={v} />
      <div className="flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-surface p-3">
        <label className="text-sm">
          <span className="block text-xs text-muted">Every working day, 8 h to</span>
          <select value={fill} onChange={(e) => setFill(e.target.value)} className={`${sel} mt-1`}>
            {v.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={quietBtn} onClick={fillAll}>
          Fill
        </button>
        <span className="mx-2 hidden h-10 w-px bg-line sm:block" />
        <label className="text-sm">
          <span className="block text-xs text-muted">Leave from</span>
          <input type="date" min={`${sheet.month}-01`} max={daysIn(sheet.month).at(-1)} value={leave.from} onChange={(e) => setLeave({ ...leave, from: e.target.value, to: e.target.value > leave.to ? e.target.value : leave.to })} className={`${sel} mt-1`} />
        </label>
        <label className="text-sm">
          <span className="block text-xs text-muted">to</span>
          <input type="date" min={leave.from} max={daysIn(sheet.month).at(-1)} value={leave.to} onChange={(e) => setLeave({ ...leave, to: e.target.value })} className={`${sel} mt-1`} />
        </label>
        <select value={leave.type} onChange={(e) => setLeave({ ...leave, type: e.target.value as LeaveType })} className={sel} aria-label="Type of leave">
          {LEAVE_TYPES.map((l) => (
            <option key={l} value={l}>
              {LEAVE[l]}
            </option>
          ))}
        </select>
        <button type="button" className={quietBtn} onClick={addLeave}>
          Add leave
        </button>
      </div>

      <div>
        <DayList sheet={sheet} v={v} onEdit={(d) => setOpen(open === d ? null : d)} open={open} />
        {open && <DayEditor key={open} date={open} day={sheet.days[open]} v={v} onChange={(day) => setDay(open, day)} onClose={() => setOpen(null)} />}
      </div>

      <label className="flex items-start gap-3 rounded-2xl border border-line bg-surface p-4 text-sm">
        <input type="checkbox" checked={certify} onChange={(e) => setCertify(e.target.checked)} className="mt-0.5 h-5 w-5" />
        <span>{own ? "I certify that this is a true and complete record of my time for the month." : "Entered by HR from the employee's signed timesheet, which is kept on file."}</span>
      </label>
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
          {busy ? "Submitting…" : "Submit"}
        </button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          {revising ? "Cancel" : "Start again from the prefill"}
        </button>
      </div>
    </section>
  );
}

function DayEditor({ date: d, day, v, onChange, onClose }: { date: string; day: Day | undefined; v: TimesheetView; onChange: (d: Day | null) => void; onClose: () => void }) {
  const cur: Day = day ?? { place: USUAL_PLACE[v.office] ?? "in" };
  const set = (patch: Partial<Day>) => onChange({ ...cur, ...patch });
  const input = "w-24 rounded-xl border border-line bg-paper px-3 py-2 text-base tabular-nums";
  return (
    <div className="mt-2 rounded-2xl border border-forest/40 bg-paper p-4" role="group" aria-label={`Hours for ${d}`}>
      <div className="flex items-center justify-between">
        <p className="font-semibold">
          {SHORT[weekday(d)]} {d.slice(8)}
          {HOLIDAYS[v.office]?.[d] && <span className="font-normal text-muted"> · {HOLIDAYS[v.office][d]}</span>}
        </p>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-forest hover:underline">
          Done
        </button>
      </div>
      <SectionLabel>Hours worked</SectionLabel>
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
              aria-label={`${s.label}, hours`}
            />
          </label>
        ))}
      </div>
      <fieldset className="mt-3 flex flex-wrap gap-4 text-sm">
        <legend className="sr-only">Where</legend>
        {(["in", "out"] as const).map((p) => (
          <label key={p} className="flex items-center gap-2">
            <input type="radio" name={`place-${d}`} checked={(cur.place ?? "in") === p} onChange={() => set({ place: p })} />
            {p === "in" ? "In the program country" : "Outside the program country"}
          </label>
        ))}
      </fieldset>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <span>Leave</span>
        <select
          value={cur.leave?.type ?? ""}
          onChange={(e) => set({ leave: e.target.value ? { type: e.target.value as LeaveType, hours: cur.leave?.hours || HOURS_PER_DAY } : undefined })}
          className="rounded-xl border border-line bg-paper px-3 py-2 text-base sm:text-sm"
          aria-label="Type of leave"
        >
          <option value="">None</option>
          {LEAVE_TYPES.map((l) => (
            <option key={l} value={l}>
              {LEAVE[l]}
            </option>
          ))}
        </select>
        {cur.leave && (
          <input type="number" inputMode="decimal" min={0} max={24} step={0.5} value={cur.leave.hours} onChange={(e) => set({ leave: { ...cur.leave!, hours: Number(e.target.value) || 0 } })} className={input} aria-label="Leave hours" />
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-sm">
        {ALLOWANCE_TYPES.map((a) => (
          <label key={a} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={!!cur.allowances?.includes(a)}
              onChange={(e) => set({ allowances: e.target.checked ? [...(cur.allowances ?? []), a] : (cur.allowances ?? []).filter((x: Allowance) => x !== a) })}
            />
            {ALLOWANCES[a]}
          </label>
        ))}
      </div>
      <label className="mt-3 block text-sm">
        <span className="text-muted">Note (where, what, why different)</span>
        <input value={cur.note ?? ""} maxLength={300} onChange={(e) => set({ note: e.target.value || undefined })} className="mt-1 w-full rounded-xl border border-line bg-paper px-3 py-2 text-base" />
      </label>
    </div>
  );
}

/* ---------------- The month, for HR ---------------- */

function Overview({ v, monthName, go }: { v: TimesheetView; monthName: (m: string) => string; go: (n: { person: string }) => void }) {
  const tone = { approved: "forest", pending: "ochre", returned: "clay", missing: "muted" } as const;
  const text = { approved: "Approved", pending: "Waiting", returned: "Sent back", missing: "Not submitted" };
  return (
    <section className="mt-10">
      <SectionLabel>Everyone, {monthName(v.month)}</SectionLabel>
      <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
        {v.overview.map((o) => (
          <li key={o.person}>
            <button type="button" onClick={() => go({ person: o.person })} className="flex w-full items-center gap-3 px-4 py-2.5 text-start text-sm hover:bg-sunken">
              <span className="min-w-0 flex-1 truncate">{v.names[o.person] ?? o.person}</span>
              {o.by && o.by !== o.person && <span className="text-xs text-muted">entered by HR</span>}
              {o.revised && <Pill tone="plum">Revised</Pill>}
              <Pill tone={tone[o.status as keyof typeof tone]}>{text[o.status as keyof typeof text]}</Pill>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
