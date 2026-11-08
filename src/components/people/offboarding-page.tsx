"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, primaryBtn } from "@/components/workspace/ui";
import { OFF_OWNER_LABEL, type OffAction } from "@/lib/offboarding";
import type { OffboardingView } from "@/server/offboarding-view";

/** People leaving (from approved departures in the HR record) and contracts ending soon. */

async function call(user: string, init?: RequestInit): Promise<OffboardingView> {
  const res = await fetch("/api/offboarding", { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as OffboardingView;
}

function Step({ person, s, act }: { person: string; s: OffboardingView["leavers"][number]["steps"][number]; act: (a: OffAction) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-start gap-2">
        <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs ${s.done ? "bg-forest text-paper" : "border border-line"}`}>
          {s.done ? "✓" : ""}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {s.title} <span className="font-normal text-muted">· {OFF_OWNER_LABEL[s.owner]}</span>
          </p>
          {s.done ? (
            <p className="text-xs text-muted">
              {s.done.byName}, {s.done.at.slice(0, 10)}
              {s.done.note ? `: ${s.done.note}` : ""}
            </p>
          ) : (
            <p className="text-xs text-muted">{s.help}</p>
          )}
        </div>
        {s.canDo && !open && (
          <button type="button" className="text-sm font-semibold text-forest hover:underline" onClick={() => setOpen(true)}>
            Done
          </button>
        )}
      </div>
      {open && (
        <form
          className="mt-2 flex flex-wrap gap-2 ps-7"
          onSubmit={(e) => {
            e.preventDefault();
            void act({ person, step: s.id, note }).then(() => setOpen(false));
          }}
        >
          <input className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder={s.needsNote ? "What was done (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
          <button type="submit" className={primaryBtn} disabled={s.needsNote && note.trim().length < 3}>
            Record
          </button>
        </form>
      )}
    </li>
  );
}

export function OffboardingPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const [v, setV] = useState<OffboardingView | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call(user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user]);
  useEffect(() => {
    if (ready && user) void load();
  }, [ready, user, load]);
  if (!user) return null;
  const act = async (a: OffAction) => {
    setError("");
    try {
      setV(await call(user.id, { method: "POST", body: JSON.stringify(a) }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <Link href="/people" className="text-sm text-muted hover:text-ink">
          ← People
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Leaving and renewals</h1>
        <p className="mt-1 text-sm text-muted">A checklist starts by itself when someone&rsquo;s leaving is approved in the HR record. Each step is done by the person who owns it and kept in the record.</p>
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {!v && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && (
          <>
            <section className="mt-6">
              <h2 className="font-display text-2xl">Contracts ending in the next {v.renewalDays} days</h2>
              {v.renewals.length === 0 ? (
                <p className="mt-2 text-sm text-muted">None.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line rounded-2xl border border-line bg-surface px-4">
                  {v.renewals.map((r) => (
                    <li key={r.person} className="flex flex-wrap items-center gap-2 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="font-semibold">{r.name}</span> <span className="text-muted">· {r.title}{r.supervisor ? ` · supervisor ${r.supervisor}` : ""}</span>
                      </span>
                      <Pill tone={r.overdue ? "clay" : "ochre"}>{r.overdue ? `Ended ${r.contractEnd}` : `Ends ${r.contractEnd}`}</Pill>
                    </li>
                  ))}
                </ul>
              )}
              {v.renewals.length > 0 && <p className="mt-2 text-xs text-muted">Renew by proposing a new contract end date in the person&rsquo;s record, or propose their leaving.</p>}
            </section>
            <section className="mt-8">
              <h2 className="font-display text-2xl">Leaving</h2>
              {v.leavers.length === 0 && <p className="mt-2 text-sm text-muted">Nobody is leaving.</p>}
              {v.leavers.map((o) => {
                const done = o.steps.filter((s) => s.done).length;
                return (
                  <article key={o.person} className="mt-3 rounded-2xl border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 flex-1 font-semibold">
                        {o.name} <span className="font-normal text-muted">· {o.title}</span>
                      </h3>
                      <Pill tone={done === o.steps.length ? "forest" : "ochre"}>{done === o.steps.length ? "Done" : `${done} of ${o.steps.length}`}</Pill>
                    </div>
                    <p className="text-xs text-muted">
                      Last day {o.effective}
                      {o.reason ? ` · ${o.reason}` : ""}
                    </p>
                    {o.payout && (
                      <p className={`mt-2 rounded-xl px-3 py-2 text-sm ${o.payout.rule.rule === "unset" ? "bg-ochre-soft text-ochre" : "bg-mist"}`}>
                        <span className="font-semibold">Unused annual leave: </span>
                        {o.payout.amount !== null ? `${o.payout.currency} ${o.payout.amount.toLocaleString("en-US")}. ` : ""}
                        {o.payout.note}
                      </p>
                    )}
                    <ul className="mt-2 divide-y divide-line">
                      {o.steps.map((s) => (
                        <Step key={s.id} person={o.person} s={s} act={act} />
                      ))}
                    </ul>
                  </article>
                );
              })}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
