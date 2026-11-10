"use client";

import Link from "next/link";
import { MoneySourceLink } from "@/components/progress/proof-panel";
import { useT } from "@/components/app/i18n";
import { beforeDownload, PreflightButton, usePreflight } from "@/components/progress/preflight-page";
import { useCallback, useEffect, useState } from "react";
import { useCurrentProject } from "@/components/app/current-project";
import { useRequireUser, useSession } from "@/components/app/session";
import { TopBar, primaryBtn, quietBtn } from "@/components/workspace/ui";
import type { FaceHeader, FacePatch } from "@/lib/face";
import type { FaceView } from "@/server/face-store";

/**
 * UNDP's FACE form, month by month. Actual expenditure comes from Finance's budget-against-actual
 * workbook; Finance enters the authorised amount (filled from last month's outstanding) and the new
 * request, then downloads the form in UNDP's layout to sign and send.
 */

const input = "w-full rounded-lg border border-line bg-paper px-2 py-1.5 text-right text-sm tabular-nums";
const n = (v: number) => (v < 0 ? `(${Math.abs(v).toLocaleString("en-US")})` : v.toLocaleString("en-US"));
const num = (s: string) => {
  const v = Number(s.replace(/[,\s]/g, ""));
  return Number.isFinite(v) && v >= 0 ? v : 0;
};

