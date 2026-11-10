"use client";

import { changeReasonHeader } from "@/components/setup/change-reason";
import { useEffect, useMemo, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import {
  BUDGET_FIELDS,
  BUDGET_KINDS,
  ourWork,
  parseBudget,
  parseWorkplan,
  quarterEnd,
  type Budget,
  type BudgetColumns,
  type BudgetField,
  type BudgetKind,
  type BudgetLine,
  type BudgetParse,
  type Grid,
  type WorkplanItem,
} from "@/lib/budget";
import type { MessageKey } from "@/lib/i18n";
import { clearPending, getPending } from "@/components/setup/pending";
import { readWorkbook } from "@/lib/read-sheet";

/**
 * Setup steps after the project exists: the budget and the workplan, uploaded from the donor's
 * spreadsheets (the app guesses the columns, a person checks them) or typed in. Both feed the
 * procurement calendar.
 */

const cellInput = "w-full min-w-0 rounded-lg border border-transparent bg-transparent px-1.5 py-1 hover:border-line focus:border-forest focus:bg-surface";
const colName = (c: number) => (c >= 26 ? String.fromCharCode(64 + Math.floor(c / 26)) : "") + String.fromCharCode(65 + (c % 26));

async function api<T>(url: string, user: string | undefined, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "", ...(init?.method === "PUT" ? changeReasonHeader(url) : {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

function useMoney(currency: string) {
  const { lang } = useT();
  return useMemo(() => {
    try {
      const f = new Intl.NumberFormat(lang, { style: "currency", currency, maximumFractionDigits: 0 });
      return (n: number) => f.format(n);
    } catch {
      return (n: number) => `${Math.round(n).toLocaleString()} ${currency}`;
    }
  }, [lang, currency]);
}

/** Upload button that reads an Excel file into its sheets. */
function Upload({ label, onRead }: { label: string; onRead: (sheets: { name: string; grid: Grid }[], file: string) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <div>
      <label className={`${primaryBtn} inline-flex cursor-pointer items-center gap-2 px-5 py-2.5`}>
        <input
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (!file) return;
            setBusy(true);
            setError("");
            try {
              onRead(await readWorkbook(await file.arrayBuffer()), file.name);
            } catch {
              setError(t("plan.readFailed"));
            } finally {
              setBusy(false);
            }
          }}
        />
        {busy ? t("plan.reading") : label}
      </label>
      {error && (
        <p role="alert" className="mt-2 text-sm text-clay">
          {error}
        </p>
      )}
    </div>
  );
}

/* ---------------- Budget ---------------- */

const FIELD_LABEL: Record<BudgetField, MessageKey> = {
  code: "budget.col.code",
  activity: "budget.col.activity",
  description: "budget.col.description",
  unit: "budget.col.unit",
  quantity: "budget.col.quantity",
  unitCost: "budget.col.unitCost",
  total: "budget.col.total",
  spent: "budget.col.spent",
};

export function BudgetStep({ code, onDone }: { code: string; onDone: () => void }) {
  const { t, date } = useT();
  const { user } = useSession();
  const [budget, setBudget] = useState<Budget | null>(null);
  const [saved, setSaved] = useState(0);
  const [source, setSource] = useState<{ file: string; sheets: { name: string; grid: Grid }[]; sheet: number; parse: BudgetParse } | null>(null);
  const [filter, setFilter] = useState<"all" | "procure" | BudgetKind>("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  // Where each line came from (lib/agreement: every proposed value shows its source), by position.
  const [sources, setSources] = useState<string[]>([]);
  const [proposedFrom, setProposedFrom] = useState("");
  const [proposedQuestions, setProposedQuestions] = useState<string[]>([]);
  const money = useMoney(budget?.currency ?? "USD");

  useEffect(() => {
    api<Budget>(`/api/projects/${code}/budget`, user?.id)
      .then((b) => {
        setSaved(b.lines.length);
        // Read from the documents at the start of setup: proposed here, saved only when the person saves it.
        const p = getPending().budget;
        if (!b.lines.length && p?.lines.length) {
          setBudget({ currency: p.currency, lines: p.lines });
          setSources(p.sources);
          setProposedFrom(p.file);
          setProposedQuestions(p.questions);
          setDirty(true);
        } else setBudget(b);
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [code, user?.id]);

  const read = (sheets: { name: string; grid: Grid }[], file: string) => {
    // The sheet that reads as the most budget lines.
    const tries = sheets.map((s) => parseBudget(s.grid));
    const best = tries.reduce((b, p, i) => ((p?.lines.length ?? 0) > (tries[b]?.lines.length ?? 0) ? i : b), 0);
    const parse = tries[best];
    if (!parse || !parse.lines.length) return setError(t("budget.noLines"));
    setError("");
    setSource({ file, sheets, sheet: best, parse });
    setBudget({ currency: parse.currency, lines: parse.lines });
    setSources(parse.rows.map((r) => `${file}, sheet "${sheets[best].name}", row ${r}`));
    setProposedFrom("");
    setDirty(true);
  };
  const reparse = (patch: { sheet?: number; columns?: BudgetColumns; currency?: string }) => {
    if (!source) return;
    const sheet = patch.sheet ?? source.sheet;
    const parse = parseBudget(source.sheets[sheet].grid, patch.sheet !== undefined ? undefined : { row: source.parse.headerRow, columns: patch.columns ?? source.parse.columns, currency: patch.currency ?? source.parse.currency });
    if (!parse) return setError(t("budget.noLines"));
    setSource({ ...source, sheet, parse });
    setBudget({ currency: parse.currency, lines: parse.lines });
    setSources(parse.rows.map((r) => `${source.file}, sheet "${source.sheets[sheet].name}", row ${r}`));
    setDirty(true);
  };

  const lines = budget?.lines ?? [];
  const setLine = (i: number, patch: Partial<BudgetLine>) => {
    setBudget((b) => b && { ...b, lines: b.lines.map((l, k) => (k === i ? { ...l, ...patch } : l)) });
    setDirty(true);
  };
  const shown = lines.map((l, i) => ({ l, i })).filter(({ l }) => filter === "all" || (filter === "procure" ? l.procure : l.kind === filter));
  const total = lines.reduce((s, l) => s + l.total, 0);
  const procured = lines.filter((l) => l.procure);
  const quarters = [...new Set(lines.flatMap((l) => Object.keys(l.schedule)))].sort();

  const save = async () => {
    if (!budget) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${code}/budget`, user?.id, { method: "PUT", body: JSON.stringify(budget) });
      setDirty(false);
      setSaved(budget.lines.length);
      clearPending("budget");
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!budget) return <p className="text-sm text-muted">{error || t("setup.loading")}</p>;

  return (
    <section>
      <h1 className="font-display text-3xl leading-tight tracking-tight">{t("budget.title")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">{t("budget.help")}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Upload label={t(saved ? "budget.uploadAgain" : "budget.upload")} onRead={read} />
        {saved > 0 && !source && <span className="text-sm text-muted">{t("budget.saved", { n: saved })}</span>}
        {source && <span className="text-sm text-muted">{t("plan.readFrom", { file: source.file, n: lines.length })}</span>}
      </div>
      {source && saved > 0 && <p className="mt-2 text-sm text-ochre">{t("budget.replaces", { n: saved })}</p>}
      {proposedFrom && (
        <div className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm">
          <p>{t("ag.budgetFrom", { file: proposedFrom })}</p>
          {proposedQuestions.length > 0 && (
            <ul className="mt-1 list-disc ps-5 text-muted">
              {proposedQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {source && (
        <details className="mt-4 rounded-2xl border border-line bg-surface p-4" open={source.parse.warnings.length > 0}>
          <summary className="cursor-pointer text-sm font-semibold">{t("plan.columns")}</summary>
          <p className="mt-2 text-xs text-muted">{t("plan.columnsHelp")}</p>
          {source.parse.warnings.map((w) => (
            <p key={w} className="mt-2 text-sm text-clay">
              {w}
            </p>
          ))}
          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {source.sheets.length > 1 && (
              <label className="text-sm">
                {t("plan.sheet")}
                <select value={source.sheet} onChange={(e) => reparse({ sheet: Number(e.target.value) })} className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2">
                  {source.sheets.map((s, i) => (
                    <option key={s.name} value={i}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {BUDGET_FIELDS.map((f) => (
              <label key={f} className="text-sm">
                {t(FIELD_LABEL[f])}
                <select
                  value={source.parse.columns[f] ?? -1}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    reparse({ columns: { ...source.parse.columns, [f]: v < 0 ? undefined : v } });
                  }}
                  className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2"
                >
                  <option value={-1}>{t("plan.none")}</option>
                  {source.parse.headers.map((h, c) => (
                    <option key={c} value={c}>
                      {colName(c)} · {h.slice(0, 50) || "—"}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label className="text-sm">
              {t("budget.currency")}
              <input
                key={source.parse.currency}
                defaultValue={source.parse.currency}
                maxLength={3}
                onBlur={(e) => /^[A-Za-z]{3}$/.test(e.target.value) && e.target.value.toUpperCase() !== source.parse.currency && reparse({ currency: e.target.value.toUpperCase() })}
                className="mt-1 w-full rounded-lg border border-line bg-paper px-2 py-2 uppercase"
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-muted">
            {source.parse.columns.quarters.length
              ? t("budget.quartersFound", { list: source.parse.columns.quarters.map((q) => `${colName(q.col)} ${date(q.start, { month: "short", year: "numeric" })}`).join(", ") })
              : t("budget.noQuarters")}
          </p>
        </details>
      )}

      {lines.length > 0 && (
        <>
          <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-sunken p-3">
              <dt className="text-xs text-muted">{t("budget.total")}</dt>
              <dd className="font-display text-xl tabular-nums">{money(total)}</dd>
            </div>
            <div className="rounded-2xl bg-sunken p-3">
              <dt className="text-xs text-muted">{t("budget.toProcure")}</dt>
              <dd className="font-display text-xl tabular-nums">
                {money(procured.reduce((s, l) => s + l.total, 0))} <span className="text-sm text-muted">· {t("budget.lines", { n: procured.length })}</span>
              </dd>
            </div>
            <div className="rounded-2xl bg-sunken p-3">
              <dt className="text-xs text-muted">{t("budget.spentSoFar")}</dt>
              <dd className="font-display text-xl tabular-nums">{money(lines.reduce((s, l) => s + (l.spent ?? 0), 0))}</dd>
            </div>
          </dl>

          <div role="tablist" className="mt-5 flex flex-wrap gap-1 text-sm">
            {(["all", "procure", ...BUDGET_KINDS] as const).map((f) => (
              <button
                key={f}
                type="button"
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1.5 ${filter === f ? "bg-ink text-paper" : "bg-sunken text-muted hover:text-ink"}`}
              >
                {t(`budget.filter.${f}`)}
              </button>
            ))}
          </div>

          <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="bg-sunken text-start text-xs text-muted">
                <tr>
                  <th className="px-2 py-2 text-start font-medium">{t("budget.procure")}</th>
                  <th className="px-2 py-2 text-start font-medium">{t("budget.col.code")}</th>
                  <th className="px-2 py-2 text-start font-medium">{t("budget.col.description")}</th>
                  <th className="px-2 py-2 text-start font-medium">{t("budget.kind")}</th>
                  <th className="px-2 py-2 text-start font-medium">{t("budget.col.unit")}</th>
                  <th className="px-2 py-2 text-end font-medium">{t("budget.col.quantity")}</th>
                  <th className="px-2 py-2 text-end font-medium">{t("budget.col.total")}</th>
                  <th className="px-2 py-2 text-start font-medium">{t("budget.when")}</th>
                  <th className="px-2 py-2" aria-label={t("budget.remove")} />
                </tr>
              </thead>
              <tbody>
                {shown.map(({ l, i }) => (
                  <tr key={i} className={`border-t border-line align-top ${l.procure ? "" : "text-muted"}`}>
                    <td className="px-2 py-1.5">
                      <input type="checkbox" checked={l.procure} onChange={(e) => setLine(i, { procure: e.target.checked })} aria-label={t("budget.procureLine", { code: l.code })} className="h-5 w-5 accent-forest" />
                    </td>
                    <td className="px-1 py-1 font-mono text-xs">
                      <input value={l.code} onChange={(e) => setLine(i, { code: e.target.value })} className={`${cellInput} w-28`} aria-label={t("budget.col.code")} />
                      {l.activityCode && <span className="block px-1.5 text-[11px] text-muted">{t("budget.activityN", { n: l.activityCode })}</span>}
                    </td>
                    <td className="px-1 py-1">
                      <textarea value={l.description} rows={2} onChange={(e) => setLine(i, { description: e.target.value })} className={`${cellInput} min-w-[16rem] resize-y`} aria-label={t("budget.col.description")} />
                      {sources[i] && <span className="block px-1.5 text-[11px] text-muted">{t("ag.source", { source: sources[i] })}</span>}
                    </td>
                    <td className="px-1 py-1">
                      <select value={l.kind} onChange={(e) => setLine(i, { kind: e.target.value as BudgetKind })} className="w-32 rounded-lg border border-line bg-surface px-2 py-1 text-sm" aria-label={t("budget.kind")}>
                        {BUDGET_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {t(`budget.filter.${k}`)}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-1 py-1">
                      <input value={l.unit ?? ""} onChange={(e) => setLine(i, { unit: e.target.value || null })} className={`${cellInput} w-24`} aria-label={t("budget.col.unit")} />
                    </td>
                    <td className="px-1 py-1">
                      <input
                        inputMode="decimal"
                        value={l.quantity ?? ""}
                        onChange={(e) => setLine(i, { quantity: e.target.value === "" ? null : Number(e.target.value) || 0 })}
                        className={`${cellInput} w-20 text-end tabular-nums`}
                        aria-label={t("budget.col.quantity")}
                      />
                    </td>
                    <td className="px-1 py-1">
                      <input inputMode="decimal" value={l.total} onChange={(e) => setLine(i, { total: Number(e.target.value) || 0 })} className={`${cellInput} w-32 text-end tabular-nums`} aria-label={t("budget.col.total")} />
                    </td>
                    <td className="px-2 py-1.5 text-xs">
                      {quarters.filter((q) => l.schedule[q]).map((q) => (
                        <span key={q} className="me-1 inline-block whitespace-nowrap rounded bg-sunken px-1.5 py-0.5">
                          {date(q, { month: "short", year: "2-digit" })}
                        </span>
                      ))}
                    </td>
                    <td className="px-1 py-1">
                      <button
                        type="button"
                        onClick={() => {
                          setBudget((b) => b && { ...b, lines: b.lines.filter((_, k) => k !== i) });
                          setSources((s) => s.filter((_, k) => k !== i));
                          setDirty(true);
                        }}
                        aria-label={t("budget.removeLine", { code: l.code })}
                        className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-clay-soft hover:text-clay"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <button
        type="button"
        onClick={() => {
          setBudget((b) => b && { ...b, lines: [...b.lines, { code: `L-${b.lines.length + 1}`, activityCode: null, activity: null, description: t("budget.newLine"), unit: null, quantity: null, unitCost: null, total: 0, spent: null, schedule: {}, kind: "program", procure: true }] });
          setFilter("all");
          setDirty(true);
        }}
        className={`${quietBtn} mt-3`}
      >
        {t("budget.addLine")}
      </button>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
          {error}
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={`${primaryBtn} px-6`}>
          {busy ? t("settings.saving") : t("plan.saveContinue")}
        </button>
        <button type="button" onClick={onDone} className={quietBtn}>
          {t(dirty ? "plan.skipUnsaved" : "plan.continue")}
        </button>
      </div>
    </section>
  );
}

/* ---------------- Workplan ---------------- */

export function WorkplanStep({ code, projectStart, onDone }: { code: string; projectStart: string; onDone: () => void }) {
  const { t, date } = useT();
  const { user } = useSession();
  const [items, setItems] = useState<WorkplanItem[] | null>(null);
  const [saved, setSaved] = useState(0);
  const [source, setSource] = useState<{ file: string; grid: Grid; relative: boolean; warnings: string[] } | null>(null);
  const [year1, setYear1] = useState(projectStart.slice(0, 7) + "-01");
  const [onlyOurs, setOnlyOurs] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    api<{ items: WorkplanItem[] }>(`/api/projects/${code}/workplan`, user?.id)
      .then((r) => {
        setItems(r.items);
        setSaved(r.items.length);
      })
      .catch((e) => setError(String(e instanceof Error ? e.message : e)));
  }, [code, user?.id]);

  const apply = (grid: Grid, file: string, start: string) => {
    const p = parseWorkplan(grid, start);
    if (!p || !p.items.length) return setError(t("workplan.noRows"));
    setError("");
    setSource({ file, grid, relative: p.relative, warnings: p.warnings });
    setItems(p.items);
    setDirty(true);
  };
  const read = (sheets: { name: string; grid: Grid }[], file: string) => {
    const best = sheets.map((s) => ({ s, n: parseWorkplan(s.grid, year1)?.items.length ?? 0 })).sort((a, b) => b.n - a.n)[0];
    if (!best?.n) return setError(t("workplan.noRows"));
    apply(best.s.grid, file, year1);
  };

  const all = items ?? [];
  const ours = ourWork(all);
  const hasPartners = ours.length !== all.length;
  const shown = all.map((it, i) => ({ it, i })).filter(({ it }) => !onlyOurs || !hasPartners || ours.includes(it));
  const setItem = (i: number, patch: Partial<WorkplanItem>) => {
    setItems((list) => list && list.map((x, k) => (k === i ? { ...x, ...patch } : x)));
    setDirty(true);
  };

  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await api(`/api/projects/${code}/workplan`, user?.id, { method: "PUT", body: JSON.stringify({ items: all }) });
      setDirty(false);
      setSaved(all.length);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (!items) return <p className="text-sm text-muted">{error || t("setup.loading")}</p>;

  return (
    <section>
      <h1 className="font-display text-3xl leading-tight tracking-tight">{t("workplan.title")}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted">{t("workplan.help")}</p>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Upload label={t(saved ? "workplan.uploadAgain" : "workplan.upload")} onRead={read} />
        {saved > 0 && !source && <span className="text-sm text-muted">{t("workplan.saved", { n: saved })}</span>}
        {source && <span className="text-sm text-muted">{t("plan.readFrom", { file: source.file, n: all.length })}</span>}
      </div>
      {source && saved > 0 && <p className="mt-2 text-sm text-ochre">{t("workplan.replaces", { n: saved })}</p>}
      {source?.warnings.map((w) => (
        <p key={w} className="mt-2 text-sm text-clay">
          {w}
        </p>
      ))}
      {source?.relative && (
        <label className="mt-4 block max-w-xs rounded-2xl border border-ochre bg-surface p-4 text-sm font-medium">
          {t("workplan.year1")}
          <input
            type="month"
            value={year1.slice(0, 7)}
            onChange={(e) => {
              if (!e.target.value) return;
              const start = `${e.target.value}-01`;
              setYear1(start);
              apply(source.grid, source.file, start);
            }}
            className="mt-2 w-full rounded-lg border border-line bg-paper px-2 py-2"
          />
          <span className="mt-1 block text-xs font-normal text-muted">{t("workplan.year1Help")}</span>
        </label>
      )}

      {hasPartners && (
        <label className="mt-4 flex items-center gap-2 text-sm">
          <input type="checkbox" checked={onlyOurs} onChange={(e) => setOnlyOurs(e.target.checked)} className="h-5 w-5 accent-forest" />
          {t("workplan.onlyOurs", { n: ours.length, total: all.length })}
        </label>
      )}

      {shown.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[52rem] text-sm">
            <thead className="bg-sunken text-xs text-muted">
              <tr>
                <th className="px-2 py-2 text-start font-medium">{t("workplan.col.code")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("workplan.col.title")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("workplan.col.org")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("workplan.col.start")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("workplan.col.end")}</th>
                <th className="px-2 py-2 text-start font-medium">{t("workplan.col.targets")}</th>
                <th className="px-2 py-2" aria-label={t("budget.remove")} />
              </tr>
            </thead>
            <tbody>
              {shown.map(({ it, i }) => (
                <tr key={i} className="border-t border-line align-top">
                  <td className="px-1 py-1 font-mono text-xs">
                    <input value={it.code} onChange={(e) => setItem(i, { code: e.target.value })} className={`${cellInput} w-24`} aria-label={t("workplan.col.code")} />
                  </td>
                  <td className="px-1 py-1">
                    <textarea value={it.title} rows={2} onChange={(e) => setItem(i, { title: e.target.value })} className={`${cellInput} min-w-[18rem] resize-y`} aria-label={t("workplan.col.title")} />
                    {it.remark && <span className="block px-1.5 text-xs text-muted">{it.remark}</span>}
                  </td>
                  <td className="px-1 py-1">
                    <input value={it.org ?? ""} onChange={(e) => setItem(i, { org: e.target.value || null })} className={`${cellInput} w-20`} aria-label={t("workplan.col.org")} />
                  </td>
                  <td className="px-1 py-1">
                    <input type="date" value={it.start ?? ""} onChange={(e) => setItem(i, { start: e.target.value || null })} className={cellInput} aria-label={t("workplan.col.start")} />
                  </td>
                  <td className="px-1 py-1">
                    <input type="date" value={it.end ?? ""} min={it.start ?? undefined} onChange={(e) => setItem(i, { end: e.target.value || null })} className={cellInput} aria-label={t("workplan.col.end")} />
                  </td>
                  <td className="px-2 py-1.5 text-xs">
                    {Object.entries(it.targets).map(([q, v]) => (
                      <span key={q} className="me-1 inline-block whitespace-nowrap rounded bg-sunken px-1.5 py-0.5 tabular-nums">
                        {date(q, { month: "short", year: "2-digit" })}: {v}
                      </span>
                    ))}
                    {it.unit && <span className="block text-muted">{it.unit}</span>}
                  </td>
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      onClick={() => {
                        setItems((list) => list && list.filter((_, k) => k !== i));
                        setDirty(true);
                      }}
                      aria-label={t("budget.removeLine", { code: it.code })}
                      className="grid h-9 w-9 place-items-center rounded-full text-muted hover:bg-clay-soft hover:text-clay"
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <button
        type="button"
        onClick={() => {
          const start = projectStart.slice(0, 7) + "-01";
          setItems((list) => [...(list ?? []), { code: `${(list?.length ?? 0) + 1}`, activityCode: null, activity: null, title: t("workplan.newRow"), indicator: null, unit: null, org: "ROP", targets: {}, active: [start], start, end: quarterEnd(start), remark: null }]);
          setDirty(true);
        }}
        className={`${quietBtn} mt-3`}
      >
        {t("workplan.addRow")}
      </button>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
          {error}
        </p>
      )}
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" onClick={() => void save()} disabled={busy || !dirty} className={`${primaryBtn} px-6`}>
          {busy ? t("settings.saving") : t("plan.saveContinue")}
        </button>
        <button type="button" onClick={onDone} className={quietBtn}>
          {t(dirty ? "plan.skipUnsaved" : "plan.continue")}
        </button>
      </div>
    </section>
  );
}
