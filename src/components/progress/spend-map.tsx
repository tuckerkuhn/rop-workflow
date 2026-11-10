"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "@/components/app/session";
import { useT } from "@/components/app/i18n";
import { Pill, primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { MessageKey } from "@/lib/i18n";
import { COLUMN_ROLES, type Group, type SpendMapping } from "@/lib/spend-map";

/**
 * Spending from any spreadsheet (B3): the AI proposes the columns, the person confirms them,
 * then checks how each account was matched to a budget line before importing.
 */

type Proposal = { sheets: string[]; sheet: string; rows: string[][]; mapping: SpendMapping; remembered: boolean; reason: string; ai?: boolean };
type Preview = { headers: string[]; months: string[]; monthLabels: Record<string, string>; currency: string; rows: number; groups: Group[]; problems: string[]; notes: string[]; total: number; budget: { code: string; description: string }[] };

const field = "mt-1 block w-full min-h-12 rounded-xl border border-line bg-paper px-3 py-2 text-base";
const num = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 2 });

export function SpreadsheetImport({ code, file, link, onDone, onCancel }: { code: string; file: File; link: string; onDone: () => void; onCancel: () => void }) {
  const { user } = useSession();
  const { t } = useT();
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [mapping, setMapping] = useState<SpendMapping | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const call = useCallback(
    async (step: string, extra: Record<string, unknown> = {}) => {
      const body = new FormData();
      body.append("file", file);
      body.append("step", step);
      for (const [k, v] of Object.entries(extra)) if (v !== undefined) body.append(k, typeof v === "string" ? v : JSON.stringify(v));
      if (link.trim()) body.append("sharepointUrl", link.trim());
      const res = await fetch(`/api/projects/${code}/actuals/map`, { method: "POST", body, headers: { "x-demo-user": user?.id ?? "" } });
      const out = await res.json().catch(() => ({}));
      if (out.preview) setPreview(out.preview);
      if (!res.ok) throw new Error(out.error ?? `Failed (${res.status})`);
      return out;
    },
    [code, file, link, user?.id],
  );

  const run = async (f: () => Promise<void>) => {
    setErr("");
    setBusy(true);
    try {
      await f();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const read = (m: SpendMapping) =>
    run(async () => {
      setPreview(null);
      await call("preview", { mapping: m, decisions: { confirmed: [], assign: {} } });
      setConfirmed(new Set());
      setAssign({});
    });

  const propose = (sheet?: string) =>
    run(async () => {
      setPreview(null);
      const out: Proposal = await call("propose", { sheet });
      setProposal(out);
      setMapping(out.mapping);
      // The same export as last month: straight to the rows, with "Change columns" to hand.
      if (out.remembered) await call("preview", { mapping: out.mapping, decisions: { confirmed: [], assign: {} } });
    });

  // Once per file: each proposal may ask the AI, and is logged.
  const proposed = useRef<File | null>(null);
  useEffect(() => {
    if (proposed.current === file) return;
    proposed.current = file;
    void propose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const doImport = () =>
    run(async () => {
      await call("import", { mapping, decisions: { confirmed: [...confirmed], assign } });
      onDone();
    });

  if (!proposal || !mapping) return <span className="mt-2 block text-xs text-muted">{busy ? t("sm.reading") : err && <span role="alert" className="text-clay">{err}</span>}</span>;

  // The columns step.
  if (!preview) {
    const head = proposal.rows[mapping.headerRow] ?? [];
    const width = Math.max(head.length, ...proposal.rows.map((r) => r.length));
    const sample = (i: number | null) => (i === null ? "" : proposal.rows.slice(mapping.headerRow + 1).map((r) => r[i]).find((c) => c) ?? "");
    const set = (role: (typeof COLUMN_ROLES)[number], v: string) => setMapping({ ...mapping, columns: { ...mapping.columns, [role]: v === "" ? null : Number(v) } });
    const roles = COLUMN_ROLES.filter((r) => !((r === "debit" || r === "credit") && mapping.columns.amount !== null));
    return (
      <span className="mt-3 block rounded-xl border border-line bg-surface p-3">
        <span className="block font-semibold">{t("sm.columnsTitle")}</span>
        <span className="block text-xs text-muted">{proposal.remembered ? t("sm.remembered") : proposal.ai === false ? t("sm.guessed") : t("sm.aiProposed")}</span>
        {proposal.reason && <span className="mt-1 block text-xs">{proposal.reason}</span>}
        {proposal.sheets.length > 1 && (
          <label className="mt-2 block text-xs font-semibold">
            {t("sm.sheet")}
            <select className={field} value={proposal.sheet} disabled={busy} onChange={(e) => void propose(e.target.value)}>
              {proposal.sheets.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </label>
        )}
        <label className="mt-2 block text-xs font-semibold">
          {t("sm.headerRow")}
          <select className={field} value={mapping.headerRow} onChange={(e) => setMapping({ ...mapping, headerRow: Number(e.target.value) })}>
            {proposal.rows.map((r, i) => (
              <option key={i} value={i}>
                {t("sm.row", { n: i + 1 })}: {r.filter(Boolean).slice(0, 4).join(" · ").slice(0, 70)}
              </option>
            ))}
          </select>
        </label>
        {roles.map((role) => (
          <label key={role} className="mt-2 block text-xs font-semibold">
            {t(`sm.role.${role}` as MessageKey)}
            <select className={field} value={mapping.columns[role] ?? ""} onChange={(e) => set(role, e.target.value)}>
              <option value="">{t("sm.none")}</option>
              {Array.from({ length: width }, (_, i) => (
                <option key={i} value={i}>
                  {head[i] || t("sm.col", { n: i + 1 })}
                </option>
              ))}
            </select>
            {sample(mapping.columns[role]) && <span className="mt-0.5 block font-normal text-muted">{t("sm.eg", { value: sample(mapping.columns[role]) })}</span>}
          </label>
        ))}
        {mapping.columns.date === null && (
          <label className="mt-2 block text-xs font-semibold">
            {t("sm.month")}
            <input type="month" className={field} value={mapping.month ?? ""} onChange={(e) => setMapping({ ...mapping, month: e.target.value || null })} />
          </label>
        )}
        {err && <span role="alert" className="mt-2 block text-xs text-clay">{err}</span>}
        <span className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={`${primaryBtn} min-h-12`} disabled={busy} onClick={() => void read(mapping)}>
            {t("sm.confirm")}
          </button>
          <button type="button" className={`${quietBtn} min-h-12`} disabled={busy} onClick={onCancel}>
            {t("sm.cancel")}
          </button>
        </span>
      </span>
    );
  }

  // The rows step: what each account goes to.
  const lineName = (c: string | null) => {
    const b = preview.budget.find((x) => x.code === c);
    return b ? `${b.code} ${b.description}` : "";
  };
  const counted = (g: Group) => g.line !== null && g.how !== "skipped" && (g.how !== "description" || confirmed.has(g.key));
  const needs = preview.groups.filter((g) => g.how === "description" || g.how === "none");
  const done = preview.groups.filter((g) => !needs.includes(g));
  const unmatched = preview.groups.filter((g) => g.how !== "skipped" && !counted(g)).length;
  const choose = (g: Group, v: string) => {
    setAssign({ ...assign, [g.key]: v });
    setPreview({ ...preview, groups: preview.groups.map((x) => (x.key === g.key ? { ...x, line: v && v !== "skip" ? v : null, how: v === "skip" ? "skipped" : v ? "assigned" : "none" } : x)) });
  };
  const card = (g: Group) => (
    <li key={g.key} className="rounded-xl bg-sunken p-3">
      <span className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="min-w-0 break-words font-semibold">{g.label}</span>
        <span className="tabular-nums">
          {num(g.total)} {preview.currency}
        </span>
      </span>
      <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
        <Pill tone={g.how === "none" ? "clay" : g.how === "description" ? "ochre" : g.how === "skipped" ? "muted" : "forest"}>{t(`sm.how.${g.how}` as MessageKey)}</Pill>
        {g.rows === 1 ? t("sm.row1") : t("sm.rows", { n: g.rows })}
      </span>
      {g.how === "description" && (
        <label className="mt-2 flex min-h-12 items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="h-5 w-5"
            checked={confirmed.has(g.key)}
            onChange={(e) => {
              const next = new Set(confirmed);
              if (e.target.checked) next.add(g.key);
              else next.delete(g.key);
              setConfirmed(next);
            }}
          />
          {t("sm.tick", { line: lineName(g.line) })}
        </label>
      )}
      <select className={field} aria-label={t("sm.lineFor", { label: g.label })} value={g.how === "skipped" ? "skip" : (g.line ?? "")} onChange={(e) => choose(g, e.target.value)}>
        <option value="">{t("sm.keep")}</option>
        <option value="skip">{t("sm.leaveOut")}</option>
        {preview.budget.map((b) => (
          <option key={b.code} value={b.code}>
            {b.code} {b.description.slice(0, 60)}
          </option>
        ))}
      </select>
    </li>
  );
  return (
    <span className="mt-3 block rounded-xl border border-line bg-surface p-3">
      <span className="block font-semibold">{t("sm.summary", { rows: preview.rows, months: preview.months.map((m) => preview.monthLabels[m] ?? m).join(", "), total: num(preview.total), currency: preview.currency })}</span>
      {proposal.remembered && <span className="block text-xs text-muted">{t("sm.remembered")}</span>}
      <span className="block text-xs text-muted">{t("sm.privacy")}</span>
      {preview.problems.map((p) => (
        <span key={p} className="mt-1 block text-xs text-clay">
          {p}
        </span>
      ))}
      {preview.notes.map((p) => (
        <span key={p} className="mt-1 block text-xs text-ochre">
          {p}
        </span>
      ))}
      {needs.length > 0 && (
        <>
          <span className="mt-3 block text-xs font-semibold uppercase tracking-wide text-muted">{t("sm.needs", { n: needs.length })}</span>
          <span className="block text-xs text-muted">{t("sm.untickedNote")}</span>
          <ul className="mt-1 space-y-2">{needs.map(card)}</ul>
        </>
      )}
      {done.length > 0 && (
        <details className="mt-3" open={needs.length === 0}>
          <summary className="min-h-12 cursor-pointer py-3 text-xs font-semibold uppercase tracking-wide text-muted">{t("sm.matched", { n: done.length })}</summary>
          <ul className="space-y-2">{done.map(card)}</ul>
        </details>
      )}
      {unmatched > 0 && <span className="mt-2 block text-xs text-ochre">{t("sm.unmatchedNote", { n: unmatched })}</span>}
      {err && <span role="alert" className="mt-2 block text-xs text-clay">{err}</span>}
      <span className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`${primaryBtn} min-h-12`} disabled={busy || preview.problems.length > 0} onClick={() => void doImport()}>
          {t("sm.import")}
        </button>
        <button type="button" className={`${quietBtn} min-h-12`} disabled={busy} onClick={() => setPreview(null)}>
          {t("sm.change")}
        </button>
        <button type="button" className={`${quietBtn} min-h-12`} disabled={busy} onClick={onCancel}>
          {t("sm.cancel")}
        </button>
      </span>
    </span>
  );
}
