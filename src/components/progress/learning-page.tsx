"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { LESSON_AREAS, type LearningAction } from "@/lib/learning";
import type { LearningView } from "@/server/learning-store";

/** Lessons learned as the project runs, and the checklist that closes it. */

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";

async function call(url: string, user: string, init?: RequestInit): Promise<LearningView> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as LearningView;
}

function LessonForm({ act, onClose }: { act: (a: LearningAction) => Promise<void>; onClose: () => void }) {
  const [f, setF] = useState({ date: new Date().toISOString().slice(0, 10), area: "Programme" as (typeof LESSON_AREAS)[number], happened: "", lesson: "", action_: "" });
  return (
    <form
      className="mt-3 grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: "lesson", ...f }).then(onClose);
      }}
    >
      <label className="text-sm">
        When
        <input type="date" className={input} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
      </label>
      <label className="text-sm">
        Area
        <select className={input} value={f.area} onChange={(e) => setF({ ...f, area: e.target.value as typeof f.area })}>
          {LESSON_AREAS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      </label>
      <label className="text-sm sm:col-span-2">
        What happened
        <textarea rows={2} className={input} value={f.happened} onChange={(e) => setF({ ...f, happened: e.target.value })} />
      </label>
      <label className="text-sm sm:col-span-2">
        What we learned
        <textarea rows={2} className={input} value={f.lesson} onChange={(e) => setF({ ...f, lesson: e.target.value })} />
      </label>
      <label className="text-sm sm:col-span-2">
        What we will do differently
        <input className={input} value={f.action_} onChange={(e) => setF({ ...f, action_: e.target.value })} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primaryBtn}>
          Record lesson
        </button>
        <button type="button" className={quietBtn} onClick={onClose}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function Applied({ id, act }: { id: string; act: (a: LearningAction) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [how, setHow] = useState("");
  if (!open)
    return (
      <button type="button" className="text-xs font-semibold text-forest hover:underline" onClick={() => setOpen(true)}>
        Mark applied
      </button>
    );
  return (
    <form
      className="mt-2 flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: "applied", id, how }).then(() => setOpen(false));
      }}
    >
      <input className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="How it was applied" value={how} onChange={(e) => setHow(e.target.value)} />
      <button type="submit" className={primaryBtn}>
        Save
      </button>
    </form>
  );
}

function Item({ it, act }: { it: LearningView["items"][number]; act: (a: LearningAction) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [note, setNote] = useState("");
  return (
    <li className="py-3">
      <div className="flex flex-wrap items-start gap-2">
        <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${it.done ? "bg-forest text-paper" : "border border-line"}`}>
          {it.done ? "✓" : ""}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">{it.label}</p>
          <p className="text-xs text-muted">{it.hint}</p>
          {it.auto && <p className={`text-xs ${it.auto.ok ? "text-forest" : "text-clay"}`}>{it.auto.detail}</p>}
          {it.tick && (
            <p className="text-xs text-muted">
              Confirmed by {it.tick.byName} on {it.tick.on}
              {it.tick.note ? `: ${it.tick.note}` : ""}{" "}
              {it.tick.evidence && (
                <a href={it.tick.evidence} target="_blank" rel="noreferrer" className="text-forest hover:underline">
                  evidence
                </a>
              )}
            </p>
          )}
        </div>
        {it.canTick &&
          (it.tick ? (
            <button type="button" className="text-xs text-muted hover:text-clay" onClick={() => setOpen(!open)}>
              Reopen
            </button>
          ) : (
            <button type="button" className={quietBtn} onClick={() => setOpen(!open)}>
              Confirm
            </button>
          ))}
      </div>
      {open && (
        <form
          className="mt-2 flex flex-wrap gap-2 ps-7"
          onSubmit={(e) => {
            e.preventDefault();
            void act(it.tick ? { action: "untick", item: it.id, note } : { action: "tick", item: it.id, evidence, note }).then(() => setOpen(false));
          }}
        >
          {!it.tick && <input className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder={it.auto ? "Evidence link (optional)" : "Evidence (SharePoint link)"} value={evidence} onChange={(e) => setEvidence(e.target.value)} />}
          <input className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder={it.tick ? "Why it is reopened" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className={primaryBtn}>
            {it.tick ? "Reopen" : "Confirm"}
          </button>
        </form>
      )}
    </li>
  );
}

export function LearningPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<LearningView | null>(null);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const url = `/api/projects/${project.id}/learning`;
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call(url, user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);
  if (!user) return null;
  const act = async (a: LearningAction) => {
    setError("");
    try {
      setV(await call(url, user.id, { method: "POST", body: JSON.stringify(a) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const done = v?.items.filter((i) => i.done).length ?? 0;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <Link href="/progress" className="text-sm text-muted hover:text-ink">
          ← Progress
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Lessons and close-out</h1>
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {!v && project.saved && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && (
          <>
            <section className="mt-6">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="flex-1 font-display text-2xl">Lessons learned</h2>
                {v.can.record && !adding && (
                  <button type="button" className={primaryBtn} onClick={() => setAdding(true)}>
                    + Record a lesson
                  </button>
                )}
              </div>
              <p className="mt-1 text-sm text-muted">Record them when they happen, not at the end. They go into the annual and final reports.</p>
              {adding && <LessonForm act={act} onClose={() => setAdding(false)} />}
              {v.lessons.length === 0 ? (
                <p className="mt-4 text-sm text-muted">No lessons recorded yet.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {v.lessons.map((l) => (
                    <li key={l.id} className="rounded-2xl border border-line bg-surface p-4">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                        <Pill tone="muted">{l.area}</Pill>
                        {l.date} · {l.byName}
                        {l.applied ? <Pill tone="forest">Applied</Pill> : <Pill tone="ochre">To apply</Pill>}
                      </div>
                      <p className="mt-2 text-sm">
                        <span className="font-semibold">What happened: </span>
                        {l.happened}
                      </p>
                      <p className="mt-1 text-sm">
                        <span className="font-semibold">Lesson: </span>
                        {l.lesson}
                      </p>
                      <p className="mt-1 text-sm">
                        <span className="font-semibold">We will: </span>
                        {l.action}
                      </p>
                      {l.applied ? (
                        <p className="mt-1 text-xs text-forest">
                          Applied {l.applied.on} by {l.applied.byName}: {l.applied.how}
                        </p>
                      ) : (
                        v.can.record && <Applied id={l.id} act={act} />
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-10 border-t border-line pt-6">
              <h2 className="font-display text-2xl">Project close-out</h2>
              <p className="mt-1 text-sm text-muted">
                {v.closed ? `Closed on ${v.closed.on} by ${v.closed.byName}.` : `${done} of ${v.items.length} done. Each item is confirmed by the role that owns it, with the evidence; a plan approver closes the project when all are done.`}
                {v.project.end ? ` The agreement ends ${v.project.end}.` : ""}
              </p>
              <ul className="mt-3 divide-y divide-line rounded-2xl border border-line bg-surface px-4">
                {v.items.map((it) => (
                  <Item key={it.id} it={it} act={act} />
                ))}
              </ul>
              {v.can.close && (
                <button type="button" className={`${primaryBtn} mt-4`} onClick={() => void act({ action: "close" })}>
                  Close the project
                </button>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
