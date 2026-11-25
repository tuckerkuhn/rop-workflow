"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Priority } from "@/lib/week";
import { useSession } from "@/components/app/session";
import { cachedHome, homeCacheKey, keepHome } from "@/components/home/home-cache";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";
import type { WeekAction } from "@/lib/week";
import type { WeekView } from "@/server/week-store";

/**
 * The week ahead, at the top of a manager's Home: up to three priorities the app proposes from the
 * records and the person makes their own, once a week. Confirmed, they are a banner with a pencil
 * to change them, and stay at the top of the screen as one line while the page scrolls. What the
 * records say is in the to-do list right below, so it is not repeated here.
 */

type Draft = { id: string; text: string; href: string; own: boolean; carried?: boolean };

/** The person's own calendar day, so a week starts on their Monday (api/week ?day=). */
const localDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

/**
 * The week, asked for as soon as Home starts loading rather than once Home has arrived: the server
 * then reads it while Home's own read of the open project is still running, and joins that read
 * instead of doing it again (server/next-report joinRunning). Taken once, by the first WeekAhead
 * that mounts for this person and day, and only while fresh.
 */
const started = new Map<string, { at: number; res: Promise<Response> }>();
const FRESH_MS = 30_000;
export function startWeek(userId: string) {
  const key = `${userId}:${localDay()}`;
  const was = started.get(key);
  if (was && Date.now() - was.at < FRESH_MS) return;
  const res = fetch(`/api/week?day=${localDay()}`, { cache: "no-store", headers: { "Content-Type": "application/json", "x-demo-user": userId } });
  res.catch(() => undefined);
  started.set(key, { at: Date.now(), res });
}
function takeStarted(userId: string): Promise<Response> | null {
  const key = `${userId}:${localDay()}`;
  const was = started.get(key);
  started.delete(key);
  return was && Date.now() - was.at < FRESH_MS ? was.res : null;
}

