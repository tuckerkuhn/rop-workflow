"use client";

import Link from "next/link";
import { useState } from "react";
import { LookedAt } from "@/components/app/ai-why";
import { primaryBtn } from "@/components/workspace/ui";
import { voucherGaps, withholding } from "@/lib/payments";
import { ROUTES, committeeNeeded, isSharePointUrl, levelFor, reviewKey, routesFor, rulesInForce, valueOf, vendbillOf, type Draft, type Procurement, type Voucher } from "@/lib/procurement";
import { DEPARTMENTS, GL_EXPENSE, LOCATIONS, type Code } from "@/lib/voucher-codes";
import { codingFor, type VoucherSetup } from "@/lib/voucher-setup";
import { today } from "@/lib/clock";
import { lastScreening, type Supplier } from "@/lib/suppliers";

/**
 * Step panels for choosing how to buy: the route, the sole-source facts, and AI drafts of the
 * request for quotation, solicitation or sole-source justification, which procurement corrects.
 */

type Update = (fn: (p: Procurement) => Procurement) => void;
export type DraftKind = "rfq" | "solicitation" | "sole" | "package";
export const DRAFT_DOC: Record<DraftKind, string> = {
  rfq: "Request for quotation",
  solicitation: "Solicitation (RFQ/RFP)",
  sole: "Sole source justification",
  package: "Procurement package",
};

const box = "border-b border-line bg-paper/60 px-5 py-5";
const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none disabled:bg-paper disabled:text-muted";

/** Any change clears the reviewed mark, so the document is read again before it is signed. */
const unreview = (q: Procurement): Record<string, boolean> => {
  const checks = { ...q.checks };
  delete checks[reviewKey(q)];
  return checks;
};

