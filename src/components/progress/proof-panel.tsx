"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { personName } from "@/lib/project";
import type { MoneySource, ProofView } from "@/server/proof";

/**
 * Number to proof (lib/evidence). A reported figure as a button: one tap opens a sheet with the
 * accepted results behind it, each with its proof (files, links, the Kobo submission), who
 * recorded it and who accepted it when. A figure with results but no proof shows "No proof yet";
 * a figure with nothing behind it is plain text, never a dead link. Spending figures open where
 * they come from (Finance's workbook as imported).
 */

const fmt = (v: number) =>
  v.toLocaleString("en-US", { maximumFractionDigits: 2 });

function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useT();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-paper p-4 text-start shadow-xl sm:max-w-xl sm:rounded-2xl sm:p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-xl">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 min-w-11 rounded-full text-lg text-muted hover:text-ink"
            aria-label={t("ev.close")}
          >
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ProofNumber({
  project,
  user,
  indicator,
  from,
  to,
  value,
  records,
  proof,
  className = "font-semibold tabular-nums",
  children,
}: {
  project: string;
  user: string;
  indicator: string;
  /** Null: since the start. */
  from: string | null;
  to: string;
  value: number;
  /** Accepted results behind the figure; with none, the number is plain text. */
  records: number;
  /** Files and links behind it, when known: zero shows "No proof yet". */
  proof?: number;
  className?: string;
  children?: React.ReactNode;
}) {
  const { t, date } = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<ProofView | null>(null);
  const [error, setError] = useState("");
  const shown = children ?? fmt(value);
  useEffect(() => {
    if (!open || v) return;
    fetch(
      `/api/projects/${project}/proof?indicator=${encodeURIComponent(indicator)}&to=${to}${from ? `&from=${from}` : ""}`,
      { headers: { "x-demo-user": user } },
    )
      .then(async (r) => {
        const d = await r.json().catch(() => null);
        if (!r.ok) setError(d?.error ?? `Error ${r.status}`);
        else setV(d);
      })
      .catch((e) => setError(String(e)));
  }, [open, v, project, user, indicator, from, to]);
  if (!records) return <span className={className}>{shown}</span>;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`${className} text-forest underline decoration-dotted underline-offset-4 hover:decoration-solid`}
        title={t("ev.show", { n: fmt(value) })}
      >
        {shown}
      </button>
      {proof === 0 && (
        <span className="ms-1 whitespace-nowrap rounded-full bg-ochre-soft px-1.5 py-0.5 text-[10px] font-semibold text-ochre">
          {t("ev.noProof")}
        </span>
      )}
      {open && (
        <Sheet title={t("ev.title")} onClose={() => setOpen(false)}>
          {error && <p className="mt-2 text-sm text-clay">{error}</p>}
          {!v && !error && (
            <p className="mt-2 text-sm text-muted">{t("ev.loading")}</p>
          )}
          {v && (
            <>
              <p className="mt-1 text-sm">
                <span className="font-mono text-xs text-muted">
                  {v.indicator.donorCode}
                </span>{" "}
                {v.indicator.name}
              </p>
              <p className="text-sm text-muted">
                {v.from
                  ? t("ev.period", {
                      from: date(v.from, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      }),
                      to: date(v.to, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      }),
                    })
                  : t("ev.since", {
                      to: date(v.to, {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      }),
                    })}{" "}
                ·{" "}
                {t("ev.summary", {
                  count: v.results.length,
                  n: fmt(v.total),
                  unit: v.indicator.unit,
                })}
              </p>
              {!v.results.length && (
                <p className="mt-3 text-sm text-muted">{t("ev.none")}</p>
              )}
              <ul className="mt-3 space-y-3">
                {v.results.map((r) => {
                  const none = !r.files.length && !r.links.length && !r.kobo;
                  return (
                    <li
                      key={r.id}
                      className="rounded-xl border border-line bg-surface p-3 text-sm"
                    >
                      <p>
                        <span className="font-semibold tabular-nums">
                          {fmt(r.value)}
                        </span>{" "}
                        {r.unit} ·{" "}
                        {date(r.date, { day: "numeric", month: "short" })}
                        {r.district || r.province
                          ? ` · ${[r.district, r.province].filter(Boolean).join(", ")}`
                          : ""}
                      </p>
                      {r.note && (
                        <p className="mt-1 line-clamp-3 text-muted">{r.note}</p>
                      )}
                      <p className="mt-1 text-xs text-muted">
                        {t("ev.recorded", { who: personName(r.recordedBy) })} ·{" "}
                        {r.acceptedBy && r.acceptedAt
                          ? t("ev.accepted", {
                              who: personName(r.acceptedBy),
                              date: date(r.acceptedAt.slice(0, 10), {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                              }),
                            })
                          : t("ev.notAccepted")}
                      </p>
                      <ul className="mt-2 space-y-1">
                        {r.files.map((f) => (
                          <li key={f.hash}>
                            <a
                              href={`/api/files/${f.hash}`}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-9 items-center font-semibold text-forest hover:underline"
                              onClick={(e) => openFile(e, f.hash, user)}
                            >
                              📎 {f.caption || f.name}
                            </a>
                          </li>
                        ))}
                        {r.links.map((l) => (
                          <li key={l.url}>
                            <a
                              href={l.url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex min-h-9 items-center font-semibold text-forest hover:underline"
                            >
                              🔗 {l.title || l.url}
                            </a>
                          </li>
                        ))}
                        {r.kobo && (
                          <li className="text-muted">
                            {t("ev.kobo", { id: r.kobo.id ?? "" })}
                          </li>
                        )}
                        {none && (
                          <li className="font-semibold text-ochre">
                            {r.noFile
                              ? t("ev.noFile", { why: r.noFile })
                              : t("ev.noProof")}
                          </li>
                        )}
                      </ul>
                    </li>
                  );
                })}
              </ul>
              <Link
                href={`/progress/results?indicator=${v.indicator.code}${v.from ? `&from=${v.from}` : ""}&to=${v.to}`}
                className="mt-4 inline-flex min-h-11 items-center font-semibold text-forest hover:underline"
              >
                {t("ev.open")} →
              </Link>
            </>
          )}
        </Sheet>
      )}
    </>
  );
}

