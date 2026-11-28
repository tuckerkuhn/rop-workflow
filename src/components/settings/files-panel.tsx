"use client";

import { useState } from "react";
import type { OrgSettingsView } from "@/app/api/org/settings/route";
import { useSession } from "@/components/app/session";
import { primaryBtn } from "@/components/workspace/ui";
import { ReasonNeeded } from "@/components/settings/reason-needed";
import { ANY_LINK_RISK, STORES, type StoreId } from "@/lib/file-store";

/**
 * Organization settings: where files are kept, so which links the app takes as evidence, and what
 * the organization calls its accounting and payroll systems. Naming the file store is the safe
 * choice; "any secure link" is offered last, with what it costs, and needs the risk accepted.
 */

const field = "mt-1 block w-full rounded-sm border border-line bg-paper px-3 py-2 text-base";
const HELP: Record<StoreId, string> = {
  sharepoint: "Links to your organization's SharePoint site.",
  gdrive: "Links to Google Drive and Google Docs. Use a shared drive the organization owns, not a personal one.",
  onedrive: "Links to OneDrive.",
  dropbox: "Links to Dropbox. Use a team folder the organization owns.",
  any: ANY_LINK_RISK,
};

export function FilesPanel({ v, post }: { v: OrgSettingsView; post: (body: object, msg: string) => Promise<void> }) {
  const { refresh } = useSession();
  const [stores, setStores] = useState<StoreId[]>(v.files.stores);
  const [accounting, setAccounting] = useState(v.files.accounting);
  // ISS-24: links to filed vouchers are optional at month close unless the organization asks for them.
  const [linksRequired, setLinksRequired] = useState(!!v.files.linksRequired);
  const [payroll, setPayroll] = useState(v.files.payroll);
  const [acceptRisk, setAcceptRisk] = useState(false);
  const [why, setWhy] = useState("");
  const [busy, setBusy] = useState(false);
  const any = stores.includes("any");
  const changed = stores.slice().sort().join() !== v.files.stores.slice().sort().join() || accounting.trim() !== v.files.accounting || payroll.trim() !== v.files.payroll || linksRequired !== !!v.files.linksRequired;
  const toggle = (id: StoreId, on: boolean) => {
    setStores((s) => (on ? [...new Set([...s, id])] : s.filter((x) => x !== id)));
    if (id === "any" && !on) setAcceptRisk(false);
  };
  const save = async () => {
    setBusy(true);
    try {
      await post({ action: "files", stores, accounting, payroll, linksRequired, acceptRisk, reason: why }, "Saved. Evidence links are now checked against these.");
      setWhy("");
      setAcceptRisk(false);
      // The session carries the stores to every screen that checks a link.
      await refresh();
    } catch {
      /* shown above */
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="mt-6 border border-line bg-surface p-4" aria-labelledby="files-heading">
      <h2 id="files-heading" className="font-ledger text-xl font-bold">
        Where your files are kept
      </h2>
      <p className="mt-1 max-w-3xl text-sm text-muted">
        Proof in this app is a link to the file where your organization keeps it: an attendance sheet, a signed contract, a voucher. The app takes links only from the places chosen here, so proof stays where
        the organization controls it and an auditor can be let in.
      </p>
      {v.files.stores.includes("any") && (
        <p role="status" className="mt-3 border-s-[6px] border-clay bg-clay-soft px-3 py-2 text-sm text-clay">
          <span className="font-bold">Any secure link is on. </span>
          {ANY_LINK_RISK}
        </p>
      )}
      <ul className="mt-3 border-t-2 border-ink">
        {STORES.map((s) => {
          const on = stores.includes(s.id);
          const risky = s.id === "any";
          return (
            <li key={s.id} className={`border-b border-line ${risky && on ? "bg-clay-soft" : ""}`}>
              <label className={`flex min-h-12 items-start gap-3 px-2 py-3 ${v.admin ? "cursor-pointer hover:bg-ochre-soft" : ""}`}>
                <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={on} disabled={!v.admin || busy} onChange={(e) => toggle(s.id, e.target.checked)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">
                    {s.name}
                    {risky && <span className="ms-2 bg-clay px-2 py-0.5 font-mono text-xs uppercase text-paper">Not recommended</span>}
                  </span>
                  <span className={`block text-sm ${risky ? "text-clay" : "text-muted"}`}>{HELP[s.id]}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          What you call your accounting system
          <input className={field} value={accounting} maxLength={40} disabled={!v.admin} placeholder="For example QuickBooks, ERPNext, an Excel cashbook" onChange={(e) => setAccounting(e.target.value)} />
        </label>
        <label className="text-sm">
          What you call your payroll system
          <input className={field} value={payroll} maxLength={40} disabled={!v.admin} placeholder="For example a bank file, a payroll service" onChange={(e) => setPayroll(e.target.value)} />
        </label>
      </div>
      <label className="mt-3 flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-0.5" checked={linksRequired} disabled={!v.admin} onChange={(e) => setLinksRequired(e.target.checked)} />
        <span>
          Month close needs a link to each filed voucher in the file store
          <span className="block text-xs text-muted">Off: the link is asked for but a month can close without it. Leave the accounting system empty to use the app&apos;s own books at month close.</span>
        </span>
      </label>
      {v.admin && changed && (
        <div className="mt-4 border-s-[6px] border-ochre ps-3">
          {any && !v.files.stores.includes("any") && (
            <label className="mb-3 flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={acceptRisk} onChange={(e) => setAcceptRisk(e.target.checked)} />
              <span>
                <span className="font-semibold">I understand the risk and accept it for this organization.</span> Proof may sit in a personal account, and proof that cannot be opened at audit counts as no proof.
              </span>
            </label>
          )}
          <label className="text-sm">
            Why this is changing (kept with the change)
            <input className={field} value={why} onChange={(e) => setWhy(e.target.value)} />
          </label>
          <button type="button" className={`${primaryBtn} mt-3`} disabled={busy || !stores.length || why.trim().length < 5 || (any && !v.files.stores.includes("any") && !acceptRisk)} onClick={() => void save()}>
            Save
          </button>
          <ReasonNeeded reason={why} className="mt-2" />
          {any && !v.files.stores.includes("any") && !acceptRisk && <p className="mt-1 text-xs text-warn">Tick &ldquo;I understand the risk&rdquo; above to save with any secure link on.</p>}
          {!stores.length && <p className="mt-2 text-sm text-clay">Choose at least one place files are kept.</p>}
        </div>
      )}
      {v.filesChange && (
        <p className="mt-3 text-xs text-muted">
          Set by {v.filesChange.name} on {v.filesChange.at}: {v.filesChange.reason}
        </p>
      )}
    </section>
  );
}
