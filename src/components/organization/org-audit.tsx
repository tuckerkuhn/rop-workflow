"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRequireUser } from "@/components/app/session";
import { Pill, TopBar } from "@/components/workspace/ui";
import type { OrgAuditRow } from "@/app/api/org/audit/route";
import { toCsv } from "@/lib/field-data";


/** The rows on screen as a CSV file, for an auditor: the same columns, the filter applied. */
function download(rows: OrgAuditRow[]) {
  const csv = toCsv({ headers: ["When (UTC)", "Area", "What", "By", "About", "Detail", "Entry"], rows: rows.map((r) => [r.at.slice(0, 19).replace("T", " "), r.area, r.action, r.by ?? "", r.about ?? "", r.note ?? "", r.ref]) });
  const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `organization-audit-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
/** Every recorded change in the Organization area, newest first, filterable by area and person, with a download of what is shown. */
export function OrgAudit() {
  const { user } = useRequireUser();
  const [rows, setRows] = useState<OrgAuditRow[] | null>(null);
  const [intact, setIntact] = useState(true);
  const [error, setError] = useState("");
  const [area, setArea] = useState("All");
  const [who, setWho] = useState("");
  // The period asked for (both empty: the newest entries) and the one on screen.
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [shown, setShown] = useState({ from: "", to: "" });
  const [more, setMore] = useState(false);
  useEffect(() => {
    if (!user) return;
    let live = true;
    setRows(null);
    setError("");
    const q = new URLSearchParams({ ...(shown.from ? { from: shown.from } : {}), ...(shown.to ? { to: shown.to } : {}) }).toString();
    fetch(`/api/org/audit${q ? `?${q}` : ""}`, { cache: "no-store", headers: { "x-demo-user": user.id } })
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Could not load.");
        if (!live) return;
        setRows(d.rows);
        setMore(!!d.more);
        setIntact(d.intact);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      live = false;
    };
  }, [user, shown]);
  const areas = useMemo(() => ["All", ...new Set((rows ?? []).map((r) => r.area))], [rows]);
  const listed = (rows ?? []).filter((r) => (area === "All" || r.area === area) && (!who || [r.by, r.about].some((x) => x?.toLowerCase().includes(who.toLowerCase()))));
  if (!user) return null;
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
        <Link href="/organization" className="text-sm text-muted hover:text-ink">
          ← Organization
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Organization audit log</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Every change to people&rsquo;s access, the HR record, pay settings, suppliers, the organization&rsquo;s rules, opportunities and proposals, and each use of View as: who made it and when. HR entries show what kind of change it was, not its contents.</p>
        {!intact && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm font-semibold text-clay">The HR record shows signs of tampering. Open People to see where.</p>}
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {/* A period for an audit: a quarter, a year. Empty shows the newest entries. */}
        <form
          className="mt-5 flex flex-wrap items-end gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setShown({ from, to });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">From</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-1.5" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">To</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="rounded-lg border border-line bg-paper px-3 py-1.5" />
          </label>
          <button type="submit" className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:border-forest">
            Show
          </button>
          <span className="text-xs text-muted">{shown.from || shown.to ? `Every entry ${shown.from ? `from ${shown.from}` : ""}${shown.from && shown.to ? " " : ""}${shown.to ? `to ${shown.to}` : ""} (UTC)` : "The newest 800 entries. Choose dates for a whole period."}</span>
        </form>
        {more && <p className="mt-3 rounded-xl bg-ochre-soft px-4 py-3 text-sm">This period has more than 5,000 entries: only the newest 5,000 are listed. Choose a shorter period to see the rest.</p>}
        {!rows && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {rows && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              {areas.map((a) => (
                <button key={a} type="button" onClick={() => setArea(a)} className={`rounded-full px-3 py-1 text-sm ${a === area ? "bg-forest text-paper" : "bg-sunken text-muted hover:text-ink"}`}>
                  {a}
                </button>
              ))}
              <input className="ms-auto rounded-lg border border-line bg-paper px-3 py-1.5 text-sm" placeholder="Person" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by person" />
              <button type="button" onClick={() => download(listed)} disabled={!listed.length} className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm hover:border-forest disabled:opacity-40">
                Download (CSV)
              </button>
            </div>
            <div className="mt-3 overflow-x-auto rounded-2xl border border-line bg-surface">
              <table className="w-full text-sm">
                <thead className="text-start text-xs text-muted">
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
                  {listed.map((r) => (
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
              {listed.length === 0 && <p className="px-3 py-6 text-center text-sm text-muted">Nothing recorded.</p>}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