/** Files open through the API with the session's header, so they open for the signed-in person. */
async function openFile(e: React.MouseEvent, hash: string, user: string) {
  e.preventDefault();
  const w = window.open("", "_blank");
  const r = await fetch(`/api/files/${hash}`, {
    headers: { "x-demo-user": user },
  });
  if (!r.ok) {
    w?.close();
    return;
  }
  const url = URL.createObjectURL(await r.blob());
  if (w) w.location.href = url;
  else window.location.href = url;
}

/** For spending figures: a small link that opens where they come from. */
export function MoneySourceLink({
  project,
  user,
}: {
  project: string;
  user: string;
}) {
  const { t, date } = useT();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState<MoneySource | null>(null);
  useEffect(() => {
    if (!open || v) return;
    fetch(`/api/projects/${project}/proof?money=1`, {
      headers: { "x-demo-user": user },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setV(d.sources))
      .catch(() => undefined);
  }, [open, v, project, user]);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs font-semibold text-forest underline decoration-dotted underline-offset-4"
      >
        {t("ev.money.show")}
      </button>
      {open && (
        <Sheet title={t("ev.money.title")} onClose={() => setOpen(false)}>
          <p className="mt-1 text-sm text-muted">{t("ev.money.hint")}</p>
          {!v ? (
            <p className="mt-3 text-sm text-muted">{t("ev.loading")}</p>
          ) : !v.length ? (
            <p className="mt-3 text-sm font-semibold text-ochre">
              {t("ev.money.none")}
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {[...v].reverse().map((s) => (
                <li
                  key={`${s.file}${s.at}`}
                  className="rounded-xl border border-line bg-surface p-3 text-sm"
                >
                  <p className="font-semibold">
                    {t("ev.money.file", {
                      file: s.file,
                      who: personName(s.by),
                      date: date(s.at.slice(0, 10), {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      }),
                    })}
                  </p>
                  <p className="text-xs text-muted">
                    {t("ev.money.months", {
                      from: s.months[0] ?? "",
                      to: s.months.at(-1) ?? "",
                      lines: s.lines,
                      currency: s.currency,
                    })}
                  </p>
                  {s.sharepointUrl && (
                    <a
                      href={s.sharepointUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1 inline-flex min-h-9 items-center font-semibold text-forest hover:underline"
                    >
                      {t("ev.money.sharepoint")} →
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Sheet>
      )}
    </>
  );
}
