"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useT } from "@/components/app/i18n";
import { useSession } from "@/components/app/session";
import { SectionLabel, primaryBtn, quietBtn } from "@/components/workspace/ui";
import { roleOf, type DonorFunding } from "@/lib/donor-funding";
import type { fundingSetup } from "@/server/donor-view-store";

/**
 * Project settings: what each donor's grant pays for. A donor sees spending only for the budget
 * lines set here (the whole budget, or chosen lines), with cost-share lines in a block of their
 * own. Nothing about the budget changes: this only decides what each donor is shown.
 */

type Setup = Awaited<ReturnType<typeof fundingSetup>>;
type Role = "funded" | "share" | "none";

export function DonorFundingSection({ code, canEdit, donorsKey }: { code: string; canEdit: boolean; donorsKey: string }) {
  const { user } = useSession();
  const { tx } = useT();
  const [setup, setSetup] = useState<Setup | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const userId = user?.id;

  const load = useCallback(() => {
    if (!userId) return;
    fetch(`/api/projects/${encodeURIComponent(code)}/donor-funding`, { cache: "no-store", headers: { "x-demo-user": userId } })
      .then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error((d as { error?: string }).error ?? "Could not load what each donor funds.");
        setSetup(d as Setup);
        setError("");
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [code, userId]);
  // The donors' own list (above this section) is the cue to read again: a donor added or removed changes what applies.
  useEffect(() => load(), [load, donorsKey]);

  const save = async (donorId: string, funding: DonorFunding) => {
    const res = await fetch(`/api/projects/${encodeURIComponent(code)}/donor-funding`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "x-demo-user": userId ?? "" },
      body: JSON.stringify({ donorId, ...funding }),
    });
    if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `Not saved (${res.status})`);
    load();
  };

  if (!setup?.donors.length) return error ? <p role="alert" className="mt-6 text-sm text-clay">{error}</p> : null;
  const total = setup.lines.length;
  // A line paid by more than one grant is allowed (a co-funded line); each of those donors then sees its full figures.
  const twice = setup.lines.filter((l) => setup.donors.filter((d) => d.applies && roleOf(d.applies, l.code) === "funded").length > 1).length;
  const open = setup.donors.find((d) => d.id === editing);
  return (
    <section className="mt-8" aria-labelledby="funding-heading">
      <span id="funding-heading">
        <SectionLabel>{tx("What each donor funds")}</SectionLabel>
      </span>
      <p className="mt-2 text-sm text-muted">{tx("A donor sees spending only for the budget lines their grant pays for, and only as a released report gave it. Cost-share lines are shown to them apart.")}</p>
      {error && (
        <p role="alert" className="mt-3 text-sm text-clay">
          {error}
        </p>
      )}
      <ul className="mt-3 space-y-3">
        {setup.donors.map((d) => {
          const f = d.applies;
          const funded = f ? (f.lines === "all" ? total - f.share.length : f.lines.length) : 0;
          return (
            <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface p-5">
              <div className="min-w-0">
                <p className="font-semibold">{d.name}</p>
                <p className={`mt-1 text-sm ${f ? "text-muted" : "font-medium text-warn"}`}>
                  {!f
                    ? tx("Not set. This donor sees no spending until it is.")
                    : f.lines === "all"
                      ? d.saved
                        ? tx("Funds the whole budget.")
                        : tx("Funds the whole budget: taken as given, being the only donor.")
                      : tx("Funds {n} of {total} budget lines.", { n: funded, total })}
                  {f && f.share.length > 0 && ` ${tx("{n} cost-share lines.", { n: f.share.length })}`}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <Link href={`/progress/released?donor=${encodeURIComponent(d.id)}`} className="font-semibold text-forest hover:underline">
                  {tx("See what they see")} →
                </Link>
                {canEdit && (
                  <button type="button" onClick={() => setEditing(d.id)} className={quietBtn}>
                    {tx("Change")}
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {twice > 0 && <p className="mt-3 text-sm text-muted">{tx("{n} budget lines are marked as paid by more than one grant. That is right for a co-funded line: each of those donors then sees the line's full figures.", { n: twice })}</p>}
      {open && <FundingSheet donor={open} lines={setup.lines} onSave={(f) => save(open.id, f)} onClose={() => setEditing(null)} />}
    </section>
  );
}

function FundingSheet({ donor, lines, onSave, onClose }: { donor: Setup["donors"][number]; lines: Setup["lines"]; onSave: (f: DonorFunding) => Promise<void>; onClose: () => void }) {
  const { tx } = useT();
  const start = donor.applies;
  const [whole, setWhole] = useState(start ? start.lines === "all" : lines.length === 0);
  const [roles, setRoles] = useState<Record<string, Role>>(() => Object.fromEntries(lines.map((l) => [l.code, start ? (roleOf(start, l.code) ?? "none") : "none"])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  // With the whole budget, a line is paid by the grant unless it is cost share.
  const roleFor = (code: string): Role => (whole && roles[code] !== "share" ? "funded" : (roles[code] ?? "none"));
  const funded = lines.filter((l) => roleFor(l.code) === "funded").map((l) => l.code);
  const share = lines.filter((l) => roleFor(l.code) === "share").map((l) => l.code);
  const ready = whole || funded.length + share.length > 0;
  const setAll = (r: Role) => setRoles(Object.fromEntries(lines.map((l) => [l.code, r])));
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setError("");
    try {
      await onSave({ lines: whole ? "all" : funded, share });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };
  const amount = (l: Setup["lines"][number]) => (l.amount === null ? "" : `${l.currency} ${Math.round(l.amount).toLocaleString("en-US")}`);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 sm:items-center sm:p-4" onClick={onClose}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="funding-title"
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-full w-full flex-col overflow-y-auto bg-paper p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:max-w-2xl sm:rounded-2xl sm:border sm:border-line"
      >
        <h2 id="funding-title" className="font-display text-2xl">
          {tx("What {donor} funds", { donor: donor.name })}
        </h2>
        <fieldset className="mt-5">
          <legend className="text-sm font-medium">{tx("This grant pays for")}</legend>
          <div className="mt-2 flex flex-wrap gap-x-6 gap-y-2 text-base">
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={whole} onChange={() => setWhole(true)} className="h-5 w-5" />
              {tx("The whole budget")}
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="scope" checked={!whole} onChange={() => setWhole(false)} disabled={lines.length === 0} className="h-5 w-5" />
              {tx("These budget lines")}
            </label>
          </div>
        </fieldset>

        {lines.length === 0 ? (
          <p className="mt-4 rounded-xl bg-sunken px-4 py-3 text-sm text-muted">{tx("This project has no budget lines yet. Bring in the budget (Budget and spending) to choose lines or mark cost share.")}</p>
        ) : (
          <fieldset className="mt-5">
            <legend className="text-sm font-medium">{whole ? tx("Cost share: mark the lines Roots of Peace or a partner pays for") : tx("Each budget line: paid by this grant, cost share or not this donor's")}</legend>
            {!whole && (
              <p className="mt-1 text-sm">
                <button type="button" onClick={() => setAll("funded")} className="font-semibold text-forest hover:underline">
                  {tx("Mark all as paid by this grant")}
                </button>
                <span className="text-muted"> · </span>
                <button type="button" onClick={() => setAll("none")} className="font-semibold text-forest hover:underline">
                  {tx("Clear all")}
                </button>
              </p>
            )}
            <ul className="mt-2 divide-y divide-line rounded-xl border border-line bg-surface">
              {lines.map((l) => (
                <li key={l.code} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <label htmlFor={`fund-${l.code}`} className="min-w-0 flex-1 text-sm">
                    <span className="font-mono text-xs text-muted">{l.code} </span>
                    {l.description}
                    <span className="block text-xs text-muted">{[l.activity, amount(l)].filter(Boolean).join(" · ")}</span>
                  </label>
                  <select id={`fund-${l.code}`} value={roleFor(l.code)} onChange={(e) => setRoles({ ...roles, [l.code]: e.target.value as Role })} className="rounded-lg border border-line bg-paper px-2 py-2 text-sm">
                    <option value="funded">{tx("Paid by this grant")}</option>
                    <option value="share">{tx("Cost share")}</option>
                    {!whole && <option value="none">{tx("Not this donor's")}</option>}
                  </select>
                </li>
              ))}
            </ul>
          </fieldset>
        )}
        <p className="mt-4 text-sm text-muted">
          {whole ? tx("Paid by this grant: {n} lines.", { n: funded.length }) : tx("Paid by this grant: {n} of {total} lines.", { n: funded.length, total: lines.length })}
          {share.length > 0 && ` ${tx("Cost share: {n} lines.", { n: share.length })}`} {tx("The donor sees these figures from the next time they open a released report.")}
        </p>
        {error && (
          <p role="alert" className="mt-3 text-sm text-clay">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-wrap gap-3">
          <button type="submit" disabled={!ready || busy} className={`${primaryBtn} flex-1`}>
            {busy ? tx("Saving…") : tx("Save")}
          </button>
          <button type="button" onClick={onClose} className={quietBtn}>
            {tx("Cancel")}
          </button>
        </div>
      </form>
    </div>
  );
}
