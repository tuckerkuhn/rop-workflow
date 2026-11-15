"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { field } from "@/components/setup/question";
import { primaryBtn } from "@/components/workspace/ui";
import type { KoboApproval } from "@/lib/kobo-approval";

type View = { rule: KoboApproval; options: { id: KoboApproval["who"]; label: string; help: string }[]; people: { id: string; name: string; title: string }[]; approvers: string; canEdit: boolean; accounts: { account: string; person: string | null; saved: boolean }[] };

/**
 * Who approves what arrives from KoboCollect on this project (lib/kobo-approval): one choice,
 * three options. Nothing from a phone reaches targets, the field steps or the project manager
 * until that person has looked.
 */
export function KoboApprovalSetting({ code }: { code: string }) {
  const { user } = useSession();
  const [v, setV] = useState<View | null>(null);
  const [rule, setRule] = useState<KoboApproval>({ who: "mel" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const url = `/api/projects/${encodeURIComponent(code)}/kobo/approval`;

  useEffect(() => {
    if (!user) return;
    let live = true;
    fetch(url, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: View | null) => {
        if (!live || !d) return;
        setV(d);
        setRule(d.rule);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [url, user]);

  if (!v || !user) return null;
  const changed = JSON.stringify(rule) !== JSON.stringify(v.rule);
  const save = async () => {
    setBusy(true);
    setError("");
    const res = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify(rule) });
    const body = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(body.error ?? `Not saved (${res.status}).`);
    setV({ ...v, rule: body.rule, approvers: body.approvers });
    setRule(body.rule);
    setSaved(true);
  };
  const pick = (patch: Partial<KoboApproval>) => {
    setSaved(false);
    setRule((r) => ({ ...r, ...patch }));
  };

  return (
    <section className="mt-8 rounded-2xl border border-line p-4">
      <h3 className="font-semibold">Who approves KoboCollect data</h3>
      <p className="mt-1 text-sm text-muted">Nothing sent from a phone counts toward a target, moves a farmer on or reaches the project manager until this person has looked. Now: {v.approvers}.</p>
      <fieldset disabled={!v.canEdit || busy} className="mt-3 space-y-2">
        {v.options.map((o) => (
          <label key={o.id} className={`flex cursor-pointer gap-3 rounded-xl border px-3 py-2.5 text-sm ${rule.who === o.id ? "border-forest bg-mist" : "border-line"}`}>
            <input type="radio" name="kobo-approval" className="mt-1" checked={rule.who === o.id} onChange={() => pick(o.id === "named" ? { who: "named" } : { who: o.id, person: undefined, standIn: undefined })} />
            <span>
              <span className="font-medium">{o.label}</span>
              <span className="block text-muted">{o.help}</span>
            </span>
          </label>
        ))}
        {rule.who === "named" && (
          <div className="grid gap-3 pt-1 sm:grid-cols-2">
            <label className="block text-sm font-medium">
              Approves
              <select value={rule.person ?? ""} onChange={(e) => pick({ person: e.target.value || undefined })} className={`mt-1 ${field}`}>
                <option value="">Choose a person</option>
                {v.people.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}, {p.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm font-medium">
              Stand-in when they are away
              <select value={rule.standIn ?? ""} onChange={(e) => pick({ standIn: e.target.value || undefined })} className={`mt-1 ${field}`}>
                <option value="">No stand-in</option>
                {v.people
                  .filter((p) => p.id !== rule.person)
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}, {p.title}
                    </option>
                  ))}
              </select>
            </label>
            {!rule.standIn && <p className="text-sm text-muted sm:col-span-2">With no stand-in, field data waits whenever this person is away. In the last week of a planting window that can hold farmers up.</p>}
          </div>
        )}
      </fieldset>
      <div className="mt-5 border-t border-line pt-4">
        <h4 className="text-sm font-semibold">Whose KoboCollect account is whose</h4>
        <p className="mt-1 text-sm text-muted">Every record carries the account that sent it. Match each account to a person and the app makes sure nobody approves what they collected: it goes to another approver, or to the person the collector reports to.</p>
        {v.accounts.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No account has sent a record to this project yet. They appear here after the first sync.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {v.accounts.map((a) => {
              const chosen = rule.accounts?.[a.account] ?? (a.saved ? "" : (a.person ?? ""));
              return (
                <li key={a.account} className="grid items-center gap-2 text-sm sm:grid-cols-[1fr_1.4fr]">
                  <span className="font-mono text-xs">{a.account}</span>
                  <select aria-label={`Who uses the account ${a.account}`} disabled={!v.canEdit || busy} value={chosen} onChange={(e) => pick({ accounts: { ...(rule.accounts ?? {}), [a.account]: e.target.value } })} className={field}>
                    <option value="">Not matched: the app cannot tell who collected</option>
                    {v.people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}, {p.title}
                      </option>
                    ))}
                  </select>
                </li>
              );
            })}
          </ul>
        )}
        {v.accounts.some((a) => !(rule.accounts?.[a.account] ?? a.person)) && <p className="mt-2 rounded-xl bg-ochre-soft px-3 py-2 text-sm">Some accounts are not matched to a person. Records from them can be approved by anyone who approves KoboCollect data, including the person who collected them.</p>}
      </div>
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}
      {v.canEdit ? (
        <div className="mt-3 flex items-center gap-3">
          <button type="button" className={primaryBtn} disabled={busy || !changed} onClick={save}>
            Save
          </button>
          {saved && !changed && <span className="text-sm text-muted">Saved. It applies from the next record.</span>}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted">The project manager, plan approvers and administrators can change this.</p>
      )}
    </section>
  );
}
