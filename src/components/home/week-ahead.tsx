"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";
import type { WeekAction } from "@/lib/week";
import type { WeekView } from "@/server/week-store";

/**
 * The week ahead, on a manager's Home under the next thing to do and what waits on them: four sentences built from the
 * records and up to three priorities the app proposes and the person makes their
 * own. The priorities come first: they are what the person decided, the rest is what informed it. The sentence that needs attention carries the gold wash; every figure opens its page.
 */

type Draft = { id: string; text: string; href: string; own: boolean; carried?: boolean };

export function WeekAhead() {
  const { user } = useSession();
  const [v, setV] = useState<WeekView | null>(null);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [add, setAdd] = useState("");
  const [busy, setBusy] = useState(false);
  const userId = user?.id;

  const call = useCallback(
    async (init?: RequestInit) => {
      if (!userId) return;
      const now = new Date();
      const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
      const res = await fetch(`/api/week?day=${day}`, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": userId } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
      // A change answers with the plan alone (api/week POST); the rest of the week stays as read.
      setV((was) => (init?.method === "POST" ? (was ? { ...was, plan: (body as Pick<WeekView, "plan">).plan } : was) : (body as WeekView)));
      setError("");
    },
    [userId],
  );
  useEffect(() => {
    setV(null);
    setDraft(null);
    call().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [call]);

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
  const done = v.plan.items.filter((i) => i.done).length;
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

  return (
    <section className="mt-8" aria-labelledby="week-heading">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="week-heading" className="border-s-[6px] border-warn ps-2 font-ledger text-lg font-bold leading-tight">
          The week ahead
        </h2>
        <span className="font-mono text-xs text-muted">
          week of {v.week}, as of today · {v.projects.length} {v.projects.length === 1 ? "project" : "projects"}
        </span>
      </div>

      <div className="mt-3">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 className="font-ledger text-base font-bold">{confirmed ? "Your priorities this week" : "Suggested priorities: make them yours"}</h3>
          {confirmed && (
            <span className="font-mono text-xs text-muted">
              {done} of {v.plan.items.length} done
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="mt-2 bg-clay-soft px-3 py-2 text-sm text-clay">
            {error}
          </p>
        )}

        {confirmed ? (
          <>
            {v.plan.items.length === 0 ? (
              <p className="mt-2 text-sm text-muted">You confirmed a week with no priorities.</p>
            ) : (
              <ol className="mt-2 border-t-2 border-ink">
                {v.plan.items.map((i, k) => (
                  <li key={i.id} className="flex min-h-12 items-center gap-3 border-b border-line px-2 py-2">
                    <span aria-hidden className="w-6 shrink-0 font-mono text-xs text-muted">
                      {String(k + 1).padStart(2, "0")}
                    </span>
                    <input type="checkbox" className="h-5 w-5 shrink-0" checked={i.done} disabled={busy} aria-label={`Done: ${i.text}`} onChange={(e) => void act({ action: "done", id: i.id, done: e.target.checked })} />
                    {i.href ? (
                      <Link href={i.href} className={`min-w-0 flex-1 text-sm hover:underline ${i.done ? "text-muted line-through" : "font-semibold"}`}>
                        {i.text}
                      </Link>
                    ) : (
                      <span className={`min-w-0 flex-1 text-sm ${i.done ? "text-muted line-through" : "font-semibold"}`}>{i.text}</span>
                    )}
                    {i.own && <span className="shrink-0 font-mono text-xs uppercase text-muted">yours</span>}
                  </li>
                ))}
              </ol>
            )}
            <button type="button" className={`${quietBtn} mt-3`} disabled={busy} onClick={() => void act({ action: "reopen" })}>
              Change the list
            </button>
          </>
        ) : (
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
                  <span className="text-muted">{v.projects.length > 1 ? ": each project's Home lists its own." : ": they are in your to-do list above."}</span>
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
      <h3 className="mt-8 font-ledger text-base font-bold">What the records say</h3>
      <div className="mt-1 max-w-3xl text-base leading-relaxed">
        {v.summary.map((s) => (
          <p key={s.kind} className={s.flag ? "border-s-[6px] border-ochre bg-ochre-soft px-3 py-1.5" : "px-3 py-1.5 ps-[calc(0.75rem+6px)]"}>
            {s.parts.map((p, k) =>
              p.href ? (
                <Link key={k} href={p.href} className="font-semibold text-forest underline decoration-1 underline-offset-2 hover:decoration-2">
                  {p.t}
                </Link>
              ) : (
                <span key={k}>{p.t}</span>
              ),
            )}
          </p>
        ))}
      </div>


    </section>
  );
}
