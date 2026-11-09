"use client";

import Link from "next/link";
import type { ClaimCheck } from "@/lib/qpr";

/**
 * The report's text checked against its evidence: each sentence the records do not bear out, why,
 * and the records that say so. Findings for people to judge; nothing is changed or blocked.
 */

const KIND: Record<ClaimCheck["issues"][number]["kind"], string> = { figure: "Figure", place: "Place", timing: "Timing", contradiction: "Evidence says otherwise" };

export function ClaimCheckPanel({ check, sections, headings, busy, mayRun, onRun }: { check?: ClaimCheck; sections: Record<string, string>; headings: Record<string, string>; busy: boolean; mayRun: boolean; onRun: () => void }) {
  const written = Object.entries(sections).filter(([, t]) => t.trim());
  if (!written.length) return null;
  const stale = !!check && written.some(([k, t]) => (check.sections[k] ?? "") !== t.trim());
  return (
    <section className="mt-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-semibold">Text against the evidence</p>
        <span className="text-xs text-muted">
          {check ? `Checked ${check.at.slice(0, 16).replace("T", " ")} UTC: ${check.checked} claims, ${check.issues.length} to look at.${stale ? " The text has changed since." : ""}` : "Each claim in the text compared with the quarter's records, photo dates and weekly updates."}
        </span>
        {mayRun && (
          <button type="button" className="ms-auto rounded-lg border border-line px-3 py-1.5 text-sm font-semibold hover:bg-sunken disabled:opacity-50" disabled={busy} onClick={onRun}>
            {busy ? "Checking… (up to a minute)" : check ? "Check again" : "Check the text against the evidence"}
          </button>
        )}
      </div>
      {check && check.issues.length > 0 && (
        <ul className="mt-3 space-y-2">
          {check.issues.map((i, k) => (
            <li key={k} className="rounded-lg bg-ochre-soft px-3 py-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-ochre">
                {KIND[i.kind]} · {headings[i.section] ?? i.section}
              </p>
              <p className="mt-1 italic">&ldquo;{i.sentence}&rdquo;</p>
              <p className="mt-1">{i.problem}</p>
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
            </li>
          ))}
        </ul>
      )}
      {check && check.issues.length === 0 && <p className="mt-2 text-leaf">Every claim matches the records.</p>}
    </section>
  );
}
