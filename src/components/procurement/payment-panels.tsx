"use client";

import { formatMoney } from "@/lib/demo";
import { reviewKey, type Procurement } from "@/lib/procurement";
import {
  contractCurrency,
  currentInstalment,
  expectedAfn,
  expectedUsd,
  invoiceUsd,
  paidMark,
  paidSoFar,
  receivedBefore,
  scheduleOf,
  scheduleTotal,
  taxDueDate,
  withholding,
  type Currency,
  type Instalment,
  type PaymentRecord,
} from "@/lib/payments";
import { today } from "@/lib/clock";

/**
 * Step panels for paying a contract: the payment schedule (with the contract), the received note
 * for each instalment, the payment approval form, and the proof of payment. Also the list of
 * instalments already paid.
 */

type Update = (fn: (p: Procurement) => Procurement) => void;
const box = "border-b border-line bg-paper/60 px-5 py-5";
const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none disabled:bg-paper disabled:text-muted";
const label = "text-xs font-medium text-muted";
const num = (v: string) => (v.trim() === "" ? NaN : Number(v));
const amt = (n: number, c: Currency) => (c === "USD" ? formatMoney(n, "USD") : `AFN ${Math.round(n).toLocaleString("en-US")}`);

/** Any change clears the reviewed mark, so the document is read again before it is signed. */
const unreview = (q: Procurement): Record<string, boolean> => {
  const checks = { ...q.checks };
  delete checks[reviewKey(q)];
  return checks;
};

const Head = ({ p }: { p: Procurement }) => {
  const i = currentInstalment(p);
  return i.of > 1 ? (
    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ochre">
      Payment {i.n} of {i.of} · {i.label} · {i.pct}%
    </p>
  ) : null;
};

