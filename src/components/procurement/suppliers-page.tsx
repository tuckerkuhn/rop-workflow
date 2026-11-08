"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireUser, useSession } from "@/components/app/session";
import { Pill, TopBar, dangerBtn, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { lastScreening, type Supplier, type SupplierAction } from "@/lib/suppliers";
import type { SuppliersView } from "@/app/api/suppliers/route";

/**
 * The supplier register: every supplier the organization buys from, with its licence, confirmed
 * bank details, screenings and declaration. Procurement records pick from it.
 */

export type SupplierRow = Supplier & { gaps: string[] };

async function call(user: string | undefined, init?: RequestInit): Promise<SuppliersView> {
  const res = await fetch("/api/suppliers", { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": user ?? "" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as SuppliersView;
}

/** The register for procurement checks; null until loaded or when not used. */
export function useSupplierRegister(enabled: boolean, userId: string | undefined): SupplierRow[] | null {
  const [rows, setRows] = useState<SupplierRow[] | null>(null);
  useEffect(() => {
    if (!enabled || !userId) return setRows(null);
    let live = true;
    call(userId)
      .then((v) => live && setRows(v.suppliers))
      .catch(() => live && setRows(null));
    return () => {
      live = false;
    };
  }, [enabled, userId]);
  return rows;
}

const input = "mt-1 block w-full rounded-xl border border-line bg-paper px-3 py-2.5 text-base";
const lbl = "text-xs font-medium text-muted";
const empty = { name: "", aka: [] as string[], licenceNo: "", licenceExpiry: "", licenceEvidence: "", ownerId: "", phone: "", address: "" };

function DetailsForm({ start, onSave, onCancel }: { start: typeof empty; onSave: (f: typeof empty) => Promise<void>; onCancel: () => void }) {
  const [f, setF] = useState(start);
  const [aka, setAka] = useState(start.aka.join("; "));
  const set = (k: keyof typeof empty) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form
      className="grid gap-3 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        void onSave({ ...f, aka: aka.split(";").map((x) => x.trim()).filter(Boolean) });
      }}
    >
      <label className="sm:col-span-2">
        <span className={lbl}>Name, as on its licence</span>
        <input className={input} value={f.name} onChange={set("name")} required />
      </label>
      <label className="sm:col-span-2">
        <span className={lbl}>Other names it trades or invoices under (separate with ;)</span>
        <input className={input} value={aka} onChange={(e) => setAka(e.target.value)} />
      </label>
      <label>
        <span className={lbl}>Business licence number</span>
        <input className={input} value={f.licenceNo} onChange={set("licenceNo")} />
      </label>
      <label>
        <span className={lbl}>Licence valid until</span>
        <input type="date" className={input} value={f.licenceExpiry} onChange={set("licenceExpiry")} />
      </label>
      <label className="sm:col-span-2">
        <span className={lbl}>Licence copy (SharePoint link)</span>
        <input className={input} value={f.licenceEvidence} onChange={set("licenceEvidence")} placeholder="https://…sharepoint.com/…" />
      </label>
      <label>
        <span className={lbl}>Owner&rsquo;s tazkira or registration number</span>
        <input className={input} value={f.ownerId} onChange={set("ownerId")} />
      </label>
      <label>
        <span className={lbl}>Phone (from the licence, for call-backs)</span>
        <input className={input} value={f.phone} onChange={set("phone")} />
      </label>
      <label className="sm:col-span-2">
        <span className={lbl}>Address</span>
        <input className={input} value={f.address} onChange={set("address")} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" className={primaryBtn}>
          Save
        </button>
        <button type="button" className={quietBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}

type Panel = "edit" | "screen" | "bank" | "declare" | "suspend" | "reinstate" | null;

function SupplierCard({ s, can, act }: { s: SupplierRow; can: SuppliersView["can"]; act: (a: SupplierAction, msg: string) => Promise<void> }) {
  const [panel, setPanel] = useState<Panel>(null);
  const [f, setF] = useState<Record<string, string>>({});
  const v = (k: string) => f[k] ?? "";
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const done = (a: SupplierAction, msg: string) =>
    act(a, msg).then(() => {
      setPanel(null);
      setF({});
    });
  const sc = lastScreening(s);
  return (
    <li className="rounded-2xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-semibold">{s.name}</p>
          {s.aka.length > 0 && <p className="text-xs text-muted">Also: {s.aka.join(", ")}</p>}
          <p className="mt-0.5 font-mono text-[11px] text-muted">{s.id}</p>
        </div>
        {s.status === "suspended" ? <Pill tone="clay">Suspended</Pill> : s.gaps.length ? <Pill tone="ochre">{s.gaps.length} to resolve</Pill> : <Pill tone="forest">Ready</Pill>}
      </div>
      <dl className="mt-3 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[9rem_1fr]">
        <dt className="text-muted">Licence</dt>
        <dd>
          {s.licenceNo || "—"}
          {s.licenceExpiry && ` · valid until ${s.licenceExpiry}`}
          {s.licenceEvidence && (
            <a href={s.licenceEvidence} target="_blank" rel="noreferrer" className="ms-2 text-forest hover:underline">
              copy
            </a>
          )}
        </dd>
        <dt className="text-muted">Bank</dt>
        <dd>
          {s.bank ? (
            <>
              {s.bank.bank} …{s.bank.accountEnd} · confirmed by {s.bank.confirmedByName} on {s.bank.on} ({s.bank.how}){" "}
              <a href={s.bank.evidence} target="_blank" rel="noreferrer" className="text-forest hover:underline">
                letter
              </a>
            </>
          ) : (
            "Not confirmed"
          )}
        </dd>
        <dt className="text-muted">Last screened</dt>
        <dd>
          {sc ? (
            <>
              {sc.date} by {sc.byName}: {sc.result === "clear" ? "no match" : "MATCH"} · {sc.lists}{" "}
              <a href={sc.evidence} target="_blank" rel="noreferrer" className="text-forest hover:underline">
                record
              </a>
            </>
          ) : (
            "Never"
          )}
        </dd>
        <dt className="text-muted">No staff connection</dt>
        <dd>{s.noStaffLink ? `Declared ${s.noStaffLink.on}` : "Not declared"}</dd>
      </dl>
      {s.gaps.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-clay">
          {s.gaps.map((g) => (
            <li key={g}>· {g}</li>
          ))}
        </ul>
      )}

      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        {can.manage && (
          <>
            <button type="button" className={quietBtn} onClick={() => setPanel(panel === "edit" ? null : "edit")}>
              Edit details
            </button>
            <button type="button" className={quietBtn} onClick={() => setPanel(panel === "screen" ? null : "screen")}>
              Record a screening
            </button>
            {!s.noStaffLink && (
              <button type="button" className={quietBtn} onClick={() => setPanel(panel === "declare" ? null : "declare")}>
                File the declaration
              </button>
            )}
          </>
        )}
        {can.finance && (
          <button type="button" className={quietBtn} onClick={() => setPanel(panel === "bank" ? null : "bank")}>
            {s.bank ? "Change bank details" : "Confirm bank details"}
          </button>
        )}
        {(can.manage || can.finance) && s.status === "active" && (
          <button type="button" className={dangerBtn} onClick={() => setPanel(panel === "suspend" ? null : "suspend")}>
            Suspend
          </button>
        )}
        {can.manage && s.status === "suspended" && (
          <button type="button" className={quietBtn} onClick={() => setPanel(panel === "reinstate" ? null : "reinstate")}>
            Reinstate
          </button>
        )}
      </div>

      {panel === "edit" && (
        <div className="mt-3 border-t border-line pt-3">
          <DetailsForm start={{ name: s.name, aka: s.aka, licenceNo: s.licenceNo, licenceExpiry: s.licenceExpiry, licenceEvidence: s.licenceEvidence, ownerId: s.ownerId, phone: s.phone, address: s.address }} onSave={(fields) => done({ action: "edit", id: s.id, fields }, "Details saved.")} onCancel={() => setPanel(null)} />
        </div>
      )}
      {panel === "screen" && (
        <form
          className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void done({ action: "screen", id: s.id, date: v("date"), lists: v("lists"), result: (v("result") || "clear") as "clear" | "match", note: v("note"), evidence: v("evidence") }, "Screening recorded.");
          }}
        >
          <label>
            <span className={lbl}>Date screened</span>
            <input type="date" className={input} value={v("date")} onChange={set("date")} required />
          </label>
          <label>
            <span className={lbl}>Result</span>
            <select className={input} value={v("result") || "clear"} onChange={set("result")}>
              <option value="clear">No match</option>
              <option value="match">Match found</option>
            </select>
          </label>
          <label className="sm:col-span-2">
            <span className={lbl}>Lists checked</span>
            <input className={input} value={v("lists")} onChange={set("lists")} placeholder="UN Security Council, OFAC SDN, EU, World Bank debarment, UNGM" required />
          </label>
          <label className="sm:col-span-2">
            <span className={lbl}>Screening record (SharePoint link)</span>
            <input className={input} value={v("evidence")} onChange={set("evidence")} required />
          </label>
          <label className="sm:col-span-2">
            <span className={lbl}>Note (how any near match was resolved)</span>
            <input className={input} value={v("note")} onChange={set("note")} />
          </label>
          <p className="text-xs text-muted sm:col-span-2">A match suspends the supplier until a clear screening is recorded.</p>
          <button type="submit" className={`${primaryBtn} sm:col-span-2 sm:justify-self-start`}>
            Record screening
          </button>
        </form>
      )}
      {panel === "bank" && (
        <form
          className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            void done({ action: "bank", id: s.id, bank: v("bank"), accountEnd: v("accountEnd"), evidence: v("evidence"), how: v("how") }, "Bank details confirmed.");
          }}
        >
          <label>
            <span className={lbl}>Bank</span>
            <input className={input} value={v("bank")} onChange={set("bank")} required />
          </label>
          <label>
            <span className={lbl}>Last digits of the account</span>
            <input className={input} inputMode="numeric" value={v("accountEnd")} onChange={set("accountEnd")} required />
          </label>
          <label className="sm:col-span-2">
            <span className={lbl}>Bank letter (SharePoint link)</span>
            <input className={input} value={v("evidence")} onChange={set("evidence")} required />
          </label>
          <label className="sm:col-span-2">
            <span className={lbl}>How you confirmed it</span>
            <input className={input} value={v("how")} onChange={set("how")} placeholder="Called the owner on the number on the licence" required />
          </label>
          <p className="text-xs text-muted sm:col-span-2">Confirm through a different channel from the one that sent the details. A change is flagged on every open payment to this supplier.</p>
          <button type="submit" className={`${primaryBtn} sm:col-span-2 sm:justify-self-start`}>
            Confirm
          </button>
        </form>
      )}
      {panel === "declare" && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void done({ action: "noStaffLink", id: s.id, evidence: v("evidence") }, "Declaration filed.");
          }}
        >
          <label className="min-w-0 flex-1">
            <span className={lbl}>Signed declaration of no family or business link to ROP staff (SharePoint link)</span>
            <input className={input} value={v("evidence")} onChange={set("evidence")} required />
          </label>
          <button type="submit" className={primaryBtn}>
            File it
          </button>
        </form>
      )}
      {(panel === "suspend" || panel === "reinstate") && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3"
          onSubmit={(e) => {
            e.preventDefault();
            void done({ action: panel, id: s.id, reason: v("reason") }, panel === "suspend" ? "Supplier suspended." : "Supplier reinstated.");
          }}
        >
          <label className="min-w-0 flex-1">
            <span className={lbl}>Why</span>
            <input className={input} value={v("reason")} onChange={set("reason")} required />
          </label>
          <button type="submit" className={panel === "suspend" ? dangerBtn : primaryBtn}>
            {panel === "suspend" ? "Suspend" : "Reinstate"}
          </button>
        </form>
      )}

      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">History ({s.history.length})</summary>
        <ul className="mt-1 space-y-0.5">
          {[...s.history].reverse().map((h, i) => (
            <li key={i}>
              {h.at} · {h.byName}: {h.what}
            </li>
          ))}
        </ul>
      </details>
    </li>
  );
}

