"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { DistView } from "@/server/distribution";

/**
 * The project manager's one screen for an input distribution: what went out, the goods received
 * and quantity checks, what to look at, and Approve or Send back. Works from the email link
 * (single-use token) or signed in from Home. Farmer IDs only.
 */
export function ApprovePanel({ code, id, token }: { code: string; id: string; token: string }) {
  const { user, ready } = useSession();
  const [d, setD] = useState<DistView | null>(null);
  const [canDecide, setCanDecide] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState("");
  const url = `/api/projects/${encodeURIComponent(code)}/distributions/${id}`;
  const headers = { "Content-Type": "application/json", "x-demo-user": user?.id ?? "" };

  const load = useCallback(async () => {
    const res = await fetch(`${url}${token ? `?t=${encodeURIComponent(token)}` : ""}`, { cache: "no-store", headers: { "x-demo-user": user?.id ?? "" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? `Could not open it (${res.status}).`);
    setD(body.distribution);
    setCanDecide(body.canDecide);
    setError("");
  }, [url, token, user?.id]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load]);

  async function decide(decision: "approved" | "sent_back") {
    setBusy(true);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ decision, note: note.trim() || undefined, token: token || undefined }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Not saved (${res.status}).`);
    setD(body.distribution);
    setError("");
    setDone(decision === "approved" ? `Approved. ${body.procurements?.length ? `Added to the distribution list on ${body.procurements.join(", ")}; finance has a task to pay.` : ""} It now counts toward the distribution target.` : "Sent back. The person who recorded it has a task to fix it.");
  }

  const pending = d?.status === "pending";
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-ochre">Project {code} · input distribution</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight">{d ? `${d.farmerId}${d.village ? `, ${d.village}` : ""}` : "Distribution"}</h1>
      {error && <p className="mt-4 rounded-lg border border-clay/40 bg-surface px-4 py-3 text-sm text-clay">{error}</p>}
      {!d && !error && <p className="mt-4 text-muted">Loading…</p>}
      {d && (
        <>
          <p className="mt-2 text-sm text-muted">
            Recorded {d.date} by {d.recordedBy} {d.source === "kobo" ? "in KoboCollect" : "in the app"}.{" "}
            {d.status === "accepted" ? `Approved by ${d.decided?.byName ?? "the project manager"}.` : d.status === "queried" ? `Sent back by ${d.decided?.byName ?? "the project manager"}: ${d.decided?.note ?? ""}` : "Waiting for your approval."}
          </p>

          <section className="mt-6 rounded-xl border border-line bg-surface px-4 py-3">
            <h2 className="font-medium">Handed out</h2>
            <ul className="mt-1 text-sm">
              {d.items.map((i) => (
                <li key={i.key}>
                  {i.qty} {i.unit} {i.item}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm text-muted">
              Recipient: {d.gender ?? "sex not recorded"} · Photo of the signed list: {d.photo ? "attached" : "missing"}
            </p>
          </section>

          <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
            <h2 className="font-medium">Goods received and quantities</h2>
            <ul className="mt-1 space-y-1 text-sm">
              {d.gate.lines.map((l) => (
                <li key={l.key} className={l.ok ? "" : "text-clay"}>
                  {l.ok ? "✓" : "✗"} {l.detail}
                </li>
              ))}
            </ul>
            {!d.gate.ok && pending && <p className="mt-2 text-sm text-clay">This can&apos;t be approved until the goods received note is signed and the quantity is within what was received.</p>}
          </section>

          <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
            <h2 className="font-medium">To look at</h2>
            {d.flags.length ? (
              <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                {d.flags.map((f) => (
                  <li key={f.id}>{f.text}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted">Nothing flagged.</p>
            )}
          </section>

          {pending && canDecide && !done && (
            <section className="mt-6">
              <label className="block text-sm font-medium" htmlFor="note">
                Note (needed to send it back)
              </label>
              <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="What needs fixing" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} disabled={busy || !d.gate.ok} onClick={() => decide("approved")}>
                  Approve
                </button>
                <button type="button" className={quietBtn} disabled={busy || !note.trim()} onClick={() => decide("sent_back")}>
                  Send back
                </button>
              </div>
            </section>
          )}
          {pending && !canDecide && <p className="mt-6 text-sm text-muted">Only the project manager approves distributions.</p>}
          {done && <p className="mt-6 rounded-lg bg-mist px-4 py-3 text-sm">{done}</p>}
          {d.notified && !d.notified.emailed && d.notified.why && <p className="mt-6 text-xs text-muted">Not emailed: {d.notified.why}.</p>}
        </>
      )}
    </main>
  );
}