async function call<T>(url: string, user: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export function FacePage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const { project } = useCurrentProject();
  const [month, setMonth] = useState("");
  const [v, setV] = useState<FaceView | null>(null);
  const [a, setA] = useState<Record<string, string>>({});
  const [f, setF] = useState<Record<string, string>>({});
  const [periods, setPeriods] = useState({ authorised: "", request: "" });
  const [header, setHeader] = useState<FaceHeader | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const url = `/api/projects/${project.id}/face`;
  const show = (x: FaceView) => {
    setV(x);
    setMonth(x.month);
    setA(Object.fromEntries(x.rows.map((r) => [r.activity, String(r.a || "")])));
    setF(Object.fromEntries(x.rows.map((r) => [r.activity, String(r.f || "")])));
    setPeriods({ authorised: x.entries.authorisedPeriod, request: x.entries.requestPeriod });
    setHeader(x.header);
  };
  const load = useCallback(
    async (m: string) => {
      if (!user) return;
      try {
        show(await call<FaceView>(`${url}${m ? `?month=${m}` : ""}`, user.id));
        setError("");
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [user, url],
  );
  useEffect(() => {
    if (ready && user && project.saved) void load("");
  }, [ready, user, project.saved, load]);
  const { t } = useT();
  const pf = usePreflight(project.id, user?.id, /^\d{4}-\d{2}$/.test(month) ? { kind: "face", month } : null, v);
  if (!user) return null;
  const post = async (body: FacePatch, msg: string) => {
    setError("");
    setNotice("");
    try {
      show(await call<FaceView>(url, user.id, { method: "POST", body: JSON.stringify(body) }));
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  // Live arithmetic as Finance types: D = A - C, G = D + F.
  const rows = (v?.rows ?? []).map((r) => {
    const av = num(a[r.activity] ?? "");
    const fv = num(f[r.activity] ?? "");
    return { ...r, a: av, d: av - r.c, f: fv, g: av - r.c + fv };
  });
  const sum = (k: "a" | "b" | "c" | "d" | "f" | "g") => rows.reduce((t, r) => t + r[k], 0);
  return (
    <div className="min-h-screen">
      <TopBar />
      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        <Link href="/progress/report" className="text-sm text-muted hover:text-ink">
          ← Report
        </Link>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <h1 className="min-w-0 flex-1 font-display text-4xl tracking-tight">FACE form</h1>
          {v && (
            <label className="text-sm">
              Month
              <select className="mt-1 block rounded-xl border border-line bg-paper px-3 py-2" value={month} onChange={(e) => void load(e.target.value)}>
                {v.months.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          UNDP&rsquo;s Funding Authorization and Certificate of Expenditures. Actual expenditure (B) comes from Finance&rsquo;s budget against actual workbook; enter the authorised amount (A) and the
          new request (F), then download it to sign and send.
        </p>
        {error && <p className="mt-4 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">{error}</p>}
        {notice && <p className="mt-4 rounded-xl bg-mist px-4 py-3 text-sm text-leaf">{notice}</p>}
        {v && (
          <>
            <section className="mt-5 overflow-x-auto rounded-2xl border border-line bg-surface p-4">
              <p className="text-sm font-semibold">
                {v.period} · {v.currency}
                {v.saved ? "" : " · not saved yet: authorised amounts filled from last month's outstanding"}
              </p>
              <table className="mt-3 w-full min-w-[64rem] border-separate border-spacing-x-3 text-sm">
                <thead className="text-xs text-muted">
                  <tr className="text-right">
                    <th className="text-left font-medium">Activity</th>
                    <th className="font-medium">A: Authorised ({periods.authorised})</th>
                    <th className="font-medium">B: Actual</th>
                    <th className="font-medium">C: Accepted</th>
                    <th className="font-medium">D = A − C</th>
                    <th className="font-medium">F: New request ({periods.request})</th>
                    <th className="font-medium">G = D + F</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.activity} className="border-t border-line text-right tabular-nums">
                      <td className="py-2 pe-3 text-left">
                        <span className="font-mono text-xs text-muted">{r.activity}</span> {r.name}
                      </td>
                      <td className="w-36 py-1">
                        <input
                          className={input}
                          inputMode="decimal"
                          value={a[r.activity] ?? ""}
                          onChange={(e) => setA({ ...a, [r.activity]: e.target.value })}
                          aria-label={`Authorised, ${r.activity}`}
                        />
                      </td>
                      <td>{n(r.b)}</td>
                      <td>{n(r.c)}</td>
                      <td className={r.d < 0 ? "text-clay" : ""}>{n(r.d)}</td>
                      <td className="w-36 py-1">
                        <input
                          className={input}
                          inputMode="decimal"
                          value={f[r.activity] ?? ""}
                          onChange={(e) => setF({ ...f, [r.activity]: e.target.value })}
                          aria-label={`New request, ${r.activity}`}
                        />
                      </td>
                      <td>{n(r.g)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-ink text-right font-semibold tabular-nums">
                    <td className="py-2 text-left">Total {v.currency}</td>
                    <td>{n(sum("a"))}</td>
                    <td>{n(sum("b"))}</td>
                    <td>{n(sum("c"))}</td>
                    <td>{n(sum("d"))}</td>
                    <td>{n(sum("f"))}</td>
                    <td>{n(sum("g"))}</td>
                  </tr>
                  <tr className="border-t border-line text-right tabular-nums text-muted">
                    <td className="py-2 text-left">Overhead/GMS 8% (USD)</td>
                    <td>0</td>
                    <td>${n(v.overheadUsd)}</td>
                    <td>${n(v.overheadUsd)}</td>
                    <td>(${n(v.overheadUsd)})</td>
                    <td>${n(v.overheadUsd)}</td>
                    <td>0</td>
                  </tr>
                </tbody>
              </table>
              <p className="mt-2">
                <MoneySourceLink project={project.id} user={user.id} />
              </p>
              <div className="mt-3 flex flex-wrap items-end gap-3 text-sm">
                <label>
                  Authorised period
                  <input
                    className="mt-1 block rounded-lg border border-line bg-paper px-2 py-1.5"
                    value={periods.authorised}
                    onChange={(e) => setPeriods({ ...periods, authorised: e.target.value })}
                  />
                </label>
                <label>
                  Request period
                  <input className="mt-1 block rounded-lg border border-line bg-paper px-2 py-1.5" value={periods.request} onChange={(e) => setPeriods({ ...periods, request: e.target.value })} />
                </label>
                <button
                  type="button"
                  className={primaryBtn}
                  onClick={() =>
                    void post(
                      {
                        action: "month",
                        month,
                        authorised: Object.fromEntries(rows.map((r) => [r.activity, r.a])),
                        request: Object.fromEntries(rows.map((r) => [r.activity, r.f])),
                        requestPeriod: periods.request,
                        authorisedPeriod: periods.authorised,
                      },
                      "Saved.",
                    )
                  }
                >
                  Save
                </button>
                <a
                  className={quietBtn}
                  href={`${url}?month=${month}&download=1`}
                  onClick={async (e) => {
                    e.preventDefault();
                    if ((await beforeDownload(project.id, user.id, pf, (n) => t("pf.draftConfirm", { n }), /^\d{4}-\d{2}$/.test(month) ? { kind: "face", month } : null, t("pf.uncheckedConfirm"))) === null) return;
                    const r = await fetch(`${url}?month=${month}&download=1`, { headers: { "x-demo-user": user.id } });
                    if (!r.ok) return setError("Could not make the file.");
                    const link = document.createElement("a");
                    link.href = URL.createObjectURL(await r.blob());
                    link.download = `FACE ${project.id} ${month}.xlsx`;
                    link.click();
                  }}
                >
                  Download for Excel
                </a>
                <PreflightButton p={pf} report={{ kind: "face", month }} className={quietBtn} />
                <span className="text-xs text-muted">The download uses what is saved: save first.</span>
              </div>
            </section>
            {header && (
              <details className="mt-4 rounded-2xl border border-line bg-surface p-4 text-sm" open={!v.header.programme || !v.header.signer}>
                <summary className="cursor-pointer font-semibold">Form details (same every month)</summary>
                <div className="mt-3 grid gap-3 sm:grid-cols-3">
                  {(
                    [
                      ["programme", "Programme code & title"],
                      ["institution", "Implementing institution code"],
                      ["officer", "UNDP responsible officer"],
                      ["signer", "Signed by"],
                      ["signerTitle", "Their title"],
                      ["agency", "UN agency"],
                    ] as [keyof FaceHeader, string][]
                  ).map(([k, label]) => (
                    <label key={k}>
                      {label}
                      <input className="mt-1 block w-full rounded-lg border border-line bg-paper px-2 py-1.5" value={header[k]} onChange={(e) => setHeader({ ...header, [k]: e.target.value })} />
                    </label>
                  ))}
                </div>
                <button type="button" className={`${quietBtn} mt-3`} onClick={() => void post({ action: "header", header }, "Form details saved.")}>
                  Save form details
                </button>
              </details>
            )}
          </>
        )}
      </main>
    </div>
  );
}
