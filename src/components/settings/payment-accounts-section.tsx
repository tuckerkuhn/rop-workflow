"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/components/app/session";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";
import type { AccountType } from "@/lib/payment-accounts";

type Acc = { bankAccountId: string; code: string; name: string; currency: string; flags: string[]; registered: null | { owner: string; type: AccountType; institution?: string; last4?: string; signatoryNames: string[]; proposedByName: string; confirmedByName: string; confirmedAt: string } };
type View = { orgName: string; types: Record<AccountType, string>; staff: { id: string; name: string }[]; accounts: Acc[]; pending: { id: string; details: { account: string; owner: string; type: AccountType; institution?: string; last4?: string; signatories: string[] }; byName: string; reason: string; mine: boolean }[] };
const field = "mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm";

/**
 * MF-06: the payment accounts register. Each account the organization pays from, with its owner
 * (always the organization) and type. A change takes effect once a second person confirms it.
 */
export function PaymentAccountsSection() {
  const { user } = useSession();
  const [v, setV] = useState<View | null>(null);
  const [denied, setDenied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [f, setF] = useState({ owner: "", type: "bank" as AccountType, institution: "", last4: "", signatories: [] as string[], reason: "" });
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    if (!user) return;
    const res = await fetch("/api/payment-accounts", { cache: "no-store", headers: { "x-demo-user": user.id } });
    if (res.status === 403) return setDenied(true);
    if (res.ok) setV(await res.json());
  }, [user]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!user || denied) return null;
  if (!v) return <p className="text-sm text-muted">Loading…</p>;
  const post = async (b: unknown) => {
    setError("");
    const res = await fetch("/api/payment-accounts", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user.id }, body: JSON.stringify(b) });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) return setError(body.error ?? plainError(res.status)), false;
    setV(body);
    return true;
  };
  return (
    <div className="text-sm">
      <p className="max-w-2xl text-muted">Every account the organization pays from, in its own name. Adding or changing one needs a second person to confirm it. Cash is flagged on every payment from it.</p>
      {error && (
        <p role="alert" className="mt-2 text-clay">
          {error}
        </p>
      )}
      {!v.accounts.length && <p className="mt-2 text-muted">No bank or cash accounts yet. Finance makes them on a project&apos;s Payments page.</p>}
      <ul className="mt-3 divide-y divide-line border-y border-line">
        {v.accounts.map((a) => (
          <li key={a.bankAccountId} className="py-2">
            <p className="font-semibold">
              {a.code} {a.name} <span className="font-normal text-muted">({a.currency})</span>
            </p>
            {a.registered ? (
              <p>
                {v.types[a.registered.type]}
                {a.registered.institution ? `, ${a.registered.institution}` : ""}
                {a.registered.last4 ? ` ending ${a.registered.last4}` : ""} · in the name of {a.registered.owner} · signs: {a.registered.signatoryNames.join(", ")} · proposed by {a.registered.proposedByName}, confirmed by {a.registered.confirmedByName}
              </p>
            ) : null}
            {a.flags.map((x) => (
              <p key={x} className="text-warn">
                {x}
              </p>
            ))}
            {editing !== a.bankAccountId && !v.pending.some((c) => c.details.account === a.bankAccountId) && (
              <button
                type="button"
                className={`${quietBtn} mt-1`}
                onClick={() => {
                  setEditing(a.bankAccountId);
                  setF({ owner: a.registered?.owner ?? v.orgName, type: a.registered?.type ?? (a.code === "1000" ? "cash" : "bank"), institution: a.registered?.institution ?? "", last4: a.registered?.last4 ?? "", signatories: [], reason: "" });
                }}
              >
                {a.registered ? "Propose a change" : "Add to the register"}
              </button>
            )}
            {editing === a.bankAccountId && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="block font-medium">
                  In the name of
                  <input value={f.owner} onChange={(e) => setF({ ...f, owner: e.target.value })} className={field} />
                </label>
                <label className="block font-medium">
                  Type
                  <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as AccountType })} className={field}>
                    {(Object.keys(v.types) as AccountType[]).map((k) => (
                      <option key={k} value={k}>
                        {v.types[k]}
                      </option>
                    ))}
                  </select>
                </label>
                {f.type !== "cash" && (
                  <label className="block font-medium">
                    Bank or provider
                    <input value={f.institution} onChange={(e) => setF({ ...f, institution: e.target.value })} className={field} />
                  </label>
                )}
                {f.type !== "cash" && (
                  <label className="block font-medium">
                    Last four digits
                    <input value={f.last4} maxLength={4} inputMode="numeric" onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, "") })} className={field} />
                  </label>
                )}
                <label className="block font-medium sm:col-span-2">
                  Who may sign (hold Ctrl or Cmd for more than one)
                  <select multiple value={f.signatories} onChange={(e) => setF({ ...f, signatories: Array.from(e.target.selectedOptions).map((o) => o.value) })} className={`${field} h-28`}>
                    {v.staff.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="block font-medium sm:col-span-2">
                  Why
                  <input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} className={field} />
                </label>
                <div className="flex gap-2 sm:col-span-2">
                  <button
                    type="button"
                    className={primaryBtn}
                    disabled={f.reason.trim().length < 5}
                    onClick={() => void post({ action: "propose", reason: f.reason, details: { account: a.bankAccountId, owner: f.owner, type: f.type, ...(f.institution.trim() ? { institution: f.institution.trim() } : {}), ...(f.last4 ? { last4: f.last4 } : {}), signatories: f.signatories } }).then((ok) => ok && setEditing(null))}
                  >
                    Propose
                  </button>
                  <button type="button" className={quietBtn} onClick={() => setEditing(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </li>
        ))}
      </ul>
      {v.pending.length > 0 && (
        <div className="mt-4">
          <p className="font-semibold">Waiting for a second person</p>
          <ul className="mt-1 space-y-2">
            {v.pending.map((c) => (
              <li key={c.id} className="border border-line p-2">
                {v.types[c.details.type]} in the name of {c.details.owner}
                {c.details.institution ? `, ${c.details.institution}` : ""} · proposed by {c.byName}: {c.reason}
                {c.mine ? (
                  <p className="text-muted">You proposed this: someone else confirms it.</p>
                ) : (
                  <div className="mt-1 flex gap-2">
                    <button type="button" className={primaryBtn} onClick={() => void post({ action: "decide", change: c.id, confirm: true })}>
                      Confirm
                    </button>
                    <button type="button" className={quietBtn} onClick={() => void post({ action: "decide", change: c.id, confirm: false })}>
                      Turn down
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
