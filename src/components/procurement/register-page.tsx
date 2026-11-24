"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser } from "@/components/app/session";
import { useProcurements } from "@/components/app/use-project-data";
import { Loading, NoAccess, TopBar, primaryBtn } from "@/components/workspace/ui";
import { registerCsv, registerMonths, registerRows, registerTotals, type RegisterRow } from "@/lib/procurement-register";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const monthName = (m: string) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const day = (d: string) => (d ? new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

function download(rows: RegisterRow[], project: string, month: string) {
  const url = URL.createObjectURL(new Blob([`﻿${registerCsv(rows)}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `procurement-register-${project}-${month || new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * The procurement register: every purchase on one page, read from the records, with a monthly
 * report and a spreadsheet download for a donor or an auditor (lib/procurement-register).
 */
export function ProcurementRegisterPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const { items, status, error } = useProcurements(project.id);
  const [month, setMonth] = useState("");
  const months = useMemo(() => registerMonths(items), [items]);
  const rows = useMemo(() => registerRows(items, month || undefined), [items, month]);
  const totals = registerTotals(rows);
  // Look first at the open purchase that has waited longest since it last moved.
  const oldest = rows.filter((r) => !r.closed).sort((a, b) => (a.lastActivity || "").localeCompare(b.lastActivity || ""))[0]?.id;

  if (!user) return null;
  if (user.procurementAccess === "none") return <NoAccess what="Procurement" />;

  return (
    <div className="min-h-screen">
      <TopBar active="procurement" />
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">{project.name}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Procurement register</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Every purchase on one page: who asked, who approved, how the supplier was chosen, the order, goods received, payment and the documents filed. Donors and auditors ask for this report. It is read from the purchase records, so nothing is typed twice.
        </p>
        <p className="mt-2 flex flex-wrap gap-4 text-sm">
          <Link href="/work?source=procurement" className="font-semibold text-forest hover:underline">
            Procurement
          </Link>
          <Link href="/work/suppliers" className="font-semibold text-forest hover:underline">
            Suppliers
          </Link>
        </p>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="font-semibold">Show</span>
            <select className="mt-1 block min-h-12 rounded-xl border border-line bg-paper px-3 text-base" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Every purchase</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  Report for {monthName(m)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className={primaryBtn} disabled={!rows.length} onClick={() => download(rows, project.id, month)}>
            Download as a spreadsheet
          </button>
        </div>
        {month && <p className="mt-2 max-w-3xl text-sm text-muted">The month&apos;s report lists purchases that moved in {monthName(month)} and those still open at its end.</p>}

        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {status === "loading" && <Loading className="mt-6" />}
        {status !== "loading" && !rows.length && <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">No purchases yet. Each request made under Procurement appears here.</p>}

        {rows.length > 0 && (
          <>
            <p className="mt-5 text-sm">
              {totals.count} {totals.count === 1 ? "purchase" : "purchases"} worth {usd(totals.valueUsd)}: {totals.open} open and {totals.closed} closed
              {totals.withIssues ? `. ${totals.withIssues} with an open issue.` : "."}
            </p>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full min-w-[56rem] text-left text-sm">
                <thead className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="px-3 py-2 font-semibold">#</th>
                    <th className="px-3 py-2 font-semibold">Purchase</th>
                    <th className="px-3 py-2 font-semibold">Asked and approved</th>
                    <th className="px-3 py-2 font-semibold">How bought</th>
                    <th className="px-3 py-2 font-semibold">Order and goods</th>
                    <th className="px-3 py-2 text-right font-semibold">Value</th>
                    <th className="px-3 py-2 font-semibold">Paid</th>
                    <th className="px-3 py-2 font-semibold">Where it stands</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={r.id} className={`border-b border-line align-top last:border-0 ${r.id === oldest ? "bg-ochre-soft" : ""}`}>
                      <td className="px-3 py-2 tabular-nums text-muted">{i + 1}</td>
                      <td className="px-3 py-2">
                        <Link href={`/work?source=procurement&open=${encodeURIComponent(r.id)}`} className="font-mono text-xs text-forest hover:underline">
                          {r.id}
                        </Link>
                        <span className="block font-medium">{r.title}</span>
                        <span className="block text-xs text-muted">
                          Line {r.budgetLine} · {r.level}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="block">{r.requestedBy || "Not yet submitted"}</span>
                        <span className="block text-xs text-muted">{r.requested ? `Asked ${day(r.requested)}` : ""}</span>
                        <span className="block text-xs text-muted">{r.approved ? `Approved ${day(r.approved)}` : "Not yet approved"}</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className="block">{r.route || "Not chosen yet"}</span>
                        {r.quotes > 0 && <span className="block text-xs text-muted">{r.quotes === 1 ? "1 quote or bid" : `${r.quotes} quotes or bids`}</span>}
                        {r.supplier && <span className="block text-xs">{r.supplier}</span>}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className="block">{r.ordered ? `Signed ${day(r.ordered)}` : <span className="text-muted">No order yet</span>}</span>
                        <span className="block">{r.received ? `Received ${day(r.received)}` : <span className="text-muted">Not received</span>}</span>
                        <span className="block text-muted">{r.documents === 1 ? "1 document filed" : `${r.documents} documents filed`}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{usd(r.valueUsd)}</td>
                      <td className="px-3 py-2 text-xs">
                        {r.payments ? (
                          <>
                            <span className="block">{r.payments === 1 ? "1 payment" : `${r.payments} payments`}</span>
                            <span className="block text-muted">Last {day(r.lastPaid)}</span>
                            {r.vouchers && <span className="block font-mono text-muted">{r.vouchers}</span>}
                          </>
                        ) : (
                          <span className="text-muted">Not paid</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span className={`block ${r.closed ? "font-semibold text-leaf" : ""}`}>{r.status}</span>
                        {r.openIssues > 0 && <span className="block font-semibold text-clay">{r.openIssues === 1 ? "1 open issue" : `${r.openIssues} open issues`}</span>}
                        {r.lastActivity && <span className="block text-muted">Last moved {day(r.lastActivity)}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {oldest && <p className="mt-2 text-xs text-muted">The shaded row is the open purchase that has gone longest without moving.</p>}
          </>
        )}
      </main>
    </div>
  );
}
