"use client";

import JSZip from "jszip";
import { useState } from "react";
import type { EvidenceIndex } from "@/server/outputs";

/**
 * The report's other downloads: the indicator tracking table (Excel) and the evidence annex
 * (a zip with a folder of proof per indicator and an index), for audits and third-party monitors.
 */

const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().slice(0, 80);
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\r\n");

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function ReportDownloads({ project, quarter, user, mayEvidence }: { project: string; quarter: string; user: string; mayEvidence: boolean }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const year = Number(quarter.slice(0, 4));
  const tracking = async () => {
    setBusy("tracking");
    setError("");
    try {
      const r = await fetch(`/api/projects/${project}/outputs?kind=tracking&year=${year}`, { headers: { "x-demo-user": user } });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Could not make the table.");
      save(await r.blob(), `${project}-tracking-${year}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  const annex = async () => {
    setBusy("evidence");
    setError("");
    try {
      const r = await fetch(`/api/projects/${project}/outputs?kind=evidence&q=${quarter}`, { headers: { "x-demo-user": user } });
      const idx = (await r.json()) as EvidenceIndex & { error?: string };
      if (!r.ok) throw new Error(idx.error ?? "Could not load the evidence.");
      const zip = new JSZip();
      const rows: (string | number)[][] = [["Indicator", "Date", "Value", "Province", "District", "What was done", "File in this zip", "Caption", "Link"]];
      let missing = 0;
      for (const ind of idx.indicators) {
        const dir = zip.folder(safe(`${ind.donorCode} ${ind.name}`))!;
        for (const res of ind.results) {
          const prefix = safe(`${res.date} ${res.district || res.province}`);
          if (!res.files.length && !res.links.length) rows.push([ind.donorCode, res.date, res.value, res.province, res.district, res.note, "(no proof attached)", "", ""]);
          for (const f of res.files) {
            const name = `${prefix} ${safe(f.name)}`;
            const fr = await fetch(`/api/files/${f.hash}`, { headers: { "x-demo-user": user } });
            if (fr.ok) dir.file(name, await fr.blob());
            else missing++;
            rows.push([ind.donorCode, res.date, res.value, res.province, res.district, res.note, fr.ok ? `${dir.name}${name}` : "(could not be read)", f.caption, ""]);
          }
          for (const l of res.links) rows.push([ind.donorCode, res.date, res.value, res.province, res.district, res.note, "", l.title, l.url]);
        }
      }
      zip.file("index.csv", "﻿" + csv(rows));
      zip.file("README.txt", `${idx.project.name}: evidence annex for ${quarter}\r\nEvery result MEL accepted in the quarter, with its proof, one folder per indicator. index.csv lists each record, its files and its SharePoint links.\r\nMade ${new Date().toISOString().slice(0, 10)} from ROP Workflow. Contains personal data (attendance sheets): keep it to the audit or monitoring it is for.\r\n`);
      save(await zip.generateAsync({ type: "blob" }), `${project}-evidence-${quarter}.zip`);
      if (missing) setError(`${missing} ${missing === 1 ? "file" : "files"} could not be read and are marked in index.csv.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="text-muted">Also download:</span>
      <button type="button" className="font-semibold text-forest hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => void tracking()}>
        {busy === "tracking" ? "Making the table…" : `Indicator tracking table ${year} (Excel)`}
      </button>
      {mayEvidence && (
        <button type="button" className="font-semibold text-forest hover:underline disabled:opacity-50" disabled={!!busy} onClick={() => void annex()}>
          {busy === "evidence" ? "Collecting the proof…" : `Evidence annex ${quarter.replace("-", " ")} (zip)`}
        </button>
      )}
      {error && <span className="text-clay">{error}</span>}
    </p>
  );
}
