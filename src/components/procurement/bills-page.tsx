"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { openReceipt, shrink } from "@/components/people/expense-page";
import { Pill, SectionLabel, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { BILL_CATEGORIES, BILL_CATEGORY_KEYS, type BillAction, type BillCategory } from "@/lib/bills";
import type { Receipt } from "@/lib/expense";
import type { BillsView } from "@/app/api/projects/[code]/bills/route";

/**
 * Bills paid directly, outside procurement: record it with the document, management approves,
 * Finance prepares the voucher, and it counts in the monthly closeout.
 */

async function call<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { ...(init?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), "x-demo-user": user ?? "", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
const money = (n: number, c: string) => (c === "AFN" ? `${Math.round(n).toLocaleString("en-US")} AFN` : `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const STATUS = { waiting: { tone: "ochre", text: "Waiting for approval" }, approved: { tone: "sky", text: "Approved: voucher to prepare" }, returned: { tone: "clay", text: "Sent back" }, filed: { tone: "forest", text: "Filed and posted" } } as const;

export function BillsPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [v, setV] = useState<BillsView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
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
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">{project.name}</p>
        <h1 className="mt-1 font-display text-3xl tracking-tight">Bills paid directly</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Rent, utilities, internet and phones, insurance, and services under an agreement. Record the bill with its document; programme management approves; Finance prepares the voucher. A one-off purchase of goods or services goes through procurement instead.
        </p>
        <p className="mt-2 flex gap-4 text-sm">
          <Link href="/work/closeout" className="font-semibold text-forest hover:underline">
            Monthly closeout
          </Link>
          <Link href="/work?source=procurement" className="font-semibold text-forest hover:underline">
            Procurement
          </Link>
        </p>
        {!project.saved && <p className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">Choose a project saved in the database (for example ACRP).</p>}
        {error && (
          <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">
            {notice}
          </p>
        )}
        {v && (
          <>
            {!v.record ? (
              <p className="mt-6 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">Bills are recorded by Finance and by people named for bill entry. Give the bill to Finance.</p>
            ) : adding ? (
              <AddBill v={v} onClose={() => setAdding(false)} add={(a) => act(a, "Recorded. It goes to programme management for approval.").then(() => setAdding(false))} />
            ) : (
              <button type="button" className={`${primaryBtn} mt-6`} onClick={() => setAdding(true)}>
                Record a bill
              </button>
            )}
            <section className="mt-6 space-y-3">
              {!v.items.length && <p className="rounded-2xl border border-dashed border-line p-8 text-center text-sm text-muted">No bills yet.</p>}
              {v.items.map((b) => (
                <BillCard key={b.id} b={b} v={v} act={act} />
              ))}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

type Item = BillsView["items"][number];

function BillCard({ b, v, act }: { b: Item; v: BillsView; act: (a: BillAction, msg: string) => Promise<void> }) {
  const { user } = useSession();
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
    <article className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={STATUS[b.status].tone}>{STATUS[b.status].text}</Pill>
        <span className="font-mono text-xs text-muted">{b.id}</span>
        <span className="ms-auto font-semibold tabular-nums">{money(b.amount, b.currency)}</span>
      </div>
      <h3 className="mt-1 font-medium">
        {b.payee}: {b.description}
      </h3>
      <p className="text-sm text-muted">
        Invoice {b.invoiceNumber}, {b.invoiceDate} · {BILL_CATEGORIES[b.category].label} (GL {BILL_CATEGORIES[b.category].gl}) · {label(b.source)}
        {b.budgetLine ? ` · line ${b.budgetLine}` : ""}
        {b.contractRef ? ` · under ${b.contractRef}` : ""}
      </p>
      <button type="button" onClick={() => void openReceipt(b.file.hash, user?.id)} className="mt-1 text-sm font-semibold text-forest hover:underline">
        📎 {b.file.name}
      </button>
      <p className="mt-1 text-xs text-muted">{b.timeline.map((t) => `${t.date}: ${t.what} (${t.who})`).join(" · ")}</p>
      {b.flags.length > 0 && b.status !== "filed" && (
        <ul className="mt-2 space-y-1 rounded-xl bg-ochre-soft px-3 py-2 text-sm text-ochre">
          {b.flags.map((f) => (
            <li key={f}>⚠ {f}</li>
          ))}
        </ul>
      )}
      {b.status === "waiting" && !b.canApprove && b.raised.by === v.me && <p className="mt-2 text-sm text-muted">Waiting for programme management; you recorded it, so someone else approves it.</p>}
      {b.canApprove &&
        (back === null ? (
          <div className="mt-3 flex gap-2">
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
            <div className="mt-2 flex gap-2">
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
        <div className="mt-3 grid gap-2 rounded-xl border border-forest/40 bg-paper p-3 sm:grid-cols-2">
          <p className="text-sm font-semibold sm:col-span-2">Expense voucher</p>
          <label className="text-sm">
            <span className="text-muted">Voucher number</span>
            <input value={voucher.number} onChange={(e) => setVoucher({ ...voucher, number: e.target.value })} className={input} />
          </label>
          <label className="text-sm">
            <span className="text-muted">Month it belongs to</span>
            <input type="month" value={voucher.month} onChange={(e) => setVoucher({ ...voucher, month: e.target.value })} className={input} />
          </label>
          <label className="text-sm">
            <span className="text-muted">SharePoint link to the filed voucher</span>
            <input value={voucher.sharepointUrl} onChange={(e) => setVoucher({ ...voucher, sharepointUrl: e.target.value })} placeholder="https://….sharepoint.com/…" className={input} />
          </label>
          <label className="text-sm">
            <span className="text-muted">NetSuite reference</span>
            <input value={voucher.netsuiteRef} onChange={(e) => setVoucher({ ...voucher, netsuiteRef: e.target.value })} className={input} />
          </label>
          <div className="sm:col-span-2">
            <button type="button" disabled={busy || !voucher.number.trim()} className={primaryBtn} onClick={() => void run(() => act({ action: "voucher", id: b.id, ...voucher }, `Voucher saved for ${b.id}.`))}>
              Save the voucher
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function AddBill({ v, onClose, add }: { v: BillsView; onClose: () => void; add: (a: BillAction) => Promise<void> }) {
  const { user } = useSession();
  const [f, setF] = useState({ payee: "", invoiceNumber: "", invoiceDate: new Date().toISOString().slice(0, 10), description: "", category: "rent" as BillCategory, amount: "", currency: "AFN" as "USD" | "AFN", source: v.sources[0]?.id ?? "non-contract", budgetLine: "", contractRef: "" });
  const [file, setFile] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const ok = file && f.payee.trim().length >= 2 && f.invoiceNumber.trim() && f.description.trim().length >= 3 && Number(f.amount) > 0;
  return (
    <section className="mt-6 rounded-2xl border border-forest/40 bg-paper p-4">
      <SectionLabel>Record a bill</SectionLabel>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
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
          <select value={f.source} onChange={(e) => set({ source: e.target.value })} className={input}>
            {v.sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="font-medium">Budget line (optional)</span>
          <input value={f.budgetLine} onChange={(e) => set({ budgetLine: e.target.value })} className={input} />
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
      <div className="mt-3 flex gap-2">
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
    </section>
  );
}