export function WeekAhead() {
  const { user, actor } = useSession();
  const userId = user?.id;
  const actorId = actor?.id;
  // The last week read for this person, shown at once while a fresh read runs (components/home/home-cache).
  const keyOf = useCallback((id: string) => homeCacheKey(actorId, id, `/api/week?day=${localDay()}`), [actorId]);
  const [v, setV] = useState<WeekView | null>(() => (userId ? (cachedHome<WeekView>(keyOf(userId)) ?? null) : null));
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  // Whose week is on screen now: an answer that arrives after the person changed is dropped.
  const current = useRef(userId);
  current.current = userId;

  const call = useCallback(
    async (init?: RequestInit) => {
      if (!userId) return;
      const key = keyOf(userId);
      const res = (!init ? await takeStarted(userId) : null) ?? (await fetch(`/api/week?day=${localDay()}`, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": userId } }));
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
      if (current.current !== userId) return;
      // A change answers with the plan alone (api/week POST); the rest of the week stays as read.
      // What is kept for coming back is always what is now on screen, the change included.
      setV((was) => {
        const next = init?.method === "POST" ? (was ? { ...was, plan: (body as Pick<WeekView, "plan">).plan } : was) : (body as WeekView);
        if (next) keepHome(key, next);
        return next;
      });
      setError("");
    },
    [userId, keyOf],
  );
  useEffect(() => {
    const was = userId ? cachedHome<WeekView>(keyOf(userId)) : undefined;
    setV(was ?? null);
    setDraft(null);
    // Behind a week already on screen, a failed fresh read leaves it as it is: Home still works without it.
    call().catch((e) => !was && setError(e instanceof Error ? e.message : String(e)));
  }, [call, keyOf, userId]);

  if (error && !v) return null; // Home still works without it.
  if (!v)
    return (
      <section className="mt-8" aria-busy="true">
        <h2 className="border-s-[6px] border-warn ps-2 font-ledger text-lg font-bold leading-tight">The week ahead</h2>
        <p className="mt-2 text-sm text-muted">Reading the week from the records…</p>
      </section>
    );

  const act = async (a: WeekAction) => {
    setBusy(true);
    try {
      await call({ method: "POST", body: JSON.stringify(a) });
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const confirmed = !!v.plan.confirmedAt;
  // Choosing: the person's own list if they reopened it, else what the app proposes.
  const list: Draft[] = draft ?? (v.plan.items.length ? v.plan.items.map(({ id, text, href, own }) => ({ id, text, href, own })) : v.suggestions.map((x) => ({ id: x.id, text: x.text, href: x.href, own: !!x.own, carried: !!x.carried })));
  // When the records raise only the approvals, they are already listed one by one in the to-do list
  // above: the week ahead says so in one line instead of naming them again.
  const onlyApprovals = list.length === 1 && list[0].id === "approvals" && !list[0].own;
  const waitingN = Number.parseInt(v.summary.find((x) => x.kind === "waiting")?.parts[0]?.t ?? "", 10);
  const approvals = waitingN === 1 ? "approval" : waitingN > 1 ? `${waitingN} approvals` : "approvals";
  const full = list.length >= v.max;
  const addOwn = () => {
    const text = add.trim();
    if (text.length < 3 || full) return;
    setDraft([...list, { id: `new:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`, text, href: "", own: true }]);
    setAdd("");
  };

  const weekOf = new Date(`${v.week}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  const scope = v.projects.length === 0 ? "no running project" : v.projects.length <= 3 ? v.projects.map((p) => p.short).join(", ") : `${v.projects.length} projects`;

  // Confirmed for this week: a banner, set once a week and changed with the pencil. Scrolled past,
  // it stays at the top of the screen as one line.
  if (confirmed)
    return (
      <PriorityBanner
        items={v.plan.items}
        weekOf={weekOf}
        scope={scope}
        busy={busy}
        error={error}
        onDone={(id, d) => void act({ action: "done", id, done: d })}
        onEdit={() => void act({ action: "reopen" })}
      />
    );

  return (
    <section className="mt-8" aria-labelledby="week-heading">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="week-heading" className="border-s-[6px] border-warn ps-2 font-ledger text-lg font-bold leading-tight">
          The week ahead
        </h2>
        <span className="font-mono text-xs text-muted">
          {/* Named, so nobody reads it as the project open in the picker: the week covers every project the person runs. */}
          week of {weekOf} · {scope}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-ledger text-base font-bold">Suggested priorities: make them yours</h3>
        </div>
        {error && (
          <p role="alert" className="mt-2 bg-clay-soft px-3 py-2 text-sm text-clay">
            {error}
          </p>
        )}

        {(
          <>
            {v.lastWeek && (
              <p className="mt-1 font-mono text-xs text-muted">
                Last week: {v.lastWeek.done} of {v.lastWeek.of} done{v.lastWeek.left ? `, ${v.lastWeek.left} carried over` : ""}
              </p>
            )}
            <p className="mt-1 max-w-2xl text-sm text-muted">Drawn from what is due, blocked and waiting on you. Drop what is not yours this week, add what the records cannot know, then confirm. Three at most.</p>
            {list.length === 0 ? (
              <p className="mt-2 border-s-[6px] border-leaf ps-3 text-sm">The records raise nothing for you this week. Add your own priorities, or confirm an open week.</p>
            ) : onlyApprovals ? (
              <p className="mt-2 flex min-h-12 items-center gap-3 border-y border-line px-2 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-semibold">Clear the {approvals} waiting on you</span>
                  <span className="text-muted">{v.projects.length > 1 ? ": each project's Home lists its own." : `: they are in the to-do list below, with ${v.projects[0]?.short ?? "the project"} open.`}</span>
                </span>
                <button type="button" className="min-h-11 shrink-0 px-2 text-sm text-muted hover:text-clay" aria-label={`Drop: ${list[0].text}`} onClick={() => setDraft([])}>
                  Drop
                </button>
              </p>
            ) : (
              <ol className="mt-2 border-t-2 border-ink">
                {list.map((i, k) => (
                  <li key={i.id} className="flex min-h-12 items-center gap-3 border-b border-line px-2 py-2">
                    <span aria-hidden className="w-6 shrink-0 font-mono text-xs text-muted">
                      {String(k + 1).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 flex-1 text-sm font-semibold">{i.text}</span>
                    {i.carried && <span className="shrink-0 bg-ochre px-1.5 font-mono text-xs uppercase text-ink">from last week</span>}
                    {i.own && <span className="shrink-0 font-mono text-xs uppercase text-muted">yours</span>}
                    <button type="button" className="min-h-11 shrink-0 px-2 text-sm text-muted hover:text-clay" aria-label={`Drop: ${i.text}`} onClick={() => setDraft(list.filter((x) => x.id !== i.id))}>
                      Drop
                    </button>
                  </li>
                ))}
              </ol>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                className="min-w-0 flex-1 rounded-sm border border-line bg-paper px-3 py-2.5 text-base"
                value={add}
                maxLength={200}
                disabled={full}
                placeholder={full ? "Three is the limit. Drop one to add another." : "Add a priority of your own"}
                aria-label="Add a priority of your own"
                onChange={(e) => setAdd(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addOwn())}
              />
              <button type="button" className={quietBtn} disabled={full || add.trim().length < 3} onClick={addOwn}>
                Add
              </button>
              <button type="button" className={primaryBtn} disabled={busy} onClick={() => void act({ action: "confirm", items: list })}>
                Confirm my week
              </button>
            </div>
          </>
        )}
      </div>

    </section>
  );
}

/** The pencil: change this week's priorities. */
function EditButton({ onEdit, busy, small }: { onEdit: () => void; busy: boolean; small?: boolean }) {
  return (
    <button type="button" disabled={busy} onClick={onEdit} aria-label="Change this week's priorities" title="Change this week's priorities" className={`inline-flex shrink-0 items-center justify-center rounded-full text-sky hover:bg-sky/10 ${small ? "h-11 w-11 sm:h-8 sm:w-8" : "h-11 w-11"}`}>
      <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13.5 3.5l3 3L7 16l-4 1 1-4z" />
      </svg>
    </button>
  );
}

/**
 * This week's confirmed priorities as a banner in its own colour. Once it scrolls out of sight a
 * one-line copy stays at the top of the screen, under the header when the header shows.
 */
function PriorityBanner({ items, weekOf, scope, busy, error, onDone, onEdit }: { items: Priority[]; weekOf: string; scope: string; busy: boolean; error: string; onDone: (id: string, done: boolean) => void; onEdit: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const [away, setAway] = useState(false);
  const [box, setBox] = useState({ top: 0, left: 0, width: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const header = () => Math.max(0, document.querySelector("header")?.getBoundingClientRect().bottom ?? 0);
    // Lined up with the banner itself, so it sits over the page's content and not under a side menu.
    const onScroll = () => {
      const h = header();
      const r = el.getBoundingClientRect();
      setBox({ top: h, left: r.left, width: r.width });
      setAway(r.bottom < h);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, []);
  const done = items.filter((i) => i.done).length;
  return (
    <>
      <section ref={ref} aria-labelledby="week-heading" className="mt-6 border-s-[6px] border-sky bg-sky-soft px-4 py-3">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 id="week-heading" className="font-ledger text-base font-bold leading-tight">
              This week&apos;s priorities
            </h2>
            <p className="font-mono text-xs text-muted">
              week of {weekOf} · {scope}
              {items.length ? ` · ${done} of ${items.length} done` : ""}
            </p>
          </div>
          <EditButton onEdit={onEdit} busy={busy} />
        </div>
        {error && (
          <p role="alert" className="mt-2 bg-clay-soft px-3 py-2 text-sm text-clay">
            {error}
          </p>
        )}
        {items.length === 0 ? (
          <p className="mt-1 text-sm text-muted">No priorities set for this week.</p>
        ) : (
          <ol className="mt-1">
            {items.map((i) => (
              <li key={i.id} className="flex min-h-11 items-center gap-3">
                <input type="checkbox" className="h-5 w-5 shrink-0" checked={i.done} disabled={busy} aria-label={`Done: ${i.text}`} onChange={(e) => onDone(i.id, e.target.checked)} />
                {i.href ? (
                  <Link href={i.href} className={`min-w-0 flex-1 text-sm hover:underline ${i.done ? "text-muted line-through" : "font-semibold"}`}>
                    {i.text}
                  </Link>
                ) : (
                  <span className={`min-w-0 flex-1 text-sm ${i.done ? "text-muted line-through" : "font-semibold"}`}>{i.text}</span>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
      {/* The same, as one line at the top of the screen once the banner has scrolled away. */}
      {away && items.length > 0 && (
        <div style={box} className="fixed z-30 border-s-[6px] border-sky bg-sky-soft/95 shadow-sm backdrop-blur" role="region" aria-label="This week's priorities">
          <div className="flex items-center gap-3 ps-3 pe-1">
            <span className="shrink-0 font-ledger text-xs font-bold uppercase tracking-wide text-sky">This week</span>
            <ol className="flex min-w-0 flex-1 gap-4 overflow-x-auto py-1">
              {items.map((i) => (
                <li key={i.id} className="flex min-h-11 shrink-0 items-center gap-2 sm:min-h-9">
                  <input type="checkbox" className="h-4 w-4" checked={i.done} disabled={busy} aria-label={`Done: ${i.text}`} onChange={(e) => onDone(i.id, e.target.checked)} />
                  <span className={`max-w-[16rem] truncate text-sm ${i.done ? "text-muted line-through" : "font-semibold"}`}>{i.text}</span>
                </li>
              ))}
            </ol>
            <EditButton onEdit={onEdit} busy={busy} small />
          </div>
        </div>
      )}
    </>
  );
}
