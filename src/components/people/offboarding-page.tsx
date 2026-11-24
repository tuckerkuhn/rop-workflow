"use client";

import { plainError } from "@/lib/plain-error";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead, StatusBlock } from "@/components/workspace/ledger";
import { OFF_OWNER_LABEL, type OffAction } from "@/lib/offboarding";
import type { OffboardingView } from "@/server/offboarding-view";

/** People leaving (from approved departures in the HR record) and contracts ending soon. */

/** Contracts: the person, then the end date; on a phone they stack. */
const RENEW = "minmax(0,1fr) 11rem";
const link = "inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline";

async function call(user: string, init?: RequestInit): Promise<OffboardingView> {
  const res = await fetch("/api/offboarding", { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as OffboardingView;
}

function Step({ n, first, person, s, act, fmt }: { n: number; first: boolean; person: string; s: OffboardingView["leavers"][number]["steps"][number]; act: (a: OffAction) => Promise<void>; fmt: (iso: string) => string }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  return (
    <LedgerRow cols="minmax(0,1fr)" n={n} first={first} className="text-sm">
      <div className="min-w-0">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <span aria-hidden className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center text-xs ${s.done ? "bg-forest text-paper" : "border border-line-strong"}`}>
            {s.done ? "✓" : ""}
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">
              {s.title} <span className="font-normal text-muted">· {OFF_OWNER_LABEL[s.owner]}</span>
            </p>
            {s.done ? (
              <p className="text-xs text-muted">
                {s.done.byName}, <span className="font-mono tabular-nums">{fmt(s.done.at)}</span>
                {s.done.note ? `: ${s.done.note}` : ""}
              </p>
            ) : (
              <p className="text-xs text-muted">{s.help}</p>
            )}
          </div>
          {s.canDo && !open && (
            <button type="button" className={`${quietBtn} min-h-11`} onClick={() => setOpen(true)}>
              Done
            </button>
          )}
        </div>
        {open && (
          <form
            className="mt-2 flex flex-wrap gap-2 ps-8"
            onSubmit={(e) => {
              e.preventDefault();
              void act({ person, step: s.id, note }).then(() => setOpen(false));
            }}
          >
            <input className="min-h-11 min-w-0 flex-1 border border-line bg-paper px-3 py-2 text-base" placeholder={s.needsNote ? "What was done (required)" : "Note (optional)"} value={note} onChange={(e) => setNote(e.target.value)} />
            <button type="submit" className={primaryBtn} disabled={s.needsNote && note.trim().length < 3}>
              Record
            </button>
          </form>
        )}
      </div>
    </LedgerRow>
  );
}

export function OffboardingPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { date } = useT();
  const fmt = (iso: string) => date(iso.slice(0, 10), { day: "numeric", month: "short", year: "numeric" });
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
  // The one contract to look at first: the first that has already ended.
  const overdue = v?.renewals.find((r) => r.overdue)?.person;
  // In each checklist, the next step the reader can do; the reason is said under the first one shaded.
  const nextStep = (o: OffboardingView["leavers"][number]) => o.steps.find((s) => !s.done && s.canDo)?.id;
  const firstShaded = v?.leavers.find((o) => nextStep(o))?.person;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <PageHead
          back={{ href: "/people", label: "People" }}
          title="Leaving and renewals"
          actions={
            <Link href="/onboarding" className={link}>
              Starting at ROP →
            </Link>
          }
        >
          A checklist starts by itself when someone&rsquo;s leaving is approved in the HR record. Each step is done by the person who owns it and kept in the record.
        </PageHead>
        {error && <p className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {!v && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {v && (
          <>
            <section>
              <SectionHead>Contracts ending in the next {v.renewalDays} days</SectionHead>
              {v.renewals.length === 0 ? (
                <Empty>None.</Empty>
              ) : (
                <LedgerTable cols={RENEW} head={["Person", "Contract end"]} label="Contracts ending">
                  {v.renewals.map((r) => (
                    <LedgerRow key={r.person} cols="minmax(0,1fr)" first={r.person === overdue} className="text-sm">
                      <div className="grid gap-x-3 gap-y-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
                        <span className="min-w-0">
                          <span className="font-semibold">{r.name}</span> <span className="text-muted">· {r.title}{r.supervisor ? ` · supervisor ${r.supervisor}` : ""}</span>
                        </span>
                        <span>
                          <StatusBlock tone={r.overdue ? "clay" : "ochre"}>{r.overdue ? `Ended ${fmt(r.contractEnd)}` : `Ends ${fmt(r.contractEnd)}`}</StatusBlock>
                        </span>
                        {v.isHr && (
                          <span className="flex flex-wrap gap-2 sm:col-span-2">
                            <Link href={`/people?person=${encodeURIComponent(r.person)}&change=contractEnd`} className={primaryBtn}>
                              Renew
                            </Link>
                            <Link href={`/people?person=${encodeURIComponent(r.person)}&change=leave`} className={quietBtn}>
                              Record leaving
                            </Link>
                          </span>
                        )}
                      </div>
                    </LedgerRow>
                  ))}
                </LedgerTable>
              )}
              {overdue && <p className="mt-2 text-xs text-muted">The shaded row is a contract that has already ended.</p>}
              {v.renewals.length > 0 && (
                <p className="mt-2 text-xs text-muted">
                  {v.isHr ? "Renew proposes a new contract end date; Record leaving proposes their departure. Both are signed as usual." : "HR renews a contract or records the person's leaving in the HR record."}
                </p>
              )}
            </section>
            <section>
              <SectionHead>Leaving</SectionHead>
              {v.leavers.length === 0 && <Empty>Nobody is leaving.</Empty>}
              {v.leavers.map((o) => {
                const done = o.steps.filter((s) => s.done).length;
                const next = nextStep(o);
                return (
                  <article key={o.person} className="mt-6 font-ledger">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="min-w-0 flex-1 text-lg font-bold">
                        {o.name} <span className="font-normal text-muted">· {o.title}</span>
                      </h3>
                      <StatusBlock tone={done === o.steps.length ? "forest" : "ochre"}>{done === o.steps.length ? "Done" : `${done} of ${o.steps.length}`}</StatusBlock>
                    </div>
                    <p className="text-sm text-muted">
                      Last day <Fig className="text-start">{fmt(o.effective)}</Fig>
                      {o.reason ? ` · ${o.reason}` : ""}
                    </p>
                    {o.payout && (
                      <p className={`mt-2 px-3 py-2 text-sm ${o.payout.rule.rule === "unset" ? "bg-ochre-soft text-warn" : "bg-mist"}`}>
                        <span className="font-semibold">Unused annual leave: </span>
                        {o.payout.amount !== null ? (
                          <>
                            <Fig className="text-start">{`${o.payout.currency} ${o.payout.amount.toLocaleString("en-US")}`}</Fig>.{" "}
                          </>
                        ) : (
                          ""
                        )}
                        {o.payout.note}
                      </p>
                    )}
                    <LedgerTable cols="2.25rem minmax(0,1fr)" head={["", "Step"]} label={`${o.name}: leaving checklist`}>
                      {o.steps.map((s, i) => (
                        <Step key={s.id} n={i + 1} first={s.id === next} person={o.person} s={s} act={act} fmt={fmt} />
                      ))}
                    </LedgerTable>
                    {next && o.person === firstShaded && <p className="mt-2 text-xs text-muted">The shaded row is the next step you can do.</p>}
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