export function RoutePicker({ p, editable, update }: { p: Procurement; editable: boolean; update: Update }) {
  const value = valueOf(p);
  const level = levelFor(value);
  const allowed = routesFor(level, value);
  const rif = rulesInForce();
  const soleAbove = typeof rif.soleSourceAboveUsd === "number" ? rif.soleSourceAboveUsd : 5000;
  const why = (id: string) =>
    id === "direct" ? `Only for Micro purchases (up to $${Number(rif.microMaxUsd ?? 500).toLocaleString("en-US")}).` : id === "sole" ? `Sole source applies only above $${soleAbove.toLocaleString("en-US")}; below that, compete as usual.` : "Micro purchases are bought directly.";
  return (
    <fieldset className={box} disabled={!editable}>
      <legend className="sr-only">How it is bought</legend>
      <p className="text-sm font-semibold">How will it be bought?</p>
      <p className="mt-1 text-xs text-muted">{level} purchase. {editable ? "Choose one." : "Chosen by procurement."}</p>
      <div className="mt-3 grid gap-2 sm:grid-cols-3">
        {ROUTES.map((r) => {
          const ok = allowed.includes(r.id);
          const on = p.route === r.id;
          return (
            <label
              key={r.id}
              className={`flex cursor-pointer flex-col rounded-xl border p-3 text-sm transition ${on ? "border-forest bg-mist" : "border-line bg-surface"} ${ok ? "" : "cursor-not-allowed opacity-50"}`}
            >
              <span className="flex items-center gap-2 font-medium">
                <input type="radio" name={`route-${p.id}`} checked={on} disabled={!ok || !editable} onChange={() => update((q) => ({ ...q, route: r.id }))} className="accent-[var(--forest)]" />
                {r.title}
              </span>
              <span className="mt-1 text-xs text-muted">{ok ? r.detail : why(r.id)}</span>
            </label>
          );
        })}
      </div>
      {(level === "Medium" || level === "Large") && p.route === "rfq" && (
        <div className="mt-4">
          <p className="text-sm font-semibold">How will bids be evaluated?</p>
          <div className="mt-2 flex flex-wrap gap-4 text-sm">
            {(
              [
                ["lowest", "Lowest price that meets every requirement"],
                ["bestValue", "Best value (weighted scoring; needs a bid committee)"],
              ] as const
            ).map(([id, label]) => (
              <label key={id} className="flex items-center gap-2">
                <input type="radio" name={`eval-${p.id}`} checked={(p.evaluation ?? "lowest") === id} disabled={!editable} onChange={() => update((q) => ({ ...q, evaluation: id }))} className="accent-[var(--forest)]" />
                {label}
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-muted">
            {committeeNeeded(p) ? "A bid committee evaluates this one." : "Below the committee threshold on lowest price: programme management may waive the committee with a signed certification."}
          </p>
        </div>
      )}
    </fieldset>
  );
}

/**
 * The chosen supplier, named at screening. On a real project it is picked from the supplier
 * register, so screening, licence and bank checks read the supplier's own record; the demo
 * project keeps a typed name.
 */
export function SupplierField({ p, editable, update, register }: { p: Procurement; editable: boolean; update: Update; register?: (Supplier & { gaps: string[] })[] | null }) {
  const name = p.supplier?.name ?? p.sole?.supplier ?? "";
  if (register) {
    const chosen = register.find((x) => x.id === p.supplier?.id);
    const pick = (id: string) => {
      const r = register.find((x) => x.id === id);
      update((q) => ({ ...q, supplier: r ? { id: r.id, name: r.name, screenedOn: lastScreening(r)?.date ?? "", licenceNo: r.licenceNo, licenceExpiry: r.licenceExpiry } : undefined, checks: unreview(q) }));
    };
    return (
      <fieldset className={box} disabled={!editable}>
        <legend className="sr-only">Supplier</legend>
        <label className="block text-sm font-semibold" htmlFor={`supplier-${p.id}`}>
          Chosen supplier
        </label>
        <p className="mt-1 text-xs text-muted">
          From the supplier register. Not there yet?{" "}
          <Link href="/work/suppliers" className="font-semibold text-forest hover:underline">
            Add it to the register
          </Link>{" "}
          with its licence, then screen it.
        </p>
        {/* The supplier of the chosen quotation, when it is in the register and not picked yet. */}
        {!chosen &&
          (() => {
            const bid = (p.bids ?? []).find((b) => b.id === p.selectedBid);
            const r = bid?.supplierId ? register.find((x) => x.id === bid.supplierId) : undefined;
            return r && editable ? (
              <button type="button" onClick={() => pick(r.id)} className="mt-2 rounded-full bg-forest px-4 py-2 text-sm font-semibold text-forest-ink">
                Use {r.name}, from the chosen quotation
              </button>
            ) : null;
          })()}
        <select id={`supplier-${p.id}`} value={chosen?.id ?? ""} onChange={(e) => pick(e.target.value)} className={`mt-2 ${field}`}>
          <option value="">{name && !chosen ? `${name} (not in the register: pick its record)` : "Pick a supplier"}</option>
          {register
            .filter((r) => r.status === "active" || r.id === chosen?.id)
            .map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
                {r.gaps.length ? ` · ${r.gaps.length} to resolve` : " · ready"}
              </option>
            ))}
        </select>
        {chosen && chosen.gaps.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-xs text-clay">
            {chosen.gaps.map((g) => (
              <li key={g}>· {g}</li>
            ))}
          </ul>
        )}
      </fieldset>
    );
  }
  return (
    <fieldset className={box} disabled={!editable}>
      <legend className="sr-only">Supplier</legend>
      <label className="block text-sm font-semibold" htmlFor={`supplier-${p.id}`}>
        Chosen supplier
      </label>
      <p className="mt-1 text-xs text-muted">Its registered name, as on its licence. The same name across purchases lets the app add up repeat buys.</p>
      <input
        id={`supplier-${p.id}`}
        value={name}
        onChange={(e) => update((q) => ({ ...q, supplier: e.target.value.trim() ? { name: e.target.value, screenedOn: today() } : undefined }))}
        className={`mt-2 ${field}`}
      />
    </fieldset>
  );
}

