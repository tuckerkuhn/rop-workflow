"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";

type Entry = { id: string; person: string; personName: string; from: string; to: string; delegate?: string; delegateName: string | null; note?: string; mine: boolean };
type View = { today: string; escalateAfterDays: number; entries: Entry[]; people: { id: string; name: string; title: string; reportsTo: string | null }[] };

const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";

/**
 * Time away (MF-01): record the days you will be away and who acts for you. While you are away they
 * approve in your place, and what they sign says "on behalf of" you. With nobody named, your line
 * manager steps in after a few days.
 */
export function AwaySection() {
  const { user } = useSession();
  const [v, setV] = useState<View | null>(null);
  const [form, setForm] = useState({ from: "", to: "", delegate: "", note: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const headers = { "Content-Type": "application/json", "x-demo-user": user?.id ?? "" };

  const load = useCallback(async () => {
    if (!user) return;
    const res = await fetch("/api/away", { cache: "no-store", headers: { "x-demo-user": user.id } });
    if (res.ok) setV(await res.json());
  }, [user]);
  useEffect(() => {
    void load();
  }, [load]);

  const post = async (b: unknown) => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/away", { method: "POST", headers, body: JSON.stringify(b) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? plainError(res.status));
      setV(body);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!user || user.kind !== "employee" || !v) return null;
  const boss = v.people.find((p) => p.id === v.people.find((x) => x.id === user.id)?.reportsTo);
  return (
    <section className="mt-6" aria-labelledby="away-heading">
      <h3 id="away-heading" className="font-semibold">
        Time away
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-muted">
        While you are away, the person you name approves in your place, and what they sign says it is on your behalf.
        {boss ? ` With nobody named, ${boss.name} steps in after ${v.escalateAfterDays} days.` : ` With nobody named, work waits ${v.escalateAfterDays} days and then goes to your line manager.`}
      </p>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          void post({ action: "record", away: { person: user.id, from: form.from, to: form.to, ...(form.delegate ? { delegate: form.delegate } : {}), ...(form.note.trim() ? { note: form.note.trim() } : {}) } }).then((ok) => ok && setForm({ from: "", to: "", delegate: "", note: "" }));
        }}
      >
        <label className="block text-sm font-medium">
          First day away
          <input type="date" value={form.from} min={v.today} onChange={(e) => setForm({ ...form, from: e.target.value })} className={field} />
        </label>
        <label className="block text-sm font-medium">
          Last day away
          <input type="date" value={form.to} min={form.from || v.today} onChange={(e) => setForm({ ...form, to: e.target.value })} className={field} />
        </label>
        <label className="block text-sm font-medium">
          Who acts for you
          <select value={form.delegate} onChange={(e) => setForm({ ...form, delegate: e.target.value })} className={field}>
            <option value="">Nobody named{boss ? ` (${boss.name} after ${v.escalateAfterDays} days)` : ""}</option>
            {v.people
              .filter((p) => p.id !== user.id)
              .map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}, {p.title}
                </option>
              ))}
          </select>
        </label>
        <label className="block text-sm font-medium">
          Note (optional)
          <input value={form.note} maxLength={300} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="For example: annual leave" className={field} />
        </label>
        <div className="sm:col-span-2">
          <button type="submit" disabled={busy || !form.from || !form.to} className={primaryBtn}>
            Save time away
          </button>
        </div>
      </form>
      {error && (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      )}
      {v.entries.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-y border-line text-sm">
          {v.entries.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <span className="min-w-0 flex-1">
                <span className="font-semibold">{a.personName}</span> away {a.from} to {a.to}
                {a.from <= v.today ? " (now)" : ""} · {a.delegateName ? `${a.delegateName} acts` : "nobody named: the line manager steps in"}
                {a.note ? <span className="block text-xs text-muted">{a.note}</span> : null}
              </span>
              {(a.mine || user.admin) && (
                <button type="button" disabled={busy} className={quietBtn} onClick={() => void post({ action: "remove", id: a.id })}>
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
