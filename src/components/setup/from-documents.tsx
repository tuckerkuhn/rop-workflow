"use client";

import JSZip from "jszip";
import { useState } from "react";
import { quietBtn } from "@/components/workspace/ui";
import { COUNTRIES, type ProjectDesign } from "@/lib/project-setup";
import { readWorkbook } from "@/lib/read-sheet";
import type { SetupProposal } from "@/server/setup-extract";

/**
 * Setup's head start: upload the agreement and the logframe, and Claude proposes the design
 * (title, donor, dates, goal, every indicator with its donor code and targets). Every answer still
 * goes through the setup steps to be checked before anything is saved.
 */

type Sent = { name: string; kind: "pdf"; data: string } | { name: string; kind: "text"; text: string };

async function readFile(f: File): Promise<Sent> {
  const lower = f.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    if (f.size > 3_200_000) throw new Error(`${f.name} is over 3 MB: upload the logframe or the agreement's results annex on its own.`);
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: f.name, kind: "pdf", data: btoa(bin) };
  }
  if (lower.endsWith(".docx")) {
    const zip = await JSZip.loadAsync(await f.arrayBuffer());
    const xml = (await zip.file("word/document.xml")?.async("string")) ?? "";
    const text = xml
      .replace(/<w:tab\/>/g, "\t")
      .replace(/<\/w:tc>/g, "\t")
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, "\n\n");
    return { name: f.name, kind: "text", text: text.slice(0, 380_000) };
  }
  if (lower.endsWith(".xlsx")) {
    const sheets = await readWorkbook(await f.arrayBuffer());
    const text = sheets.map((s) => `Sheet: ${s.name}\n${s.grid.map((r) => r.map((c) => (c == null ? "" : String(c).replace(/\s+/g, " ").trim())).join("\t").replace(/\t+$/, "")).filter(Boolean).join("\n")}`).join("\n\n");
    return { name: f.name, kind: "text", text: text.slice(0, 380_000) };
  }
  throw new Error(`${f.name}: upload a PDF, a Word file (.docx) or an Excel file (.xlsx).`);
}

/** Per-year targets as the running totals the app keeps (expected total by 31 December). */
function runningTotals(years: { year: number; target: number }[]) {
  let t = 0;
  return Object.fromEntries([...years].sort((a, b) => a.year - b.year).map((y) => [String(y.year), (t += y.target)]));
}

export function FromDocuments({ user, onProposal }: { user: string; onProposal: (patch: Partial<ProjectDesign>, questions: string[]) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = async (list: FileList | null) => {
    if (!list?.length) return;
    setBusy(true);
    setError("");
    try {
      const files = await Promise.all(Array.from(list).slice(0, 4).map(readFile));
      const r = await fetch("/api/setup/extract", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: JSON.stringify({ files }) });
      const d = (await r.json()) as { out?: SetupProposal; error?: string };
      if (!r.ok || !d.out) throw new Error(d.error ?? "The documents could not be read.");
      const o = d.out;
      const iso = (x: string) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined);
      onProposal(
        {
          ...(o.name ? { name: o.name.slice(0, 200) } : {}),
          ...(COUNTRIES.includes(o.country) ? { country: o.country } : {}),
          ...(o.crop ? { crop: o.crop.slice(0, 100) } : {}),
          ...(iso(o.startDate) ? { startDate: o.startDate } : {}),
          ...(iso(o.endDate) ? { endDate: o.endDate } : {}),
          ...(o.goal ? { goal: o.goal.slice(0, 500) } : {}),
          ...(o.donor ? { donors: [o.donor.slice(0, 200)] } : {}),
          indicators: o.indicators
            .filter((i) => i.name && i.target > 0)
            .slice(0, 40)
            .map((i) => ({ ...(i.donorCode ? { donorCode: i.donorCode.slice(0, 30) } : {}), name: i.name.slice(0, 200), unit: (i.unit || "count").slice(0, 50), target: i.target, level: i.level, frequency: "quarterly" as const, ...(i.yearTargets.length ? { forecast: runningTotals(i.yearTargets) } : {}) })),
        },
        o.questions,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mb-6 rounded-2xl border border-forest/30 bg-mist p-4 text-sm">
      <p className="font-semibold">Start from the agreement and logframe</p>
      <p className="mt-1 text-muted">Upload the signed agreement and the logframe or results framework (PDF, Word or Excel, up to four files). Claude fills in the steps below; you check every answer before anything is saved.</p>
      <label className={`${quietBtn} mt-3 inline-block cursor-pointer`}>
        {busy ? "Reading the documents… (up to 2 minutes)" : "Choose files"}
        <input type="file" multiple accept=".pdf,.docx,.xlsx" className="sr-only" disabled={busy} onChange={(e) => void run(e.target.files)} />
      </label>
      {error && <p className="mt-2 text-clay">{error}</p>}
    </section>
  );
}
