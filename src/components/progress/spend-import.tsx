"use client";

import { useState } from "react";
import { storeNames } from "@/lib/file-store";
import { useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { SpreadsheetImport } from "@/components/progress/spend-map";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";

/**
 * Importing spending: on Budget (where a newcomer looks for it) and on the quarterly report. The
 * caller shows it only to people who may import (Finance, or the import role); the server checks again.
 */

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2 text-base";
const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** Finance's monthly budget-against-actual workbook: checked first, then imported. */
export function SpendImport({ code, currency, onDone }: { code: string; currency: string; onDone: () => void }) {
  const { user } = useSession();
  const { t } = useT();
  const [file, setFile] = useState<File | null>(null);
  // Not Finance's ICE workbook: read with columns the person confirms (B3).
  const [generic, setGeneric] = useState(false);
  const [done, setDone] = useState(false);
  const [link, setLink] = useState("");
  const [preview, setPreview] = useState<{ months: string[]; monthLabels: Record<string, string>; lines: { code: string }[]; totals: { costs: { actual: number } | null }; problems: string[]; notes: string[]; sheet: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async (check: boolean) => {
    if (!file) return;
    setDone(false);
    if (/\.csv$/i.test(file.name)) return setGeneric(true);
    setErr("");
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      if (link.trim()) body.append("sharepointUrl", link.trim());
      const res = await fetch(`/api/projects/${code}/actuals${check ? "?check=1" : ""}`, { method: "POST", body, headers: { "x-demo-user": user?.id ?? "" } });
      const out = await res.json().catch(() => ({}));
      if (out.preview) setPreview(out.preview);
      if (!res.ok) throw new Error(out.error ?? (out.preview?.problems?.length ? "The workbook has problems: see below." : `Import failed (${res.status})`));
      if (!check) {
        setFile(null);
        setPreview(null);
        onDone();
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="mt-3 block rounded-xl bg-sunken p-3 text-sm text-ink">
      <span className="block font-semibold">{t("pw.importBva")}</span>
      <span className="block text-xs text-muted">The FACE workbook sent to UNDP (.xlsx). Only its ICE Report sheet is read; the ledger sheets, which name staff, are not kept.</span>
      <span className="block text-xs text-muted">{t("sm.otherHelp")}</span>
      <input type="file" accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="mt-2 block text-sm" onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setGeneric(false); setDone(false); }} />
      <input className={input} placeholder={`Link to the workbook in ${storeNames()} (optional)`} value={link} onChange={(e) => setLink(e.target.value)} />
      {preview && (
        <span className="mt-2 block text-xs">
          Sheet &ldquo;{preview.sheet}&rdquo;: {preview.lines.length} budget lines, {preview.months.map((m) => preview.monthLabels[m] ?? m).join(", ")}
          {preview.totals.costs && `; ${num(preview.totals.costs.actual)} ${currency} spent in all`}.
          {preview.problems.map((p) => (
            <span key={p} className="block text-clay">{p}</span>
          ))}
          {preview.notes.map((p) => (
            <span key={p} className="block text-warn">{p}</span>
          ))}
        </span>
      )}
      {err && <span role="alert" className="mt-1 block text-xs text-clay">{err}</span>}
      {done && <span role="status" className="mt-1 block text-xs text-forest">{t("sm.imported")}</span>}
      {file && generic ? (
        <SpreadsheetImport
          code={code}
          file={file}
          link={link}
          onCancel={() => setGeneric(false)}
          onDone={() => {
            setGeneric(false);
            setFile(null);
            setPreview(null);
            setDone(true);
            onDone();
          }}
        />
      ) : (
        <span className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={quietBtn} disabled={!file || busy} onClick={() => void send(true)}>
            Check it
          </button>
          <button type="button" className={primaryBtn} disabled={!file || busy || !preview || preview.problems.length > 0} onClick={() => void send(false)}>
            Import
          </button>
          {file && preview && preview.problems.length > 0 && (
            <button type="button" className={primaryBtn} onClick={() => { setErr(""); setPreview(null); setGeneric(true); }}>
              {t("sm.other")}
            </button>
          )}
        </span>
      )}
    </span>
  );
}
