"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireUser } from "@/components/app/session";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";
import type { AdvAction } from "@/lib/advance";
import type { Receipt } from "@/lib/expense";
import type { AdvanceView } from "@/app/api/advances/route";

/**
 * Advances (MF-02): ask for one, see its age and the day it must be settled by, settle it with
 * receipts. Supervisors approve; Finance pays the holder, accepts the settlement and recovers
 * what is still owed.
 */
type Row = AdvanceView["mine"][number];
const field = "mt-1 w-full border border-line bg-surface px-3 py-2 text-sm";
const STATUS: Record<Row["status"], string> = { requested: "Waiting for the supervisor", approved: "Approved: Finance pays it", paid: "Paid: settle it with receipts", settling: "Settlement waiting for Finance", settled: "Settled" };

export function AdvancePage() {
  const { user } = useRequireUser();
  const [v, setV] = useState<AdvanceView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = useCallback((json = true): Record<string, string> => ({ ...(json ? { "Content-Type": "application/json" } : {}), "x-demo-user": user?.id ?? "" }), [user?.id]);
  const load = useCallback(async () => {
    if (!user) return;
    const res = await fetch("/api/advances", { cache: "no-store", headers: headers(false) });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return setError(b.error ?? plainError(res.status));
    setV(b);
  }, [user, headers]);
  useEffect(() => {
    void load();
  }, [load]);
  const act = async (a: AdvAction, done: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    const res = await fetch("/api/advances", { method: "POST", headers: headers(), body: JSON.stringify(a) });
    const b = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      setError(b.error ?? plainError(res.status));
      return false;
    }
    setV(b.view);
    setNotice(done);
    return true;
  };
  if (!user) return null;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
        <h1 className="font-display text-4xl tracking-tight">Advances</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Money paid ahead for work, for example a field trip. It is paid only to you, and settled with receipts by its deadline: 15 days on UN-funded projects, 30 days otherwise. What is not spent is returned.</p>
        {error && (
          <p role="alert" className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="mt-4 bg-mist px-4 py-3 text-sm">
            {notice}
          </p>
        )}
        {!v && !error && <p className="mt-8 text-muted">Loading…</p>}
        {v && (
          <>
            {v.overdue.length > 0 && (v.finance || v.overdue.some((r) => r.person !== v.me)) && (
              <section className="mt-6 border-s-[6px] border-clay bg-surface px-4 py-3">
                <h2 className="font-semibold">Overdue</h2>
                <ul className="mt-1 text-sm">
                  {v.overdue.map((r) => (
                    <li key={r.n}>
                      #{r.n} {r.name}: {r.request.amount} {r.request.currency}, paid {r.age!.days} days ago, due {r.age!.due}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {v.waiting.length > 0 && (
              <section className="mt-6">
                <h2 className="font-semibold">Waiting for you</h2>
                <ul className="mt-2 space-y-3">
                  {v.waiting.map((r) => (
                    <AdvanceRow key={r.n} r={r} busy={busy} act={act} />
                  ))}
                </ul>
              </section>
            )}
            <section className="mt-6">
              <h2 className="font-semibold">Yours</h2>
              {v.hasRecord && !v.mine.some((r) => r.status !== "settled") && <RequestForm busy={busy} act={act} />}
              {!v.hasRecord && <p className="mt-1 text-sm text-muted">You have no HR record yet, so an advance cannot be paid to you.</p>}
              <ul className="mt-3 space-y-3">
                {v.mine.map((r) => (
                  <AdvanceRow key={r.n} r={r} busy={busy} act={act} userId={user.id} />
                ))}
              </ul>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function RequestForm({ busy, act }: { busy: boolean; act: (a: AdvAction, done: string) => Promise<boolean> }) {
  const [f, setF] = useState({ amount: "", currency: "USD" as "USD" | "AFN" | "GTQ", purpose: "", source: "", neededBy: new Date().toISOString().slice(0, 10) });
  return (
    <form
      className="mt-2 grid gap-3 border border-line bg-surface p-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void act({ action: "request", request: { amount: Number(f.amount), currency: f.currency, purpose: f.purpose, source: f.source.trim() || "GEN", neededBy: f.neededBy } }, "Asked for. Your supervisor approves it next.");
      }}
    >
      <label className="block text-sm font-medium">
        Amount
        <input inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className={field} />
      </label>
      <label className="block text-sm font-medium">
        Currency
        <select value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value as typeof f.currency })} className={field}>
          <option>USD</option>
          <option>AFN</option>
          <option>GTQ</option>
        </select>
      </label>
      <label className="block text-sm font-medium sm:col-span-2">
        What it is for
        <input value={f.purpose} maxLength={500} onChange={(e) => setF({ ...f, purpose: e.target.value })} placeholder="For example: field trip to the project villages, fuel and lodging" className={field} />
      </label>
      <label className="block text-sm font-medium">
        Project code (empty for general)
        <input value={f.source} maxLength={40} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="A-2027" className={field} />
      </label>
      <label className="block text-sm font-medium">
        Needed by
        <input type="date" value={f.neededBy} onChange={(e) => setF({ ...f, neededBy: e.target.value })} className={field} />
      </label>
      <div className="sm:col-span-2">
        <button type="submit" disabled={busy || !(Number(f.amount) > 0) || f.purpose.trim().length < 5} className={primaryBtn}>
          Ask for an advance
        </button>
      </div>
    </form>
  );
}

