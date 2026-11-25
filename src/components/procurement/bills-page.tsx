"use client";

import { AnyLinkCaution } from "@/components/app/any-link-caution";
import { acct, storeNames, opening } from "@/lib/file-store";
import { plainError } from "@/lib/plain-error";
import { NON_CONTRACT } from "@/lib/timesheet";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { SelfConfirmSheet } from "@/components/app/self-confirm";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { TopBar, dangerBtn, primaryBtn, quietBtn, Loading } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead, Sheet, StatusBlock } from "@/components/workspace/ledger";
import { BILL_CATEGORIES, BILL_CATEGORY_KEYS, type BillAction, type BillCategory } from "@/lib/bills";
import type { Receipt } from "@/lib/expense";
import { longDate } from "@/lib/weekly";
import type { BillsView } from "@/app/api/projects/[code]/bills/route";

/**
 * Bills paid directly, outside procurement: record it with the document, management approves,
 * Finance prepares the voucher, and it counts in the monthly closeout.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
  return body as T;
}

const input = "mt-1 block min-h-11 w-full border border-line-strong bg-paper px-3 py-2.5 text-base";
const money = (n: number, c: string) => (c === "AFN" ? `${Math.round(n).toLocaleString("en-US")} AFN` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const STATUS = { waiting: { tone: "ochre", text: "Waiting for approval" }, approved: { tone: "sky", text: "Approved: voucher to prepare" }, returned: { tone: "clay", text: "Sent back" }, filed: { tone: "forest", text: "Filed and posted" } } as const;
/** The bill, then its amount: narrow enough that a phone keeps both side by side. */
const COLS = "minmax(0,1fr) auto";

