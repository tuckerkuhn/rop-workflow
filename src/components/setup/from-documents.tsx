"use client";

import JSZip from "jszip";
import { useState } from "react";
import { useT } from "@/components/app/i18n";
import { setPending, type Pending } from "@/components/setup/pending";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { parseBudget, type BudgetLine } from "@/lib/budget";
import { COUNTRIES, type ProjectDesign } from "@/lib/project-setup";
import { readWorkbook } from "@/lib/read-sheet";
import type { BudgetProposal, SetupProposal, TermsProposal } from "@/server/setup-extract";

/**
 * Setup's head start from three documents (lib/agreement): the agreement, the logframe and the
 * budget. Claude reads them side by side: the design (agreement and logframe), the agreement's
 * terms (report deadlines and donor rules) and a Word or PDF budget; an Excel budget is read
 * without AI. Every value carries its source. The design fills the setup questions; the budget,
 * deadlines and rules wait (components/setup/pending) for their steps. Nothing is saved until a
 * person confirms each section. On a running project, only the agreement's terms and a budget.
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

type Slot = "agreement" | "logframe" | "budget";

async function ask<T>(user: string, part: "design" | "terms" | "budget", files: Sent[], project?: string): Promise<{ out: T }> {
  const r = await fetch("/api/setup/extract", { method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": user }, body: JSON.stringify({ part, files, ...(project ? { project } : {}) }) });
  const d = (await r.json().catch(() => ({}))) as { out?: T; error?: string };
  if (!r.ok || !d.out) throw new Error(d.error ?? "The documents could not be read.");
  return { out: d.out };
}

/** An Excel budget, read in the browser with the budget step's own reader; each line's source is its row. */
async function excelBudget(f: File): Promise<Pending["budget"]> {
  const sheets = await readWorkbook(await f.arrayBuffer());
  const tries = sheets.map((s) => parseBudget(s.grid));
  const best = tries.reduce((b, p, i) => ((p?.lines.length ?? 0) > (tries[b]?.lines.length ?? 0) ? i : b), 0);
  const parse = tries[best];
  if (!parse?.lines.length) return undefined;
  return { file: f.name, currency: parse.currency, lines: parse.lines, sources: parse.rows.map((r) => `${f.name}, sheet "${sheets[best].name}", row ${r}`), questions: parse.warnings };
}

const fromAi = (o: BudgetProposal, file: string): Pending["budget"] => {
  const lines: BudgetLine[] = o.lines
    .filter((l) => l.description && Number.isFinite(l.amount))
    .map((l, k) => ({ code: (l.code || `L-${k + 1}`).slice(0, 40), activityCode: /^\d+\.\d+\.\d+$/.test(l.activityCode) ? l.activityCode : null, activity: null, description: l.description.slice(0, 500), unit: null, quantity: null, unitCost: null, total: Math.round(l.amount * 100) / 100, spent: null, schedule: {}, kind: "program", procure: false }));
  return { file, currency: /^[A-Z]{3}$/.test(o.currency) ? o.currency : "USD", lines, sources: o.lines.filter((l) => l.description && Number.isFinite(l.amount)).map((l) => l.source || file), questions: o.questions };
};

export function FromDocuments({ user, project, onProposal, onRead }: { user: string; /** A running project: only the agreement's terms and a budget. */ project?: string; onProposal?: (patch: Partial<ProjectDesign>, questions: string[], sources: string[]) => void; onRead?: () => void }) {
  const { t } = useT();
  const [files, setFiles] = useState<Partial<Record<Slot, File>>>({});
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [done, setDone] = useState(false);
  const slots: Slot[] = project ? ["agreement", "budget"] : ["agreement", "logframe", "budget"];
  const run = async () => {
    setBusy(true);
    setErrors([]);
    setDone(false);
    const errs: string[] = [];
    const fail = (part: string) => (e: unknown) => {
      errs.push(t("ag.partFailed", { part, error: e instanceof Error ? e.message : String(e) }));
      return undefined;
    };
    try {
      const sent: Partial<Record<Slot, Sent>> = {};
      for (const s of slots) {
        const f = files[s];
        if (f && !(s === "budget" && f.name.toLowerCase().endsWith(".xlsx"))) sent[s] = await readFile(f);
      }
      const designFiles = [sent.agreement, sent.logframe].filter((x): x is Sent => !!x);
      const [design, terms, budget] = await Promise.all([
        !project && designFiles.length ? ask<SetupProposal>(user, "design", designFiles).catch(fail(t("ag.slot.logframe"))) : undefined,
        sent.agreement ? ask<TermsProposal>(user, "terms", [sent.agreement], project).catch(fail(t("ag.slot.agreement"))) : undefined,
        files.budget ? (files.budget.name.toLowerCase().endsWith(".xlsx") ? excelBudget(files.budget).catch(fail(t("ag.slot.budget"))) : ask<BudgetProposal>(user, "budget", [sent.budget!], project).then((r) => fromAi(r.out, files.budget!.name)).catch(fail(t("ag.slot.budget")))) : undefined,
      ]);
      setPending({ terms: terms?.out, termsFile: files.agreement?.name, budget: budget ?? undefined });
      if (design && onProposal) {
        const o = design.out;
        const iso = (x: string) => (/^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined);
        const sources = [
          o.sources.name && `${t("setup.q.name")}: ${o.sources.name}`,
          o.sources.donor && `Donor: ${o.sources.donor}`,
          o.sources.dates && `Dates: ${o.sources.dates}`,
          o.sources.goal && `Goal: ${o.sources.goal}`,
          ...o.indicators.filter((i) => i.name && i.source).map((i) => `${i.donorCode || i.name.slice(0, 40)}: ${i.source}`),
        ].filter((x): x is string => !!x);
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
          // The agreement's and the budget's questions are shown at their own steps.
          o.questions,
          sources,
        );
      }
      setDone(true);
      onRead?.();
    } catch (e) {
      errs.push(e instanceof Error ? e.message : String(e));
    } finally {
      setErrors(errs);
      setBusy(false);
    }
  };
  return (
    <section className="mb-6 rounded-2xl border border-forest/30 bg-mist p-4 text-sm">
      <p className="font-semibold">{t("ag.title")}</p>
      <p className="mt-1 text-muted">{t(project ? "ag.helpRunning" : "ag.help")}</p>
      <div className="mt-3 grid gap-2">
        {slots.map((s) => (
          <label key={s} className="flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-2">
            <span>
              <span className="block font-semibold">{t(`ag.slot.${s}`)}</span>
              <span className="block truncate text-xs text-muted">{files[s]?.name ?? "PDF, Word, Excel"}</span>
            </span>
            <span className={quietBtn}>{t("ag.choose")}</span>
            <input type="file" accept=".pdf,.docx,.xlsx" className="sr-only" disabled={busy} onChange={(e) => setFiles((f) => ({ ...f, [s]: e.target.files?.[0] }))} />
          </label>
        ))}
      </div>
      <button type="button" className={`${primaryBtn} mt-3`} disabled={busy || !Object.values(files).some(Boolean)} onClick={() => void run()}>
        {busy ? t("ag.reading") : t("ag.read")}
      </button>
      {done && !errors.length && <p className="mt-2 text-leaf">{t("ag.done")}</p>}
      {errors.map((e) => (
        <p key={e} className="mt-2 text-clay">
          {e}
        </p>
      ))}
    </section>
  );
}
