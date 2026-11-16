"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { DistView } from "@/server/distribution";

/**
 * The project manager's one screen for an input distribution: what went out, the goods received
 * and quantity checks, what to look at, and Approve or Send back. Works from the email link
 * (single-use token) or signed in from Home. Farmer IDs only.
 *
 * The same screen is where a sent-back distribution is put right: the person who recorded it
 * corrects the quantities, confirms the signature and photo, says what they fixed and sends it
 * again. It then waits for the manager with fresh checks.
 */
/** What a fix may correct: the items recorded, plus any of the planned package recorded as not given. */
const fixable = (d: DistView) => [...d.items, ...d.planned.filter((p) => !d.items.some((i) => i.key === p.key))];

export function ApprovePanel({ code, id, token }: { code: string; id: string; token: string }) {
  const { user, ready } = useSession();
  const [d, setD] = useState<DistView | null>(null);
  const [canDecide, setCanDecide] = useState(false);
  const [canFix, setCanFix] = useState(false);
  const [canCheckKobo, setCanCheckKobo] = useState(false);
  const [fix, setFix] = useState<{ qty: Record<string, string>; signed: boolean; photo: boolean }>({ qty: {}, signed: false, photo: false });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"" | "approved" | "sent_back" | "resubmit">("");
  /** After a decision: the purchases whose lists grew, or who has the task to fix it. */
  const [reached, setReached] = useState<string[]>([]);
  // The target the approval added a result to, when it added one.
  const [counted, setCounted] = useState<string | null>(null);
  const url = `/api/projects/${encodeURIComponent(code)}/distributions/${id}`;
  const headers = { "Content-Type": "application/json", "x-demo-user": user?.id ?? "" };

  const load = useCallback(async () => {
    const res = await fetch(`${url}${token ? `?t=${encodeURIComponent(token)}` : ""}`, { cache: "no-store", headers: { "x-demo-user": user?.id ?? "" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? `Could not open it (${res.status}).`);
    const dist = body.distribution as DistView;
    setD(dist);
    setCanDecide(body.canDecide);
    setCanFix(!!body.canFix);
    setCanCheckKobo(!!body.canCheckKobo);
    // Every item of the farmer's planned package can be corrected, including one recorded as not given (0).
    setFix({ qty: Object.fromEntries(fixable(dist).map((i) => [i.key, String(dist.items.find((x) => x.key === i.key)?.qty ?? 0)])), signed: dist.signed, photo: dist.photo });
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
    setDone(decision);
    setCounted(decision === "approved" && body.result ? (body.targetName ?? body.target ?? null) : null);
    setReached(decision === "approved" ? (body.procurements ?? []) : body.fixer ? [body.fixer] : []);
  }

  async function checkKobo() {
    setBusy(true);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ decision: "kobo_checked" }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Not saved (${res.status}).`);
    setD(body.distribution);
    setError("");
  }

  async function sendAgain() {
    const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) || Number(v) < 0 ? undefined : Number(v));
    setBusy(true);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ decision: "resubmit", note: note.trim(), fix: { qty: Object.fromEntries(Object.entries(fix.qty).flatMap(([k, v]) => (num(v) === undefined ? [] : [[k, num(v)]]))), signed: fix.signed, photo: fix.photo } }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Not sent (${res.status}).`);
    setD(body.distribution);
    setNote("");
    setError("");
    setDone("resubmit");
  }

  const pending = d?.status === "pending";
  const sentBack = d?.status === "queried";
  const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";
  return (
    <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">Project {code} · input distribution</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight">{d ? `${d.farmerId}${d.village ? `, ${d.village}` : ""}` : "Distribution"}</h1>
      {error && <p className="mt-4 rounded-lg border border-clay/40 bg-surface px-4 py-3 text-sm text-clay">{error}</p>}
      {!d && !error && <p className="mt-4 text-muted">Loading…</p>}
      {d && (
        <>
          <p className="mt-2 text-sm text-muted">
            Recorded {d.date} by {d.recordedBy} {d.source === "kobo" ? "in KoboCollect" : "in the app"}.{" "}
            {d.status === "accepted" ? `Approved by ${d.decided?.byName ?? "the project manager"}.` : sentBack ? `Sent back by ${d.decided?.byName ?? "the project manager"}.` : canDecide ? "Waiting for your approval." : "Waiting for the project manager to approve."}
          </p>

          {sentBack && (
            <div className="mt-4 rounded-xl border border-clay/40 bg-clay-soft px-4 py-3 text-sm text-clay">
              <p className="font-semibold">What needs fixing</p>
              <p className="mt-1">{d.decided?.note ?? "No reason was given."}</p>
            </div>
          )}

          <section className="mt-6 rounded-xl border border-line bg-surface px-4 py-3">
            <h2 className="font-medium">Handed out</h2>
            <ul className="mt-1 text-sm">
              {d.items.map((i) => (
                <li key={i.key}>
                  {i.qty} {i.unit} {i.item}
                </li>
              ))}
              {!d.items.length && <li className="text-clay">Nothing is recorded as given.</li>}
            </ul>
            <p className="mt-2 text-sm text-muted">
              Recipient: {d.gender ?? "sex not recorded"} · Signature or thumbprint: {d.signed ? "confirmed" : "not confirmed"} · Photo of the signed list: {d.photo ? "attached" : "missing"}
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
            {!d.gate.ok && pending && <p className="mt-2 text-sm text-clay">{d.items.length ? "This can't be approved until the goods received note is signed and the quantity is within what was received." : d.gate.block}</p>}
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

          {/* From KoboCollect: checked first by whoever this project names for KoboCollect data. */}
          {pending && !done && d.koboCheck?.needed && (
            <section className="mt-6 rounded-xl border border-ochre/40 bg-ochre-soft px-4 py-3 text-sm" aria-live="polite">
              <p className="font-semibold">Step 1 of 2: check the KoboCollect record</p>
              <p className="mt-1">
                This record came from a phone in the field. {d.koboCheck.by} checks KoboCollect data on this project. Once that is done, the project manager can approve it.
              </p>
              {canCheckKobo && (
                <button type="button" className={`${primaryBtn} mt-3`} disabled={busy} onClick={checkKobo}>
                  I have checked this record
                </button>
              )}
            </section>
          )}
          {d.koboCheck?.done && pending && !done && <p className="mt-6 text-sm text-muted">KoboCollect record checked by {d.koboCheck.done.byName}.</p>}
          {pending && canDecide && !done && (
            <section className="mt-6">
              <label className="block text-sm font-medium" htmlFor="note">
                Note (needed to send it back)
              </label>
              <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder="What needs fixing" />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} disabled={busy || !d.gate.ok || !!d.koboCheck?.needed} onClick={() => decide("approved")}>
                  Approve
                </button>
                <button type="button" className={quietBtn} disabled={busy || !note.trim()} onClick={() => decide("sent_back")}>
                  Send back
                </button>
              </div>
            </section>
          )}
          {sentBack && canFix && !done && (
            <section className="mt-6 rounded-xl border border-forest/40 bg-mist px-4 py-4" aria-labelledby="fix">
              <h2 id="fix" className="font-medium">
                Fix it and send it again
              </h2>
              <p className="mt-1 text-sm text-muted">Correct what was recorded. The project manager is told at once and checks it again.</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {fixable(d).map((i) => (
                  <label key={i.key} className="block text-sm font-medium">
                    {i.item} handed out ({i.unit})
                    <input type="number" min={0} step="any" inputMode="decimal" value={fix.qty[i.key] ?? ""} onChange={(e) => setFix((f) => ({ ...f, qty: { ...f.qty, [i.key]: e.target.value } }))} className={field} />
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={fix.signed} onChange={(e) => setFix((f) => ({ ...f, signed: e.target.checked }))} />
                The recipient&apos;s signature or thumbprint is on the list
              </label>
              <label className="mt-2 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={fix.photo} onChange={(e) => setFix((f) => ({ ...f, photo: e.target.checked }))} />
                A photo of the signed list is on the farmer&apos;s record
              </label>
              <label className="mt-3 block text-sm font-medium" htmlFor="fixed">
                What you fixed
              </label>
              <textarea id="fixed" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={field} placeholder="For example: got the thumbprint; the amount handed out was lower" />
              <button type="button" className={`${primaryBtn} mt-3`} disabled={busy || !note.trim()} onClick={sendAgain}>
                Send it again
              </button>
              {!note.trim() && <p className="mt-2 text-xs text-muted">Say what you fixed to send it.</p>}
            </section>
          )}
          {sentBack && !canFix && !done && <p className="mt-6 text-sm text-muted">The person who recorded it has a task to fix it and send it again.</p>}
          {pending && !canDecide && !done && <p className="mt-6 text-sm text-muted">Only the project manager approves distributions.</p>}

          {done && (
            <section className="mt-6 rounded-xl bg-mist px-4 py-3 text-sm" aria-live="polite">
              <p className="font-semibold">{done === "approved" ? "Approved." : done === "sent_back" ? "Sent back." : "Sent again."}</p>
              {done === "approved" && (
                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                  <li>{counted ? `Results: one farmer added to the target "${counted}". It counts once MEL accepts it.` : "Results: not added to a target. Nobody has chosen the target that counts distributions (Field activities, Input package)."}</li>
                  {reached.length > 0 && <li>Procurement: added to the distribution list on {reached.join(" and ")}.</li>}
                  <li>Finance: told when the purchase has a payment to release.</li>
                  <li>Audit log: your decision is recorded.</li>
                </ul>
              )}
              {done === "sent_back" && <p className="mt-1">{reached.length ? "The person who recorded it has a task to fix it and send it again. Nothing counts until you approve it." : "Nobody on this project can change field records, so no one has the task. Ask an administrator to add a storekeeper or extension agent."}</p>}
              {done === "resubmit" && <p className="mt-1">The project manager has been told and will check it again. Your task is closed.</p>}
              {user && (
                <Link href="/home" className="mt-2 inline-block font-semibold text-forest hover:underline">
                  Back to Home
                </Link>
              )}
            </section>
          )}

          {d.history.length > 0 && (
            <section className="mt-6 text-sm">
              <h2 className="font-medium">Earlier rounds</h2>
              <ol className="mt-1 space-y-2">
                {d.history.map((h, k) => (
                  <li key={k} className="rounded-lg border border-line px-3 py-2 text-muted">
                    <span className="block">
                      {h.sentBack.at.slice(0, 10)} · Sent back by {h.sentBack.byName}: {h.sentBack.note}
                    </span>
                    <span className="block">
                      {h.fixed.at.slice(0, 10)} · Fixed by {h.fixed.byName}: {h.fixed.note}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {d.notified && !d.notified.emailed && d.notified.why && <p className="mt-6 text-xs text-muted">Not emailed: {d.notified.why}.</p>}
        </>
      )}
    </main>
  );
}
