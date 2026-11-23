"use client";

import { useState } from "react";
import { useSession } from "@/components/app/session";
import { useSubmissions } from "@/components/app/use-project-data";
import { Pill, SectionLabel, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { dataFlags, formLabel, personName, type Submission } from "@/lib/project";
import type { SyncCounts } from "@/lib/kobo-setup";

/**
 * Field forms waiting to be checked: readiness visits, training attendance and farm visits from
 * KoboCollect (and the demo's sample records). It sits on Results and proof so MEL checks
 * everything in one place. Accepting a record is what moves the farmer in Field activities;
 * nothing changes until a named person accepts it. Who may decide each record comes from the server
 * (the project's KoboCollect approval rule; nobody decides their own).
 */
export function FieldRecords({ code }: { code: string }) {
  const { user } = useSession();
  const kobo = useSubmissions(code);
  const [querying, setQuerying] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<{ ok: boolean; text: string } | null>(null);

  const all = kobo.submissions;
  // Input distributions are approved by the project manager (Home, or the email link), not here.
  // Records this person decides come first; the rest show who they are waiting on.
  const pending = all.filter((s) => s.status === "pending" && s.form !== "distribution").sort((a, b) => Number(!!b.mayDecide) - Number(!!a.mayDecide));
  const forMe = pending.filter((s) => s.mayDecide).length;
  const queried = all.filter((s) => s.status === "queried" && s.form !== "distribution");
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
      return `${subs.length} record${subs.length === 1 ? "" : "s"} ${status === "accepted" ? "accepted" : "queried"}.`;
    });
  const synced = (r: SyncCounts) => `Synced: ${r.fetched} on KoboToolbox, ${r.added} new${r.updated ? `, ${r.updated} changed` : ""}${r.removed ? `, ${r.removed} deleted in KoboToolbox` : ""}.`;

  if (user?.kind !== "employee") return null;

  return (
    <section id="field-records" className="mt-8 scroll-mt-24 rounded-2xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel>
            Field forms to check · {forMe} for you{pending.length > forMe ? `, ${pending.length - forMe} waiting on others` : ""}
          </SectionLabel>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Readiness visits, training attendance and farm visits from KoboCollect. Accepting one records it on the farmer in Field activities; a query sends it back to whoever collected it.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" disabled={!!busy} onClick={() => run("sync", async () => synced(await kobo.sync()))} className={`${quietBtn} py-1.5`}>
            {busy === "sync" ? "Syncing…" : "Sync from KoboToolbox"}
          </button>
          <button
            type="button"
            disabled={!!busy}
            onClick={() =>
              run("push", async () => {
                const r = await kobo.pushFarmers();
                return `Farmer list sent to ${r.forms} form${r.forms === 1 ? "" : "s"} (${r.farmers} farmers)${r.redeployed ? "." : ". Redeploy the forms in KoboToolbox so phones get it."}`;
              })
            }
            className={`${quietBtn} py-1.5`}
          >
            {busy === "push" ? "Sending…" : "Send farmer list to KoboToolbox"}
          </button>
        </div>
      </div>

      {(outcome || kobo.error) && (
        <p role="status" className={`mt-3 rounded-xl border px-4 py-3 text-sm ${outcome?.ok ? "border-forest/30 bg-mist text-leaf" : "border-clay/40 bg-clay-soft text-clay"}`}>
          {outcome?.text ?? kobo.error}
        </p>
      )}

      {clean.length > 1 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl bg-mist px-4 py-3 text-sm">
          <span className="me-auto">{clean.length} have no problems flagged.</span>
          <button type="button" disabled={!!busy} onClick={() => void decide(clean, "accepted")} className={`${primaryBtn} py-1.5`}>
            Accept all {clean.length}
          </button>
        </div>
      )}

      <ul className="mt-4 space-y-2">
        {pending.map((s) => {
          const flags = flagsOf(s);
          return (
            <li key={s.id} className={`rounded-xl border p-4 ${flags.length ? "border-clay/40" : "border-line"}`}>
              <div className="flex flex-wrap items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{formLabel[s.form]}</span> · Farmer {s.farmerId}{" "}
                    <Pill tone={s.source === "kobo" ? "sky" : "muted"}>{s.source === "kobo" ? "KoboCollect" : "Sample"}</Pill>
                  </p>
                  <p className="mt-0.5 text-xs text-muted">
                    {s.date} · collected by {name(s.enumerator)} · <span className="font-mono">{s.id}</span>
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
                  <button type="submit" className={dangerBtn}>
                    Send back with a question
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
            {kobo.status === "loading" ? "Loading field forms…" : "Nothing waiting. New submissions arrive with the nightly sync, or press Sync from KoboToolbox."}
          </li>
        )}
      </ul>
      {queried.length > 0 && (
        <p className="mt-3 text-xs text-muted">
          {queried.length} queried and back with whoever collected {queried.length === 1 ? "it" : "them"}: {queried.map((s) => `${s.id} (farmer ${s.farmerId})`).join(", ")}.
        </p>
      )}
    </section>
  );
}