function AdvanceRow({ r, busy, act, userId }: { r: Row; busy: boolean; act: (a: AdvAction, done: string) => Promise<boolean>; userId?: string }) {
  const [pay, setPay] = useState({ paidOn: new Date().toISOString().slice(0, 10), method: "bank" as "bank" | "cash" | "mobile", reference: "" });
  const [note, setNote] = useState("");
  const [recover, setRecover] = useState("");
  return (
    <li className="border border-line bg-surface p-4 text-sm">
      <p className="font-semibold">
        #{r.n} {r.name}: {r.request.amount} {r.request.currency}
      </p>
      <p>{r.request.purpose}</p>
      <p className="mt-1 text-muted">
        {STATUS[r.status]}
        {r.age ? ` · paid ${r.age.days} ${r.age.days === 1 ? "day" : "days"} ago · settle by ${r.age.due} (${r.settleDays} days)` : ""}
        {r.age?.overdue ? " · OVERDUE" : ""}
        {r.status === "settled" ? ` · spent ${r.spent}, returned ${r.settlement?.returned ?? 0}, recovered ${r.recovered}, still owed ${r.owed}` : ""}
      </p>
      {r.returnedNote && <p className="mt-1 text-clay">Settlement sent back: {r.returnedNote}</p>}
      {r.problem && r.status === "settling" && <p className="mt-1 text-clay">{r.problem}</p>}
      <div className="mt-2 flex flex-wrap items-end gap-2">
        {r.can.approve && (
          <button type="button" disabled={busy} className={primaryBtn} onClick={() => void act({ action: "approve", advance: r.n }, `Approved #${r.n}. Finance pays it next.`)}>
            Approve
          </button>
        )}
        {r.can.pay && (
          <>
            <input type="date" value={pay.paidOn} onChange={(e) => setPay({ ...pay, paidOn: e.target.value })} className="border border-line px-2 py-1.5" aria-label="Paid on" />
            <select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value as typeof pay.method })} className="border border-line px-2 py-1.5" aria-label="How">
              <option value="bank">Bank</option>
              <option value="cash">Cash</option>
              <option value="mobile">Mobile money</option>
            </select>
            <input value={pay.reference} placeholder="Reference" onChange={(e) => setPay({ ...pay, reference: e.target.value })} className="border border-line px-2 py-1.5" aria-label="Reference" />
            <button type="button" disabled={busy || pay.reference.trim().length < 2} className={primaryBtn} onClick={() => void act({ action: "pay", payment: { advance: r.n, ...pay, payee: r.person } }, `Recorded as paid to ${r.name}.`)}>
              Pay {r.name}
            </button>
          </>
        )}
        {r.can.accept && (
          <>
            <button type="button" disabled={busy || !!r.problem} className={primaryBtn} onClick={() => void act({ action: "accept", advance: r.n }, `Settlement of #${r.n} accepted.`)}>
              Accept the settlement
            </button>
            <input value={note} placeholder="What to fix" onChange={(e) => setNote(e.target.value)} className="border border-line px-2 py-1.5" aria-label="What to fix" />
            <button type="button" disabled={busy || note.trim().length < 3} className={quietBtn} onClick={() => void act({ action: "return", advance: r.n, note }, `Sent back to ${r.name}.`)}>
              Send back
            </button>
          </>
        )}
        {r.can.recover && (
          <>
            <input inputMode="decimal" value={recover} placeholder={String(r.owed)} onChange={(e) => setRecover(e.target.value)} className="w-28 border border-line px-2 py-1.5" aria-label="Amount recovered" />
            <button type="button" disabled={busy || !(Number(recover) > 0)} className={quietBtn} onClick={() => void act({ action: "recover", advance: r.n, amount: Number(recover) }, `Recovered ${recover} from ${r.name}.`)}>
              Record recovered from pay
            </button>
          </>
        )}
      </div>
      {r.can.settle && userId && <SettleForm r={r} busy={busy} act={act} userId={userId} />}
    </li>
  );
}

