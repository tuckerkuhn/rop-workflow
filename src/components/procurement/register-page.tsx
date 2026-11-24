"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser } from "@/components/app/session";
import { useProcurements } from "@/components/app/use-project-data";
import { Loading, NoAccess, TopBar, primaryBtn } from "@/components/workspace/ui";
import { Empty, Fig, Figures, LedgerRow, LedgerTable, PageHead, StatusBlock } from "@/components/workspace/ledger";

const COLS = "2.25rem 1.4fr 1.1fr 1.1fr 1fr 6rem 1fr 1.2fr";
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
        <PageHead
          kicker={project.name}
          title="Procurement register"
          meta={rows.length ? `${totals.count} ${totals.count === 1 ? "purchase" : "purchases"}` : undefined}
          actions={
            <button type="button" className={primaryBtn} disabled={!rows.length} onClick={() => download(rows, project.id, month)}>
              Download as a spreadsheet
            </button>
          }
        >
          Every purchase on one page: who asked, who approved, how the supplier was chosen, the order, goods received, payment and the documents filed. Donors and auditors ask for this report. It is read from the purchase records, so nothing is typed twice.
          <span className="mt-2 flex flex-wrap gap-4">
            <Link href="/work?source=procurement" className="font-semibold text-forest hover:underline">
              Procurement
            </Link>
            <Link href="/work/suppliers" className="font-semibold text-forest hover:underline">
              Suppliers
            </Link>
          </span>
        </PageHead>

        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="font-mono text-xs text-muted">Show</span>
            <select className="mt-1 block min-h-12 border border-line bg-paper px-3 text-base" value={month} onChange={(e) => setMonth(e.target.value)}>
              <option value="">Every purchase</option>
              {months.map((m) => (
                <option key={m} value={m}>
                  Report for {monthName(m)}
                </option>
              ))}
            </select>
          </label>
          {month && <p className="max-w-xl pb-3 text-sm text-muted">The month&apos;s report lists purchases that moved in {monthName(month)} and those still open at its end.</p>}
        </div>

        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {status === "loading" && <Loading className="mt-6" />}
        {status !== "loading" && !rows.length && <Empty className="mt-6">No purchases yet. Each request made under Procurement appears here.</Empty>}

        {rows.length > 0 && (
          <>
            <Figures
              items={[
                { label: "Purchases", value: totals.count },
                { label: "Value", value: usd(totals.valueUsd) },
                { label: "Open", value: totals.open },
                { label: "Closed", value: totals.closed },
                ...(totals.withIssues ? [{ label: "With an open issue", value: totals.withIssues, tone: "clay" as const }] : []),
              ]}
            />
            <div className="overflow-x-auto">
              <LedgerTable cols={COLS} head={["#", "Purchase", "Asked and approved", "How bought", "Order and goods", "Value", "Paid", "Where it stands"]} label="Procurement register" className="mt-4 min-w-[60rem]">
                {rows.map((r, i) => (
                  <LedgerRow key={r.id} cols={COLS} first={r.id === oldest} className="text-sm">
                    <span className="pt-0.5 font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                    <span>
                      <Link href={`/work?source=procurement&open=${encodeURIComponent(r.id)}`} className="font-mono text-xs text-forest hover:underline">
                        {r.id}
                      </Link>
                      <span className="block font-semibold">{r.title}</span>
                      <span className="block font-mono text-xs text-muted">
                        Line {r.budgetLine} · {r.level}
                      </span>
                    </span>
                    <span>
                      <span className="block">{r.requestedBy || "Not yet submitted"}</span>
                      <span className="block font-mono text-xs text-muted">{r.requested ? `Asked ${day(r.requested)}` : ""}</span>
                      <span className="block font-mono text-xs text-muted">{r.approved ? `Approved ${day(r.approved)}` : "Not yet approved"}</span>
                    </span>
                    <span>
                      <span className="block">{r.route || "Not chosen yet"}</span>
                      {r.quotes > 0 && <span className="block text-xs text-muted">{r.quotes === 1 ? "1 quote or bid" : `${r.quotes} quotes or bids`}</span>}
                      {r.supplier && <span className="block text-xs">{r.supplier}</span>}
                    </span>
                    <span className="font-mono text-xs">
                      <span className="block">{r.ordered ? `Signed ${day(r.ordered)}` : <span className="text-muted">No order yet</span>}</span>
                      <span className="block">{r.received ? `Received ${day(r.received)}` : <span className="text-muted">Not received</span>}</span>
                      <span className="block text-muted">{r.documents === 1 ? "1 document filed" : `${r.documents} documents filed`}</span>
                    </span>
                    <Fig strong>{usd(r.valueUsd)}</Fig>
                    <span className="text-xs">
                      {r.payments ? (
                        <>
                          <span className="block">{r.payments === 1 ? "1 payment" : `${r.payments} payments`}</span>
                          <span className="block font-mono text-muted">Last {day(r.lastPaid)}</span>
                          {r.vouchers && <span className="block font-mono text-muted">{r.vouchers}</span>}
                        </>
                      ) : (
                        <span className="text-muted">Not paid</span>
                      )}
                    </span>
                    <span className="text-xs">
                      {r.closed ? <StatusBlock tone="forest">Closed</StatusBlock> : <span className="block">{r.status}</span>}
                      {r.openIssues > 0 && <span className="mt-1 block font-semibold text-clay">{r.openIssues === 1 ? "1 open issue" : `${r.openIssues} open issues`}</span>}
                      {r.lastActivity && <span className="block font-mono text-muted">Last moved {day(r.lastActivity)}</span>}
                    </span>
                  </LedgerRow>
                ))}
              </LedgerTable>
            </div>
            {oldest && <p className="mt-2 text-xs text-muted">The shaded row is the open purchase that has gone longest without moving.</p>}
          </>
        )}
      </main>
    </div>
  );
}