/** With the contract: the currency and the instalments it is paid in. */
export function SchedulePanel({ p, editable, update }: { p: Procurement; editable: boolean; update: Update }) {
  const s = scheduleOf(p);
  const set = (schedule: Instalment[]) => update((q) => ({ ...q, schedule, checks: unreview(q) }));
  const total = scheduleTotal(p);
  return (
    <fieldset className={box} disabled={!editable}>
      <legend className="sr-only">Payment schedule</legend>
      <p className="text-sm font-semibold">How the contract is paid</p>
      <p className="mt-1 text-xs text-muted">As written in the contract. Each instalment is paid only against what was received or completed for it.</p>
      <div className="mt-3 grid max-w-md gap-3 sm:grid-cols-2">
        <label>
          <span className={label}>Contract currency</span>
          <select value={contractCurrency(p)} onChange={(e) => update((q) => ({ ...q, contractCurrency: e.target.value as Currency, checks: unreview(q) }))} className={`mt-1 ${field}`}>
            <option value="USD">US dollars</option>
            <option value="AFN">Afghani</option>
          </select>
        </label>
        {contractCurrency(p) === "AFN" && (
          <label>
            <span className={label}>Contract value, AFN</span>
            <input
              inputMode="decimal"
              value={p.contractAfn === undefined ? "" : String(p.contractAfn)}
              onChange={(e) => update((q) => ({ ...q, contractAfn: e.target.value.trim() === "" ? undefined : num(e.target.value), checks: unreview(q) }))}
              className={`mt-1 ${field} tabular-nums`}
            />
          </label>
        )}
      </div>
      <ul className="mt-3 space-y-2">
        {s.map((i, k) => (
          <li key={k} className="grid grid-cols-[1fr_6rem_auto] items-end gap-2">
            <label>
              <span className={label}>Instalment {k + 1}</span>
              <input value={i.label} onChange={(e) => set(s.map((x, j) => (j === k ? { ...x, label: e.target.value } : x)))} placeholder="e.g. On 40% completion" className={`mt-1 ${field}`} />
            </label>
            <label>
              <span className={label}>Share, %</span>
              <input
                inputMode="decimal"
                value={Number.isNaN(i.pct) ? "" : String(i.pct)}
                onChange={(e) => set(s.map((x, j) => (j === k ? { ...x, pct: num(e.target.value) } : x)))}
                className={`mt-1 ${field} tabular-nums`}
              />
            </label>
            <button type="button" disabled={s.length === 1} onClick={() => set(s.filter((_, j) => j !== k))} className="px-2 py-2 text-sm text-muted hover:text-clay disabled:opacity-40">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center justify-between text-sm">
        <button type="button" onClick={() => set([...s.map((x) => (s.length === 1 && x.label === "Full payment" ? { ...x, label: "First instalment" } : x)), { label: `Instalment ${s.length + 1}`, pct: Math.max(0, 100 - total) }])} className="font-medium text-forest hover:underline">
          Add an instalment
        </button>
        <span className={`tabular-nums ${total === 100 ? "text-muted" : "text-clay"}`}>Total {total}%</span>
      </div>
    </fieldset>
  );
}

/** Receipt for the instalment under way: quantity delivered since the last payment, or verified progress for works. */
export function ReceiptPanel({ p, editable, update }: { p: Procurement; editable: boolean; update: Update }) {
  const g = p.grn ?? { qty: NaN, place: p.place };
  const set = (patch: Partial<NonNullable<Procurement["grn"]>>) => update((q) => ({ ...q, grn: { ...g, ...patch }, checks: unreview(q) }));
  const before = receivedBefore(p);
  return (
    <fieldset className={box} disabled={!editable}>
      <legend className="sr-only">Goods received</legend>
      <Head p={p} />
      <p className="text-sm font-semibold">What was received</p>
      <p className="mt-1 text-xs text-muted">
        {before ? `${before.toLocaleString("en-US")} ${p.unit} received for earlier payments. ` : ""}Enter what arrived since then. For works, also the progress verified on site (from the technical report).
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label>
          <span className={label}>Received this time, {p.unit}</span>
          <input inputMode="decimal" value={Number.isNaN(g.qty) ? "" : String(g.qty)} onChange={(e) => set({ qty: num(e.target.value) })} className={`mt-1 ${field} tabular-nums`} />
        </label>
        <label>
          <span className={label}>Place of receipt</span>
          <input value={g.place} onChange={(e) => set({ place: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className={label}>Works: progress verified, % (optional)</span>
          <input
            inputMode="decimal"
            value={g.progressPct === undefined ? "" : String(g.progressPct)}
            onChange={(e) => set({ progressPct: e.target.value.trim() === "" ? undefined : num(e.target.value) })}
            className={`mt-1 ${field} tabular-nums`}
          />
        </label>
      </div>
    </fieldset>
  );
}

/** The figures of the payment approval form: gross, tax withheld and net, in the invoice's currency. */
function Figures({ p }: { p: Procurement }) {
  const inv = p.invoice;
  if (!inv) return null;
  const cur = inv.currency ?? "USD";
  const t = withholding(p, today());
  const usd = invoiceUsd(inv);
  return (
    <dl className="mt-4 grid gap-x-6 gap-y-1 rounded-xl border border-line bg-surface px-4 py-3 text-sm sm:grid-cols-[auto_1fr]">
      <dt className="text-muted">Gross</dt>
      <dd className="tabular-nums">
        {amt(inv.amount, cur)}
        {cur === "AFN" && usd !== null ? <span className="text-muted"> · {formatMoney(usd, "USD")} at {inv.rate}</span> : null}
        <span className="text-muted"> · due for this payment {expectedAfn(p) !== null ? amt(expectedAfn(p)!, "AFN") : formatMoney(expectedUsd(p), "USD")}</span>
      </dd>
      <dt className="text-muted">Tax withheld</dt>
      <dd className="tabular-nums">
        {t ? `${amt(t.amount, cur)} (${t.pct}%)` : "—"}
        {t && <span className="block text-xs text-muted">{t.why}</span>}
      </dd>
      <dt className="font-semibold">Net to pay</dt>
      <dd className="font-semibold tabular-nums">{t ? amt(inv.amount - t.amount, cur) : "—"}</dd>
    </dl>
  );
}

/** The invoice and the supplier's licence, from which the payment approval form is built. */
export function PayFormPanel({ p, editable, update }: { p: Procurement; editable: boolean; update: Update }) {
  const cur = contractCurrency(p);
  const inv = p.invoice ?? { amount: NaN, qty: NaN, currency: cur };
  const set = (patch: Partial<NonNullable<Procurement["invoice"]>>) => update((q) => ({ ...q, invoice: { ...inv, ...patch }, checks: unreview(q) }));
  const sup = p.supplier ?? { name: "", screenedOn: today() };
  const setSup = (patch: Partial<NonNullable<Procurement["supplier"]>>) => update((q) => ({ ...q, supplier: { ...sup, ...patch }, checks: unreview(q) }));
  const icur = inv.currency ?? "USD";
  return (
    <fieldset className={box} disabled={!editable}>
      <legend className="sr-only">Payment approval form</legend>
      <Head p={p} />
      <p className="text-sm font-semibold">Invoice from {sup.name || "the supplier"}</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label>
          <span className={label}>Invoice number</span>
          <input value={inv.number ?? ""} onChange={(e) => set({ number: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className={label}>Invoice date</span>
          <input type="date" value={inv.date ?? ""} onChange={(e) => set({ date: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className={label}>Currency</span>
          <select value={icur} onChange={(e) => set({ currency: e.target.value as Currency })} className={`mt-1 ${field}`}>
            <option value="USD">US dollars</option>
            <option value="AFN">Afghani</option>
          </select>
        </label>
        <label>
          <span className={label}>Gross amount</span>
          <input inputMode="decimal" value={Number.isNaN(inv.amount) ? "" : String(inv.amount)} onChange={(e) => set({ amount: num(e.target.value) })} className={`mt-1 ${field} tabular-nums`} />
        </label>
        <label>
          <span className={label}>Quantity invoiced, {p.unit}</span>
          <input inputMode="decimal" value={Number.isNaN(inv.qty) ? "" : String(inv.qty)} onChange={(e) => set({ qty: num(e.target.value) })} className={`mt-1 ${field} tabular-nums`} />
        </label>
        <label>
          <span className={label}>Afghani per US dollar (UN rate for the month)</span>
          <input inputMode="decimal" value={inv.rate === undefined ? "" : String(inv.rate)} onChange={(e) => set({ rate: e.target.value.trim() === "" ? undefined : num(e.target.value) })} className={`mt-1 ${field} tabular-nums`} />
        </label>
      </div>
      <p className="mt-4 text-sm font-semibold">Business licence</p>
      <p className="mt-1 text-xs text-muted">From the licence copy on file. The tax rate depends on it being valid on the payment date.</p>
      <div className="mt-2 grid gap-3 sm:grid-cols-3">
        <label>
          <span className={label}>Licence number</span>
          <input value={sup.licenceNo ?? ""} onChange={(e) => setSup({ licenceNo: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className={label}>Valid until</span>
          <input type="date" value={sup.licenceExpiry ?? ""} onChange={(e) => setSup({ licenceExpiry: e.target.value || undefined })} className={`mt-1 ${field}`} />
        </label>
      </div>
      <Figures p={p} />
    </fieldset>
  );
}

/** Read-only form figures for the steps that check and approve it. */
export function PayFormSummary({ p }: { p: Procurement }) {
  if (!p.invoice) return null;
  return (
    <div className={box}>
      <Head p={p} />
      <p className="text-sm font-semibold">
        Invoice {p.invoice.number} of {p.invoice.date} · {p.supplier?.name}
        {p.supplier?.licenceNo ? ` · licence ${p.supplier.licenceNo}` : ""}
      </p>
      <Figures p={p} />
    </div>
  );
}

/** Proof of payment, the paid mark for the invoice file, and the withheld tax remittance. */
export function PaidPanel({ p, editable, update }: { p: Procurement; editable: boolean; update: Update }) {
  const v = p.paid ?? { date: today(), ref: "" };
  const set = (patch: Partial<typeof v>) => update((q) => ({ ...q, paid: { ...v, ...patch } }));
  const t = withholding(p, v.date);
  return (
    <fieldset className={box} disabled={!editable}>
      <legend className="sr-only">Payment</legend>
      <Head p={p} />
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          <span className={label}>Paid on</span>
          <input type="date" value={v.date} onChange={(e) => set({ date: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className={label}>Bank transfer or cheque reference</span>
          <input value={v.ref} onChange={(e) => set({ ref: e.target.value })} className={`mt-1 ${field}`} />
        </label>
      </div>
      {v.ref.trim() && (
        <div className="mt-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <p className={label}>Mark on the invoice file in SharePoint</p>
          <p className="mt-1 font-mono text-xs">{paidMark(p, v)}</p>
        </div>
      )}
      {t && t.amount > 0 && (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <p className="text-xs text-muted sm:col-span-2">
            Tax withheld {amt(t.amount, p.invoice?.currency ?? "USD")} is due to the Ministry of Finance by {taxDueDate(v.date)}. Record the receipt now or once it is paid; the contract cannot close until it is.
          </p>
          <label>
            <span className={label}>Tax receipt number</span>
            <input value={v.taxRef ?? ""} onChange={(e) => set({ taxRef: e.target.value || undefined })} className={`mt-1 ${field}`} />
          </label>
          <label>
            <span className={label}>Tax paid on</span>
            <input type="date" value={v.taxDate ?? ""} onChange={(e) => set({ taxDate: e.target.value || undefined })} className={`mt-1 ${field}`} />
          </label>
        </div>
      )}
    </fieldset>
  );
}

/** Instalments already paid, with Finance recording the tax remittance where it is still owed. */
export function PaymentsList({ p, canFinance, update, onView }: { p: Procurement; canFinance: boolean; update: Update; onView: (r: PaymentRecord, doc: string) => void }) {
  const list = paidSoFar(p);
  if (!list.length) return null;
  const total = scheduleOf(p).length;
  const setTax = (n: number, patch: { taxRef?: string; taxDate?: string }) =>
    update((q) => ({ ...q, payments: paidSoFar(q).map((r) => (r.n === n ? { ...r, paid: { ...r.paid, ...patch } } : r)), timeline: [...q.timeline, { date: today(), who: "finance", what: `Tax for payment ${n} remitted` }] }));
  return (
    <section>
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted">
        Payments · {list.length} of {total} paid
      </p>
      <div className="mt-2 overflow-x-auto rounded-2xl border border-line bg-surface">
        <table className="w-full min-w-[44rem] text-sm">
          <thead className="bg-sunken text-xs text-muted">
            <tr>
              {["Payment", "Invoice", "Gross", "Tax", "Net", "Paid", "Tax remitted"].map((h) => (
                <th key={h} className="px-3 py-2 text-start font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map((r) => {
              const c = r.invoice.currency ?? "USD";
              return (
                <tr key={r.n} className="border-t border-line align-top">
                  <td className="px-3 py-2">
                    <span className="font-medium">
                      {r.n}. {r.label} ({r.pct}%)
                    </span>
                    <span className="mt-0.5 flex flex-wrap gap-x-2 text-xs">
                      {(["Goods received note", "Payment approval form", "Expense voucher"] as const).map((d) => (
                        <button key={d} type="button" onClick={() => onView(r, d)} className="text-forest hover:underline">
                          {d === "Goods received note" ? "Received note" : d === "Payment approval form" ? "Approval form" : "Voucher"}
                        </button>
                      ))}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    {r.invoice.number} <span className="block text-xs text-muted">{r.invoice.date}</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{amt(r.invoice.amount, c)}</td>
                  <td className="px-3 py-2 tabular-nums">
                    {amt(r.tax.amount, c)} <span className="text-xs text-muted">({r.tax.pct}%)</span>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{amt(r.net, c)}</td>
                  <td className="px-3 py-2">
                    {r.paid.date} <span className="block text-xs text-muted">ref {r.paid.ref}</span>
                  </td>
                  <td className="px-3 py-2">
                    {r.tax.amount === 0 ? (
                      <span className="text-xs text-muted">None withheld</span>
                    ) : r.paid.taxRef ? (
                      <span>
                        {r.paid.taxRef} <span className="block text-xs text-muted">{r.paid.taxDate}</span>
                      </span>
                    ) : canFinance ? (
                      <TaxForm due={r.taxDue} onSave={(taxRef, taxDate) => setTax(r.n, { taxRef, taxDate })} />
                    ) : (
                      <span className="text-xs text-clay">Due by {r.taxDue}</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TaxForm({ due, onSave }: { due: string; onSave: (ref: string, date: string) => void }) {
  return (
    <form
      className="flex flex-col gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        const ref = String(f.get("ref") ?? "").trim();
        const date = String(f.get("date") ?? "");
        if (ref && date) onSave(ref, date);
      }}
    >
      <span className="text-xs text-clay">Due by {due}</span>
      <input name="ref" placeholder="Receipt number" className="w-36 rounded-lg border border-line px-2 py-1 text-xs" />
      <input name="date" type="date" className="w-36 rounded-lg border border-line px-2 py-1 text-xs" />
      <button type="submit" className="self-start text-xs font-semibold text-forest hover:underline">
        Record
      </button>
    </form>
  );
}