export function SoleFacts({ p, editable, update }: { p: Procurement; editable: boolean; update: Update }) {
  const sole = p.sole ?? { supplier: "", reason: "" };
  const set = (patch: Partial<typeof sole>) => update((q) => ({ ...q, sole: { ...sole, ...patch }, checks: unreview(q) }));
  return (
    <div className={box}>
      <p className="text-sm font-semibold">The supplier and why only they can supply it</p>
      <p className="mt-1 text-xs text-muted">Facts only: the draft is built from these and the request. Say what market check you did and how you know the price is fair.</p>
      <div className="mt-3 grid gap-3">
        <label>
          <span className="text-xs font-medium text-muted">Proposed supplier</span>
          <input disabled={!editable} value={sole.supplier} onChange={(e) => set({ supplier: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Why only this supplier, and why the price is reasonable</span>
          <textarea
            disabled={!editable}
            rows={4}
            value={sole.reason}
            onChange={(e) => set({ reason: e.target.value })}
            placeholder="e.g. Only licensed distributor of the certified seed variety in the province; called two other dealers, neither stocks it; price matches last year's purchase PR-2026-031 plus 4%."
            className={`mt-1 ${field}`}
          />
        </label>
      </div>
    </div>
  );
}

export function DraftPanel({
  p,
  kind,
  editable,
  update,
  onDraft,
}: {
  p: Procurement;
  kind: DraftKind;
  editable: boolean;
  update: Update;
  onDraft: (kind: DraftKind) => Promise<unknown>;
}) {
  const doc = DRAFT_DOC[kind];
  const draft = p.drafts?.[doc];
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const missingFacts = kind === "sole" && (!p.sole?.supplier.trim() || (p.sole?.reason.trim().length ?? 0) <= 20);

  const run = async () => {
    setBusy(true);
    setError("");
    try {
      await onDraft(kind);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  const setDraft = (next: Draft) => update((q) => ({ ...q, drafts: { ...q.drafts, [doc]: { ...next, edited: true, asIs: false } }, checks: unreview(q) }));

  return (
    <div className={box}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{doc}</p>
        {draft && (
          <p className="text-xs text-muted">
            AI draft ({draft.model}), {draft.at}
            {draft.edited ? (draft.asIs ? " · read, no changes needed" : " · corrected") : " · not yet read"}
          </p>
        )}
      </div>
      {/* A draft that is right as it stands: the person says they read it, rather than making a token edit. */}
      {draft && editable && !draft.edited && (
        <button
          type="button"
          onClick={() => update((q) => ({ ...q, drafts: { ...q.drafts, [doc]: { ...draft, edited: true, asIs: true } }, checks: unreview(q) }))}
          className="mt-2 rounded-full border border-line px-4 py-2 text-sm font-medium hover:bg-sunken"
        >
          I have read it all: no changes needed
        </button>
      )}
      {!draft ? (
        <p className="mt-1 text-sm text-muted">
          {editable ? "Draft it from the approved request with AI, then read and correct every section. Takes about a minute." : "Procurement drafts this from the request."}
        </p>
      ) : (
        <>
          {draft.questions.length > 0 && (
            <div className="mt-3 rounded-xl bg-ochre-soft px-3 py-2 text-sm">
              <p className="font-medium">Still to confirm</p>
              <ul className="mt-1 list-disc ps-5 text-xs">
                {draft.questions.map((q) => (
                  <li key={q}>{q}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 space-y-3">
            {draft.sections.map((s, i) => (
              <label key={i} className="block">
                <span className="text-xs font-semibold">{s.heading}</span>
                <textarea
                  disabled={!editable}
                  rows={Math.min(14, Math.max(3, Math.ceil(s.body.length / 90)))}
                  value={s.body}
                  onChange={(e) => setDraft({ ...draft, sections: draft.sections.map((x, k) => (k === i ? { ...x, body: e.target.value } : x)) })}
                  className={`mt-1 ${field} leading-relaxed`}
                />
              </label>
            ))}
          </div>
        </>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-clay-soft px-3 py-2 text-sm text-clay">
          {error}
        </p>
      )}
      {editable && (
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => void run()} disabled={busy || missingFacts} className={draft ? "rounded-full border border-line px-4 py-2 text-sm font-medium" : primaryBtn}>
            {busy ? "Drafting… about a minute" : draft ? (draft.edited && !draft.asIs ? "Draft again (replaces your corrections)" : "Draft again") : "Draft with AI"}
          </button>
          {missingFacts && <span className="text-xs text-muted">Add the supplier and the reason first.</span>}
        </div>
      )}
    </div>
  );
}

/** Runs the step's AI check; the findings show in the check list for the person to read. */
export function AiCheck({ p, editable, onCheck }: { p: Procurement; editable: boolean; onCheck: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const done = !!p.ai?.[p.step];
  if (!editable) return null;
  return (
    <div className="flex flex-wrap items-center gap-3 border-b border-line bg-plum-soft/40 px-5 py-3 text-sm">
      <span className="min-w-0 flex-1">
        {done ? "AI check run. Its findings are listed below: read each one before you confirm." : "Have AI check the record before you continue. It flags problems; you decide."}
        <LookedAt what="procurementCheck" className="mt-1" />
      </span>
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await onCheck();
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-full border border-line bg-surface px-4 py-2 font-medium"
      >
        {busy ? "Checking… under a minute" : done ? "Run the AI check again" : "Run AI check"}
      </button>
      {error && (
        <p role="alert" className="w-full text-clay">
          {error}
        </p>
      )}
    </div>
  );
}

/** A select of codes grouped as in the Excel voucher form, plus whatever code is already on the record. */
function CodeSelect({ codes, value, onChange, disabled, label }: { codes: Code[]; value: string; onChange: (v: string) => void; disabled: boolean; label: string }) {
  const groups = [...new Set(codes.map((c) => c.group ?? ""))];
  return (
    <label>
      <span className="text-xs font-medium text-muted">{label}</span>
      <select disabled={disabled} value={value} onChange={(e) => onChange(e.target.value)} className={`mt-1 ${field}`}>
        <option value="">Choose…</option>
        {value && !codes.some((c) => c.code === value) && <option value={value}>{value}</option>}
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {codes
              .filter((c) => (c.group ?? "") === g)
              .map((c) => (
                <option key={`${g}-${c.code}`} value={c.code}>
                  {c.code} {c.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

/**
 * Finance codes the expense voucher and enters it in NetSuite, typing the VENDBILL number it gets;
 * a second Finance person reviews it, and an approver (a third where Finance has one) approves it and files it in SharePoint. The codes start from the last
 * voucher on this project (same budget line first), so they are chosen once and then checked.
 */
export function VoucherPanel({ p, editable, update, coding, preparedByMe }: { p: Procurement; editable: boolean; update: Update; coding?: VoucherSetup | null; preparedByMe: boolean }) {
  const set0 = codingFor(coding, p.budgetLine);
  // Review and approval read the voucher; only the approver adds the SharePoint link when filing it.
  const reviewing = p.step === "voucherReview" || p.step === "voucherApprove";
  const approving = p.step === "voucherApprove";
  const fresh: Voucher = {
    number: "",
    month: today().slice(0, 7),
    date: today(),
    sharepointUrl: "",
    netsuiteRef: "",
    gl: "",
    dept: "",
    ...set0,
  };
  // Older records carried a made-up "EV-" number; the voucher's number is now NetSuite's VENDBILL number.
  const v: Voucher = p.voucher ? { ...fresh, ...p.voucher, number: vendbillOf(p.voucher) } : fresh;
  const set = (patch: Partial<Voucher>) => update((q) => ({ ...q, voucher: { ...v, ...patch } }));
  const badLink = !!v.sharepointUrl && !isSharePointUrl(v.sharepointUrl);
  const taxed = (withholding(p, v.date ?? today())?.amount ?? 0) > 0;
  const gaps = voucherGaps({ ...p, voucher: v });
  const codingOn = editable && !reviewing;
  const text = (k: "contract" | "budgetCode" | "bankGl" | "taxGl", label: string, placeholder: string) => (
    <label>
      <span className="text-xs font-medium text-muted">{label}</span>
      <input disabled={!codingOn} value={v[k] ?? ""} onChange={(e) => set({ [k]: e.target.value })} placeholder={placeholder} className={`mt-1 ${field}`} />
    </label>
  );
  return (
    <div className={box}>
      <p className="text-sm font-semibold">Expense voucher{v.number ? ` · NetSuite bill number (VENDBILL #) ${v.number}` : ""}</p>
      <p className="mt-1 text-xs text-muted">
        {approving
          ? "Open the voucher below. If it is in order, approve it and file the signed voucher in SharePoint. If not, send it back."
          : reviewing
          ? "Open the voucher below and check the coding and the balance. If something is wrong, send it back to the person who prepared it."
          : "Choose the expense account and department. The contract, budget code, location and accounts come from project setup. Then enter the bill in NetSuite and type the VENDBILL number it gives."}
      </p>
      {reviewing && preparedByMe && <p className="mt-2 text-sm text-clay">You prepared this voucher, so someone else in Finance {approving ? "approves" : "reviews"} it.</p>}

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <label>
          <span className="text-xs font-medium text-muted">Voucher date</span>
          <input disabled={!codingOn} type="date" value={v.date ?? ""} onChange={(e) => set({ date: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Accrued month</span>
          <input disabled={!codingOn} type="month" value={v.month} onChange={(e) => e.target.value && set({ month: e.target.value })} className={`mt-1 ${field}`} />
        </label>
        <label>
          <span className="text-xs font-medium text-muted">Monthly average rate (AFS to USD 1)</span>
          <input disabled={!codingOn} type="number" min={1} step="0.001" value={v.rate ?? ""} onChange={(e) => set({ rate: e.target.value ? Number(e.target.value) : undefined })} placeholder="from NetSuite" className={`mt-1 ${field}`} />
        </label>
        <CodeSelect label="Expense account (debit)" codes={GL_EXPENSE} value={v.gl ?? ""} onChange={(gl) => set({ gl })} disabled={!codingOn} />
        <CodeSelect label="Department" codes={DEPARTMENTS} value={v.dept ?? ""} onChange={(dept) => set({ dept })} disabled={!codingOn} />
        <CodeSelect label="Location" codes={LOCATIONS} value={v.location ?? ""} onChange={(location) => set({ location })} disabled={!codingOn} />
        {text("contract", "Contract", "e.g. ACRP-01003467")}
        {text("budgetCode", "Budget code", "e.g. PRG-1.2.2.D")}
        {text("bankGl", "Paid from (bank or cash account)", "e.g. 1020 Citibank")}
        {taxed && text("taxGl", "Withheld tax held in (account)", "e.g. 2300 Liabilities-Other")}
      </div>

      {!reviewing && (
        <div className="mt-4 grid gap-3 sm:grid-cols-[16rem_1fr] sm:items-end">
          <label>
            <span className="text-xs font-medium text-muted">NetSuite bill number (VENDBILL #)</span>
            <input disabled={!codingOn || gaps.length > 0} value={v.number} onChange={(e) => set({ number: e.target.value.trim() })} className={`mt-1 ${field}`} />
          </label>
          <p className="text-xs text-muted">{gaps.length ? `Before entering it in NetSuite, add ${gaps.join(", ")}.` : "Coded. Enter it in NetSuite and type the number it gets."}</p>
        </div>
      )}

      {approving && (
        <label className="mt-4 block">
          <span className="text-xs font-medium text-muted">SharePoint link to the signed voucher</span>
          <input
            disabled={!editable || preparedByMe}
            value={v.sharepointUrl}
            onChange={(e) => set({ sharepointUrl: e.target.value.trim() })}
            placeholder="https://rootsofpeace.sharepoint.com/…"
            className={`mt-1 ${field} ${badLink ? "border-clay" : ""}`}
          />
          {badLink && <span className="mt-1 block text-xs text-clay">Paste the link from SharePoint (…sharepoint.com/…).</span>}
        </label>
      )}
    </div>
  );
}
