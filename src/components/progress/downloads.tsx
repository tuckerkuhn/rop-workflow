"use client";

import JSZip from "jszip";
import { useState } from "react";
import type { ReportRef } from "@/lib/preflight";
import type { PackIndex, PackKind } from "@/server/proof";

/**
 * The report's other downloads: the indicator tracking table (Excel) and the evidence pack (a zip
 * with an index of every figure's reference, the results behind it and their proof, the period's
 * audit log, and Finance's figures where they go in). Two packs (lib/evidence): the donor pack,
 * with only what consent allows and people by role; the audit pack, with everything and names.
 */

const safe = (s: string) =>
  s
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 80);
const csv = (rows: (string | number)[][]) =>
  "﻿" +
  rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\r\n");

function save(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const periodOf = (r: ReportRef) =>
  r.kind === "qpr" ? r.quarter : r.kind === "annual" ? String(r.year) : r.month;

/** Builds the pack's zip from its index, fetching each included file. Returns the files that could not be read. */
async function buildPack(
  idx: PackIndex,
  user: string,
): Promise<{ blob: Blob; missing: number }> {
  const zip = new JSZip();
  const audit = idx.kind === "audit";
  const rows: (string | number)[][] = [
    [
      "Reference",
      "Indicator",
      "Name",
      "Period",
      "Figure",
      "Unit",
      "Result",
      "Date",
      "Value",
      "Province",
      "District",
      "What was done",
      "Recorded by",
      "Accepted by",
      "Accepted on",
      "Proof",
      "In this pack",
      "Caption or link",
    ],
  ];
  const fetched = new Map<string, string | null>();
  let missing = 0;
  for (const e of idx.entries) {
    const head = [e.ref ?? "", e.donorCode, e.name, e.label, e.value, e.unit];
    for (const r of e.results) {
      const base = [
        ...head,
        r.id.slice(0, 8),
        r.date,
        r.value,
        r.province,
        r.district,
        r.note,
        r.recordedBy,
        r.acceptedBy ?? "",
        (r.acceptedAt ?? "").slice(0, 10),
      ];
      if (!r.files.length && !r.links.length && !r.kobo)
        rows.push([
          ...base,
          r.noFile ? `No file: ${r.noFile}` : "No proof attached",
          "",
          "",
        ]);
      if (r.kobo)
        rows.push([
          ...base,
          `KoboToolbox submission ${r.kobo.id ?? ""}`.trim(),
          audit
            ? "Held in KoboToolbox"
            : "Held by Roots of Peace, available for verification",
          "",
        ]);
      for (const f of r.files) {
        if (!f.include) {
          rows.push([...base, f.name, f.why, f.caption]);
          continue;
        }
        if (!fetched.has(f.hash)) {
          const path = `proof/${safe(`${r.date} ${r.id.slice(0, 8)} ${f.name}`)}`;
          const fr = await fetch(`/api/files/${f.hash}`, {
            headers: { "x-demo-user": user },
          });
          if (fr.ok) zip.file(path, await fr.blob());
          else missing++;
          fetched.set(f.hash, fr.ok ? path : null);
        }
        rows.push([
          ...base,
          f.name,
          fetched.get(f.hash) ?? "(could not be read)",
          f.caption,
        ]);
      }
      for (const l of r.links)
        rows.push([
          ...base,
          l.title || "Linked document",
          audit
            ? "Linked"
            : "Held by Roots of Peace, available for verification",
          audit ? l.url : "",
        ]);
    }
  }
  zip.file("index.csv", csv(rows));
  zip.file(
    "audit-log.csv",
    csv([
      ["When (UTC)", "What", "Result", "By"],
      ...idx.audit.map((a) => [
        a.at.slice(0, 16).replace("T", " "),
        a.what,
        a.record.slice(0, 8),
        a.by,
      ]),
    ]),
  );
  for (const m of idx.money) {
    const months = m.months;
    zip.file(
      `finance/${safe(m.file)}.csv`,
      csv([
        [
          `From ${m.file}, imported by ${m.by} on ${m.at.slice(0, 10)} (${m.currency})`,
        ],
        ["Line", "Description", "Budget", "Actual", ...months],
        ...m.lines.map((l) => [
          l.code,
          l.description,
          l.budget,
          l.actual,
          ...months.map((x) => l.months[x] ?? 0),
        ]),
      ]),
    );
  }
  const lines = [
    `${idx.project.name}: evidence pack for the ${idx.label}`,
    audit
      ? "AUDIT PACK: every file, with people's names and Finance's figures. Personal data: keep it to the audit it is for."
      : "DONOR PACK: photos only where consent allows donor use; documents with personal data are listed and held by Roots of Peace for verification; people are shown by their role.",
    "",
    "Every figure in the report carries a reference, e.g. [E-07]. index.csv lists each reference, the results MEL accepted behind it, and their proof: in proof/ when it is in this pack, otherwise where it is held.",
    "audit-log.csv: what happened to these results and to the report in the period.",
    idx.money.length
      ? "finance/: Finance's budget against actual as imported, line by line and month by month."
      : idx.moneyHeld
        ? "Finance's budget against actual is held by Roots of Peace and available on request."
        : "",
    "",
    idx.released
      ? `The report was released on ${idx.released.slice(0, 10)}: this pack holds what was accepted by then.`
      : "The report is not released yet: this pack reflects the records as they stand.",
    `Made ${idx.built.slice(0, 10)} from ROP Workflow.`,
  ].filter((x, k, all) => x || all[k - 1]);
  zip.file("README.txt", lines.join("\r\n") + "\r\n");
  return { blob: await zip.generateAsync({ type: "blob" }), missing };
}

export function EvidencePacks({
  project,
  report,
  user,
  mayEvidence,
  mayAudit,
}: {
  project: string;
  report: ReportRef;
  user: string;
  mayEvidence: boolean;
  mayAudit: boolean;
}) {
  const [busy, setBusy] = useState<PackKind | "">("");
  const [error, setError] = useState("");
  const pack = async (kind: PackKind) => {
    setBusy(kind);
    setError("");
    try {
      const r = await fetch(
        `/api/projects/${project}/outputs?kind=pack&pack=${kind}&report=${report.kind}&period=${periodOf(report)}`,
        { headers: { "x-demo-user": user } },
      );
      const idx = (await r.json()) as PackIndex & { error?: string };
      if (!r.ok) throw new Error(idx.error ?? "Could not load the evidence.");
      const { blob, missing } = await buildPack(idx, user);
      save(
        blob,
        `${project}-${kind === "audit" ? "audit" : "evidence"}-pack-${periodOf(report)}.zip`,
      );
      if (missing)
        setError(
          `${missing} ${missing === 1 ? "file" : "files"} could not be read and are marked in index.csv.`,
        );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  if (!mayEvidence && !mayAudit) return null;
  return (
    <>
      {mayEvidence && (
        <button
          type="button"
          className="font-semibold text-forest hover:underline disabled:opacity-50"
          disabled={!!busy}
          onClick={() => void pack("donor")}
          title="For the donor: photos only where consent allows; documents with names held by ROP; people by role."
        >
          {busy === "donor"
            ? "Collecting the proof…"
            : `Evidence pack ${periodOf(report).replace("-", " ")} (zip)`}
        </button>
      )}
      {mayAudit && (
        <button
          type="button"
          className="font-semibold text-forest hover:underline disabled:opacity-50"
          disabled={!!busy}
          onClick={() => void pack("audit")}
          title="For auditors: every file, with names and Finance's figures. The download is recorded."
        >
          {busy === "audit" ? "Collecting everything…" : "Audit pack (zip)"}
        </button>
      )}
      {error && <span className="text-clay">{error}</span>}
    </>
  );
}

export function ReportDownloads({
  project,
  quarter,
  user,
  mayEvidence,
  mayAudit,
}: {
  project: string;
  quarter: string;
  user: string;
  mayEvidence: boolean;
  mayAudit: boolean;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const year = Number(quarter.slice(0, 4));
  const tracking = async () => {
    setBusy("tracking");
    setError("");
    try {
      const r = await fetch(
        `/api/projects/${project}/outputs?kind=tracking&year=${year}`,
        { headers: { "x-demo-user": user } },
      );
      if (!r.ok)
        throw new Error(
          (await r.json().catch(() => ({}))).error ??
            "Could not make the table.",
        );
      save(await r.blob(), `${project}-tracking-${year}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  };
  return (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
      <span className="text-muted">Also download:</span>
      <button
        type="button"
        className="font-semibold text-forest hover:underline disabled:opacity-50"
        disabled={!!busy}
        onClick={() => void tracking()}
      >
        {busy === "tracking"
          ? "Making the table…"
          : `Indicator tracking table ${year} (Excel)`}
      </button>
      <EvidencePacks
        project={project}
        report={{ kind: "qpr", quarter }}
        user={user}
        mayEvidence={mayEvidence}
        mayAudit={mayAudit}
      />
      {error && <span className="text-clay">{error}</span>}
    </p>
  );
}
