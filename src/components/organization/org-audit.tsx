"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRequireUser } from "@/components/app/session";
import { Pill, TopBar } from "@/components/workspace/ui";
import type { OrgAuditRow } from "@/app/api/org/audit/route";

/** Every recorded change in the Organization area, newest first, filterable by area and person. */
export function OrgAudit() {
  const { user } = useRequireUser();
  const [rows, setRows] = useState<OrgAuditRow[] | null>(null);
  const [intact, setIntact] = useState(true);
  const [error, setError] = useState("");
  const [area, setArea] = useState("All");
  const [who, setWho] = useState("");
  useEffect(() => {
    if (!user) return;
    fetch("/api/org/audit", { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load.");
        setRows(d.rows);
        setIntact(d.intact);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [user]);
  const areas = useMemo(() => ["All", ...new Set((rows ?? []).map((r) => r.area))], [rows]);
  const shown = (rows ?? []).filter((r) => (area === "All" || r.area === area) && (!who || [r.by, r.about].some((x) => x?.toLowerCase().includes(who.toLowerCase()))));
  if (!user) return null;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Link href="/organization" className="text-sm text-muted hover:text-ink">
          ← Organization
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Organization audit log</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Every change to people&rsquo;s access, the HR record, pay settings, suppliers and the organization&rsquo;s rules: who made it and when. HR entries show what kind of change it was, not its contents.</p>
        {!intact && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm font-semibold text-clay">The HR record shows signs of tampering. Open People to see where.</p>}
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {rows && (
          <>
            <div className="mt-5 flex flex-wrap items-center gap-2">
              {areas.map((a) => (
                <button key={a} type="button" onClick={() => setArea(a)} className={`rounded-full px-3 py-1 text-sm ${a === area ? "bg-forest text-paper" : "bg-sunken text-muted hover:text-ink"}`}>
                  {a}
                </button>
              ))}
              <input className="ms-auto rounded-lg border border-line bg-paper px-3 py-1.5 text-sm" placeholder="Person" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by person" />
            </div>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">When (UTC)</th>
                    <th className="px-3 py-2 font-medium">Area</th>
                    <th className="px-3 py-2 font-medium">What</th>
                    <th className="px-3 py-2 font-medium">By</th>
                    <th className="px-3 py-2 font-medium">About</th>
                    <th className="px-3 py-2 font-medium">Detail</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r) => (
                    <tr key={r.ref} className="border-t border-line align-top">
                      <td className="whitespace-nowrap px-3 py-2 tabular-nums text-muted">{r.at.slice(0, 16).replace("T", " ")}</td>
                      <td className="px-3 py-2">
                        <Pill tone="muted">{r.area}</Pill>
                      </td>
                      <td className="px-3 py-2">{r.action}</td>
                      <td className="px-3 py-2">{r.by ?? "—"}</td>
                      <td className="px-3 py-2">{r.about ?? "—"}</td>
                      <td className="px-3 py-2 text-muted">{r.note ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shown.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Nothing recorded.</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
