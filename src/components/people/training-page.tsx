"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { Why } from "@/components/app/why";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { Loading, SectionLabel, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { TrainingView } from "@/app/api/training/route";
import type { Receipt } from "@/lib/expense";
import { toCsv } from "@/lib/field-data";
import { plainError } from "@/lib/plain-error";
import { KINDS, KIND_KEYS, METHODS, METHOD_KEYS, type Due, type Kind, type Method } from "@/lib/training";

/**
 * The training log (lib/training): who is due an induction or a yearly refresher, each person's
 * trainings with their proof, and the year's priorities agreed at the appraisal.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
const day = (d: string) => (d ? new Date(`${d.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

function DueText({ d }: { d: Due }) {
  if (d.state === "overdue") return <span className="font-semibold text-clay">{d.by ? `Overdue since ${day(d.by)}` : "Overdue"}</span>;
  if (d.state === "due") return <span className="font-semibold text-warn">Due by {day(d.by)}</span>;
  if (d.state === "unknown") return <span className="text-muted">Not on record</span>;
  return (
    <span>
      Done {day(d.last)}
      {d.by && <span className="block text-xs text-muted">Next by {day(d.by)}</span>}
    </span>
  );
}

export function TrainingPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const [v, setV] = useState<TrainingView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    (person?: string) => {
      if (!user) return;
      setError("");
      call<TrainingView>(`/api/training${person ? `?person=${encodeURIComponent(person)}` : ""}`, user.id)
        .then(setV)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    },
    [user],
  );
  useEffect(() => {
    if (!ready || !user) return;
    load(new URLSearchParams(window.location.search).get("person") ?? undefined);
  }, [ready, user, load]);

  const send = async (body: unknown, done: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const r = await call<{ view: TrainingView }>("/api/training", user?.id, { method: "POST", body: JSON.stringify(body) });
      setV(r.view);
      setNotice(done);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const download = async () => {
    try {
      const t = await call<{ headers: string[]; rows: string[][] }>("/api/training?log=1", user?.id);
      const url = URL.createObjectURL(new Blob([`﻿${toCsv(t)}`], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `training-log-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  if (!user) return null;
  const o = v?.open;
  const team = v && v.rows.length > 1;
  const name = (id: string) => v?.names[id] ?? id;

  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Link href={v?.seesAll ? "/organization" : "/people/me"} className="text-sm text-muted hover:text-ink">
          ← {v?.seesAll ? "Organization" : "My record"}
        </Link>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Training log</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Each training given to staff, with its proof. New staff have an induction within 30 days. Everyone has a refresher on anti-fraud and on the donors&apos; rules once a year. Each person agrees up to three priorities for the year at their appraisal.
        </p>
        <Why>Donors ask for a training policy and the log that shows it is followed. An auditor asks to see who was trained, when, by whom and the attendance sheet or certificate.</Why>

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
        {!v && !error && <Loading className="mt-6" />}

        {v && !v.logStart && (
          <div className="mt-5 rounded-2xl border border-line bg-ochre-soft p-4 text-sm">
            <p className="font-semibold">The log has no start date yet.</p>
            <p className="mt-1 text-muted">Until HR sets the day the training policy took effect, nobody is shown as due or overdue.</p>
            {v.isHr && <StartForm busy={busy} today={v.today} onSave={(effective) => send({ action: "start", effective }, "The policy's start date is set. Who is due is worked out from it.")} />}
          </div>
        )}
        {v?.logStart && <p className="mt-4 text-xs text-muted">The policy took effect on {day(v.logStart)}. Staff who started before then have no induction finding.</p>}

        {team && (
          <section className="mt-6">
            <div className="flex flex-wrap items-end gap-3">
              <div className="min-w-0 flex-1">
                <SectionLabel>{v.seesAll ? "Everyone" : "Your team"}</SectionLabel>
              </div>
              <button type="button" className={quietBtn} onClick={() => void download()}>
                Download the log as a spreadsheet
              </button>
            </div>
            <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full min-w-[44rem] text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Person</th>
                    <th className="px-3 py-2 font-semibold">Induction</th>
                    <th className="px-3 py-2 font-semibold">Anti-fraud</th>
                    <th className="px-3 py-2 font-semibold">Donor rules</th>
                    <th className="px-3 py-2 font-semibold">Priorities {v.rows[0]?.standing.plan.year}</th>
                    <th className="px-3 py-2 text-right font-semibold">Hours this year</th>
                  </tr>
                </thead>
                <tbody>
                  {v.rows.map((r, i) => (
                    <tr key={r.person} className={`border-b border-line align-top last:border-0 ${i === 0 && r.standing.overdue ? "bg-ochre-soft" : ""} ${o?.person === r.person ? "outline outline-2 -outline-offset-2 outline-forest" : ""}`}>
                      <td className="px-3 py-2 tabular-nums text-muted">{i + 1}</td>
                      <td className="px-3 py-2">
                        <button type="button" className="text-start font-semibold text-forest hover:underline" onClick={() => load(r.person)}>
                          {r.name}
                        </button>
                        <span className="block text-xs text-muted">{[r.title, r.office].filter(Boolean).join(" · ")}</span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <DueText d={r.standing.induction} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <DueText d={r.standing.antiFraud} />
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <DueText d={r.standing.donorRules} />
                      </td>
                      <td className="px-3 py-2 text-xs">{r.standing.plan.agreed ? "Agreed" : <span className="text-muted">Not agreed yet</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.standing.hoursThisYear}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {v.rows[0]?.standing.overdue > 0 && <p className="mt-2 text-xs text-muted">The shaded row is the person with the most training overdue. Open a name to see their log.</p>}
          </section>
        )}

        {o && (
          <section className="mt-8">
            <h2 className="font-display text-2xl tracking-tight">{o.person === v?.me ? "Your training" : o.name}</h2>
            <p className="text-sm text-muted">
              {[o.title, o.startDate ? `started ${day(o.startDate)}` : "", o.supervisor ? `supervisor ${name(o.supervisor)}` : ""].filter(Boolean).join(" · ")}
            </p>

            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              {(
                [
                  ["Induction", o.standing.induction],
                  ["Anti-fraud refresher", o.standing.antiFraud],
                  ["Donor rules refresher", o.standing.donorRules],
                ] as const
              ).map(([label, d]) => (
                <div key={label} className="rounded-xl border border-line bg-surface p-3 text-sm">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
                  <p className="mt-1">
                    <DueText d={d} />
                  </p>
                </div>
              ))}
            </div>

            <Priorities o={o} busy={busy} onSave={(priorities) => send({ action: "plan", person: o.person, plan: { year: o.standing.plan.year, priorities } }, `Priorities for ${o.standing.plan.year} saved.`)} />

            <div className="mt-8">
              <SectionLabel>Trainings recorded</SectionLabel>
              {o.records.length === 0 ? (
                <p className="mt-2 rounded-2xl border border-dashed border-line p-6 text-center text-sm text-muted">Nothing recorded yet.</p>
              ) : (
                <ol className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface">
                  {o.records.map((r, i) => (
                    <li key={`${r.n}-${r.fromOnboarding ? "ob" : "t"}`} className={`flex gap-3 px-3 py-3 text-sm ${r.voided ? "opacity-60" : ""}`}>
                      <span className="w-6 shrink-0 tabular-nums text-muted">{i + 1}</span>
                      <div className="min-w-0 flex-1">
                        <p className={`font-medium ${r.voided ? "line-through" : ""}`}>{r.topic}</p>
                        <p className="text-xs text-muted">
                          {day(r.date)} · {KINDS[r.kind]}
                          {r.donor ? ` (${r.donor})` : ""} · {r.fromOnboarding ? `confirmed by ${name(r.deliveredBy)}` : `${r.deliveredBy} · ${METHODS[r.method]} · ${r.hours} h`}
                        </p>
                        <p className="text-xs text-muted">
                          {r.fromOnboarding ? "From the onboarding checklist" : `Recorded by ${name(r.by)}${r.self ? " (their own record)" : ""} on ${day(r.at)}`}
                          {r.ceoApproved ? ` · CEO approved ${day(r.ceoApproved)}` : ""}
                        </p>
                        {r.voided && (
                          <p className="text-xs text-clay">
                            Withdrawn by {name(r.voided.by)} on {day(r.voided.at)}: {r.voided.why}
                          </p>
                        )}
                        <div className="mt-1 flex flex-wrap gap-3 text-xs">
                          {r.proof ? (
                            <button type="button" className="font-semibold text-forest hover:underline" onClick={() => void openReceipt(r.proof!.hash, user.id)}>
                              Open the proof: {r.proof.name}
                            </button>
                          ) : (
                            !r.fromOnboarding && <span className="text-warn">No attendance sheet or certificate attached</span>
                          )}
                          {r.mayVoid && <Withdraw busy={busy} onWithdraw={(why) => send({ action: "void", person: o.person, record: r.n, why }, "The record is withdrawn. It stays in the log, marked.")} />}
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </div>

            {o.canRecord && <RecordForm key={o.person} self={o.person === v?.me} busy={busy} today={v!.today} userId={user.id} onSave={(record) => send({ action: "record", person: o.person, record }, "Training recorded.")} />}
          </section>
        )}
      </main>
    </div>
  );
}

function StartForm({ busy, today, onSave }: { busy: boolean; today: string; onSave: (d: string) => void }) {
  const [d, setD] = useState(today);
  return (
    <div className="mt-3 flex flex-wrap items-end gap-3">
      <label className="text-sm">
        <span className="font-semibold">The policy took effect on</span>
        <input type="date" className={input} max={today} value={d} onChange={(e) => setD(e.target.value)} />
      </label>
      <button type="button" className={primaryBtn} disabled={busy || !d} onClick={() => onSave(d)}>
        Set the start date
      </button>
    </div>
  );
}

type Open = NonNullable<TrainingView["open"]>;

function Priorities({ o, busy, onSave }: { o: Open; busy: boolean; onSave: (p: { what: string; how: string }[]) => Promise<boolean> }) {
  const [editing, setEditing] = useState(false);
  const start = o.plan?.priorities ?? [];
  const [rows, setRows] = useState(() => [0, 1, 2].map((i) => ({ what: start[i]?.what ?? "", how: start[i]?.how ?? "" })));
  const filled = rows.filter((r) => r.what.trim() || r.how.trim());
  const ok = filled.length > 0 && filled.every((r) => r.what.trim().length >= 3 && r.how.trim().length >= 3);
  return (
    <div className="mt-8">
      <SectionLabel>Priorities for {o.standing.plan.year}</SectionLabel>
      {o.plan ? (
        <ol className="mt-2 list-decimal space-y-1 ps-5 text-sm">
          {o.plan.priorities.map((p, i) => (
            <li key={i}>
              <span className="font-medium">{p.what}</span>
              <span className="text-muted">: {p.how}</span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="mt-2 text-sm text-muted">Not agreed yet. The supervisor writes them after the appraisal, agreed with the person.</p>
      )}
      {o.plan && <p className="mt-1 text-xs text-muted">Written by {o.plan.by === o.supervisor ? "the supervisor" : "HR"} on {day(o.plan.at)}.</p>}
      {o.canPlan && !editing && (
        <button type="button" className={`${quietBtn} mt-3`} onClick={() => setEditing(true)}>
          {o.plan ? "Change the priorities" : "Write the priorities"}
        </button>
      )}
      {o.canPlan && editing && (
        <div className="mt-3 space-y-3 rounded-2xl border border-line bg-surface p-4">
          {rows.map((r, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <label className="text-sm">
                <span className="font-semibold">Priority {i + 1}</span>
                <input className={input} value={r.what} placeholder={i === 0 ? "Close the books each month without help" : ""} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, what: e.target.value } : x)))} />
              </label>
              <label className="text-sm">
                <span className="font-semibold">How it will be met</span>
                <input className={input} value={r.how} placeholder={i === 0 ? "Coaching at each month close" : ""} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, how: e.target.value } : x)))} />
              </label>
            </div>
          ))}
          <div className="flex gap-3">
            <button
              type="button"
              className={primaryBtn}
              disabled={busy || !ok}
              onClick={async () => {
                if (await onSave(filled.map((r) => ({ what: r.what.trim(), how: r.how.trim() })))) setEditing(false);
              }}
            >
              Save the priorities
            </button>
            <button type="button" className={quietBtn} onClick={() => setEditing(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Withdraw({ busy, onWithdraw }: { busy: boolean; onWithdraw: (why: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [why, setWhy] = useState("");
  if (!open)
    return (
      <button type="button" className="font-semibold text-muted hover:text-ink hover:underline" onClick={() => setOpen(true)}>
        Withdraw (recorded in error)
      </button>
    );
  return (
    <span className="flex w-full flex-wrap items-end gap-2">
      <label className="min-w-0 flex-1 text-xs">
        <span className="font-semibold">Why it is withdrawn</span>
        <input className={input} value={why} onChange={(e) => setWhy(e.target.value)} />
      </label>
      <button
        type="button"
        className={quietBtn}
        disabled={busy || why.trim().length < 5}
        onClick={async () => {
          if (await onWithdraw(why.trim())) setOpen(false);
        }}
      >
        Withdraw
      </button>
    </span>
  );
}

type RecordOut = { date: string; kind: Kind; topic: string; donor?: string; deliveredBy: string; method: Method; hours: number; proof?: Receipt; ceoApproved?: string };

function RecordForm({ self, busy, today, userId, onSave }: { self: boolean; busy: boolean; today: string; userId: string; onSave: (r: RecordOut) => Promise<boolean> }) {
  const blank = { date: today, kind: "anti-fraud" as Kind, topic: "", donor: "", deliveredBy: "", method: "coaching" as Method, hours: "", ceoApproved: "" };
  const [f, setF] = useState(blank);
  const [proof, setProof] = useState<Receipt | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof blank, val: string) => setF({ ...f, [k]: val });
  const hours = Number(f.hours);
  const ok = f.topic.trim().length >= 3 && f.deliveredBy.trim().length >= 2 && hours >= 0.25 && (f.kind !== "donor-rules" || f.donor.trim()) && (f.method !== "paid-external" || (f.ceoApproved && f.ceoApproved <= f.date)) && (!self || proof);
  return (
    <div className="mt-8 rounded-2xl border border-line bg-surface p-4">
      <SectionLabel>Record a training</SectionLabel>
      {self && <p className="mt-1 text-sm text-muted">For training you record yourself, attach the attendance sheet or certificate.</p>}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="font-semibold">Date</span>
          <input type="date" className={input} max={today} value={f.date} onChange={(e) => set("date", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="font-semibold">Training</span>
          <select className={input} value={f.kind} onChange={(e) => set("kind", e.target.value)}>
            {KIND_KEYS.map((k) => (
              <option key={k} value={k}>
                {KINDS[k]}
              </option>
            ))}
          </select>
        </label>
        {f.kind === "donor-rules" && (
          <label className="text-sm">
            <span className="font-semibold">Which donor</span>
            <input className={input} value={f.donor} placeholder="UNDP" onChange={(e) => set("donor", e.target.value)} />
          </label>
        )}
        <label className="text-sm sm:col-span-2">
          <span className="font-semibold">What was covered</span>
          <input className={input} value={f.topic} placeholder="Cash advances: clearing them within 30 days" onChange={(e) => set("topic", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="font-semibold">Given by</span>
          <input className={input} value={f.deliveredBy} placeholder="A person, or the course and who ran it" onChange={(e) => set("deliveredBy", e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="font-semibold">How</span>
          <select className={input} value={f.method} onChange={(e) => set("method", e.target.value)}>
            {METHOD_KEYS.map((k) => (
              <option key={k} value={k}>
                {METHODS[k]}
              </option>
            ))}
          </select>
        </label>
        {f.method === "paid-external" && (
          <label className="text-sm">
            <span className="font-semibold">The CEO approved it on</span>
            <input type="date" className={input} max={f.date} value={f.ceoApproved} onChange={(e) => set("ceoApproved", e.target.value)} />
          </label>
        )}
        <label className="text-sm">
          <span className="font-semibold">Hours</span>
          <input type="number" inputMode="decimal" min={0.25} step={0.25} className={input} value={f.hours} onChange={(e) => set("hours", e.target.value)} />
        </label>
        <label className="text-sm sm:col-span-2">
          <span className="font-semibold">Attendance sheet or certificate{self ? "" : " (if there is one)"}</span>
          <input
            type="file"
            accept="image/*,application/pdf"
            className="mt-1 block w-full text-sm"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              setErr("");
              try {
                const body = new FormData();
                body.append("file", await shrink(file));
                setProof(await call<Receipt>("/api/files", userId, { method: "POST", body }));
              } catch (x) {
                setErr(x instanceof Error ? x.message : String(x));
              } finally {
                setUploading(false);
              }
            }}
          />
          {uploading && <span className="mt-1 block text-xs text-muted">Uploading…</span>}
          {proof && <span className="mt-1 block text-xs text-leaf">Attached: {proof.name}</span>}
        </label>
      </div>
      {err && <p className="mt-2 text-sm text-clay">{err}</p>}
      <button
        type="button"
        className={`${primaryBtn} mt-4`}
        disabled={busy || uploading || !ok}
        onClick={async () => {
          const saved = await onSave({
            date: f.date,
            kind: f.kind,
            topic: f.topic.trim(),
            ...(f.kind === "donor-rules" ? { donor: f.donor.trim() } : {}),
            deliveredBy: f.deliveredBy.trim(),
            method: f.method,
            hours,
            ...(proof ? { proof } : {}),
            ...(f.method === "paid-external" ? { ceoApproved: f.ceoApproved } : {}),
          });
          if (saved) {
            setF(blank);
            setProof(null);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }
        }}
      >
        Record the training
      </button>
    </div>
  );
}
