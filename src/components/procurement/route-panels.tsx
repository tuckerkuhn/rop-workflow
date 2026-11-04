"use client";

import { useState } from "react";
import { primaryBtn } from "@/components/workspace/ui";
import { ROUTES, levelFor, reviewKey, routesFor, valueOf, type Draft, type Procurement } from "@/lib/procurement";

/**
 * Step panels for choosing how to buy: the route, the sole-source facts, and AI drafts of the
 * request for quotation, solicitation or sole-source justification, which procurement corrects.
 */

type Update = (fn: (p: Procurement) => Procurement) => void;
export type DraftKind = "rfq" | "solicitation" | "sole";
export const DRAFT_DOC: Record<DraftKind, string> = { rfq: "Request for quotation", solicitation: "Solicitation (RFQ/RFP)", sole: "Sole source justification" };

const box = "border-b border-line bg-paper/60 px-5 py-5";
const field = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:border-forest focus:outline-none disabled:bg-paper disabled:text-muted";

/** Any change clears the reviewed mark, so the document is read again before it is signed. */
const unreview = (q: Procurement): Record<string, boolean> => {
  const checks = { ...q.checks };
  delete checks[reviewKey(q)];
  return checks;
};

export function RoutePicker({ p, editable, update }: { p: Procurement; editable: boolean; update: Update }) {
  const level = levelFor(valueOf(p));
  const allowed = routesFor(level);
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
              <span className="mt-1 text-xs text-muted">{ok ? r.detail : r.id === "direct" ? "Only for Micro purchases (up to $500)." : "Micro purchases are bought directly."}</span>
            </label>
          );
        })}
      </div>
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
  const setDraft = (next: Draft) => update((q) => ({ ...q, drafts: { ...q.drafts, [doc]: { ...next, edited: true } }, checks: unreview(q) }));

  return (
    <div className={box}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold">{doc}</p>
        {draft && (
          <p className="text-xs text-muted">
            AI draft ({draft.model}), {draft.at}
            {draft.edited ? " · corrected" : " · not yet corrected"}
          </p>
        )}
      </div>
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
            {busy ? "Drafting… about a minute" : draft ? "Draft again (replaces your corrections)" : "Draft with AI"}
          </button>
          {missingFacts && <span className="text-xs text-muted">Add the supplier and the reason first.</span>}
        </div>
      )}
    </div>
  );
}
