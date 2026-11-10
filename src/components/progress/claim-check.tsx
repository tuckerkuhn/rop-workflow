"use client";

import Link from "next/link";
import { LookedAt, Why } from "@/components/app/ai-why";
import { useT } from "@/components/app/i18n";
import { openClaims, type ClaimCheck } from "@/lib/qpr";

/**
 * The report's text checked against its evidence: each sentence the records do not bear out, why,
 * what the check looked at, and the records that say so. Each finding has two actions: fix the
 * text, or keep it as written. The choice is saved with the person's name and on the audit trail.
 * Findings for people to judge; nothing is changed or blocked by the check itself.
 */

const KIND: Record<ClaimCheck["issues"][number]["kind"], string> = { figure: "Figure", place: "Place", timing: "Timing", contradiction: "Evidence says otherwise" };
const action = "min-h-11 rounded-xl border px-4 text-sm font-semibold disabled:opacity-50";

export function ClaimCheckPanel({
  check,
  sections,
  headings,
  busy,
  mayRun,
  onRun,
  onDecide,
}: {
  check?: ClaimCheck;
  sections: Record<string, string>;
  headings: Record<string, string>;
  busy: boolean;
  mayRun: boolean;
  onRun: () => void;
  /** Records the person's choice on finding `index`; "fix" also takes them to the section. Null takes the choice back. */
  onDecide?: (index: number, choice: "fix" | "keep" | null) => void;
}) {
  const { t } = useT();
  const written = Object.entries(sections).filter(([, text]) => text.trim());
  if (!written.length) return null;
  const stale = !!check && written.some(([k, text]) => (check.sections[k] ?? "") !== text.trim());
  const open = openClaims(check).length;
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Text against the evidence</p>
        <span className="text-xs text-muted">
          {check ? `Checked ${check.at.slice(0, 16).replace("T", " ")} UTC: ${check.checked} claims, ${open} to look at.${stale ? " The text has changed since." : ""}` : "Each claim in the text compared with the quarter's records, photo dates and weekly updates."}
        </span>
        {mayRun && (
          <button type="button" className="ms-auto min-h-11 rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-sunken disabled:opacity-50" disabled={busy} onClick={onRun}>
            {busy ? "Checking… (up to a minute)" : check ? "Check again" : "Check the text against the evidence"}
          </button>
        )}
      </div>
      {check && check.issues.length > 0 && (
        <>
          <LookedAt what="claimCheck" className="mt-2" />
          <ul className="mt-3 space-y-2">
            {check.issues.map((i, k) => (
              <li key={k} className={`rounded-lg px-3 py-2 ${i.decided?.choice === "keep" ? "bg-sunken text-muted" : "bg-ochre-soft"}`}>
                <p className="text-xs font-semibold uppercase tracking-wide text-ochre">
                  {KIND[i.kind]} · {headings[i.section] ?? i.section}
                </p>
                <p className="mt-1 italic">&ldquo;{i.sentence}&rdquo;</p>
                <p className="mt-1">
                  <Why>{i.problem}</Why>
                </p>
                {i.evidence.length > 0 && (
                  <p className="mt-1 text-xs">
                    {i.evidence.some((e) => e.startsWith("r:")) && (
                      <Link href="/progress/results" className="font-semibold text-forest hover:underline">
                        The results →
                      </Link>
                    )}
                    {i.evidence.some((e) => e.startsWith("u:")) && (
                      <Link href="/progress/weekly" className="ms-3 font-semibold text-forest hover:underline">
                        The weekly updates →
                      </Link>
                    )}
                  </p>
                )}
                {i.decided ? (
                  <p className="mt-2 text-xs">
                    {t(i.decided.choice === "keep" ? "cc.kept" : "cc.fixing", { name: i.decided.name })}
                    {mayRun && onDecide && (
                      <button type="button" className="ms-2 min-h-11 font-semibold text-forest hover:underline" disabled={busy} onClick={() => onDecide(k, null)}>
                        {t("cc.undo")}
                      </button>
                    )}
                  </p>
                ) : (
                  mayRun &&
                  onDecide && (
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:flex">
                      <button type="button" className={`${action} border-forest bg-forest text-forest-ink`} disabled={busy} onClick={() => onDecide(k, "fix")}>
                        {t("cc.fix")}
                      </button>
                      <button type="button" className={`${action} border-line bg-paper`} disabled={busy} onClick={() => onDecide(k, "keep")}>
                        {t("cc.keep")}
                      </button>
                    </div>
                  )
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {check && check.issues.length === 0 && <p className="mt-2 text-leaf">Every claim matches the records.</p>}
    </section>
  );
}
