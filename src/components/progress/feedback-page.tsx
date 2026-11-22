"use client";

import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { ANSWER_DAYS, FEEDBACK_CHANNELS, FEEDBACK_FROM, FEEDBACK_KINDS, KIND_LABEL, needsAnswer, overdue, type FeedbackAction } from "@/lib/feedback";
import { plainError } from "@/lib/plain-error";
import type { FeedbackView } from "@/server/feedback-store";

/**
 * Feedback and complaints: one ruled list, what still needs an answer at the top. The page says
 * why the log is kept, once, because a first-time grantee is rarely told until the audit asks.
 */

const input = "mt-1 block w-full rounded-sm border border-line bg-paper px-3 py-2.5 text-base";
const today = () => new Date().toISOString().slice(0, 10);
type Entry = FeedbackView["entries"][number];

async function call(url: string, user: string, init?: RequestInit): Promise<FeedbackView> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as FeedbackView;
}

function RecordForm({ act, onClose }: { act: (a: FeedbackAction) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState({ date: today(), kind: "complaint" as (typeof FEEDBACK_KINDS)[number], from: "farmer" as (typeof FEEDBACK_FROM)[number], channel: "in person" as (typeof FEEDBACK_CHANNELS)[number], place: "", about: "", serious: false });
  return (
    <form
      className="mt-3 grid gap-3 border-s-[6px] border-forest bg-surface p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: "record", ...f }).then(onClose, () => undefined);
      }}
    >
      <label className="text-sm">
        When it was said
        <input type="date" max={today()} className={input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </label>
      <label className="text-sm">
        What it is
        <select className={input} value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value as typeof f.kind })}>
          {FEEDBACK_KINDS.map((k) => (
            <option key={k} value={k}>
              {KIND_LABEL[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        Who said it
        <select className={input} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value as typeof f.from })}>
          {FEEDBACK_FROM.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label className="text-sm">
        How it reached us
        <select className={input} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value as typeof f.channel })}>
          {FEEDBACK_CHANNELS.map((k) => (
            <option key={k}>{k}</option>
          ))}
        </select>
      </label>
      <label className="text-sm sm:col-span-2">
        Village or district (optional)
        <input className={input} value={f.place} maxLength={120} onChange={(e) => setF({ ...f, place: e.target.value })} />
      </label>
      <label className="text-sm sm:col-span-2">
        What the person told you
        <textarea className={input} rows={4} value={f.about} maxLength={2000} onChange={(e) => setF({ ...f, about: e.target.value })} />
        <span className="mt-1 block text-xs text-muted">Do not write the person&rsquo;s name. Say what happened in their words as closely as you can.</span>
      </label>
      <label className="flex items-start gap-3 text-sm sm:col-span-2">
        <input type="checkbox" className="mt-1 h-5 w-5" checked={f.serious} onChange={(e) => setF({ ...f, serious: e.target.checked })} />
        <span>
          <span className="font-semibold">This is a serious matter</span>: harm to a person, abuse, fraud or a safety risk. Only you, plan approvers and administrators will be able to read it.
        </span>
      </label>
      <div className="flex flex-wrap gap-2 sm:col-span-2">
        <button type="submit" className={primaryBtn} disabled={f.about.trim().length < 10}>
          Record it
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Answer({ e, act }: { e: Entry; act: (a: FeedbackAction) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  if (!open)
    return (
      <button type="button" className={`${quietBtn} mt-2`} onClick={() => setOpen(true)}>
        Record the answer
      </button>
    );
  return (
    <form
      className="mt-2"
      onSubmit={(ev) => {
        ev.preventDefault();
        void act({ action: "answer", id: e.id, text }).then(() => setOpen(false), () => undefined);
      }}
    >
      <label className="text-sm">
        What was done or answered, and how the person was told
        <textarea className={input} rows={3} value={text} maxLength={2000} onChange={(ev) => setText(ev.target.value)} />
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="submit" className={primaryBtn} disabled={text.trim().length < 10}>
          Save the answer
        </button>
        <button type="button" className={quietBtn} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function FeedbackPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<FeedbackView | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const url = `/api/projects/${project.id}/feedback`;
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call(url, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);
  if (!user) return null;
  const act = async (a: FeedbackAction) => {
    setError("");
    try {
      setV(await call(url, user.id, { method: "POST", body: JSON.stringify(a) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const s = v?.thisQuarter;
  const t = today();
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">{project.name}</p>
        <div className="mt-1 flex flex-wrap items-end gap-3">
          <h1 className="min-w-0 flex-1 font-display text-4xl tracking-tight">Feedback and complaints</h1>
          {v?.can.record && !adding && (
            <button type="button" className={primaryBtn} onClick={() => setAdding(true)}>
              + Record feedback
            </button>
          )}
        </div>
        <p className="mt-2 max-w-2xl text-sm text-muted">
          What farmers, community members, suppliers and staff told the project, and what was answered. Why keep it: donors ask how complaints are received and answered, an auditor asks to see the record, and
          a complaint answered early rarely becomes a problem. Aim to answer within {ANSWER_DAYS} days.
        </p>
        {error && (
          <p role="alert" className="mt-3 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {!project.saved && <p className="mt-6 text-sm text-muted">Save the project first: the log is kept with the project.</p>}
        {!v && project.saved && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {adding && <RecordForm act={act} onClose={() => setAdding(false)} />}
        {v && s && (
          <>
            <dl className="mt-6 grid grid-cols-2 border-t-2 border-ink sm:grid-cols-4">
              {(
                [
                  [`Received, ${v.quarter.replace("-Q", " Q")}`, s.received, ""],
                  ["Answered", s.answered, ""],
                  ["Waiting for an answer", v.all.open, v.all.open ? "text-warn" : ""],
                  [`Waiting more than ${ANSWER_DAYS} days`, v.all.overdue, v.all.overdue ? "text-clay" : ""],
                ] as [string, number, string][]
              ).map(([label, n, tone]) => (
                <div key={label} className="border-b border-line px-2 py-3">
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className={`font-mono text-3xl font-bold ${tone}`}>{n}</dd>
                </div>
              ))}
            </dl>
            {s.averageDays !== null && <p className="mt-2 font-mono text-xs text-muted">Average time to answer this quarter: {s.averageDays} days</p>}

            {v.entries.length === 0 ? (
              <p className="mt-6 border-s-[6px] border-ochre bg-ochre-soft px-3 py-3 text-sm">
                Nothing recorded yet. An empty log does not show there were no complaints. It shows nobody was asked. Tell people at the next community meeting how they can reach the project, then record what
                they say here.
              </p>
            ) : (
              <ol className="mt-6 border-t-2 border-ink">
                {v.entries.map((e, k) => {
                  const late = overdue(e, t);
                  const open = needsAnswer(e);
                  return (
                    <li key={e.id} className={`border-b border-line px-2 py-3 ${late ? "border-s-[6px] border-s-clay" : open ? "border-s-[6px] border-s-ochre bg-ochre-soft" : ""}`}>
                      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                        <span aria-hidden className="w-6 shrink-0 font-mono text-xs text-muted">
                          {String(k + 1).padStart(2, "0")}
                        </span>
                        <span className="font-ledger text-base font-bold">{KIND_LABEL[e.kind]}</span>
                        <span className="text-sm text-muted">
                          from a {e.from}, {e.channel}
                          {e.place ? `, ${e.place}` : ""}
                        </span>
                        {e.serious && <span className="bg-clay px-2 py-0.5 font-mono text-xs uppercase text-paper">Serious</span>}
                        <span className="ms-auto font-mono text-xs text-muted">
                          {e.date} · {e.byName}
                        </span>
                      </div>
                      {e.withheld ? (
                        <p className="mt-2 text-sm text-muted">A serious matter. Its words are read only by the person who recorded it, plan approvers and administrators.</p>
                      ) : (
                        <p className="mt-2 whitespace-pre-wrap text-sm">{e.about}</p>
                      )}
                      {e.answer ? (
                        <p className="mt-2 border-s-2 border-leaf ps-3 text-sm">
                          <span className="font-semibold text-leaf">
                            Answered {e.answer.on} by {e.answer.byName}
                          </span>
                          {e.answer.text ? `: ${e.answer.text}` : ""}
                        </p>
                      ) : open ? (
                        <>
                          <p className={`mt-2 font-mono text-xs uppercase ${late ? "font-bold text-clay" : "text-warn"}`}>{late ? `Waiting more than ${ANSWER_DAYS} days` : "Waiting for an answer"}</p>
                          {v.can.record && !e.withheld && <Answer e={e} act={act} />}
                        </>
                      ) : null}
                    </li>
                  );
                })}
              </ol>
            )}
          </>
        )}
      </main>
    </div>
  );
}
