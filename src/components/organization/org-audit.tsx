"use client";

import { useEffect, useMemo, useState } from "react";
import { useRequireUser } from "@/components/app/session";
import { TopBar, quietBtn } from "@/components/workspace/ui";
import { Empty, Fig, LedgerRow, LedgerTable, PageHead, SectionHead } from "@/components/workspace/ledger";

const COLS = "9rem 7rem 1.2fr 8rem 8rem 1.4fr";
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
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <PageHead back={{ href: "/organization", label: "Organization" }} title="Organization audit log" meta={rows ? `${listed.length} ${listed.length === 1 ? "entry" : "entries"}` : undefined}>
          Every change to people&rsquo;s access, the HR record, pay settings, suppliers, the organization&rsquo;s rules, opportunities and proposals, and each use of View as: who made it and when. HR entries show what kind of change it was, not its contents.
        </PageHead>
        {!intact && <p className="mt-4 bg-clay-soft px-4 py-3 text-sm font-semibold text-clay">The HR record shows signs of tampering. Open People to see where.</p>}
        {error && <p className="mt-4 bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {/* A period for an audit: a quarter, a year. Empty shows the newest entries. */}
        <form
          className="mt-5 flex flex-wrap items-end gap-3 text-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setShown({ from, to });
          }}
        >
          <label className="flex flex-col gap-1">
            <span className="font-mono text-xs text-muted">From</span>
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} className="min-h-11 border border-line bg-paper px-3" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-mono text-xs text-muted">To</span>
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} className="min-h-11 border border-line bg-paper px-3" />
          </label>
          <button type="submit" className={quietBtn}>
            Show
          </button>
          <span className="text-xs text-muted">{shown.from || shown.to ? `Every entry ${shown.from ? `from ${shown.from}` : ""}${shown.from && shown.to ? " " : ""}${shown.to ? `to ${shown.to}` : ""} (UTC)` : "The newest 800 entries. Choose dates for a whole period."}</span>
        </form>
        {more && <p className="mt-3 bg-ochre-soft px-4 py-3 text-sm">This period has more than 5,000 entries: only the newest 5,000 are listed. Choose a shorter period to see the rest.</p>}
        {!rows && !error && <p className="mt-6 text-sm text-muted">Loading…</p>}
        {rows && (
          <>
            <SectionHead
              aside={
                <>
                  <input className="min-h-11 border border-line bg-paper px-3 text-sm" placeholder="Person" value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by person" />
                  <button type="button" onClick={() => download(listed)} disabled={!listed.length} className={quietBtn}>
                    Download (CSV)
                  </button>
                </>
              }
            >
              Entries
            </SectionHead>
            <div className="mt-3 flex flex-wrap gap-1" role="group" aria-label="Area">
              {areas.map((a) => (
                <button key={a} type="button" aria-pressed={a === area} onClick={() => setArea(a)} className={`min-h-11 px-3 font-mono text-xs ${a === area ? "font-bold underline decoration-ochre decoration-4 underline-offset-8" : "text-muted hover:text-ink"}`}>
                  {a}
                </button>
              ))}
            </div>
            {listed.length === 0 ? (
              <Empty>Nothing recorded.</Empty>
            ) : (
              <div className="overflow-x-auto">
                <LedgerTable cols={COLS} head={["When (UTC)", "Area", "What", "By", "About", "Detail"]} label="Organization audit log" className="mt-2 min-w-[52rem]">
                  {listed.map((r) => (
                    <LedgerRow key={r.ref} cols={COLS} className="text-sm">
                      <Fig className="text-start text-muted">{r.at.slice(0, 16).replace("T", " ")}</Fig>
                      <span className="font-mono text-xs">{r.area}</span>
                      <span className="font-semibold">{r.action}</span>
                      <span>{r.by ?? "None"}</span>
                      <span>{r.about ?? ""}</span>
                      <span className="text-muted">{r.note ?? ""}</span>
                    </LedgerRow>
                  ))}
                </LedgerTable>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
