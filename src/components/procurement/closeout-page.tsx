"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { useRequireUser, useSession } from "@/components/app/session";
import { useCloseouts, useProcurements } from "@/components/app/use-project-data";
import { Pill, SectionLabel, TopBar, primaryBtn } from "@/components/workspace/ui";
import { blockers, fromBill, fromProcurement, monthsOf, total } from "@/lib/closeout";
import type { Bill } from "@/lib/bills";
import { procRolesFor, stepById } from "@/lib/procurement";
import { today } from "@/lib/clock";

/**
 * Monthly closeout: every expense voucher by month, with its SharePoint and NetSuite records.
 * Finance closes a month once all of them are filed and posted.
 */
export function CloseoutPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const { money } = useSession();
  const { date } = useT();
  const procs = useProcurements(project.id);
  const closeouts = useCloseouts(project.saved ? project.id : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  useEffect(() => {
    if (!user || !project.saved) return;
    fetch(`/api/projects/${project.id}/bills`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((v: { items: Bill[] } | null) => setBills(v?.items ?? []))
      .catch(() => setBills([]));
  }, [user, project.id, project.saved]);

  if (!user) return null;
  const canClose = procRolesFor(user).includes("finance") || !!user.admin;
  // Vouchers from procurements and from bills paid directly.
  const months = monthsOf([...procs.items.map((p) => fromProcurement(p, stepById[p.step]?.title ?? p.step)), ...bills.map(fromBill)]);
  const monthName = (m: string) => date(`${m}-01`, { month: "long", year: "numeric" });

  return (
    <div className="min-h-screen">
      <TopBar active="procurement" />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{project.name}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Monthly closeout</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Expense vouchers by month, from procurements and from bills paid directly, with where each is filed in SharePoint and posted in NetSuite. Finance closes a month once every voucher in it is filed and posted.
        </p>
        <p className="mt-2 text-sm">
          <Link href="/tasks?source=procurement" className="font-semibold text-forest hover:underline">
            Procurements in progress
          </Link>{" "}
          ·{" "}
          <Link href="/tasks/bills" className="font-semibold text-forest hover:underline">
            Bills paid directly
          </Link>
        </p>
        {(error || closeouts.error) && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error || closeouts.error}
          </p>
        )}
        {!months.length && <p className="mt-10 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">No expense vouchers yet. They appear here once Finance prepares them.</p>}
        {months.map(([m, list]) => {
          const closed = closeouts.months[m];
          const open = blockers(list);
          const ended = m < today().slice(0, 7);
          return (
            <section key={m} className="mt-8">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <SectionLabel>{monthName(m)}</SectionLabel>
                  <p className="mt-1 text-sm text-muted">
                    {list.length} {list.length === 1 ? "voucher" : "vouchers"} · <span className="tabular-nums">{money(total(list))}</span>
                  </p>
                </div>
                {closed ? (
                  <Pill tone="forest">
                    Closed by {closed.name}, {date(closed.at)}
                  </Pill>
                ) : canClose ? (
                  <div className="text-end">
                    <button
                      type="button"
                      disabled={!ended || open.length > 0 || busy === m}
                      onClick={async () => {
                        setBusy(m);
                        setError("");
                        try {
                          await closeouts.close(m);
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        } finally {
                          setBusy(null);
                        }
                      }}
                      className={primaryBtn}
                    >
                      Close {monthName(m)}
                    </button>
                    <p className="mt-1 text-xs text-muted">{!ended ? "Closes after the month ends." : open.length ? `${open.length} still open below.` : "Everything is filed and posted."}</p>
                  </div>
                ) : (
                  <Pill tone="ochre">Open</Pill>
                )}
              </div>
              <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
                <table className="w-full min-w-[48rem] text-sm">
                  <thead className="bg-sunken text-xs text-muted">
                    <tr>
                      {["Voucher", "Item", "Payee", "Amount", "SharePoint", "NetSuite", "Status"].map((h) => (
                        <th key={h} className="px-3 py-2 text-start font-medium">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p) => (
                      <tr key={p.id} className="border-t border-line align-top">
                        <td className="px-3 py-2 font-mono text-xs">
                          <Link href={p.kind === "bill" ? "/tasks/bills" : `/tasks?source=procurement&open=${p.id}`} className="text-forest hover:underline">
                            {p.voucher!.number}
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          {p.title}
                          <span className="block text-xs text-muted">{p.kind === "bill" ? `Bill ${p.id}` : p.id}</span>
                        </td>
                        <td className="px-3 py-2">{p.payee ?? "—"}</td>
                        <td className="px-3 py-2 tabular-nums">{money(p.amountUsd)}</td>
                        <td className="px-3 py-2">
                          {p.voucher!.sharepointUrl ? (
                            <a href={p.voucher!.sharepointUrl} target="_blank" rel="noreferrer" className="text-forest hover:underline">
                              Open
                            </a>
                          ) : (
                            <span className="text-clay">Missing</span>
                          )}
                        </td>
                        <td className="px-3 py-2">{p.voucher!.netsuiteRef || <span className="text-clay">Missing</span>}</td>
                        <td className="px-3 py-2 text-xs">{p.filed ? <Pill tone="forest">Filed</Pill> : <span className="text-muted">{p.stage}</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          );
        })}
      </main>
    </div>
  );
}