function SettleForm({ r, busy, act, userId }: { r: Row; busy: boolean; act: (a: AdvAction, done: string) => Promise<boolean>; userId: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [lines, setLines] = useState([{ date: today, description: "", amount: "", receipts: [] as Receipt[], noReceipt: "" }]);
  const [returned, setReturned] = useState("0");
  const [uploading, setUploading] = useState(false);
  const spent = lines.reduce((t, l) => t + (Number(l.amount) || 0), 0);
  const upload = async (k: number, files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const got: Receipt[] = [];
    for (const f of Array.from(files)) {
      const body = new FormData();
      body.append("file", f);
      const res = await fetch("/api/files", { method: "POST", headers: { "x-demo-user": userId }, body });
      if (res.ok) got.push(await res.json());
    }
    setUploading(false);
    setLines(lines.map((l, j) => (j === k ? { ...l, receipts: [...l.receipts, ...got] } : l)));
  };
  return (
    <div className="mt-3 border-t border-line pt-3">
      <p className="font-semibold">Settle it</p>
      {lines.map((l, k) => (
        <div key={k} className="mt-2 grid gap-2 sm:grid-cols-[8rem_1fr_7rem]">
          <input type="date" value={l.date} onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, date: e.target.value } : x)))} className="border border-line px-2 py-1.5" aria-label="Date" />
          <input value={l.description} placeholder="What was paid for" onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, description: e.target.value } : x)))} className="border border-line px-2 py-1.5" aria-label="What" />
          <input inputMode="decimal" value={l.amount} placeholder="Amount" onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, amount: e.target.value } : x)))} className="border border-line px-2 py-1.5" aria-label="Amount" />
          <label className="text-xs sm:col-span-3">
            Receipt {l.receipts.length ? `(${l.receipts.length} attached)` : ""}
            <input type="file" accept="image/*,application/pdf" multiple onChange={(e) => void upload(k, e.target.files)} className="ms-2" />
          </label>
          {!l.receipts.length && <input value={l.noReceipt} placeholder="No receipt? Say why" onChange={(e) => setLines(lines.map((x, j) => (j === k ? { ...x, noReceipt: e.target.value } : x)))} className="border border-line px-2 py-1.5 sm:col-span-3" aria-label="Why no receipt" />}
        </div>
      ))}
      <button type="button" className={`${quietBtn} mt-2`} onClick={() => setLines([...lines, { date: today, description: "", amount: "", receipts: [], noReceipt: "" }])}>
        + Another line
      </button>
      <label className="mt-2 block text-sm">
        Cash handed back to Finance
        <input inputMode="decimal" value={returned} onChange={(e) => setReturned(e.target.value)} className="ms-2 w-28 border border-line px-2 py-1.5" />
      </label>
      <p className="mt-1 text-xs text-muted">
        Spent {spent}, returned {Number(returned) || 0}, of {r.request.amount}. Anything not accounted for is recovered from your pay.
      </p>
      <button
        type="button"
        disabled={busy || uploading}
        className={`${primaryBtn} mt-2`}
        onClick={() => void act({ action: "settle", settlement: { advance: r.n, lines: lines.map((l) => ({ date: l.date, description: l.description, amount: Number(l.amount) || 0, receipts: l.receipts, ...(l.noReceipt.trim() ? { noReceipt: l.noReceipt.trim() } : {}) })), returned: Number(returned) || 0 } }, "Settlement sent to Finance.")}
      >
        Send the settlement
      </button>
    </div>
  );
}
