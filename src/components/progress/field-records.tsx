"use client";

import { sourceText } from "@/lib/form-record";
import { useState } from "react";
import { askConfirm } from "@/components/app/dialogs";
import { useSession } from "@/components/app/session";
import { useSubmissions } from "@/components/app/use-project-data";
import { RecordProof } from "@/components/field/record-proof";
import { Pill, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { dataFlags, formLabel, personName, whoOf, type Submission } from "@/lib/project";
import { longDate } from "@/lib/weekly";

/**
 * Field forms waiting to be checked: readiness visits, training attendance and farm visits from
 * KoboCollect (and the demo's sample records). They are the second part of the one "To check"
 * place on Results and proof (results-page ToCheck), so MEL checks everything in one place.
 * Accepting a record is what moves the farmer in Field activities; nothing changes until a named
 * person accepts it. Who may decide each record comes from the server (the project's KoboCollect
 * approval rule; nobody decides their own). The technical lead may send a field form back with a
 * note (`maySendBack`), but not accept it.
 *
 * `useFieldForms` holds the records and the actions; the page uses it for the counts and the
 * "Accept all" button at the top of "To check", and `FieldRecords` shows the records themselves.
 */
export function useFieldForms(code: string, wanted = true) {
  const { user } = useSession();
  const kobo = useSubmissions(code, wanted);
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const all = kobo.submissions;
  // Input distributions are approved by the project manager (Home, or the email link), not here.
  // Records this person decides come first; the rest show who they are waiting on.
  const pending = all.filter((s) => s.status === "pending" && s.form !== "distribution").sort((a, b) => Number(!!b.mayDecide) - Number(!!a.mayDecide));
  const forMe = pending.filter((s) => s.mayDecide).length;
  // The technical lead's: forms they may send back for correction, not accept.
  const toSendBack = pending.filter((s) => s.maySendBack).length;
  const queried = all.filter((s) => s.status === "queried" && s.form !== "distribution");
  // Session records accepted for everyone but a farmer held in Farmer selection: that farmer stays open here.
  const heldOpen = all.filter((s) => s.status === "accepted" && s.form === "training" && (s.held?.length ?? 0) > 0);
  const flagsOf = (s: Submission) => dataFlags(s, all, kobo.roster);
  const clean = pending.filter((s) => s.mayDecide && flagsOf(s).length === 0);
  const name = (id: string) => personName(id) || id;

  const run = async (what: string, fn: () => Promise<string>) => {
    setBusy(what);
    setOutcome(null);
    try {
      setOutcome({ ok: true, text: await fn() });
    } catch (e) {
      setOutcome({ ok: false, text: e instanceof Error ? e.message : String(e) });
    }
    setBusy(null);
  };
  const decide = (subs: Submission[], status: "accepted" | "queried", why?: string) =>
    run(`decide-${subs[0]?.id}`, async () => {
      const applied = await kobo.decide(subs.map((x) => x.dbId!).filter(Boolean), status, why);
      if (applied.length) return `Field activities updated: ${applied.join(" ")}`;
      if (status === "queried" && subs.length === 1) return `Sent back to ${name(subs[0].enumerator)} with your note.`;
      return `${subs.length} record${subs.length === 1 ? "" : "s"} ${status === "accepted" ? "accepted" : "queried"}.`;
    });
  const settleHeld = (s: Submission, farmer: string, action: "record" | "leave_out") => run(`held-${s.id}-${farmer}`, async () => (action === "record" ? `Field activities updated: ${await kobo.settleHeld(s.dbId!, farmer, action)}` : await kobo.settleHeld(s.dbId!, farmer, action)));
  return { show: user?.kind === "employee", code, userId: user?.id ?? "", kobo, pending, forMe, toSendBack, queried, heldOpen, clean, flagsOf, name, busy, outcome, run, decide, settleHeld };
}
export type FieldForms = ReturnType<typeof useFieldForms>;

export function FieldRecords({ f, open, onToggle }: { f: FieldForms; open: boolean; onToggle: () => void }) {
  const { code, userId, kobo, pending, forMe, toSendBack, queried, heldOpen, flagsOf, name, busy, outcome, decide, settleHeld } = f;
  const [querying, setQuerying] = useState<string | null>(null);
  // Records whose photo and place the checker has opened.
  const [proofOpen, setProofOpen] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  if (!f.show) return null;

  return (
    <div id="field-records" className="mt-5 scroll-mt-24 border-t border-line pt-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold">
            Field forms · {toSendBack > 0 && forMe === 0 ? `${toSendBack} you can send back` : `${forMe} for you`}
            {pending.length > forMe && !(toSendBack > 0 && forMe === 0) ? `, ${pending.length - forMe} waiting on others` : ""}
          </h3>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Readiness visits, training attendance and farm visits filled in by field staff. Accepting one records it on the farmer in Field activities; a query sends it back to whoever collected it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {pending.length > 0 && (
            <button type="button" aria-expanded={open} aria-controls="field-records-list" onClick={onToggle} className={`${quietBtn} py-1.5`}>
              {open ? "Hide" : `Review ${pending.length}`}
            </button>
          )}
        </div>
      </div>

      {(outcome || kobo.error) && (
        <p role="status" className={`mt-3 rounded-xl border px-4 py-3 text-sm ${outcome?.ok ? "border-forest/30 bg-mist text-leaf" : "border-clay/40 bg-clay-soft text-clay"}`}>
          {outcome?.text ?? kobo.error}
        </p>
      )}

      {heldOpen.length > 0 && (
        <ul className="mt-4 space-y-2" aria-label="Farmers left open on a training record">
          {heldOpen.map((s) => (
            <li key={s.id} className="rounded-xl border border-clay/40 p-4" data-held={s.id}>
              <p className="text-sm">
                <span className="font-medium">{formLabel[s.form]}</span> · {s.fields.session || "Session"} · {/^\d{4}-\d{2}-\d{2}$/.test(s.date) ? longDate(s.date) : s.date} · <span className="font-mono">{s.id}</span>
              </p>
              <p className="mt-1 text-sm text-muted">
                Everyone else on this record is recorded. {s.held!.length === 1 ? "One farmer stays open on it" : `${s.held!.length} farmers stay open on it`} until they are recorded or left out.
              </p>
              {s.held!.map((h) => (
                <div key={h.id} className="mt-2 border-t border-line pt-2">
                  <p className="text-sm">
                    {h.why ? `${h.why}. Select them first, or leave them out.` : `${h.id} is selected now. Record their attendance, or leave them out.`}{" "}
                    {h.why && (
                      <a href="/work/selection" className="font-semibold text-forest hover:underline">
                        Open Farmer selection
                      </a>
                    )}
                  </p>
                  {s.mayDecide ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button type="button" disabled={!!busy || !!h.why} onClick={() => void settleHeld(s, h.id, "record")} className={`${primaryBtn} min-h-11`}>
                        Record {h.id}
                      </button>
                      <button type="button" disabled={!!busy} onClick={() => void askConfirm({ message: `Leave ${h.id} out of this training record? Nothing is recorded for them and they do not count as trained. This cannot be undone here.`, confirm: `Leave ${h.id} out`, danger: true }).then((ok) => (ok ? settleHeld(s, h.id, "leave_out") : undefined))} className={`${quietBtn} min-h-11`}>
                        Leave {h.id} out
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1 text-xs text-muted">Waiting on {s.deciders || "MEL"}.</p>
                  )}
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}

      <ul id="field-records-list" className="mt-4 space-y-2">
        {open && pending.map((s) => {
          const flags = flagsOf(s);
          return (
            <li key={s.id} className={`rounded-xl border p-4 ${flags.length ? "border-clay/40" : "border-line"}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{formLabel[s.form]}</span> · {whoOf(s)}{" "}
                    <Pill tone={s.source === "kobo" || s.source === "form" ? "sky" : "muted"}>{s.source === "kobo" ? "KoboCollect" : s.source === "form" ? "In the app" : "Sample"}</Pill>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {/^\d{4}-\d{2}-\d{2}$/.test(s.date) ? longDate(s.date) : s.date} · {sourceText(s.source, s.source === "kobo" ? s.collectorName : (s.recorderName ?? s.collectorName ?? name(s.enumerator)))} · <span className="font-mono">{s.id}</span>
                  </p>
                  {Object.keys(s.fields).length > 0 && (
                    <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      {Object.entries(s.fields).map(([k, v]) => (
                        <div key={k} className="flex gap-1">
                          <dt className="text-muted">{k.replace(/_/g, " ")}:</dt>
                          <dd>{v || "—"}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {/* The proof itself, for a record from a phone: fetched when asked for, so the list stays fast. */}
                  {s.source === "kobo" && s.dbId && (
                    <button type="button" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-forest underline-offset-4 hover:underline" aria-expanded={proofOpen.has(s.id)} onClick={() => setProofOpen((cur) => { const next = new Set(cur); if (next.has(s.id)) next.delete(s.id); else next.add(s.id); return next; })}>
                      {proofOpen.has(s.id) ? "Hide the photo" : s.photo ? "See the photo and where it was recorded" : "See where it was recorded"}
                    </button>
                  )}
                  {s.source === "kobo" && s.dbId && proofOpen.has(s.id) && <RecordProof code={code} id={s.dbId} userId={userId} photo={s.photo} />}
                  {flags.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {flags.map((f) => (
                        <li key={f} className="flex gap-2 text-sm text-clay">
                          <span aria-hidden>◆</span>
                          {f}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {s.mayDecide ? (
                  querying !== s.id && (
                    <div className="flex gap-2">
                      <button type="button" disabled={!!busy} onClick={() => void decide([s], "accepted")} className={`${primaryBtn} py-1.5`}>
                        Accept
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setQuerying(s.id);
                          setNote(flags[0] ?? "");
                        }}
                        className={`${quietBtn} py-1.5`}
                      >
                        Send back with a question
                      </button>
                    </div>
                  )
                ) : s.maySendBack ? (
                  querying !== s.id && (
                    <div className="flex max-w-[18rem] flex-col items-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setQuerying(s.id);
                          setNote(flags[0] ?? "");
                        }}
                        className={`${quietBtn} py-1.5`}
                      >
                        Send back with a note
                      </button>
                      <p className="text-end text-xs text-muted">Only {s.deciders ?? "MEL"} can accept it. If something needs fixing, send it back with a note.</p>
                    </div>
                  )
                ) : (
                  <p className="max-w-[16rem] text-xs text-muted">Waiting on {s.deciders ?? "the reviewer"}.</p>
                )}
              </div>
              {querying === s.id && (
                <form
                  className="mt-3 flex flex-wrap gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!note.trim()) return;
                    void decide([s], "queried", note.trim());
                    setQuerying(null);
                    setNote("");
                  }}
                >
                  <label htmlFor={`q-${s.id}`} className="sr-only">
                    Question for {name(s.enumerator)}
                  </label>
                  <input
                    id={`q-${s.id}`}
                    autoFocus
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder={`What should ${name(s.enumerator)} check or fix?`}
                    className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none"
                  />
                  <button type="submit" disabled={!note.trim()} className={dangerBtn}>
                    {s.mayDecide ? "Send back with a question" : "Send back with a note"}
                  </button>
                  <button type="button" onClick={() => setQuerying(null)} className="px-2 text-sm text-muted hover:text-ink">
                    Cancel
                  </button>
                </form>
              )}
            </li>
          );
        })}
        {pending.length === 0 && (
          <li className="rounded-xl border border-dashed border-line p-4 text-sm text-muted">
            {kobo.status === "loading" ? "Loading field forms…" : "Nothing waiting. Field forms appear here as soon as field staff save them."}
          </li>
        )}
      </ul>
      {queried.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {queried.length} queried and back with whoever collected {queried.length === 1 ? "it" : "them"}: {queried.map((s) => `${s.id} (${whoOf(s).toLowerCase()})`).join(", ")}.
        </p>
      )}
    </div>
  );
}
