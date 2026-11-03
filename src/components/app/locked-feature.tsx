"use client";

import { useT } from "@/components/app/i18n";
import { Pill, quietBtn } from "@/components/workspace/ui";

/** Shown in place of a paid-plan feature the organization does not have. */

export function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

export function LockedFeature({ feature, why, onBack }: { feature: string; why: string; onBack?: () => void }) {
  const { t } = useT();
  return (
    <section className="mx-auto max-w-md rounded-2xl border border-line bg-surface p-6 text-center">
      <Pill tone="ochre">
        <LockIcon /> {t("plan.paid")}
      </Pill>
      <h2 className="mt-3 font-display text-2xl">{t("plan.locked", { feature })}</h2>
      <p className="mt-2 text-sm text-muted">{why}</p>
      <p className="mt-2 text-sm text-muted">{t("plan.ask")}</p>
      {onBack && (
        <button type="button" onClick={onBack} className={`${quietBtn} mt-5`}>
          {t("plan.back")}
        </button>
      )}
    </section>
  );
}
