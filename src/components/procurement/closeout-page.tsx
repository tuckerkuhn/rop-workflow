"use client";

import { acct, storeNames, opening } from "@/lib/file-store";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useT } from "@/components/app/i18n";
import { BankReconciliation } from "@/components/procurement/bank-reconciliation";
import { useRequireUser, useSession } from "@/components/app/session";
import { useCloseouts, useProcurements } from "@/components/app/use-project-data";
import { TopBar, primaryBtn, Loading, StatusPill } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead, StatusBlock } from "@/components/workspace/ledger";
import { blockers, fromBill, fromProcurement, monthsOf, total, type VoucherItem } from "@/lib/closeout";
import type { Bill } from "@/lib/bills";
import { procRolesFor, stepById } from "@/lib/procurement";
import { today } from "@/lib/clock";

/**
 * Monthly closeout: every expense voucher by month, with its SharePoint and NetSuite records.
 * Finance closes a month once all of them are filed and posted.
 */
/** Voucher, item, payee, amount, where it is filed, where it is posted, status. */
const COLS = "7rem minmax(10rem,1.4fr) minmax(7rem,1fr) 8rem 6rem 7rem 9rem";
/** A voucher still stopping its month from closing: not finished, not filed or not posted. */
const stillOpen = (p: VoucherItem) => !p.filed || !p.voucher?.sharepointUrl || !p.voucher.netsuiteRef.trim();

export function CloseoutPage() {
  const { user } = useRequireUser();
  const { project } = useCurrentProject();
  const { money } = useSession();
  const { date, t } = useT();
  const procs = useProcurements(project.id);
  const closeouts = useCloseouts(project.saved ? project.id : null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [bills, setBills] = useState<Bill[]>([]);
  const [billsFailed, setBillsFailed] = useState(false);
  useEffect(() => {
    if (!user || !project.saved) return;
    fetch(`/api/projects/${project.id}/bills`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? (r.json() as Promise<{ items: Bill[] }>) : Promise.reject(new Error(String(r.status)))))
      .then((v) => {
        setBills(v.items ?? []);
        setBillsFailed(false);
      })
      // A failed load is said, never shown as an empty list.
      .catch(() => setBillsFailed(true));
  }, [user, project.id, project.saved]);

  if (!user) return null;
  const canClose = procRolesFor(user).includes("finance") || !!user.admin;
  // Vouchers from procurements and from bills paid directly.
  const months = monthsOf([...procs.items.flatMap((p) => fromProcurement(p, stepById[p.step]?.title ?? p.step)), ...bills.map(fromBill)]);
  const monthName = (m: string) => date(`${m}-01`, { month: "long", year: "numeric" });

  return (
    <div className="min-h-screen">
      <TopBar active="procurement" />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <PageHead kicker={project.name} title="Month close">
          Expense vouchers by month, from procurements and from bills paid directly, with where each is filed in {storeNames()} and posted in {acct()}. Finance closes a month once every voucher in it is filed and posted, then reconciles each bank account and locks the month.
          <span className="mt-2 block">
          <Link href="/work?source=procurement" className="font-semibold text-forest hover:underline">
            Procurements in progress
          </Link>{" "}
          ·{" "}
          <Link href="/work/bills" className="font-semibold text-forest hover:underline">
            Bills paid directly
          </Link>
          {project.saved && (
            <>
              {" "}
              ·{" "}
              <a href="#bank" className="font-semibold text-forest hover:underline">
                Bank reconciliation
              </a>
            </>
          )}
          </span>
        </PageHead>
        {(error || closeouts.error) && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error || closeouts.error}
          </p>
        )}
        {billsFailed && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {t("closeout.loadFailed")}
          </p>
        )}
        {project.saved && <BankReconciliation code={project.id} user={user} />}
        {procs.status === "loading" && <Loading className="mt-6" />}
        {procs.status !== "loading" && !months.length && !billsFailed && !closeouts.error && <Empty className="mt-8">No expense vouchers yet. They appear here once Finance prepares them.</Empty>}
        {months.map(([m, list], mi) => {
          const closed = closeouts.months[m];
          const open = blockers(list);
          const ended = m < today().slice(0, 7);
          // Look first at the first voucher still stopping an open month from closing.
          const first = closed ? undefined : list.find(stillOpen)?.id;
          // Say why a row is shaded once on the page: under the first month that has one.
          const sayWhy = !!first && months.slice(0, mi).every(([pm, pl]) => closeouts.months[pm] || !pl.some(stillOpen));
          return (
            <section key={m}>
              <SectionHead
                aside={
                  closed ? (
                    <StatusBlock tone="forest">
                      Closed by {closed.name}, {date(closed.at)}
                    </StatusBlock>
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
                    <StatusBlock tone="ochre">Open</StatusBlock>
                  )
                }
              >
                {monthName(m)}
              </SectionHead>
              <p className="mt-1 font-mono text-xs text-muted">
                {list.length} {list.length === 1 ? "voucher" : "vouchers"} · <span className="tabular-nums">{money(total(list))}</span>
              </p>
              <div className="overflow-x-auto">
                <LedgerTable cols={`2.25rem ${COLS}`} head={["#", "Voucher", "Item", "Payee", { label: "Amount", end: true }, opening(storeNames()), opening(acct()), "Status"]} label={`Expense vouchers, ${monthName(m)}`} className="mt-3 min-w-[56rem]">
                  {list.map((p, k) => (
                    <LedgerRow key={p.id} n={k + 1} cols={COLS} first={p.id === first} className="text-sm">
                      <span className="font-mono text-xs">
                        <Link href={p.kind === "bill" ? "/work/bills" : `/work?source=procurement&open=${p.id.replace(/-P\d+$/, "")}`} className="text-forest hover:underline">
                          {p.voucher!.number}
                        </Link>
                      </span>
                      <span>
                        {p.title}
                        <span className="block font-mono text-xs text-muted">{p.kind === "bill" ? `Bill ${p.id}` : p.id}</span>
                      </span>
                      <span>{p.payee ?? "—"}</span>
                      <Fig>{money(p.amountUsd)}</Fig>
                      <span>
                        {p.voucher!.sharepointUrl ? (
                          <a href={p.voucher!.sharepointUrl} target="_blank" rel="noreferrer" className="text-forest hover:underline">
                            Open
                          </a>
                        ) : (
                          <span className="text-clay">Missing</span>
                        )}
                      </span>
                      <span className="font-mono text-xs">{p.voucher!.netsuiteRef || <span className="font-ledger text-sm text-clay">Missing</span>}</span>
                      <span className="text-xs">{p.filed ? <StatusPill tone="forest">Filed</StatusPill> : <span className="text-muted">{p.stage}</span>}</span>
                    </LedgerRow>
                  ))}
                </LedgerTable>
              </div>
              {sayWhy && <p className="mt-2 text-xs text-muted">The shaded voucher is the first one in an open month still to finish, file or post.</p>}
            </section>
          );
        })}
      </main>
    </div>
  );
}