export function SuppliersPage() {
  const { user } = useRequireUser();
  const { ready } = useSession();
  const [v, setV] = useState<SuppliersView | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");
  const load = useCallback(async () => {
    if (!user) return;
    try {
      setV(await call(user.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user]);
  useEffect(() => {
    if (ready && user) void load();
  }, [ready, user, load]);
  if (!user) return null;
  const act = async (a: SupplierAction, msg: string) => {
    setError("");
    setNotice("");
    try {
      setV(await call(user.id, { method: "POST", body: JSON.stringify(a) }));
      setNotice(msg);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      throw e;
    }
  };
  const shown = (v?.suppliers ?? []).filter((s) => !q.trim() || [s.name, ...s.aka, s.licenceNo].some((n) => n.toLowerCase().includes(q.trim().toLowerCase())));
  const ready_ = (v?.suppliers ?? []).filter((s) => !s.gaps.length).length;

  return (
    <div className="min-h-screen">
      <TopBar active="procurement" />
      <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
        <Link href="/work?source=procurement" className="text-sm text-muted hover:text-ink">
          ← Procurement
        </Link>
        <h1 className="mt-2 font-display text-4xl tracking-tight">Suppliers</h1>
        <p className="mt-1 text-sm text-muted">
          Every supplier ROP buys from, across projects: licence, confirmed bank details, screenings and the declaration of no staff connection. Procurements pick from this list. Re-screen after {v?.rescreenMonths ?? 6} months.
        </p>
        {v && (
          <p className="mt-3 text-sm">
            {v.suppliers.length} {v.suppliers.length === 1 ? "supplier" : "suppliers"} · {ready_} ready to award and pay
          </p>
        )}
        {error && (
          <p role="alert" className="mt-3 rounded-xl bg-clay-soft px-4 py-3 text-sm text-clay">
            {error}
          </p>
        )}
        {notice && !error && (
          <p role="status" className="mt-3 rounded-xl bg-mist px-4 py-3 text-sm text-forest">
            {notice}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <input className="min-w-0 flex-1 rounded-xl border border-line bg-paper px-3 py-2.5 text-base" placeholder="Find by name or licence" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a supplier" />
          {v?.can.manage && !adding && (
            <button type="button" className={primaryBtn} onClick={() => setAdding(true)}>
              + Add a supplier
            </button>
          )}
        </div>
        {adding && (
          <section className="mt-4 rounded-2xl border border-line bg-surface p-4">
            <h2 className="mb-3 font-display text-xl">New supplier</h2>
            <DetailsForm start={empty} onSave={(fields) => act({ action: "add", fields }, `${fields.name} added. Screen it and have Finance confirm its bank details before an award.`).then(() => setAdding(false))} onCancel={() => setAdding(false)} />
          </section>
        )}
        {!v ? (
          <p className="mt-6 text-sm text-muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="mt-6 text-sm text-muted">{v.suppliers.length ? "No supplier matches." : "No suppliers yet. Add the first one with its licence."}</p>
        ) : (
          <ul className="mt-4 space-y-3">
            {shown.map((s) => (
              <SupplierCard key={s.id} s={s} can={v.can} act={act} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
