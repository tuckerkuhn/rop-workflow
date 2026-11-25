"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorNote } from "@/components/app/error-note";
import { useSession } from "@/components/app/session";
import { LedgerRow, LedgerTable, SectionHead } from "@/components/workspace/ledger";
import { primaryBtn, quietBtn } from "@/components/workspace/ui";
import { plainError } from "@/lib/plain-error";
import type { ConfirmLinks } from "@/lib/target-details";
import type { TargetDetailsView } from "@/server/target-details";

/**
 * Suggested links from each target to its workplan item and budget line (lib/link-suggest), on
 * Target details and once in setup's review. Nothing is saved until a person picks "Use this" or
 * "Use all suggestions"; a plan approver may, everyone else reads.
 */

const COLS = "minmax(0,1fr) auto";
type Links = ConfirmLinks["links"];

export function LinkSuggestions({ view, apply, className }: { view: TargetDetailsView; apply: (links: Links) => Promise<void>; className?: string }) {
  // The budget line chosen where more than one pays for the same workplan item; the first until changed.
  const [pick, setPick] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const list = view.suggestions;
  if (!list.length) return null;
  const linkOf = (x: (typeof list)[number]) => ({ indicator: x.indicator, workplanCode: x.workplan?.code, budgetRef: x.budget.length ? (pick[x.indicator] ?? x.budget[0].code) : undefined });
  const run = (links: Links) => {
    setBusy(true);
    setError("");
    apply(links)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const can = view.can.edit;
  return (
    <section className={className} aria-labelledby="link-suggestions">
      <SectionHead
        id="link-suggestions"
        className=""
        aside={
          can && (
            <button type="button" className={`${primaryBtn} min-h-11`} disabled={busy} onClick={() => run(list.map(linkOf))}>
              Use all suggestions
            </button>
          )
        }
      >
        Suggested links
      </SectionHead>
      <p className="mt-2 text-sm text-muted">
        Each target needs the workplan item that delivers it and the budget line that pays for it. Without them the quarterly report cannot tell late work from work planned for later. These come from the workplan and the budget: check each one before you use it. Nothing is saved until you do.
      </p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <LedgerTable cols={COLS} head={["Target and what to link it to", ""]} label="Suggested links">
        {list.map((x, n) => {
          const t = view.targets.find((y) => y.code === x.indicator);
          return (
            <LedgerRow key={x.indicator} cols={COLS} n={n + 1} className="text-sm">
              <div className="min-w-0 space-y-1.5">
                <p className="font-semibold">
                  <span className="font-mono text-xs text-muted">{t?.donorCode ?? x.indicator}</span> {t?.name ?? x.indicator}
                </p>
                {x.workplan && (
                  <p>
                    Workplan item <span className="font-mono">{x.workplan.code}</span> {x.workplan.title}
                    <span className="block text-xs text-muted">Why: {x.workplan.reason}</span>
                  </p>
                )}
                {x.budget.length === 1 && (
                  <p>
                    Budget line <span className="font-mono">{x.budget[0].code}</span> {x.budget[0].description}
                    <span className="block text-xs text-muted">Why: {x.budget[0].reason}</span>
                  </p>
                )}
                {x.budget.length > 1 && (
                  <label className="block">
                    Budget line ({x.budget.length} pay for this item; choose one)
                    <select className="mt-1 block w-full rounded-sm border border-line bg-paper px-2 py-2 text-sm" value={pick[x.indicator] ?? x.budget[0].code} disabled={!can} onChange={(e) => setPick({ ...pick, [x.indicator]: e.target.value })}>
                      {x.budget.map((b) => (
                        <option key={b.code} value={b.code}>
                          {b.code} {b.description}
                        </option>
                      ))}
                    </select>
                    <span className="block text-xs text-muted">Why: {x.budget.find((b) => b.code === (pick[x.indicator] ?? x.budget[0].code))?.reason}</span>
                  </label>
                )}
              </div>
              {can && (
                <button type="button" className={`${quietBtn} min-h-11 self-center`} disabled={busy} onClick={() => run([linkOf(x)])} aria-label={`Use this for ${t?.name ?? x.indicator}`}>
                  Use this
                </button>
              )}
            </LedgerRow>
          );
        })}
      </LedgerTable>
    </section>
  );
}

/** Setup's review: the same suggestions once, after targets and the workplan are both saved. */
export function SetupLinkSuggestions({ code }: { code: string }) {
  const { user } = useSession();
  const [view, setView] = useState<TargetDetailsView | null>(null);
  const userId = user?.id;
  const url = `/api/projects/${code}/targets`;
  const call = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!userId) return;
      const res = await fetch(path, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", "x-demo-user": userId } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error((body as { error?: string }).error ?? plainError(res.status));
      setView(body as TargetDetailsView);
    },
    [userId],
  );
  useEffect(() => {
    // The suggestions are an extra here: if they cannot be read, the review shows without them.
    call(url).catch(() => setView(null));
  }, [call, url]);
  if (!view || !view.targets.length || !view.workplan.length || !view.suggestions.length) return null;
  return (
    <div className="mt-6">
      <LinkSuggestions view={view} apply={(links) => call(`${url}/links`, { method: "POST", body: JSON.stringify({ links }) })} />
      <p className="mt-2 text-sm">
        <Link href="/progress/targets" className="btn-link">
          Change a link on Target details
        </Link>
      </p>
    </div>
  );
}