export function BillsPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<BillsView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  // A bill sent back that is being corrected: the form opens with what was recorded and its document.
  const [redo, setRedo] = useState<Item | null>(null);
  const url = `/api/projects/${project.id}/bills`;

  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call<BillsView>(url, user.id));
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, url]);
  useEffect(() => {
    if (ready && user && project.saved) void load();
  }, [ready, user, project.saved, load]);

  if (!user) return null;
  // Look first at the bill that has waited longest for approval.
  const oldest = v?.items.filter((b) => b.status === "waiting").sort((a, b) => a.raised.at.localeCompare(b.raised.at))[0]?.id;
  const act = async (a: BillAction, msg: string) => {
    setError("");
    try {
      setV(await call<BillsView>(url, user.id, { method: "POST", body: JSON.stringify(a) }));
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };

  return (
    <div className="min-h-screen">
      <TopBar active="procurement" />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <PageHead kicker={project.name} title="Bills paid directly" meta={v ? `${v.items.length} ${v.items.length === 1 ? "bill" : "bills"}` : undefined}>
          Rent, utilities, internet and phones, insurance, and services under an agreement. Record the bill with its document; programme management approves; Finance prepares the voucher. A one-off purchase of goods or services goes through procurement instead.
          <span className="mt-2 flex flex-wrap gap-4">
            <Link href="/work/closeout" className="font-semibold text-forest hover:underline">
              Month close
            </Link>
            <Link href="/work?source=procurement" className="font-semibold text-forest hover:underline">
              Procurement
            </Link>
          </span>
        </PageHead>
        {!project.saved && <Empty className="mt-6">Choose a project saved in the database (for example ACRP).</Empty>}
        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {!v && !error && <Loading className="mt-6" />}
        {v && (
          <>
            {!v.record ? (
              <p className="mt-6 bg-sunken px-4 py-3 text-sm text-muted">Bills are recorded by Finance and by people named for bill entry. Give the bill to Finance.</p>
            ) : redo ? (
              <AddBill key={redo.id} v={v} from={redo} onClose={() => setRedo(null)} add={(a) => act(a, `Recorded again in place of ${redo.id}. It goes to programme management for approval.`).then(() => setRedo(null))} />
            ) : adding ? (
              <AddBill v={v} onClose={() => setAdding(false)} add={(a) => act(a, "Recorded. It goes to programme management for approval.").then(() => setAdding(false))} />
            ) : (
              <button type="button" className={`${primaryBtn} mt-6`} onClick={() => setAdding(true)}>
                Record a bill
              </button>
            )}
            <section>
              <SectionHead>Bills</SectionHead>
              {!v.items.length ? (
                <Empty>No bills yet.</Empty>
              ) : (
                <>
                  <LedgerTable cols={`2.25rem ${COLS}`} head={["#", "Bill", { label: "Amount", end: true }]} label="Bills paid directly">
                    {v.items.map((b, k) => (
                      <BillRow key={b.id} n={k + 1} first={b.id === oldest} b={b} v={v} act={act} onRedo={() => (setNotice(""), setAdding(false), setRedo(b))} />
                    ))}
                  </LedgerTable>
                  {oldest && <p className="mt-2 text-xs text-muted">The shaded bill is the one that has waited longest for approval.</p>}
                </>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

type Item = BillsView["items"][number];

function BillRow({ b, v, act, n, first, onRedo }: { b: Item; v: BillsView; act: (a: BillAction, msg: string) => Promise<void>; n: number; first: boolean; onRedo: () => void }) {
  const { user } = useSession();
  const { t, tx } = useT();
  const [selfing, setSelfing] = useState(false);
  const [back, setBack] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [voucher, setVoucher] = useState({ number: b.voucher?.number ?? "", month: b.voucher?.month ?? b.invoiceDate.slice(0, 7), sharepointUrl: b.voucher?.sharepointUrl ?? "", netsuiteRef: b.voucher?.netsuiteRef ?? "" });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };
  const label = (id: string) => v.sources.find((s) => s.id === id)?.label ?? id;
  return (
    <LedgerRow n={n} first={first} cols={COLS}>
      <article className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBlock tone={STATUS[b.status].tone}>{STATUS[b.status].text}</StatusBlock>
          <span className="font-mono text-xs text-muted">{b.id}</span>
        </div>
        <h3 className="mt-1 font-semibold">
          {b.payee}: {b.description}
        </h3>
        <p className="text-sm text-muted">
          Invoice <span className="font-mono">{b.invoiceNumber}</span>, <span className="font-mono">{b.invoiceDate}</span> · {BILL_CATEGORIES[b.category].label} (GL <span className="font-mono">{BILL_CATEGORIES[b.category].gl}</span>) · {label(b.source)}
          {b.budgetLine ? (
            <>
              {" · line "}
              <span className="font-mono">{b.budgetLine}</span>
            </>
          ) : (
            ""
          )}
          {b.contractRef ? ` · under ${b.contractRef}` : ""}
        </p>
        <button type="button" onClick={() => void openReceipt(b.file.hash, user?.id)} className="inline-flex min-h-11 items-center text-sm font-semibold text-forest hover:underline">
          📎 {b.file.name}
        </button>
        <p className="text-xs text-muted">{b.timeline.map((t) => `${t.date}: ${t.what} (${t.who})`).join(" · ")}</p>
        {b.flags.length > 0 && b.status !== "filed" && (
          <ul className="mt-2 space-y-1 bg-ochre-soft px-3 py-2 text-sm text-warn">
            {b.flags.map((f) => (
              <li key={f}>⚠ {f}</li>
            ))}
          </ul>
        )}
        {b.status === "returned" && b.returned && (
          <div className="mt-2 bg-clay-soft px-3 py-2 text-sm">
            <p>{tx("{name} sent this bill back on {date}: {note}", { name: b.returned.name, date: longDate(b.returned.at), note: b.returned.note })}</p>
            {b.redoneAs ? (
              <p className="mt-1 text-muted">{tx("It was corrected and recorded again as {id}.", { id: b.redoneAs })}</p>
            ) : b.canRedo ? (
              <>
                <p className="mt-1">{tx("It will not be paid as it stands. Correct it and record it again. What was recorded and its document are kept, so nothing is typed twice.")}</p>
                <button type="button" className={`${primaryBtn} mt-2 min-h-12`} onClick={onRedo}>
                  {tx("Correct it and record it again")}
                </button>
              </>
            ) : (
              <p className="mt-1">{tx("It will not be paid as it stands. Finance corrects it and records it again.")}</p>
            )}
          </div>
        )}
        {b.status === "waiting" && !b.canApprove && !b.canSelfApprove && b.raised.by === v.me && <p className="mt-2 text-sm text-muted">Waiting for programme management; you recorded it, so someone else approves it.</p>}
        {b.canSelfApprove && (
          <div className="mt-3">
            <button type="button" disabled={busy} className={`${primaryBtn} min-h-12`} onClick={() => setSelfing(true)}>
              Approve for payment
            </button>
            {selfing && (
              <SelfConfirmSheet
                what={`${b.id} · ${b.payee} · ${money(b.amount, b.currency)}`}
                onCancel={() => setSelfing(false)}
                onConfirm={(self) => run(() => act({ action: "approve", id: b.id, self }, `Approved ${b.id}, marked self-approved.`)).finally(() => setSelfing(false))}
              />
            )}
          </div>
        )}
        {b.approval?.selfApproved && <p className="mt-2 text-xs font-semibold text-warn">{t("so.self")}{b.approval.soloNote ? `: ${b.approval.soloNote}` : ""}</p>}
        {b.canApprove &&
          (back === null ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} className={primaryBtn} onClick={() => void run(() => act({ action: "approve", id: b.id }, `Approved ${b.id}.`))}>
                Approve for payment
              </button>
              <button type="button" disabled={busy} className={quietBtn} onClick={() => setBack("")}>
                Send back
              </button>
            </div>
          ) : (
            <div className="mt-3">
              <input value={back} onChange={(e) => setBack(e.target.value)} placeholder="What needs to change?" className={input} aria-label="Why it is sent back" />
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={busy || back.trim().length < 3} className={dangerBtn} onClick={() => void run(() => act({ action: "return", id: b.id, note: back }, "Sent back.").then(() => setBack(null)))}>
                  Send back
                </button>
                <button type="button" className={quietBtn} onClick={() => setBack(null)}>
                  Cancel
                </button>
              </div>
            </div>
          ))}
        {b.canVoucher && (
          <Sheet className="mt-3 grid gap-2 sm:grid-cols-2">
            <p className="font-ledger text-sm font-bold sm:col-span-2">Expense voucher</p>
            <label className="text-sm">
              <span className="text-muted">Voucher number</span>
              <input value={voucher.number} onChange={(e) => setVoucher({ ...voucher, number: e.target.value })} className={input} />
            </label>
            <label className="text-sm">
              <span className="text-muted">Month it belongs to</span>
              <input type="month" value={voucher.month} onChange={(e) => setVoucher({ ...voucher, month: e.target.value })} className={input} />
            </label>
            <label className="text-sm">
              <span className="text-muted">{opening(storeNames())} link to the filed voucher</span>
              <input value={voucher.sharepointUrl} onChange={(e) => setVoucher({ ...voucher, sharepointUrl: e.target.value })} placeholder="https://…" className={input} />
              <AnyLinkCaution />
            </label>
            <label className="text-sm">
              <span className="text-muted">{opening(acct())} reference</span>
              <input value={voucher.netsuiteRef} onChange={(e) => setVoucher({ ...voucher, netsuiteRef: e.target.value })} className={input} />
            </label>
            <div className="sm:col-span-2">
              <button type="button" disabled={busy || !voucher.number.trim()} className={primaryBtn} onClick={() => void run(() => act({ action: "voucher", id: b.id, ...voucher }, `Voucher saved for ${b.id}.`))}>
                Save the voucher
              </button>
            </div>
          </Sheet>
        )}
      </article>
      <Fig strong>{money(b.amount, b.currency)}</Fig>
    </LedgerRow>
  );
}

/** `from`: a bill sent back, corrected here and recorded again as a new bill with the same document. */
function AddBill({ v, from, onClose, add }: { v: BillsView; from?: Item; onClose: () => void; add: (a: BillAction) => Promise<void> }) {
  const { user } = useSession();
  const { tx } = useT();
  // A bill recorded on a project's page starts as that project's: its budget line is then asked for.
  // A general and admin bill is one choice away.
  const { project } = useCurrentProject();
  const [f, setF] = useState(
    from
      ? { payee: from.payee, invoiceNumber: from.invoiceNumber, invoiceDate: from.invoiceDate, description: from.description, category: from.category, amount: String(from.amount), currency: from.currency, source: from.source, budgetLine: from.budgetLine ?? "", contractRef: from.contractRef ?? "" }
      : { payee: "", invoiceNumber: "", invoiceDate: new Date().toISOString().slice(0, 10), description: "", category: "rent" as BillCategory, amount: "", currency: "AFN" as "USD" | "AFN", source: v.sources.find((x) => x.id === project.id)?.id ?? v.sources[0]?.id ?? "non-contract", budgetLine: "", contractRef: "" },
  );
  const [file, setFile] = useState<Receipt | null>(from?.file ?? null);
  // The button that opens this form sits in the list below it: bring the form to the person.
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    if (from) top.current?.scrollIntoView({ block: "start" });
  }, [from]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const needsLine = (v.lines[f.source] ?? []).length > 0 && !f.budgetLine;
  // What still stops Record, said under the button so nobody has to guess.
  const missing = [!file && "the bill's photo or PDF", f.payee.trim().length < 2 && "who it is paid to", !f.invoiceNumber.trim() && "the invoice number", f.description.trim().length < 3 && "what it is for", !(Number(f.amount) > 0) && "the amount", needsLine && "the budget line"].filter((x): x is string => !!x);
  const ok = !missing.length;
  return (
    <section ref={top} className="scroll-mt-32">
      <SectionHead>{from ? tx("Correct {id} and record it again", { id: from.id }) : "Record a bill"}</SectionHead>
      {from?.returned && <p className="mt-3 bg-clay-soft px-3 py-2 text-sm">{tx("{name} sent it back: {note}", { name: from.returned.name, note: from.returned.note })}</p>}
      <Sheet className="mt-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="text-sm sm:col-span-2">
            <span className="font-medium">The bill (photo or PDF)</span>
            <label className={`${quietBtn} mt-1 block cursor-pointer text-center`}>
              {file ? `📎 ${file.name}` : "Choose or photograph the bill"}
              <input
                type="file"
                accept="image/*,application/pdf"
                capture="environment"
                className="sr-only"
                onChange={async (e) => {
                  const x = e.target.files?.[0];
                  if (!x) return;
                  setError("");
                  try {
                    const body = new FormData();
                    body.append("file", await shrink(x));
                    setFile(await call<Receipt>("/api/files", user?.id, { method: "POST", body }));
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                }}
              />
            </label>
          </div>
          <label className="text-sm">
            <span className="font-medium">Paid to</span>
            <input value={f.payee} onChange={(e) => set({ payee: e.target.value })} className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium">Invoice number</span>
            <input value={f.invoiceNumber} onChange={(e) => set({ invoiceNumber: e.target.value })} className={input} />
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="font-medium">What it is for</span>
            <input value={f.description} onChange={(e) => set({ description: e.target.value })} placeholder="Kabul office rent, November" className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium">Kind</span>
            <select value={f.category} onChange={(e) => set({ category: e.target.value as BillCategory })} className={input}>
              {BILL_CATEGORY_KEYS.map((k) => (
                <option key={k} value={k}>
                  {BILL_CATEGORIES[k].label} (GL {BILL_CATEGORIES[k].gl})
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium">Invoice date</span>
            <input type="date" value={f.invoiceDate} onChange={(e) => set({ invoiceDate: e.target.value })} className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium">Amount</span>
            <input type="number" inputMode="decimal" min={0} step="0.01" value={f.amount} onChange={(e) => set({ amount: e.target.value })} className={input} />
          </label>
          <label className="text-sm">
            <span className="font-medium">Currency</span>
            <select value={f.currency} onChange={(e) => set({ currency: e.target.value as "USD" | "AFN" })} className={input}>
              <option value="AFN">AFN</option>
              <option value="USD">USD</option>
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium">Funding source</span>
            <select value={f.source} onChange={(e) => set({ source: e.target.value, budgetLine: "" })} className={input}>
              {v.sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="font-medium">Budget line</span>
            {(v.lines[f.source] ?? []).length ? (
              <select value={f.budgetLine} onChange={(e) => set({ budgetLine: e.target.value })} className={input}>
                <option value="">Choose the line this is charged to</option>
                {v.lines[f.source].map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.code} {l.description}
                  </option>
                ))}
              </select>
            ) : (
              <span className="mt-1 block text-xs text-muted">{f.source === NON_CONTRACT ? "General and admin bills have no project line." : "This project has no budget loaded yet, so there is no line to choose."}</span>
            )}
          </label>
          <label className="text-sm sm:col-span-2">
            <span className="font-medium">Lease, contract or agreement it is under (if any)</span>
            <input value={f.contractRef} onChange={(e) => set({ contractRef: e.target.value })} placeholder="Office lease, Kabul, 2026–2027" className={input} />
          </label>
        </div>
        {error && (
          <p role="alert" className="mt-2 text-sm text-clay">
            {error}
          </p>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !ok}
            className={primaryBtn}
            onClick={async () => {
              setBusy(true);
              try {
                await add({ action: "raise", ...f, amount: Number(f.amount), budgetLine: f.budgetLine.trim() || null, contractRef: f.contractRef.trim() || null, file: file! });
              } catch {
                /* shown above */
              } finally {
                setBusy(false);
              }
            }}
          >
            Record
          </button>
          <button type="button" className={quietBtn} onClick={onClose}>
            Cancel
          </button>
        </div>
        {missing.length > 0 && <p className="mt-2 text-sm text-muted">{tx("Still needed: {list}.", { list: missing.join(", ") })}</p>}
      </Sheet>
    </section>
  );
}
