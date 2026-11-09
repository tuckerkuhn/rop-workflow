"use client";

import { useCallback, useEffect, useState } from "react";
import { quietBtn } from "@/components/workspace/ui";

/**
 * Read-only links to this quarter's report for the donor. A link shows the release (or, before
 * it, the latest practice copy); it expires after 60 days and can be withdrawn.
 */

type Share = { token: string; quarter: string; by: string; at: string; expires: string; active: boolean };

export function ShareLinks({ project, quarter, user, ready }: { project: string; quarter: string; user: string; ready: boolean }) {
  const [shares, setShares] = useState<Share[] | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const url = `/api/projects/${project}/shares`;
  const load = useCallback(async () => {
    const r = await fetch(`${url}?q=${quarter}`, { cache: "no-store", headers: { "x-demo-user": user } });
    if (r.ok) setShares((await r.json()).shares);
    else setShares(null);
  }, [url, quarter, user]);
  useEffect(() => {
    void load();
  }, [load]);
  if (!shares) return null;
  const act = async (body: object) => {
    setError("");
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) return setError(d.error ?? "That did not work.");
    await load();
  };
  const link = (t: string) => `${window.location.origin}/share/${encodeURIComponent(project)}/${t}`;
  const active = shares.filter((s) => s.active);
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Share with the donor</p>
        <span className="text-xs text-muted">A read-only link where each figure opens its records and photos. No names beyond what the report says; attendance sheets are not opened.</span>
        {ready ? (
          <button type="button" className={`${quietBtn} ms-auto`} onClick={() => void act({ action: "create", quarter })}>
            Make a link
          </button>
        ) : (
          <span className="ms-auto text-xs text-muted">Do a practice release or release first: the link shows that copy.</span>
        )}
      </div>
      {error && <p className="mt-2 text-clay">{error}</p>}
      {active.length > 0 && (
        <ul className="mt-2 space-y-1">
          {active.map((s) => (
            <li key={s.token} className="flex flex-wrap items-center gap-2 text-xs">
              <code className="max-w-full truncate rounded bg-sunken px-2 py-1">{link(s.token)}</code>
              <button
                type="button"
                className="font-semibold text-forest hover:underline"
                onClick={() => {
                  void navigator.clipboard.writeText(link(s.token));
                  setCopied(s.token);
                }}
              >
                {copied === s.token ? "Copied" : "Copy"}
              </button>
              <span className="text-muted">
                made by {s.by} {s.at.slice(0, 10)} · works until {s.expires.slice(0, 10)}
              </span>
              <button type="button" className="text-muted hover:text-clay" onClick={() => window.confirm("Withdraw this link? Anyone holding it can no longer open the report.") && void act({ action: "revoke", token: s.token })}>
                Withdraw
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
