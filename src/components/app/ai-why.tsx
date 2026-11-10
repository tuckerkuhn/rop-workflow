"use client";

import { useT } from "@/components/app/i18n";

/**
 * Beside every flag or suggestion: what it looked at, in one plain line. The reason itself (the
 * "why") is the flag's own sentence; this says where that sentence came from, so a person can
 * judge how far to trust it. One component, so every flag says it the same way.
 */
export type Looker = "dataChecks" | "claimCheck" | "procurementCheck" | "koboSuggest";

export function LookedAt({ what, className = "" }: { what: Looker; className?: string }) {
  const { t } = useT();
  return (
    <p className={`text-xs text-muted ${className}`}>
      <span className="font-semibold">{t("ai.looked")}</span> {t(`ai.looks.${what}`)}
    </p>
  );
}

/** The label in front of a flag's reason. */
export function Why({ children }: { children: React.ReactNode }) {
  const { t } = useT();
  return (
    <>
      <span className="font-semibold">{t("ai.why")}</span> {children}
    </>
  );
}
