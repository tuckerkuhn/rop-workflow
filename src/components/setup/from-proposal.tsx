"use client";

import { useEffect, useRef, useState } from "react";
import { Sheet } from "@/components/workspace/ledger";
import { field } from "@/components/setup/question";
import type { OriginChoice, SetupDefaults } from "@/lib/project-origin";
import type { ProjectDesign } from "@/lib/project-setup";

/**
 * Setup opened from a won proposal (or a matched opportunity): its name, donor, country and start
 * date fill the steps as defaults; the award's currency and ceiling are confirmed here. Saved
 * only with the project; the server links the proposal and the project both ways then.
 */

export type FromRecord = { proposal: string | null; opportunity: string | null; name: string | null };

export function useFromProposal(from: FromRecord, user: string | undefined, setDraft: React.Dispatch<React.SetStateAction<ProjectDesign>>) {
  const [defaults, setDefaults] = useState<SetupDefaults | null>(null);
  const [choice, setChoice] = useState<OriginChoice | null>(null);
  const [error, setError] = useState("");
  const done = useRef(false);
  useEffect(() => {
    if (done.current || !user || (!from.proposal && !from.opportunity)) return;
    done.current = true;
    const q = new URLSearchParams({ ...(from.proposal ? { proposal: from.proposal } : {}), ...(from.opportunity ? { opportunity: from.opportunity } : {}) });
    fetch(`/api/setup/origin?${q}`, { cache: "no-store", headers: { "x-demo-user": user } })
      .then(async (r) => {
        const body = (await r.json().catch(() => ({}))) as SetupDefaults & { error?: string };
        if (!r.ok) throw new Error(body.error ?? "The proposal could not be read. Fill in the steps by hand.");
        setDefaults(body);
        setChoice({ proposalId: body.proposalId, opportunityId: body.opportunityId, currency: body.currency, ceiling: body.ceiling });
        setDraft((d) => ({ ...d, name: body.name, donors: [body.donor], ...(body.country ? { country: body.country } : {}), ...(body.startDate ? { startDate: body.startDate, endDate: body.startDate } : {}) }));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [from.proposal, from.opportunity, user, setDraft]);
  return { defaults, choice, setChoice, error };
}

export function FromProposalPanel({ defaults, choice, onChange, error }: { defaults: SetupDefaults | null; choice: OriginChoice | null; onChange: (c: OriginChoice) => void; error: string }) {
  if (error)
    return (
      <p role="alert" className="mb-6 bg-clay-soft px-4 py-3 text-sm text-clay">
        {error}
      </p>
    );
  if (!defaults || !choice) return null;
  const what = defaults.proposalId ? "proposal" : "opportunity";
  return (
    <Sheet tone="gold" className="mb-6 text-sm">
      <p className="font-mono text-xs uppercase tracking-[0.12em] text-warn">From the {what}</p>
      <p className="mt-1 text-lg font-bold">{defaults.title}</p>
      <p className="mt-1">
        The name, the donor{defaults.country ? ", the country" : ""} and the start date are filled in from the {what}. Check each step before saving: nothing is created until you do.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs font-semibold">
          Award currency
          <input value={choice.currency} onChange={(e) => onChange({ ...choice, currency: e.target.value.toUpperCase().slice(0, 3) })} maxLength={3} className={`${field} font-mono`} />
        </label>
        <label className="text-xs font-semibold">
          Award ceiling
          <input
            type="number"
            min={0}
            step="any"
            inputMode="decimal"
            value={choice.ceiling ?? ""}
            onChange={(e) => onChange({ ...choice, ceiling: e.target.value === "" ? null : Number(e.target.value) })}
            className={`${field} font-mono`}
          />
        </label>
      </div>
      {defaults.winThemes.length > 0 && (
        <>
          <p className="mt-3 font-semibold">Win themes, kept with the project as context for drafts</p>
          <ul className="mt-1 list-disc ps-5">
            {defaults.winThemes.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </>
      )}
      {defaults.documents > 0 && <p className="mt-3">{defaults.documents === 1 ? "The call document is linked to the project, not copied." : `${defaults.documents} call documents are linked to the project, not copied.`}</p>}
      {defaults.missing.length > 0 && (
        <>
          <p className="mt-3 font-semibold">To settle</p>
          <ul className="mt-1 list-disc ps-5">
            {defaults.missing.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  );
}
