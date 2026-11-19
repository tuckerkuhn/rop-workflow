"use client";

import { Arrow } from "@/components/app/arrow";
import { plainError } from "@/lib/plain-error";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { DistView } from "@/server/distribution";
import { qtyItem } from "@/lib/package";

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
  const { tx } = useT();
  const [d, setD] = useState<DistView | null>(null);
  const [notePhoto, setNotePhoto] = useState<{ src: string; date: string } | null>(null);
  // From the email link without signing in, the photo is held back: it can show farmers' names.
  const [photoNeedsSignIn, setPhotoNeedsSignIn] = useState(false);
  const [canDecide, setCanDecide] = useState(false);
  const [canFix, setCanFix] = useState(false);
  const [canCheckKobo, setCanCheckKobo] = useState(false);
  const [fix, setFix] = useState<{ qty: Record<string, string>; signed: boolean; photo: boolean; conditionOk: boolean }>({ qty: {}, signed: false, photo: false, conditionOk: false });
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"" | "approved" | "sent_back" | "resubmit">("");
  /** After a decision: the purchases whose lists grew, or who has the task to fix it. */
  const [reached, setReached] = useState<string[]>([]);
  // The target the approval added a result to, when it added one.
  const [counted, setCounted] = useState<string | null>(null);
  // Other distributions waiting for this person, oldest first: after a decision, the next one is a click away.
  const [waiting, setWaiting] = useState<{ id: string; farmerId: string }[]>([]);
  const url = `/api/projects/${encodeURIComponent(code)}/distributions/${id}`;
  const headers = { "Content-Type": "application/json", "x-demo-user": user?.id ?? "" };

  const load = useCallback(async () => {
    const res = await fetch(`${url}${token ? `?t=${encodeURIComponent(token)}` : ""}`, { cache: "no-store", headers: { "x-demo-user": user?.id ?? "" } });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? plainError(res.status));
    const dist = body.distribution as DistView;
    setD(dist);
    setNotePhoto(body.notePhoto ?? null);
    setPhotoNeedsSignIn(!!body.photoNeedsSignIn);
    setCanDecide(body.canDecide);
    setCanFix(!!body.canFix);
    setCanCheckKobo(!!body.canCheckKobo);
    setWaiting(body.waiting ?? []);
    // Every item of the farmer's planned package can be corrected, including one recorded as not given (0).
    setFix({ qty: Object.fromEntries(fixable(dist).map((i) => [i.key, String(dist.items.find((x) => x.key === i.key)?.qty ?? 0)])), signed: dist.signed, photo: dist.photo, conditionOk: false });
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
    if (!res.ok) return setError(body.error ?? plainError(res.status));
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
    if (!res.ok) return setError(body.error ?? plainError(res.status));
    setD(body.distribution);
    setError("");
  }

  async function sendAgain() {
    const num = (v: string) => (v.trim() === "" || !Number.isFinite(Number(v)) || Number(v) < 0 ? undefined : Number(v));
    setBusy(true);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify({ decision: "resubmit", note: note.trim(), fix: { qty: Object.fromEntries(Object.entries(fix.qty).flatMap(([k, v]) => (num(v) === undefined ? [] : [[k, num(v)]]))), signed: fix.signed, photo: fix.photo, ...(d?.condition && fix.conditionOk ? { conditionOk: true } : {}) } }) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? plainError(res.status));
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
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-warn">{tx("Project {code} · input distribution", { code })}</p>
      <h1 className="mt-1 font-display text-3xl tracking-tight">{d ? `${d.farmerId}${d.village ? `, ${d.village}` : ""}` : tx("Distribution")}</h1>
      {error && <p className="mt-4 rounded-lg border border-clay/40 bg-surface px-4 py-3 text-sm text-clay">{error}</p>}
      {!d && !error && <p className="mt-4 text-muted">{tx("Loading…")}</p>}
      {d && (
        <>
          <p className="mt-2 text-sm text-muted">
            {d.source === "kobo" ? tx("Recorded {date} by {name} in KoboCollect.", { date: d.date, name: d.recordedBy }) : tx("Recorded {date} by {name} in the app.", { date: d.date, name: d.recordedBy })}{" "}
            {d.status === "accepted"
              ? d.decided?.byName
                ? tx("Approved by {name}.", { name: d.decided.byName })
                : tx("Approved by the project manager.")
              : sentBack
                ? d.decided?.byName
                  ? tx("Sent back by {name}.", { name: d.decided.byName })
                  : tx("Sent back by the project manager.")
                : canDecide
                  ? tx("Waiting for your approval.")
                  : d.approverNames
                    ? tx("Waiting for {names} to approve.", { names: d.approverNames })
                    : tx("Waiting for the project manager to approve.")}
            {pending && !canDecide && user && d.approvers && !d.approvers.includes(user.id) && user.field.includes("manager") ? <>{" "}{tx("You recorded this one, and nobody approves their own record.")}</> : ""}
          </p>

          {sentBack && (
            <div className="mt-4 rounded-xl border border-clay/40 bg-clay-soft px-4 py-3 text-sm text-clay">
              <p className="font-semibold">{tx("What needs fixing")}</p>
              <p className="mt-1">{d.decided?.note ?? tx("No reason was given.")}</p>
            </div>
          )}

          <section className="mt-6 rounded-xl border border-line bg-surface px-4 py-3">
            <h2 className="font-medium">{tx("Handed out")}</h2>
            <ul className="mt-1 text-sm">
              {d.items.map((i) => (
                <li key={i.key}>
                  {qtyItem(i.qty, i.unit, i.item)}
                </li>
              ))}
              {!d.items.length && <li className="text-clay">{tx("Nothing is recorded as given.")}</li>}
            </ul>
            <p className="mt-2 text-sm text-muted">
              {tx("Recipient: {gender}", { gender: d.gender ?? tx("sex not recorded") })} · {d.signed ? tx("Signature or thumbprint: confirmed") : tx("Signature or thumbprint: not confirmed")} · {tx("Photo of the signed goods received note:")}{" "}
              {d.source === "kobo" ? (d.photo ? tx("attached in KoboToolbox") : tx("missing")) : notePhoto ? tx("below") : photoNeedsSignIn ? tx("sign in to see it") : <span className="text-clay">{d.photo ? tx("ticked as taken, but none is attached") : tx("missing")}</span>}
            </p>
            {photoNeedsSignIn && (
              <p className="mt-2 text-sm">
                {tx("The photo can show farmers’ names, so it opens only when you are signed in.")}{" "}
                <Link href={`/approve/${encodeURIComponent(code)}/${id}`} className="font-medium text-forest underline">
                  {tx("Sign in to see the photo")}
                </Link>
              </p>
            )}
            {notePhoto && (
              <figure className="mt-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- a stored data URL, not a static asset */}
                <img src={notePhoto.src} alt={tx("Signed goods received note for {id}", { id: d.farmerId })} className="max-h-96 w-full rounded-lg border border-line bg-mist object-contain" />
                <figcaption className="mt-1 text-xs text-muted">
                  {tx("Signed goods received note, photographed {date}. Check the signature or thumbprint and the quantities before approving.", { date: notePhoto.date })}
                </figcaption>
              </figure>
            )}
          </section>

          <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
            <h2 className="font-medium">{tx("Goods received and quantities")}</h2>
            <ul className="mt-1 space-y-1 text-sm">
              {d.gate.lines.map((l) => (
                <li key={l.key} className={l.ok ? "" : "text-clay"}>
                  {l.ok ? "✓" : "✗"} {l.detail}
                </li>
              ))}
            </ul>
            {!d.gate.ok && pending && <p className="mt-2 text-sm text-clay">{d.items.length ? tx("This can't be approved until the goods received note is signed and the quantity is within what was received.") : d.gate.block}</p>}
          </section>

          {/* The signed note closes a distribution: say so before the tap, with what to do instead. */}
          {pending && d.closeBlock && (
            <section className="mt-4 rounded-xl border border-clay/40 bg-clay-soft px-4 py-3 text-sm text-clay" aria-live="polite">
              <p className="font-semibold">{tx("This cannot be approved yet")}</p>
              <p className="mt-1">{d.closeBlock}</p>
            </section>
          )}

          <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-3">
            <h2 className="font-medium">{tx("To look at")}</h2>
            {d.flags.length ? (
              <ul className="mt-1 list-disc space-y-1 ps-5 text-sm">
                {d.flags.map((f) => (
                  <li key={f.id}>{f.text}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-muted">{tx("Nothing flagged.")}</p>
            )}
          </section>

          {/* From KoboCollect: checked first by whoever this project names for KoboCollect data. */}
          {pending && !done && d.koboCheck?.needed && (
            <section className="mt-6 rounded-xl border border-ochre/40 bg-ochre-soft px-4 py-3 text-sm" aria-live="polite">
              <p className="font-semibold">{tx("Step 1 of 2: check the KoboCollect record")}</p>
              <p className="mt-1">
                {tx("This record came from a phone in the field. {name} checks KoboCollect data on this project. Once that is done, the project manager can approve it.", { name: d.koboCheck.by })}
              </p>
              {canCheckKobo && (
                <button type="button" className={`${primaryBtn} mt-3`} disabled={busy} onClick={checkKobo}>
                  {tx("I have checked this record")}
                </button>
              )}
            </section>
          )}
          {d.koboCheck?.done && pending && !done && <p className="mt-6 text-sm text-muted">{tx("KoboCollect record checked by {name}.", { name: d.koboCheck.done.byName })}</p>}
          {pending && canDecide && !done && (
            <section className="mt-6">
              <label className="block text-sm font-medium" htmlFor="note">
                {tx("Note (needed to send it back)")}
              </label>
              <textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm" placeholder={tx("What needs fixing")} />
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className={primaryBtn} disabled={busy || !d.gate.ok || !!d.closeBlock || !!d.koboCheck?.needed} onClick={() => decide("approved")}>
                  {busy ? tx("Saving…") : tx("Approve")}
                </button>
                <button type="button" className={quietBtn} disabled={busy || !note.trim()} onClick={() => decide("sent_back")}>
                  {tx("Send back")}
                </button>
              </div>
            </section>
          )}
          {sentBack && canFix && !done && (
            <section className="mt-6 rounded-xl border border-forest/40 bg-mist px-4 py-4" aria-labelledby="fix">
              <h2 id="fix" className="font-medium">
                {tx("Fix it and send it again")}
              </h2>
              <p className="mt-1 text-sm text-muted">{tx("Correct what was recorded. The project manager is told at once and checks it again.")}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {fixable(d).map((i) => (
                  <label key={i.key} className="block text-sm font-medium">
                    {tx("{item} handed out ({unit})", { item: i.item, unit: i.unit })}
                    <input type="number" min={0} step="any" inputMode="decimal" value={fix.qty[i.key] ?? ""} onChange={(e) => setFix((f) => ({ ...f, qty: { ...f.qty, [i.key]: e.target.value } }))} className={field} />
                  </label>
                ))}
              </div>
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-0.5 h-4 w-4" checked={fix.signed} onChange={(e) => setFix((f) => ({ ...f, signed: e.target.checked }))} />
                {tx("The recipient signed or thumbprinted the goods received note: received in acceptable condition and responsible from now on")}
              </label>
              {d.source === "kobo" ? (
                <label className="mt-2 flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={fix.photo} onChange={(e) => setFix((f) => ({ ...f, photo: e.target.checked }))} />
                  {tx("A photo of the signed note is on the farmer’s record")}
                </label>
              ) : (
                !d.photo && <p className="mt-2 text-sm">{tx("Add the photo of the signed note on the farmer’s record in Field activities first. It is picked up when you send this again.")}</p>
              )}
              {d.condition && (
                <label className="mt-2 flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={fix.conditionOk} onChange={(e) => setFix((f) => ({ ...f, conditionOk: e.target.checked }))} />
                  {tx("Damaged items were replaced or taken off the amounts above, and the recipient accepted the rest in acceptable condition")}
                </label>
              )}
              <label className="mt-3 block text-sm font-medium" htmlFor="fixed">
                {tx("What you fixed")}
              </label>
              <textarea id="fixed" value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={field} placeholder={tx("For example: got the thumbprint; the amount handed out was lower")} />
              <button type="button" className={`${primaryBtn} mt-3`} disabled={busy || !note.trim()} onClick={sendAgain}>
                {tx("Send it again")}
              </button>
              {!note.trim() && <p className="mt-2 text-xs text-muted">{tx("Say what you fixed to send it.")}</p>}
            </section>
          )}
          {sentBack && !canFix && !done && <p className="mt-6 text-sm text-muted">{tx("The person who recorded it has a task to fix it and send it again.")}</p>}
          {pending && !canDecide && !done && <p className="mt-6 text-sm text-muted">{tx("Only the project manager approves distributions.")}</p>}

          {done && (
            <section className="mt-6 rounded-xl bg-mist px-4 py-3 text-sm" aria-live="polite">
              <p className="font-semibold">{done === "approved" ? tx("Approved.") : done === "sent_back" ? tx("Sent back.") : tx("Sent again.")}</p>
              {done === "approved" && (
                <ul className="mt-1 list-disc space-y-0.5 ps-5">
                  <li>{counted ? tx("Results: one farmer added to the target \"{target}\". It counts once MEL accepts it.", { target: counted }) : tx("Results: not added to a target. Nobody has chosen the target that counts distributions (Field activities, Input package).")}</li>
                  {reached.length > 0 && <li>{tx("Procurement: added to the distribution list on {list}.", { list: reached.join(tx(" and ")) })}</li>}
                  <li>{tx("Finance: told when the purchase has a payment to release.")}</li>
                  <li>{tx("Audit log: your decision is recorded.")}</li>
                </ul>
              )}
              {done === "sent_back" && <p className="mt-1">{reached.length ? tx("The person who recorded it has a task to fix it and send it again. Nothing counts until you approve it.") : tx("Nobody on this project can change field records, so no one has the task. Ask an administrator to add a storekeeper or extension agent.")}</p>}
              {done === "resubmit" && <p className="mt-1">{tx("The project manager has been told and will check it again. Your task is closed.")}</p>}
              {user && (
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  {waiting.length > 0 && (done === "approved" || done === "sent_back") && (
                    <Link href={`/approve/${encodeURIComponent(code)}/${waiting[0].id}`} className={primaryBtn}>
                      {tx("Next: farmer {id} ({n} left)", { id: waiting[0].farmerId, n: waiting.length })} <Arrow />
                    </Link>
                  )}
                  <Link href="/home" className="font-semibold text-forest hover:underline">
                    {tx("Back to Home")}
                  </Link>
                </div>
              )}
            </section>
          )}

          {d.history.length > 0 && (
            <section className="mt-6 text-sm">
              <h2 className="font-medium">{tx("Earlier rounds")}</h2>
              <ol className="mt-1 space-y-2">
                {d.history.map((h, k) => (
                  <li key={k} className="rounded-lg border border-line px-3 py-2 text-muted">
                    <span className="block">
                      {h.sentBack.at.slice(0, 10)} · {tx("Sent back by {name}: {note}", { name: h.sentBack.byName, note: h.sentBack.note ?? "" })}
                    </span>
                    <span className="block">
                      {h.fixed.at.slice(0, 10)} · {tx("Fixed by {name}: {note}", { name: h.fixed.byName, note: h.fixed.note })}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          )}
          {d.notified && !d.notified.emailed && d.notified.why && <p className="mt-6 text-xs text-muted">{tx("Not emailed: {why}.", { why: d.notified.why })}</p>}
        </>
      )}
    </main>
  );
}
